import type { Import } from '@prisma/client';
import type { ImportCounts, ImportKind, ImportReport, ImportRowError } from '@opsgraph/shared';
import type { RowError } from './parsing/parsed-import';

export interface ImportCountsByKind {
  entities: ImportCounts;
  relationships: ImportCounts;
  events: ImportCounts;
}

export function toApiKind(kind: Import['csvKind']): ImportKind | null {
  switch (kind) {
    case 'ENTITIES':
      return 'entities';
    case 'RELATIONSHIPS':
      return 'relationships';
    case 'EVENTS':
      return 'events';
    default:
      return null;
  }
}

export function toDbKind(kind: ImportKind): 'ENTITIES' | 'RELATIONSHIPS' | 'EVENTS' {
  switch (kind) {
    case 'entities':
      return 'ENTITIES';
    case 'relationships':
      return 'RELATIONSHIPS';
    case 'events':
      return 'EVENTS';
  }
}

function toRowError(error: RowError): ImportRowError {
  return {
    kind: error.kind,
    row: error.row,
    field: error.field,
    message: error.message,
    dependsOn: error.dependsOn ?? null,
  };
}

function toCounts(counts: Import['counts']): ImportCountsByKind {
  return counts as unknown as ImportCountsByKind;
}

function toFileErrors(fileErrors: Import['fileErrors']): string[] {
  return fileErrors as unknown as string[];
}

function toRowErrors(rowErrors: Import['rowErrors']): ImportRowError[] {
  return (rowErrors as unknown as RowError[]).map(toRowError);
}

export function toImportReport(
  row: Import,
  submitter: { id: string; email: string } | null,
): ImportReport {
  return {
    id: row.id,
    outcome: row.outcome,
    countsAreProjected: row.outcome !== 'APPLIED',
    trigger: row.trigger,
    format: row.format === 'JSON' ? 'json' : 'csv',
    kind: toApiKind(row.csvKind),
    dryRun: row.dryRun,
    fileName: row.fileName,
    byteSize: row.byteSize,
    receivedAt: row.receivedAt.toISOString(),
    submittedBy: submitter,
    counts: toCounts(row.counts),
    fileErrors: toFileErrors(row.fileErrors),
    rowErrors: toRowErrors(row.rowErrors),
  };
}
