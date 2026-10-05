import {
  RELATIONSHIP_RULES,
  type EntityRef,
  type EntityType,
  type RelationshipType,
} from '@opsgraph/shared';
import type { RowError, ValidatedRow } from '../parsing/parsed-import';
import { payloadHash } from './canonical-json';
import {
  identifierKey,
  recordKey,
  type EntityIdentifierInsert,
  type ImportPlan,
  type ImportSnapshot,
  type ImportWriteSet,
  type NormalizedEntity,
  type NormalizedEvent,
  type NormalizedRelationship,
  type PlanContext,
  type PlanCounts,
  type PlannedEntityRow,
  type PlannedEventRow,
  type PlannedRelationshipRow,
  type RowClassification,
  type SourceRecordInsert,
  type StateObservationInsert,
} from './import-plan';
import {
  nonEmpty,
  projectEntity,
  projectEvent,
  projectRelationship,
  type EntityObservation,
  type EntityProjection,
  type EntityStateObservation,
  type EventObservation,
  type EventProjection,
  type RelationshipObservation,
  type RelationshipProjection,
} from './projections';

interface InFileEntityKey {
  entityId: string | null;
  hasOwnKeyRow: boolean;
  hasRefRow: boolean;
  establishedByRow: number | null;
  rejectedRows: number[];
}

interface InFileRelationship {
  id: string;
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
}

interface InFileEvent {
  id: string;
  type: string;
  subjectEntityId: string;
}

interface EntityWorking {
  type: EntityType;
  observations: EntityObservation[];
  states: EntityStateObservation[];
  newObservations: number;
  createdInFile: boolean;
}

interface RelationshipWorking {
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
  sourceSystem: string;
  sourceId: string;
  observations: RelationshipObservation[];
  newObservations: number;
  createdInFile: boolean;
}

interface EventWorking {
  type: string;
  subjectEntityId: string;
  sourceSystem: string;
  sourceId: string;
  observations: EventObservation[];
  newObservations: number;
  createdInFile: boolean;
}

type RefTarget = { entityId: string; entityType: EntityType };
type RefResult = { ok: true; target: RefTarget } | { ok: false; error: RowError };

function formatRuleSide(types: readonly EntityType[] | null): string {
  return types === null ? 'any' : types.join(' | ');
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value) => right.includes(value));
}

export function planImport(
  rows: readonly ValidatedRow[],
  snapshot: ImportSnapshot,
  context: PlanContext,
): ImportPlan {
  const errors: RowError[] = [];
  const write: ImportWriteSet = {
    entityInserts: [],
    entityUpdates: [],
    identifierInserts: [],
    relationshipInserts: [],
    relationshipUpdates: [],
    eventInserts: [],
    eventUpdates: [],
    eventEntityInserts: [],
    eventRelatedReplacements: [],
    sourceRecords: [],
    stateObservations: [],
    audits: [],
  };

  const counts = {
    entities: { created: 0, updated: 0, unchanged: 0, rejected: 0 } satisfies PlanCounts,
    relationships: { created: 0, updated: 0, unchanged: 0, rejected: 0 } satisfies PlanCounts,
    events: { created: 0, updated: 0, unchanged: 0, rejected: 0 } satisfies PlanCounts,
  };

  const flags = rows.map(() => ({ ambiguous: false, duplicate: false }));
  const hashes = rows.map((row) => payloadHash(row.parsed.raw));

  const entityRowPlans = new Map<number, PlannedEntityRow>();
  const relationshipRowPlans = new Map<number, PlannedRelationshipRow>();
  const eventRowPlans = new Map<number, PlannedEventRow>();

  const inFileEntityKeys = new Map<string, InFileEntityKey>();
  const entityWorking = new Map<string, EntityWorking>();
  const inFileRelationships = new Map<string, InFileRelationship>();
  const relationshipWorking = new Map<string, RelationshipWorking>();
  const inFileEvents = new Map<string, InFileEvent>();
  const eventWorking = new Map<string, EventWorking>();

  function keyOf(row: ValidatedRow): string {
    if (row.kind === 'entities') {
      return identifierKey(row.value.type, row.value.sourceSystem, row.value.sourceId);
    }
    return recordKey(row.value.sourceSystem, row.value.sourceId);
  }

  function markAmbiguities(kind: ValidatedRow['kind']): void {
    const groups = new Map<string, { indices: number[]; hashes: Set<string> }>();
    rows.forEach((row, index) => {
      if (row.kind !== kind) {
        return;
      }
      const groupKey = `${keyOf(row)}\u0000${row.value.observedAt}`;
      const group = groups.get(groupKey) ?? { indices: [], hashes: new Set<string>() };
      group.indices.push(index);
      group.hashes.add(hashes[index] ?? '');
      groups.set(groupKey, group);
    });

    for (const group of groups.values()) {
      if (group.hashes.size > 1) {
        const rowNumbers = group.indices.map((index) => rows[index]?.parsed.row ?? 0);
        for (const index of group.indices) {
          flags[index] = { ambiguous: true, duplicate: false };
          const row = rows[index];
          if (row !== undefined) {
            errors.push({
              kind,
              row: row.parsed.row,
              field: null,
              message: `Ambiguous: rows ${rowNumbers.join(', ')} have the same key and observedAt but different content`,
            });
          }
        }
      } else {
        for (let position = 1; position < group.indices.length; position += 1) {
          const index = group.indices[position];
          if (index !== undefined) {
            flags[index] = { ambiguous: false, duplicate: true };
          }
        }
      }
    }
  }

  function count(kind: ValidatedRow['kind'], classification: RowClassification): void {
    counts[kind][classification] += 1;
  }

  function rowError(
    kind: ValidatedRow['kind'],
    row: number,
    field: string | null,
    message: string,
    dependsOn?: { kind: ValidatedRow['kind']; row: number },
  ): RowError {
    return { kind, row, field, message, ...(dependsOn ? { dependsOn } : {}) };
  }

  function entityState(entityId: string, type: EntityType, createdInFile: boolean): EntityWorking {
    let state = entityWorking.get(entityId);
    if (state === undefined) {
      state = {
        type,
        observations: [...(snapshot.entityObservations.get(entityId) ?? [])],
        states: [...(snapshot.stateObservations.get(entityId) ?? [])],
        newObservations: 0,
        createdInFile,
      };
      entityWorking.set(entityId, state);
    }
    return state;
  }

  function relationshipState(
    id: string,
    type: RelationshipType,
    fromEntityId: string,
    toEntityId: string,
    sourceSystem: string,
    sourceId: string,
    createdInFile: boolean,
  ): RelationshipWorking {
    let state = relationshipWorking.get(id);
    if (state === undefined) {
      state = {
        type,
        fromEntityId,
        toEntityId,
        sourceSystem,
        sourceId,
        observations: [...(snapshot.relationshipObservations.get(id) ?? [])],
        newObservations: 0,
        createdInFile,
      };
      relationshipWorking.set(id, state);
    }
    return state;
  }

  function eventState(
    id: string,
    type: string,
    subjectEntityId: string,
    sourceSystem: string,
    sourceId: string,
    createdInFile: boolean,
  ): EventWorking {
    let state = eventWorking.get(id);
    if (state === undefined) {
      state = {
        type,
        subjectEntityId,
        sourceSystem,
        sourceId,
        observations: [...(snapshot.eventObservations.get(id) ?? [])],
        newObservations: 0,
        createdInFile,
      };
      eventWorking.set(id, state);
    }
    return state;
  }

  function resolveRef(
    kind: ValidatedRow['kind'],
    row: number,
    field: string,
    ref: EntityRef,
  ): RefResult {
    if ('id' in ref) {
      const entity = snapshot.entitiesById.get(ref.id);
      if (entity === undefined) {
        return { ok: false, error: rowError(kind, row, field, `Entity ${ref.id} does not exist`) };
      }
      return { ok: true, target: { entityId: entity.id, entityType: entity.type } };
    }

    const key = identifierKey(ref.entityType, ref.sourceSystem, ref.sourceId);
    const identifier = snapshot.identifiersByKey.get(key);
    if (identifier !== undefined) {
      const entity = snapshot.entitiesById.get(identifier.entityId);
      return {
        ok: true,
        target: {
          entityId: identifier.entityId,
          entityType: entity?.type ?? identifier.entityType,
        },
      };
    }

    const inFile = inFileEntityKeys.get(key);
    if (inFile !== undefined) {
      if (inFile.entityId !== null) {
        if (!inFile.hasOwnKeyRow) {
          return {
            ok: false,
            error: rowError(
              kind,
              row,
              field,
              "Reference chains are not supported; reference the entity's own key or OpsGraph id",
            ),
          };
        }
        const working = entityWorking.get(inFile.entityId);
        const stored = snapshot.entitiesById.get(inFile.entityId);
        const entityType = working?.type ?? stored?.type;
        if (entityType !== undefined) {
          return { ok: true, target: { entityId: inFile.entityId, entityType } };
        }
      } else {
        const rejectedRow = inFile.rejectedRows[0];
        if (rejectedRow !== undefined) {
          return {
            ok: false,
            error: rowError(kind, row, field, `Depends on rejected entities row ${rejectedRow}`, {
              kind: 'entities',
              row: rejectedRow,
            }),
          };
        }
      }
    }

    return {
      ok: false,
      error: rowError(
        kind,
        row,
        field,
        `No entity with key ${ref.entityType}/${ref.sourceSystem}/${ref.sourceId}`,
      ),
    };
  }

  function isStoredObservation(
    observations: readonly {
      observedAt: Date;
      payloadHash: string;
      sourceSystem: string;
      sourceId: string;
    }[],
    sourceSystem: string,
    sourceId: string,
    observedAt: string,
    hash: string,
  ): boolean {
    return observations.some(
      (observation) =>
        observation.sourceSystem === sourceSystem &&
        observation.sourceId === sourceId &&
        observation.observedAt.getTime() === new Date(observedAt).getTime() &&
        observation.payloadHash === hash,
    );
  }

  function entityAuditValue(
    working: EntityWorking,
    projection: EntityProjection,
  ): Record<string, unknown> {
    return {
      type: working.type,
      displayName: projection.displayName,
      attributes: projection.attributes,
      currentState: projection.currentState,
      lastObservedAt: projection.lastObservedAt.toISOString(),
    };
  }

  function relationshipAuditValue(
    working: RelationshipWorking,
    projection: RelationshipProjection,
  ): unknown {
    return {
      type: working.type,
      fromEntityId: working.fromEntityId,
      toEntityId: working.toEntityId,
      origin: projection.origin,
      confidence: projection.confidence,
      basis: projection.basis,
      observedAt: projection.observedAt.toISOString(),
    };
  }

  function eventAuditValue(working: EventWorking, projection: EventProjection): unknown {
    return {
      type: working.type,
      occurredAt: projection.occurredAt.toISOString(),
      description: projection.description,
      subjectEntityId: working.subjectEntityId,
      relatedEntityIds: projection.relatedEntityIds,
    };
  }

  for (const [key, row] of snapshot.rejectedEntityRows) {
    inFileEntityKeys.set(key, {
      entityId: null,
      hasOwnKeyRow: false,
      hasRefRow: false,
      establishedByRow: null,
      rejectedRows: [row],
    });
  }

  markAmbiguities('entities');
  markAmbiguities('relationships');
  markAmbiguities('events');

  function processEntityRow(row: ValidatedRow & { kind: 'entities' }, index: number): void {
    const parsed = row.parsed;
    const value = row.value;
    const key = identifierKey(value.type, value.sourceSystem, value.sourceId);
    let keyRecord = inFileEntityKeys.get(key);
    if (keyRecord === undefined) {
      keyRecord = {
        entityId: null,
        hasOwnKeyRow: false,
        hasRefRow: false,
        establishedByRow: null,
        rejectedRows: [],
      };
      inFileEntityKeys.set(key, keyRecord);
    }

    const flag = flags[index];
    if (flag?.ambiguous === true) {
      keyRecord.rejectedRows.push(parsed.row);
      count('entities', 'rejected');
      entityRowPlans.set(index, { row: parsed.row, classification: 'rejected', entityId: null });
      return;
    }
    if (flag?.duplicate === true) {
      count('entities', 'unchanged');
      entityRowPlans.set(index, {
        row: parsed.row,
        classification: 'unchanged',
        entityId: keyRecord.entityId,
      });
      return;
    }

    const hash = hashes[index] ?? '';
    const observedAt = new Date(value.observedAt);
    const ref = value.entityRef;
    let refTarget: RefTarget | null = null;

    if (ref !== undefined) {
      const resolved = resolveRef('entities', parsed.row, 'entityRef', ref);
      if (!resolved.ok) {
        keyRecord.rejectedRows.push(parsed.row);
        count('entities', 'rejected');
        errors.push(resolved.error);
        entityRowPlans.set(index, { row: parsed.row, classification: 'rejected', entityId: null });
        return;
      }
      if (resolved.target.entityType !== value.type) {
        keyRecord.rejectedRows.push(parsed.row);
        count('entities', 'rejected');
        errors.push(
          rowError(
            'entities',
            parsed.row,
            'entityRef',
            `Referenced entity is a ${resolved.target.entityType}, row is a ${value.type}`,
          ),
        );
        entityRowPlans.set(index, { row: parsed.row, classification: 'rejected', entityId: null });
        return;
      }
      refTarget = resolved.target;
    }

    let entityId: string;
    let createdInFile = false;
    let newIdentifier = false;

    const existingIdentifier = snapshot.identifiersByKey.get(key);
    if (keyRecord.entityId !== null) {
      if (refTarget !== null && refTarget.entityId !== keyRecord.entityId) {
        const establishedBy = keyRecord.establishedByRow ?? parsed.row;
        keyRecord.rejectedRows.push(parsed.row);
        count('entities', 'rejected');
        errors.push(
          rowError(
            'entities',
            parsed.row,
            null,
            `Rows ${establishedBy}, ${parsed.row} resolve the same key to different entities`,
          ),
        );
        entityRowPlans.set(index, { row: parsed.row, classification: 'rejected', entityId: null });
        return;
      }
      entityId = keyRecord.entityId;
    } else if (existingIdentifier !== undefined) {
      if (refTarget !== null && refTarget.entityId !== existingIdentifier.entityId) {
        keyRecord.rejectedRows.push(parsed.row);
        count('entities', 'rejected');
        errors.push(
          rowError(
            'entities',
            parsed.row,
            'entityRef',
            `Identifier ${value.sourceSystem}/${value.sourceId} already belongs to entity ${existingIdentifier.entityId}`,
          ),
        );
        entityRowPlans.set(index, { row: parsed.row, classification: 'rejected', entityId: null });
        return;
      }
      entityId = existingIdentifier.entityId;
      keyRecord.entityId = entityId;
      keyRecord.establishedByRow ??= parsed.row;
    } else if (refTarget !== null) {
      entityId = refTarget.entityId;
      newIdentifier = true;
      keyRecord.hasRefRow = true;
      keyRecord.entityId = entityId;
      keyRecord.establishedByRow ??= parsed.row;
    } else {
      entityId = context.newId();
      createdInFile = true;
      newIdentifier = true;
      keyRecord.hasOwnKeyRow = true;
      keyRecord.entityId = entityId;
      keyRecord.establishedByRow = parsed.row;
    }

    const stored = snapshot.entityObservations.get(entityId) ?? [];
    const unchanged =
      !newIdentifier &&
      isStoredObservation(stored, value.sourceSystem, value.sourceId, value.observedAt, hash);

    const working = entityState(entityId, value.type, createdInFile);
    if (unchanged) {
      count('entities', 'unchanged');
      entityRowPlans.set(index, { row: parsed.row, classification: 'unchanged', entityId });
      return;
    }

    const classification: RowClassification =
      createdInFile && working.newObservations === 0 ? 'created' : 'updated';
    const before =
      working.observations.length > 0
        ? projectEntity(nonEmpty(working.observations), working.states)
        : null;

    const normalized: NormalizedEntity = {
      entityType: value.type,
      displayName: value.displayName,
      attributes: value.attributes,
      state: value.state ?? null,
      sourceStatus: value.sourceStatus ?? null,
    };
    const seqOrder = snapshot.maxSourceRecordSeq + index + 1;
    working.observations.push({ observedAt, seqOrder, normalized });
    working.newObservations += 1;

    const sourceRecord: SourceRecordInsert = {
      id: context.newId(),
      kind: 'ENTITY',
      sourceSystem: value.sourceSystem,
      sourceId: value.sourceId,
      observedAt,
      seqOrder,
      rawPayload: parsed.raw,
      payloadHash: hash,
      normalized,
      entityId,
      relationshipId: null,
      eventId: null,
    };
    write.sourceRecords.push(sourceRecord);

    let stateObservation: StateObservationInsert | null = null;
    if (value.state !== undefined) {
      const stateSeqOrder = snapshot.maxStateObservationSeq + index + 1;
      stateObservation = {
        id: context.newId(),
        entityId,
        sourceRecordId: sourceRecord.id,
        state: value.state,
        sourceStatus: value.sourceStatus ?? null,
        sourceSystem: value.sourceSystem,
        sourceId: value.sourceId,
        observedAt,
        seqOrder: stateSeqOrder,
      };
      working.states.push({ observedAt, seqOrder: stateSeqOrder, state: value.state });
      write.stateObservations.push(stateObservation);
    }

    let identifier: EntityIdentifierInsert | null = null;
    if (newIdentifier) {
      identifier = {
        id: context.newId(),
        entityId,
        entityType: value.type,
        sourceSystem: value.sourceSystem,
        sourceId: value.sourceId,
      };
      write.identifierInserts.push(identifier);
    }

    const after = projectEntity(nonEmpty(working.observations), working.states);

    if (classification === 'created') {
      write.audits.push({
        action: 'entity.created',
        targetType: 'entity',
        targetId: entityId,
        after: {
          ...entityAuditValue(working, after),
          identifiers: identifier
            ? [
                {
                  id: identifier.id,
                  entityType: identifier.entityType,
                  sourceSystem: identifier.sourceSystem,
                  sourceId: identifier.sourceId,
                },
              ]
            : [],
        },
        sourceRecordId: sourceRecord.id,
      });
    } else {
      write.audits.push({
        action: 'entity.observed',
        targetType: 'entity',
        targetId: entityId,
        ...(before ? { before: entityAuditValue(working, before) } : {}),
        after: entityAuditValue(working, after),
        sourceRecordId: sourceRecord.id,
      });
    }

    if (stateObservation !== null) {
      write.audits.push({
        action: 'entity.state_observed',
        targetType: 'entity',
        targetId: entityId,
        after: {
          state: stateObservation.state,
          sourceStatus: stateObservation.sourceStatus,
          sourceSystem: stateObservation.sourceSystem,
          observedAt: stateObservation.observedAt.toISOString(),
        },
        sourceRecordId: sourceRecord.id,
      });
    }

    count('entities', classification);
    entityRowPlans.set(index, { row: parsed.row, classification, entityId });
  }

  function processRelationshipRow(
    row: ValidatedRow & { kind: 'relationships' },
    index: number,
  ): void {
    const parsed = row.parsed;
    const value = row.value;
    const key = recordKey(value.sourceSystem, value.sourceId);
    const flag = flags[index];

    if (flag?.ambiguous === true) {
      count('relationships', 'rejected');
      relationshipRowPlans.set(index, {
        row: parsed.row,
        classification: 'rejected',
        relationshipId: null,
      });
      return;
    }
    if (flag?.duplicate === true) {
      count('relationships', 'unchanged');
      relationshipRowPlans.set(index, {
        row: parsed.row,
        classification: 'unchanged',
        relationshipId: inFileRelationships.get(key)?.id ?? null,
      });
      return;
    }

    const fromResolved = resolveRef('relationships', parsed.row, 'from', value.from);
    if (!fromResolved.ok) {
      count('relationships', 'rejected');
      errors.push(fromResolved.error);
      relationshipRowPlans.set(index, {
        row: parsed.row,
        classification: 'rejected',
        relationshipId: null,
      });
      return;
    }
    const toResolved = resolveRef('relationships', parsed.row, 'to', value.to);
    if (!toResolved.ok) {
      count('relationships', 'rejected');
      errors.push(toResolved.error);
      relationshipRowPlans.set(index, {
        row: parsed.row,
        classification: 'rejected',
        relationshipId: null,
      });
      return;
    }
    const from = fromResolved.target;
    const to = toResolved.target;

    const rule = RELATIONSHIP_RULES[value.type];
    const fromAllowed = rule.from === null || rule.from.includes(from.entityType);
    const toAllowed = rule.to === null || rule.to.includes(to.entityType);
    if (!fromAllowed || !toAllowed) {
      count('relationships', 'rejected');
      errors.push(
        rowError(
          'relationships',
          parsed.row,
          null,
          `${value.type} requires from ${formatRuleSide(rule.from)} → to ${formatRuleSide(rule.to)}; got ${from.entityType} → ${to.entityType}`,
        ),
      );
      relationshipRowPlans.set(index, {
        row: parsed.row,
        classification: 'rejected',
        relationshipId: null,
      });
      return;
    }

    if (from.entityId === to.entityId) {
      count('relationships', 'rejected');
      errors.push(
        rowError(
          'relationships',
          parsed.row,
          null,
          'A relationship cannot connect an entity to itself',
        ),
      );
      relationshipRowPlans.set(index, {
        row: parsed.row,
        classification: 'rejected',
        relationshipId: null,
      });
      return;
    }

    const existing = snapshot.relationshipsByKey.get(key);
    const inFile = inFileRelationships.get(key);
    const immutableMismatch =
      existing !== undefined
        ? existing.type !== value.type ||
          existing.fromEntityId !== from.entityId ||
          existing.toEntityId !== to.entityId
        : inFile !== undefined
          ? inFile.type !== value.type ||
            inFile.fromEntityId !== from.entityId ||
            inFile.toEntityId !== to.entityId
          : false;
    if (immutableMismatch) {
      count('relationships', 'rejected');
      errors.push(
        rowError(
          'relationships',
          parsed.row,
          null,
          `Relationship ${value.sourceSystem}/${value.sourceId} already exists with a different type or endpoints`,
        ),
      );
      relationshipRowPlans.set(index, {
        row: parsed.row,
        classification: 'rejected',
        relationshipId: null,
      });
      return;
    }

    let relationshipId: string;
    let createdInFile = false;
    if (existing !== undefined) {
      relationshipId = existing.id;
    } else if (inFile !== undefined) {
      relationshipId = inFile.id;
    } else {
      relationshipId = context.newId();
      createdInFile = true;
      inFileRelationships.set(key, {
        id: relationshipId,
        type: value.type,
        fromEntityId: from.entityId,
        toEntityId: to.entityId,
      });
    }

    const hash = hashes[index] ?? '';
    const stored = snapshot.relationshipObservations.get(relationshipId) ?? [];
    const unchanged = isStoredObservation(
      stored,
      value.sourceSystem,
      value.sourceId,
      value.observedAt,
      hash,
    );
    const working = relationshipState(
      relationshipId,
      value.type,
      from.entityId,
      to.entityId,
      value.sourceSystem,
      value.sourceId,
      createdInFile,
    );
    if (unchanged) {
      count('relationships', 'unchanged');
      relationshipRowPlans.set(index, {
        row: parsed.row,
        classification: 'unchanged',
        relationshipId,
      });
      return;
    }

    const classification: RowClassification =
      createdInFile && working.newObservations === 0 ? 'created' : 'updated';
    const before =
      working.observations.length > 0 ? projectRelationship(nonEmpty(working.observations)) : null;

    const observedAt = new Date(value.observedAt);
    const normalized: NormalizedRelationship = {
      type: value.type,
      fromEntityId: from.entityId,
      toEntityId: to.entityId,
      origin: value.origin,
      confidence: value.confidence,
      basis: value.basis ?? null,
    };
    const seqOrder = snapshot.maxSourceRecordSeq + index + 1;
    working.observations.push({ observedAt, seqOrder, importId: '', normalized });
    working.newObservations += 1;

    const sourceRecord: SourceRecordInsert = {
      id: context.newId(),
      kind: 'RELATIONSHIP',
      sourceSystem: value.sourceSystem,
      sourceId: value.sourceId,
      observedAt,
      seqOrder,
      rawPayload: parsed.raw,
      payloadHash: hash,
      normalized,
      entityId: null,
      relationshipId,
      eventId: null,
    };
    write.sourceRecords.push(sourceRecord);

    const after = projectRelationship(nonEmpty(working.observations));
    if (classification === 'created') {
      write.audits.push({
        action: 'relationship.created',
        targetType: 'relationship',
        targetId: relationshipId,
        after: relationshipAuditValue(working, after),
        sourceRecordId: sourceRecord.id,
      });
    } else {
      write.audits.push({
        action: 'relationship.observed',
        targetType: 'relationship',
        targetId: relationshipId,
        ...(before ? { before: relationshipAuditValue(working, before) } : {}),
        after: relationshipAuditValue(working, after),
        sourceRecordId: sourceRecord.id,
      });
    }

    count('relationships', classification);
    relationshipRowPlans.set(index, { row: parsed.row, classification, relationshipId });
  }

  function processEventRow(row: ValidatedRow & { kind: 'events' }, index: number): void {
    const parsed = row.parsed;
    const value = row.value;
    const key = recordKey(value.sourceSystem, value.sourceId);
    const flag = flags[index];

    if (flag?.ambiguous === true) {
      count('events', 'rejected');
      eventRowPlans.set(index, { row: parsed.row, classification: 'rejected', eventId: null });
      return;
    }
    if (flag?.duplicate === true) {
      count('events', 'unchanged');
      eventRowPlans.set(index, {
        row: parsed.row,
        classification: 'unchanged',
        eventId: inFileEvents.get(key)?.id ?? null,
      });
      return;
    }

    const subjectResolved = resolveRef('events', parsed.row, 'subject', value.subject);
    if (!subjectResolved.ok) {
      count('events', 'rejected');
      errors.push(subjectResolved.error);
      eventRowPlans.set(index, { row: parsed.row, classification: 'rejected', eventId: null });
      return;
    }
    const relatedEntityIds: string[] = [];
    for (const relatedRef of value.related) {
      const resolved = resolveRef('events', parsed.row, 'related', relatedRef);
      if (!resolved.ok) {
        count('events', 'rejected');
        errors.push(resolved.error);
        eventRowPlans.set(index, { row: parsed.row, classification: 'rejected', eventId: null });
        return;
      }
      if (!relatedEntityIds.includes(resolved.target.entityId)) {
        relatedEntityIds.push(resolved.target.entityId);
      }
    }
    const subjectEntityId = subjectResolved.target.entityId;
    if (relatedEntityIds.includes(subjectEntityId)) {
      count('events', 'rejected');
      errors.push(
        rowError(
          'events',
          parsed.row,
          null,
          "An event's subject cannot also be a related entity",
        ),
      );
      eventRowPlans.set(index, { row: parsed.row, classification: 'rejected', eventId: null });
      return;
    }

    const existing = snapshot.eventsByKey.get(key);
    const inFile = inFileEvents.get(key);
    const immutableMismatch =
      existing !== undefined
        ? existing.type !== value.type || existing.subjectEntityId !== subjectEntityId
        : inFile !== undefined
          ? inFile.type !== value.type || inFile.subjectEntityId !== subjectEntityId
          : false;
    if (immutableMismatch) {
      count('events', 'rejected');
      errors.push(
        rowError(
          'events',
          parsed.row,
          null,
          `Event ${value.sourceSystem}/${value.sourceId} already exists with a different type or subject`,
        ),
      );
      eventRowPlans.set(index, { row: parsed.row, classification: 'rejected', eventId: null });
      return;
    }

    let eventId: string;
    let createdInFile = false;
    if (existing !== undefined) {
      eventId = existing.id;
    } else if (inFile !== undefined) {
      eventId = inFile.id;
    } else {
      eventId = context.newId();
      createdInFile = true;
      inFileEvents.set(key, {
        id: eventId,
        type: value.type,
        subjectEntityId,
      });
    }

    const hash = hashes[index] ?? '';
    const stored = snapshot.eventObservations.get(eventId) ?? [];
    const unchanged = isStoredObservation(
      stored,
      value.sourceSystem,
      value.sourceId,
      value.observedAt,
      hash,
    );
    const working = eventState(
      eventId,
      value.type,
      subjectEntityId,
      value.sourceSystem,
      value.sourceId,
      createdInFile,
    );
    if (unchanged) {
      count('events', 'unchanged');
      eventRowPlans.set(index, { row: parsed.row, classification: 'unchanged', eventId });
      return;
    }

    const classification: RowClassification =
      createdInFile && working.newObservations === 0 ? 'created' : 'updated';
    const before =
      working.observations.length > 0 ? projectEvent(nonEmpty(working.observations)) : null;

    const observedAt = new Date(value.observedAt);
    const normalized: NormalizedEvent = {
      type: value.type,
      occurredAt: value.occurredAt,
      description: value.description ?? null,
      subjectEntityId,
      relatedEntityIds,
    };
    const seqOrder = snapshot.maxSourceRecordSeq + index + 1;
    working.observations.push({ observedAt, seqOrder, importId: '', normalized });
    working.newObservations += 1;

    const sourceRecord: SourceRecordInsert = {
      id: context.newId(),
      kind: 'EVENT',
      sourceSystem: value.sourceSystem,
      sourceId: value.sourceId,
      observedAt,
      seqOrder,
      rawPayload: parsed.raw,
      payloadHash: hash,
      normalized,
      entityId: null,
      relationshipId: null,
      eventId,
    };
    write.sourceRecords.push(sourceRecord);

    const after = projectEvent(nonEmpty(working.observations));
    if (classification === 'created') {
      write.audits.push({
        action: 'event.created',
        targetType: 'event',
        targetId: eventId,
        after: eventAuditValue(working, after),
        sourceRecordId: sourceRecord.id,
      });
    } else {
      write.audits.push({
        action: 'event.observed',
        targetType: 'event',
        targetId: eventId,
        ...(before ? { before: eventAuditValue(working, before) } : {}),
        after: eventAuditValue(working, after),
        sourceRecordId: sourceRecord.id,
      });
    }

    count('events', classification);
    eventRowPlans.set(index, { row: parsed.row, classification, eventId });
  }

  const entityRowEntries = rows
    .map((row, index) => ({ row, index }))
    .filter(
      (entry): entry is { row: ValidatedRow & { kind: 'entities' }; index: number } =>
        entry.row.kind === 'entities',
    );

  for (const pass of [false, true]) {
    for (const entry of entityRowEntries) {
      const hasRef = entry.row.value.entityRef !== undefined;
      if (hasRef === pass) {
        processEntityRow(entry.row, entry.index);
      }
    }
  }

  rows.forEach((row, index) => {
    if (row.kind === 'relationships') {
      processRelationshipRow(row, index);
    }
  });

  rows.forEach((row, index) => {
    if (row.kind === 'events') {
      processEventRow(row, index);
    }
  });

  for (const [entityId, working] of entityWorking) {
    if (working.newObservations === 0) {
      continue;
    }
    const projection = projectEntity(nonEmpty(working.observations), working.states);
    const writeProjection = {
      id: entityId,
      type: working.type,
      displayName: projection.displayName,
      attributes: projection.attributes,
      currentState: projection.currentState,
      lastObservedAt: projection.lastObservedAt,
    };
    if (working.createdInFile) {
      write.entityInserts.push(writeProjection);
    } else {
      write.entityUpdates.push(writeProjection);
    }
  }

  for (const [relationshipId, working] of relationshipWorking) {
    if (working.newObservations === 0) {
      continue;
    }
    const projection = projectRelationship(nonEmpty(working.observations));
    const writeProjection = {
      id: relationshipId,
      type: working.type,
      fromEntityId: working.fromEntityId,
      toEntityId: working.toEntityId,
      origin: projection.origin,
      confidence: projection.confidence,
      basis: projection.basis,
      sourceSystem: working.sourceSystem,
      sourceId: working.sourceId,
      observedAt: projection.observedAt,
    };
    if (working.createdInFile) {
      write.relationshipInserts.push(writeProjection);
    } else {
      write.relationshipUpdates.push(writeProjection);
    }
  }

  for (const [eventId, working] of eventWorking) {
    if (working.newObservations === 0) {
      continue;
    }
    const projection = projectEvent(nonEmpty(working.observations));
    const writeProjection = {
      id: eventId,
      type: working.type,
      occurredAt: projection.occurredAt,
      observedAt: projection.observedAt,
      description: projection.description,
      subjectEntityId: working.subjectEntityId,
      relatedEntityIds: projection.relatedEntityIds,
      sourceSystem: working.sourceSystem,
      sourceId: working.sourceId,
    };
    if (working.createdInFile) {
      write.eventInserts.push(writeProjection);
      write.eventEntityInserts.push({
        eventId,
        entityId: working.subjectEntityId,
        role: 'SUBJECT',
      });
      for (const relatedEntityId of projection.relatedEntityIds) {
        write.eventEntityInserts.push({ eventId, entityId: relatedEntityId, role: 'RELATED' });
      }
    } else {
      write.eventUpdates.push(writeProjection);
      const storedRelated = snapshot.eventsById.get(eventId)?.relatedEntityIds ?? [];
      if (!sameSet(storedRelated, projection.relatedEntityIds)) {
        write.eventRelatedReplacements.push(eventId);
        for (const relatedEntityId of projection.relatedEntityIds) {
          write.eventEntityInserts.push({ eventId, entityId: relatedEntityId, role: 'RELATED' });
        }
      }
    }
  }

  const changeCount =
    counts.entities.created +
    counts.entities.updated +
    counts.relationships.created +
    counts.relationships.updated +
    counts.events.created +
    counts.events.updated;

  return {
    entityRows: [...entityRowPlans.values()].sort((left, right) => left.row - right.row),
    relationshipRows: [...relationshipRowPlans.values()].sort((left, right) => left.row - right.row),
    eventRows: [...eventRowPlans.values()].sort((left, right) => left.row - right.row),
    write,
    counts,
    errors,
    changeCount,
  };
}
