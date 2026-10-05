import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Import } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  IMPORT_MAX_ROWS,
  type ImportCounts,
  type ImportKind,
  type ImportReport,
} from '@opsgraph/shared';
import { AuditService, type AuditRecordInput } from '../audit/audit.service';
import { RequestContext } from '../common/context/request-context';
import { Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { toDbKind, toImportReport } from './import.mapper';
import { parseJsonImport } from './parsing/json-import.parser';
import type { ParsedImport, RowError } from './parsing/parsed-import';
import { ImportSnapshotLoader } from './persistence/import-snapshot.loader';
import { ImportWriter, type ImportActor, type ImportCountsByKind } from './persistence/import-writer';
import type { ImportPlan } from './planning/import-plan';
import { planImport } from './planning/import-planner';
import { collectRejectedEntityKeys, validateRows } from './validation/row-validator';

export interface RunImportInput {
  format: 'json' | 'csv';
  kind?: ImportKind;
  fileName: string;
  byteSize: number;
  content: Uint8Array;
  dryRun?: boolean;
  skipIfNoChanges?: boolean;
  trigger?: 'API' | 'SEED';
  actor: ImportActor;
}

const KIND_ORDER: Record<ImportKind, number> = {
  entities: 0,
  relationships: 1,
  events: 2,
};

function compareField(left: string | null, right: string | null): number {
  const a = left ?? '';
  const b = right ?? '';
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortRowErrors(errors: readonly RowError[]): RowError[] {
  return [...errors].sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      left.row - right.row ||
      compareField(left.field, right.field),
  );
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContext,
    private readonly audit: AuditService,
    private readonly snapshotLoader: ImportSnapshotLoader,
    private readonly writer: ImportWriter,
  ) {}

  async refuse(reason: 'bytes' | 'rows', limit: number, actual?: number): Promise<never> {
    await this.audit.recordStandalone({
      action: AUDIT_ACTIONS.IMPORT_REFUSED,
      metadata: { reason, limit, ...(actual !== undefined ? { actual } : {}) },
    });
    throw Errors.importTooLarge();
  }

  async run(input: RunImportInput): Promise<ImportReport | null> {
    const now = new Date();
    const receivedAt = new Date();
    const parsed = this.parse(input);

    const totalRows = parsed.rows.length + parsed.rowErrors.length;
    if (totalRows > IMPORT_MAX_ROWS) {
      await this.refuse('rows', IMPORT_MAX_ROWS, totalRows);
    }

    const fileLevel = parsed.fileErrors.length > 0;
    const validation = fileLevel ? { rows: [], errors: [] } : validateRows(parsed.rows, now);
    const rejectedEntityRows = fileLevel
      ? new Map<string, number>()
      : collectRejectedEntityKeys(parsed.rows, validation.errors);

    const importRow = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('opsgraph:graph-import'))`;

        let plan: ImportPlan | null = null;
        if (!fileLevel) {
          const snapshot = await this.snapshotLoader.load(
            tx,
            validation.rows,
            rejectedEntityRows,
          );
          plan = planImport(validation.rows, snapshot, { now, receivedAt, newId: randomUUID });
        }

        const allErrors = sortRowErrors([
          ...parsed.rowErrors,
          ...validation.errors,
          ...(plan?.errors ?? []),
        ]);
        const outcome: Import['outcome'] =
          fileLevel || allErrors.length > 0
            ? 'REJECTED'
            : input.dryRun === true
              ? 'DRY_RUN'
              : 'APPLIED';

        if (
          input.skipIfNoChanges === true &&
          outcome === 'APPLIED' &&
          (plan?.changeCount ?? 0) === 0
        ) {
          return null;
        }

        const counts = this.buildCounts(parsed, validation.errors, plan, fileLevel);
        const row = await this.writer.writeImport(tx, {
          id: randomUUID(),
          trigger: input.trigger ?? 'API',
          format: input.format === 'json' ? 'JSON' : 'CSV',
          csvKind: input.format === 'csv' && input.kind !== undefined ? toDbKind(input.kind) : null,
          dryRun: input.dryRun === true,
          outcome,
          actorType: input.actor.type,
          submittedById: input.actor.type === 'user' ? (input.actor.id ?? null) : null,
          fileName: input.fileName,
          byteSize: input.byteSize,
          receivedAt,
          counts,
          fileErrors: parsed.fileErrors,
          rowErrors: allErrors,
          correlationId: this.requestContext.correlationId,
        });

        if (outcome === 'APPLIED' && plan !== null) {
          await this.writer.applyPlan(tx, row.id, plan, receivedAt, input.actor);
        }

        await this.audit.record(
          tx,
          this.summaryAudit(outcome, row.id, input, counts, allErrors.length),
        );

        return row;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    if (importRow === null) {
      return null;
    }

    const submitter =
      importRow.submittedById === null
        ? null
        : await this.prisma.user.findUnique({
            where: { id: importRow.submittedById },
            select: { id: true, email: true },
          });

    return toImportReport(importRow, submitter);
  }

  private parse(input: RunImportInput): ParsedImport {
    if (input.format === 'json') {
      return parseJsonImport(input.content);
    }
    throw Errors.validation([{ path: 'format', message: 'CSV imports are not supported yet' }]);
  }

  private buildCounts(
    parsed: ParsedImport,
    staticErrors: readonly RowError[],
    plan: ImportPlan | null,
    fileLevel: boolean,
  ): ImportCountsByKind {
    const build = (kind: ImportKind): ImportCounts => {
      const received =
        parsed.rows.filter((row) => row.kind === kind).length +
        parsed.rowErrors.filter((error) => error.kind === kind).length;
      if (fileLevel) {
        return { received, created: 0, updated: 0, unchanged: 0, rejected: received };
      }
      const planCounts = plan?.counts[kind] ?? {
        created: 0,
        updated: 0,
        unchanged: 0,
        rejected: 0,
      };
      const parserRejected = parsed.rowErrors.filter((error) => error.kind === kind).length;
      const staticRejected = staticErrors.filter((error) => error.kind === kind).length;
      return {
        received,
        created: planCounts.created,
        updated: planCounts.updated,
        unchanged: planCounts.unchanged,
        rejected: planCounts.rejected + parserRejected + staticRejected,
      };
    };

    return {
      entities: build('entities'),
      relationships: build('relationships'),
      events: build('events'),
    };
  }

  private summaryAudit(
    outcome: Import['outcome'],
    importId: string,
    input: RunImportInput,
    counts: ImportCountsByKind,
    errorCount: number,
  ): AuditRecordInput {
    const action =
      outcome === 'APPLIED'
        ? AUDIT_ACTIONS.IMPORT_APPLIED
        : outcome === 'DRY_RUN'
          ? AUDIT_ACTIONS.IMPORT_DRY_RUN
          : AUDIT_ACTIONS.IMPORT_REJECTED;
    const after =
      outcome === 'APPLIED'
        ? { format: input.format, kind: input.kind ?? null, counts }
        : { format: input.format, kind: input.kind ?? null, counts, errorCount };

    return {
      action,
      targetType: 'import',
      targetId: importId,
      after,
      actorType: input.actor.type,
      ...(input.actor.id !== undefined ? { actorId: input.actor.id } : {}),
    };
  }
}
