import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuditAction,
  AuditEntryDto,
  AuditListResponse,
  ListAuditQuery,
} from '@opsgraph/shared';
import { RequestContext } from '../common/context/request-context';
import { Errors } from '../common/errors/app-error';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { redact } from './redact';

export interface AuditRecordInput {
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  actorType?: 'user' | 'system' | 'anonymous';
  actorId?: string;
}

interface ResolvedActor {
  actorType: 'user' | 'system' | 'anonymous';
  actorId: string | null;
}

type JsonInput = Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;

function toJsonInput(value: unknown): JsonInput {
  if (value === undefined) {
    return undefined;
  }
  const redacted = redact(value);
  if (redacted === null || redacted === undefined) {
    return Prisma.JsonNull;
  }
  return redacted;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContext,
  ) {}

  async record(tx: Tx, input: AuditRecordInput): Promise<void> {
    await tx.auditEntry.create({ data: this.buildData(input) });
  }

  async recordMany(tx: Tx, inputs: AuditRecordInput[]): Promise<void> {
    const chunkSize = 1_000;
    for (let offset = 0; offset < inputs.length; offset += chunkSize) {
      const chunk = inputs.slice(offset, offset + chunkSize);
      await tx.auditEntry.createMany({ data: chunk.map((input) => this.buildData(input)) });
    }
  }

  async recordStandalone(input: AuditRecordInput): Promise<void> {
    await this.prisma.auditEntry.create({ data: this.buildData(input) });
  }

  async list(query: ListAuditQuery): Promise<AuditListResponse> {
    const where: Prisma.AuditEntryWhereInput = {};
    if (query.actorId !== undefined) {
      where.actorId = query.actorId;
    }
    if (query.action !== undefined) {
      where.action = query.action;
    }
    if (query.targetType !== undefined) {
      where.targetType = query.targetType;
    }
    if (query.targetId !== undefined) {
      where.targetId = query.targetId;
    }
    if (query.from !== undefined || query.to !== undefined) {
      where.occurredAt = {
        ...(query.from !== undefined ? { gte: new Date(query.from) } : {}),
        ...(query.to !== undefined ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.cursor !== undefined) {
      if (!/^\d+$/.test(query.cursor)) {
        throw Errors.validation([
          { path: 'cursor', message: 'Cursor must be a positive integer id' },
        ]);
      }
      where.id = { lt: BigInt(query.cursor) };
    }

    const rows = await this.prisma.auditEntry.findMany({
      where,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const actorIds = [...new Set(page.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
    const actors =
      actorIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, email: true },
          })
        : [];
    const emailById = new Map(actors.map((actor) => [actor.id, actor.email]));

    const items: AuditEntryDto[] = page.map((row) => ({
      id: row.id.toString(),
      occurredAt: row.occurredAt.toISOString(),
      actorType: row.actorType as AuditEntryDto['actorType'],
      actorId: row.actorId,
      actorEmail: row.actorId ? (emailById.get(row.actorId) ?? null) : null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      before: row.before,
      after: row.after,
      metadata: row.metadata,
      correlationId: row.correlationId,
      ipAddress: row.ipAddress,
    }));

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private buildData(input: AuditRecordInput): Prisma.AuditEntryUncheckedCreateInput {
    const actor = this.resolveActor(input);
    return {
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      before: toJsonInput(input.before),
      after: toJsonInput(input.after),
      metadata: toJsonInput(input.metadata),
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: this.requestContext.correlationId,
      ipAddress: this.requestContext.ip ?? null,
    };
  }

  private resolveActor(input: AuditRecordInput): ResolvedActor {
    if (input.actorType) {
      return { actorType: input.actorType, actorId: input.actorId ?? null };
    }
    const userId = this.requestContext.userId ?? input.actorId;
    if (userId) {
      return { actorType: 'user', actorId: userId };
    }
    return { actorType: 'anonymous', actorId: null };
  }
}
