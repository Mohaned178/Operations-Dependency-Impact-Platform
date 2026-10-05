import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditAction } from '@opsgraph/shared';
import { RequestContext } from '../common/context/request-context';
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

  async recordStandalone(input: AuditRecordInput): Promise<void> {
    await this.prisma.auditEntry.create({ data: this.buildData(input) });
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
