import { Injectable } from '@nestjs/common';
import { Prisma, type Import } from '@prisma/client';
import type { ImportCounts } from '@opsgraph/shared';
import { AuditService, type AuditRecordInput } from '../../audit/audit.service';
import type { Tx } from '../../prisma/prisma.service';
import type { RowError } from '../parsing/parsed-import';
import type { ImportPlan } from '../planning/import-plan';

const CHUNK_SIZE = 1_000;

function chunk<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += CHUNK_SIZE) {
    chunks.push(items.slice(offset, offset + CHUNK_SIZE));
  }
  return chunks;
}

export interface ImportCountsByKind {
  entities: ImportCounts;
  relationships: ImportCounts;
  events: ImportCounts;
}

export interface ImportRecordInput {
  id: string;
  trigger: 'API' | 'SEED';
  format: 'JSON' | 'CSV';
  csvKind: 'ENTITIES' | 'RELATIONSHIPS' | 'EVENTS' | null;
  dryRun: boolean;
  outcome: 'APPLIED' | 'REJECTED' | 'DRY_RUN';
  actorType: 'user' | 'system';
  submittedById: string | null;
  fileName: string;
  byteSize: number;
  receivedAt: Date;
  counts: ImportCountsByKind;
  fileErrors: string[];
  rowErrors: RowError[];
  correlationId: string;
}

export interface ImportActor {
  type: 'user' | 'system';
  id?: string;
}

@Injectable()
export class ImportWriter {
  constructor(private readonly audit: AuditService) {}

  async writeImport(tx: Tx, input: ImportRecordInput): Promise<Import> {
    return tx.import.create({
      data: {
        id: input.id,
        trigger: input.trigger,
        format: input.format,
        csvKind: input.csvKind,
        dryRun: input.dryRun,
        outcome: input.outcome,
        actorType: input.actorType,
        submittedById: input.submittedById,
        fileName: input.fileName,
        byteSize: input.byteSize,
        receivedAt: input.receivedAt,
        counts: input.counts as unknown as Prisma.InputJsonValue,
        fileErrors: input.fileErrors,
        rowErrors: input.rowErrors as unknown as Prisma.InputJsonValue,
        correlationId: input.correlationId,
      },
    });
  }

  async applyPlan(
    tx: Tx,
    importId: string,
    plan: ImportPlan,
    receivedAt: Date,
    actor: ImportActor,
  ): Promise<void> {
    await this.createEntities(tx, plan);
    await this.createIdentifiers(tx, plan, receivedAt);
    await this.createRelationships(tx, plan, importId);
    await this.createEvents(tx, plan, importId);
    await this.replaceEventEntities(tx, plan);
    await this.createSourceRecords(tx, plan, importId, receivedAt);
    await this.createStateObservations(tx, plan, importId, receivedAt);
    await this.updateProjections(tx, plan, importId);
    await this.audit.recordMany(
      tx,
      plan.write.audits.map((audit) => this.toAuditInput(audit, importId, actor)),
    );
  }

  private async createEntities(tx: Tx, plan: ImportPlan): Promise<void> {
    for (const part of chunk(plan.write.entityInserts)) {
      await tx.entity.createMany({
        data: part.map((entity) => ({
          id: entity.id,
          type: entity.type,
          displayName: entity.displayName,
          attributes: entity.attributes,
          currentState: entity.currentState,
          lastObservedAt: entity.lastObservedAt,
        })),
      });
    }
  }

  private async createIdentifiers(tx: Tx, plan: ImportPlan, receivedAt: Date): Promise<void> {
    for (const part of chunk(plan.write.identifierInserts)) {
      await tx.entityIdentifier.createMany({
        data: part.map((identifier) => ({
          id: identifier.id,
          entityId: identifier.entityId,
          entityType: identifier.entityType,
          sourceSystem: identifier.sourceSystem,
          sourceId: identifier.sourceId,
          createdAt: receivedAt,
        })),
      });
    }
  }

  private async createRelationships(tx: Tx, plan: ImportPlan, importId: string): Promise<void> {
    for (const part of chunk(plan.write.relationshipInserts)) {
      await tx.relationship.createMany({
        data: part.map((relationship) => ({
          id: relationship.id,
          type: relationship.type,
          fromEntityId: relationship.fromEntityId,
          toEntityId: relationship.toEntityId,
          origin: relationship.origin,
          confidence: relationship.confidence,
          basis: relationship.basis,
          sourceSystem: relationship.sourceSystem,
          sourceId: relationship.sourceId,
          observedAt: relationship.observedAt,
          importId,
        })),
      });
    }
  }

  private async createEvents(tx: Tx, plan: ImportPlan, importId: string): Promise<void> {
    for (const part of chunk(plan.write.eventInserts)) {
      await tx.event.createMany({
        data: part.map((event) => ({
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt,
          observedAt: event.observedAt,
          description: event.description,
          sourceSystem: event.sourceSystem,
          sourceId: event.sourceId,
          importId,
        })),
      });
    }
  }

  private async replaceEventEntities(tx: Tx, plan: ImportPlan): Promise<void> {
    for (const part of chunk(plan.write.eventRelatedReplacements)) {
      await tx.eventEntity.deleteMany({ where: { eventId: { in: part }, role: 'RELATED' } });
    }
    for (const part of chunk(plan.write.eventEntityInserts)) {
      await tx.eventEntity.createMany({ data: part });
    }
  }

  private async createSourceRecords(
    tx: Tx,
    plan: ImportPlan,
    importId: string,
    receivedAt: Date,
  ): Promise<void> {
    const records = [...plan.write.sourceRecords].sort(
      (left, right) => left.seqOrder - right.seqOrder,
    );
    for (const part of chunk(records)) {
      await tx.sourceRecord.createMany({
        data: part.map((record) => ({
          id: record.id,
          kind: record.kind,
          sourceSystem: record.sourceSystem,
          sourceId: record.sourceId,
          observedAt: record.observedAt,
          receivedAt,
          rawPayload: record.rawPayload as Prisma.InputJsonValue,
          payloadHash: record.payloadHash,
          normalized: record.normalized as unknown as Prisma.InputJsonValue,
          importId,
          entityId: record.entityId,
          relationshipId: record.relationshipId,
          eventId: record.eventId,
        })),
      });
    }
  }

  private async createStateObservations(
    tx: Tx,
    plan: ImportPlan,
    importId: string,
    receivedAt: Date,
  ): Promise<void> {
    const observations = [...plan.write.stateObservations].sort(
      (left, right) => left.seqOrder - right.seqOrder,
    );
    for (const part of chunk(observations)) {
      await tx.stateObservation.createMany({
        data: part.map((observation) => ({
          id: observation.id,
          entityId: observation.entityId,
          sourceRecordId: observation.sourceRecordId,
          state: observation.state,
          sourceStatus: observation.sourceStatus,
          sourceSystem: observation.sourceSystem,
          sourceId: observation.sourceId,
          observedAt: observation.observedAt,
          receivedAt,
          importId,
        })),
      });
    }
  }

  private async updateProjections(tx: Tx, plan: ImportPlan, importId: string): Promise<void> {
    for (const entity of plan.write.entityUpdates) {
      await tx.entity.update({
        where: { id: entity.id },
        data: {
          displayName: entity.displayName,
          attributes: entity.attributes,
          currentState: entity.currentState,
          lastObservedAt: entity.lastObservedAt,
        },
      });
    }
    for (const relationship of plan.write.relationshipUpdates) {
      await tx.relationship.update({
        where: { id: relationship.id },
        data: {
          type: relationship.type,
          fromEntityId: relationship.fromEntityId,
          toEntityId: relationship.toEntityId,
          origin: relationship.origin,
          confidence: relationship.confidence,
          basis: relationship.basis,
          sourceSystem: relationship.sourceSystem,
          sourceId: relationship.sourceId,
          observedAt: relationship.observedAt,
          importId,
        },
      });
    }
    for (const event of plan.write.eventUpdates) {
      await tx.event.update({
        where: { id: event.id },
        data: {
          type: event.type,
          occurredAt: event.occurredAt,
          observedAt: event.observedAt,
          description: event.description,
          sourceSystem: event.sourceSystem,
          sourceId: event.sourceId,
          importId,
        },
      });
    }
  }

  private toAuditInput(
    audit: ImportPlan['write']['audits'][number],
    importId: string,
    actor: ImportActor,
  ): AuditRecordInput {
    return {
      action: audit.action,
      targetType: audit.targetType,
      targetId: audit.targetId,
      before: audit.before,
      after: audit.after,
      metadata: { importId, sourceRecordId: audit.sourceRecordId },
      actorType: actor.type,
      ...(actor.id !== undefined ? { actorId: actor.id } : {}),
    };
  }
}
