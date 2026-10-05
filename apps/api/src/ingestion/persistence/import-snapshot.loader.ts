import { Injectable } from '@nestjs/common';
import type { EntityRef, EntityType } from '@opsgraph/shared';
import type { Tx } from '../../prisma/prisma.service';
import type { ValidatedRow } from '../parsing/parsed-import';
import {
  identifierKey,
  recordKey,
  type ImportSnapshot,
  type NormalizedEntity,
  type NormalizedEvent,
  type NormalizedRelationship,
  type ObservationRecord,
  type SnapshotEntity,
  type SnapshotEvent,
  type SnapshotIdentifier,
  type SnapshotRelationship,
  type StateObservationRecord,
} from '../planning/import-plan';

const CHUNK_SIZE = 5_000;

function chunk<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += CHUNK_SIZE) {
    chunks.push(items.slice(offset, offset + CHUNK_SIZE));
  }
  return chunks;
}

interface EntityKeyRef {
  entityType: EntityType;
  sourceSystem: string;
  sourceId: string;
}

interface RecordKeyRef {
  sourceSystem: string;
  sourceId: string;
}

@Injectable()
export class ImportSnapshotLoader {
  async load(
    tx: Tx,
    rows: readonly ValidatedRow[],
    rejectedEntityRows: ReadonlyMap<string, number> = new Map(),
  ): Promise<ImportSnapshot> {
    const entityKeys = new Map<string, EntityKeyRef>();
    const entityIds = new Set<string>();
    const relationshipKeys = new Map<string, RecordKeyRef>();
    const eventKeys = new Map<string, RecordKeyRef>();

    const collectRef = (ref: EntityRef): void => {
      if ('id' in ref) {
        entityIds.add(ref.id);
      } else {
        entityKeys.set(identifierKey(ref.entityType, ref.sourceSystem, ref.sourceId), {
          entityType: ref.entityType,
          sourceSystem: ref.sourceSystem,
          sourceId: ref.sourceId,
        });
      }
    };

    for (const row of rows) {
      if (row.kind === 'entities') {
        entityKeys.set(identifierKey(row.value.type, row.value.sourceSystem, row.value.sourceId), {
          entityType: row.value.type,
          sourceSystem: row.value.sourceSystem,
          sourceId: row.value.sourceId,
        });
        if (row.value.entityRef !== undefined) {
          collectRef(row.value.entityRef);
        }
      } else if (row.kind === 'relationships') {
        relationshipKeys.set(recordKey(row.value.sourceSystem, row.value.sourceId), {
          sourceSystem: row.value.sourceSystem,
          sourceId: row.value.sourceId,
        });
        collectRef(row.value.from);
        collectRef(row.value.to);
      } else {
        eventKeys.set(recordKey(row.value.sourceSystem, row.value.sourceId), {
          sourceSystem: row.value.sourceSystem,
          sourceId: row.value.sourceId,
        });
        collectRef(row.value.subject);
        for (const ref of row.value.related) {
          collectRef(ref);
        }
      }
    }

    const identifiersByKey = await this.loadIdentifiers(tx, entityKeys);
    const allEntityIds = new Set<string>([
      ...entityIds,
      ...[...identifiersByKey.values()].map((identifier) => identifier.entityId),
    ]);
    const entitiesById = await this.loadEntities(tx, allEntityIds);
    const relationships = await this.loadRelationships(tx, relationshipKeys);
    const events = await this.loadEvents(tx, eventKeys);
    const touchedEntityIds = [...entitiesById.keys()];
    const touchedRelationshipIds = [...relationships.values()].map(
      (relationship) => relationship.id,
    );
    const touchedEventIds = [...events.values()].map((event) => event.id);

    const [entityObservations, stateObservations, relationshipObservations, eventObservations] =
      await Promise.all([
        this.loadEntityObservations(tx, touchedEntityIds),
        this.loadStateObservations(tx, touchedEntityIds),
        this.loadRelationshipObservations(tx, touchedRelationshipIds),
        this.loadEventObservations(tx, touchedEventIds),
      ]);

    const [sourceRecordMax, stateObservationMax] = await Promise.all([
      tx.sourceRecord.aggregate({ _max: { seq: true } }),
      tx.stateObservation.aggregate({ _max: { seq: true } }),
    ]);

    return {
      maxSourceRecordSeq: Number(sourceRecordMax._max.seq ?? 0),
      maxStateObservationSeq: Number(stateObservationMax._max.seq ?? 0),
      entitiesById,
      identifiersByKey,
      entityObservations,
      stateObservations,
      relationshipsById: relationships,
      relationshipsByKey: relationships,
      relationshipObservations,
      eventsById: events,
      eventsByKey: events,
      eventObservations,
      rejectedEntityRows,
    };
  }

  private async loadIdentifiers(
    tx: Tx,
    keys: ReadonlyMap<string, EntityKeyRef>,
  ): Promise<Map<string, SnapshotIdentifier>> {
    const result = new Map<string, SnapshotIdentifier>();
    if (keys.size === 0) {
      return result;
    }
    const sourceIds = [...new Set([...keys.values()].map((key) => key.sourceId))];
    for (const part of chunk(sourceIds)) {
      const found = await tx.entityIdentifier.findMany({ where: { sourceId: { in: part } } });
      for (const identifier of found) {
        const key = identifierKey(
          identifier.entityType,
          identifier.sourceSystem,
          identifier.sourceId,
        );
        if (keys.has(key)) {
          result.set(key, {
            entityId: identifier.entityId,
            entityType: identifier.entityType,
            sourceSystem: identifier.sourceSystem,
            sourceId: identifier.sourceId,
          });
        }
      }
    }
    return result;
  }

  private async loadEntities(tx: Tx, ids: ReadonlySet<string>): Promise<Map<string, SnapshotEntity>> {
    const result = new Map<string, SnapshotEntity>();
    for (const part of chunk([...ids])) {
      const found = await tx.entity.findMany({ where: { id: { in: part } } });
      for (const entity of found) {
        result.set(entity.id, { id: entity.id, type: entity.type });
      }
    }
    return result;
  }

  private async loadRelationships(
    tx: Tx,
    keys: ReadonlyMap<string, RecordKeyRef>,
  ): Promise<Map<string, SnapshotRelationship>> {
    const result = new Map<string, SnapshotRelationship>();
    if (keys.size === 0) {
      return result;
    }
    const sourceIds = [...new Set([...keys.values()].map((key) => key.sourceId))];
    for (const part of chunk(sourceIds)) {
      const found = await tx.relationship.findMany({ where: { sourceId: { in: part } } });
      for (const relationship of found) {
        const key = recordKey(relationship.sourceSystem, relationship.sourceId);
        if (keys.has(key)) {
          result.set(key, {
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
            importId: relationship.importId,
          });
        }
      }
    }
    return result;
  }

  private async loadEvents(
    tx: Tx,
    keys: ReadonlyMap<string, RecordKeyRef>,
  ): Promise<Map<string, SnapshotEvent>> {
    const result = new Map<string, SnapshotEvent>();
    if (keys.size === 0) {
      return result;
    }
    const sourceIds = [...new Set([...keys.values()].map((key) => key.sourceId))];
    for (const part of chunk(sourceIds)) {
      const found = await tx.event.findMany({
        where: { sourceId: { in: part } },
        include: { entities: true },
      });
      for (const event of found) {
        const key = recordKey(event.sourceSystem, event.sourceId);
        if (!keys.has(key)) {
          continue;
        }
        result.set(key, {
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt,
          observedAt: event.observedAt,
          description: event.description,
          subjectEntityId:
            event.entities.find((link) => link.role === 'SUBJECT')?.entityId ?? '',
          relatedEntityIds: event.entities
            .filter((link) => link.role === 'RELATED')
            .map((link) => link.entityId),
          sourceSystem: event.sourceSystem,
          sourceId: event.sourceId,
          importId: event.importId,
        });
      }
    }
    return result;
  }

  private async loadEntityObservations(
    tx: Tx,
    entityIds: Iterable<string>,
  ): Promise<Map<string, ObservationRecord<NormalizedEntity>[]>> {
    const result = new Map<string, ObservationRecord<NormalizedEntity>[]>();
    const ids = [...entityIds];
    if (ids.length === 0) {
      return result;
    }
    for (const part of chunk(ids)) {
      const found = await tx.sourceRecord.findMany({
        where: { entityId: { in: part }, kind: 'ENTITY' },
        orderBy: { seq: 'asc' },
      });
      for (const record of found) {
        if (record.entityId === null) {
          continue;
        }
        const observations = result.get(record.entityId) ?? [];
        observations.push({
          observedAt: record.observedAt,
          seqOrder: Number(record.seq),
          payloadHash: record.payloadHash,
          sourceSystem: record.sourceSystem,
          sourceId: record.sourceId,
          importId: record.importId,
          normalized: record.normalized as unknown as NormalizedEntity,
        });
        result.set(record.entityId, observations);
      }
    }
    return result;
  }

  private async loadStateObservations(
    tx: Tx,
    entityIds: Iterable<string>,
  ): Promise<Map<string, StateObservationRecord[]>> {
    const result = new Map<string, StateObservationRecord[]>();
    const ids = [...entityIds];
    if (ids.length === 0) {
      return result;
    }
    for (const part of chunk(ids)) {
      const found = await tx.stateObservation.findMany({
        where: { entityId: { in: part } },
        orderBy: { seq: 'asc' },
      });
      for (const observation of found) {
        const observations = result.get(observation.entityId) ?? [];
        observations.push({
          observedAt: observation.observedAt,
          seqOrder: Number(observation.seq),
          state: observation.state,
          sourceStatus: observation.sourceStatus,
          sourceSystem: observation.sourceSystem,
        });
        result.set(observation.entityId, observations);
      }
    }
    return result;
  }

  private async loadRelationshipObservations(
    tx: Tx,
    relationshipIds: Iterable<string>,
  ): Promise<Map<string, ObservationRecord<NormalizedRelationship>[]>> {
    const result = new Map<string, ObservationRecord<NormalizedRelationship>[]>();
    const ids = [...relationshipIds];
    if (ids.length === 0) {
      return result;
    }
    for (const part of chunk(ids)) {
      const found = await tx.sourceRecord.findMany({
        where: { relationshipId: { in: part }, kind: 'RELATIONSHIP' },
        orderBy: { seq: 'asc' },
      });
      for (const record of found) {
        if (record.relationshipId === null) {
          continue;
        }
        const observations = result.get(record.relationshipId) ?? [];
        observations.push({
          observedAt: record.observedAt,
          seqOrder: Number(record.seq),
          payloadHash: record.payloadHash,
          sourceSystem: record.sourceSystem,
          sourceId: record.sourceId,
          importId: record.importId,
          normalized: record.normalized as unknown as NormalizedRelationship,
        });
        result.set(record.relationshipId, observations);
      }
    }
    return result;
  }

  private async loadEventObservations(
    tx: Tx,
    eventIds: Iterable<string>,
  ): Promise<Map<string, ObservationRecord<NormalizedEvent>[]>> {
    const result = new Map<string, ObservationRecord<NormalizedEvent>[]>();
    const ids = [...eventIds];
    if (ids.length === 0) {
      return result;
    }
    for (const part of chunk(ids)) {
      const found = await tx.sourceRecord.findMany({
        where: { eventId: { in: part }, kind: 'EVENT' },
        orderBy: { seq: 'asc' },
      });
      for (const record of found) {
        if (record.eventId === null) {
          continue;
        }
        const observations = result.get(record.eventId) ?? [];
        observations.push({
          observedAt: record.observedAt,
          seqOrder: Number(record.seq),
          payloadHash: record.payloadHash,
          sourceSystem: record.sourceSystem,
          sourceId: record.sourceId,
          importId: record.importId,
          normalized: record.normalized as unknown as NormalizedEvent,
        });
        result.set(record.eventId, observations);
      }
    }
    return result;
  }
}
