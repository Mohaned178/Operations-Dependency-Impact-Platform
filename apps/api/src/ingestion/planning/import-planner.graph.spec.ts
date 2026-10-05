import {
  EntityImportRowSchema,
  EventImportRowSchema,
  RelationshipImportRowSchema,
  type EntityImportRow,
  type EventImportRow,
  type JsonValue,
  type RelationshipImportRow,
} from '@opsgraph/shared';
import type { ValidatedRow } from '../parsing/parsed-import';
import { payloadHash } from './canonical-json';
import {
  identifierKey,
  recordKey,
  type ImportSnapshot,
  type NormalizedEvent,
  type NormalizedRelationship,
  type ObservationRecord,
  type PlanContext,
  type SnapshotEvent,
  type SnapshotRelationship,
} from './import-plan';
import { planImport } from './import-planner';

const NOW = new Date('2026-09-14T10:00:00.000Z');
const T1 = '2026-09-14T08:00:00+00:00';
const T2 = '2026-09-14T09:00:00+00:00';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const SUPPLIER_ID = '33333333-3333-4333-8333-333333333333';
const RELATIONSHIP_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';

const FROM_KEY = { entityType: 'Customer', sourceSystem: 'CRM', sourceId: 'acme' } as const;
const TO_KEY = { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' } as const;

function context(): PlanContext {
  let counter = 0;
  return { now: NOW, receivedAt: NOW, newId: () => `new-${(counter += 1)}` };
}

function emptySnapshot(overrides: Partial<ImportSnapshot> = {}): ImportSnapshot {
  return {
    maxSourceRecordSeq: 0,
    maxStateObservationSeq: 0,
    entitiesById: new Map(),
    identifiersByKey: new Map(),
    entityObservations: new Map(),
    stateObservations: new Map(),
    relationshipsById: new Map(),
    relationshipsByKey: new Map(),
    relationshipObservations: new Map(),
    eventsById: new Map(),
    eventsByKey: new Map(),
    eventObservations: new Map(),
    rejectedEntityRows: new Map(),
    ...overrides,
  };
}

function entityRow(candidate: Record<string, unknown>, row = 1): ValidatedRow & { kind: 'entities' } {
  const value: EntityImportRow = EntityImportRowSchema.parse(candidate);
  return {
    kind: 'entities',
    parsed: { kind: 'entities', row, raw: candidate as unknown as JsonValue, candidate },
    value,
  };
}

function relationshipRow(
  candidate: Record<string, unknown>,
  row = 1,
): ValidatedRow & { kind: 'relationships' } {
  const value: RelationshipImportRow = RelationshipImportRowSchema.parse(candidate);
  return {
    kind: 'relationships',
    parsed: { kind: 'relationships', row, raw: candidate as unknown as JsonValue, candidate },
    value,
  };
}

function eventRow(candidate: Record<string, unknown>, row = 1): ValidatedRow & { kind: 'events' } {
  const value: EventImportRow = EventImportRowSchema.parse(candidate);
  return {
    kind: 'events',
    parsed: { kind: 'events', row, raw: candidate as unknown as JsonValue, candidate },
    value,
  };
}

const CUSTOMER_ROW = {
  type: 'Customer',
  sourceSystem: 'CRM',
  sourceId: 'acme',
  displayName: 'Acme Corp',
  observedAt: T1,
};

const ORDER_ROW = {
  type: 'Order',
  sourceSystem: 'OMS',
  sourceId: '18492',
  displayName: 'Order #18492',
  observedAt: T1,
  attributes: { amount: '12480.00', currency: 'USD' },
};

const PLACED = {
  type: 'PLACED',
  sourceSystem: 'OPSGRAPH',
  sourceId: 'placed-1',
  from: FROM_KEY,
  to: TO_KEY,
  origin: 'SOURCE',
  confidence: 'HIGH',
  observedAt: T1,
};

function snapshotWithEntities(): ImportSnapshot {
  return emptySnapshot({
    entitiesById: new Map([
      [CUSTOMER_ID, { id: CUSTOMER_ID, type: 'Customer' }],
      [ORDER_ID, { id: ORDER_ID, type: 'Order' }],
      [SUPPLIER_ID, { id: SUPPLIER_ID, type: 'Supplier' }],
    ]),
    identifiersByKey: new Map([
      [
        identifierKey('Customer', 'CRM', 'acme'),
        { entityId: CUSTOMER_ID, entityType: 'Customer', sourceSystem: 'CRM', sourceId: 'acme' },
      ],
      [
        identifierKey('Order', 'OMS', '18492'),
        { entityId: ORDER_ID, entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
      ],
      [
        identifierKey('Supplier', 'SCM', 'supplier-1'),
        { entityId: SUPPLIER_ID, entityType: 'Supplier', sourceSystem: 'SCM', sourceId: 'supplier-1' },
      ],
    ]),
  });
}

function storedRelationship(
  candidate: Record<string, unknown>,
  record: { id: string; fromEntityId: string; toEntityId: string; normalized: NormalizedRelationship },
): ImportSnapshot {
  const value = RelationshipImportRowSchema.parse(candidate);
  const relationship: SnapshotRelationship = {
    id: record.id,
    type: value.type,
    fromEntityId: record.fromEntityId,
    toEntityId: record.toEntityId,
    origin: value.origin,
    confidence: value.confidence,
    basis: value.basis ?? null,
    sourceSystem: value.sourceSystem,
    sourceId: value.sourceId,
    observedAt: new Date(value.observedAt),
    importId: 'import-1',
  };
  return emptySnapshot({
    maxSourceRecordSeq: 10,
    entitiesById: snapshotWithEntities().entitiesById,
    identifiersByKey: snapshotWithEntities().identifiersByKey,
    relationshipsById: new Map([[record.id, relationship]]),
    relationshipsByKey: new Map([[recordKey(value.sourceSystem, value.sourceId), relationship]]),
    relationshipObservations: new Map([
      [
        record.id,
        [
          {
            observedAt: new Date(value.observedAt),
            seqOrder: 1,
            payloadHash: payloadHash(candidate),
            sourceSystem: value.sourceSystem,
            sourceId: value.sourceId,
            importId: 'import-1',
            normalized: record.normalized,
          },
        ],
      ],
    ]),
  });
}

describe('planImport relationships', () => {
  it('P7 rejects a reference to an entity that does not exist', () => {
    const plan = planImport([relationshipRow(PLACED)], emptySnapshot(), context());

    expect(plan.counts.relationships.rejected).toBe(1);
    expect(plan.errors[0]).toMatchObject({
      field: 'from',
      message: 'No entity with key Customer/CRM/acme',
    });
  });

  it('P8 rejects a relationship to an entity whose rows were all rejected', () => {
    const plan = planImport(
      [
        entityRow(CUSTOMER_ROW, 1),
        entityRow({ ...ORDER_ROW, observedAt: T2, displayName: 'First' }, 2),
        entityRow({ ...ORDER_ROW, observedAt: T2, displayName: 'Second' }, 3),
        relationshipRow(PLACED, 4),
      ],
      emptySnapshot(),
      context(),
    );

    expect(plan.counts.entities).toMatchObject({ created: 1, rejected: 2 });
    expect(plan.counts.relationships.rejected).toBe(1);
    const relationshipError = plan.errors.find((error) => error.kind === 'relationships');
    expect(relationshipError).toMatchObject({
      message: 'Depends on rejected entities row 2',
      dependsOn: { kind: 'entities', row: 2 },
    });
  });

  it('accepts a relationship that appears before its entities in the file', () => {
    const plan = planImport(
      [relationshipRow(PLACED, 1), entityRow(CUSTOMER_ROW, 1), entityRow(ORDER_ROW, 1)],
      emptySnapshot(),
      context(),
    );

    expect(plan.counts.relationships.created).toBe(1);
    expect(plan.write.relationshipInserts).toHaveLength(1);
    expect(plan.write.relationshipInserts[0]).toMatchObject({
      type: 'PLACED',
      fromEntityId: plan.write.entityInserts[0]?.id,
      toEntityId: plan.write.entityInserts[1]?.id,
    });
  });

  it('keeps two assertions of the same link from different sources', () => {
    const plan = planImport(
      [
        relationshipRow(PLACED, 1),
        relationshipRow(
          { ...PLACED, sourceSystem: 'ERP', sourceId: 'erp-placed-1' },
          2,
        ),
      ],
      snapshotWithEntities(),
      context(),
    );

    expect(plan.counts.relationships.created).toBe(2);
    expect(plan.write.relationshipInserts).toHaveLength(2);
    expect(plan.write.sourceRecords).toHaveLength(2);
  });

  it('accepts a 2-node cycle', () => {
    const plan = planImport(
      [
        relationshipRow(
          {
            type: 'RELATES_TO',
            sourceSystem: 'OPSGRAPH',
            sourceId: 'ab',
            from: { id: CUSTOMER_ID },
            to: { id: ORDER_ID },
            origin: 'MANUAL',
            confidence: 'MEDIUM',
            basis: 'related',
            observedAt: T1,
          },
          1,
        ),
        relationshipRow(
          {
            type: 'RELATES_TO',
            sourceSystem: 'OPSGRAPH',
            sourceId: 'ba',
            from: { id: ORDER_ID },
            to: { id: CUSTOMER_ID },
            origin: 'MANUAL',
            confidence: 'MEDIUM',
            basis: 'related',
            observedAt: T1,
          },
          2,
        ),
      ],
      snapshotWithEntities(),
      context(),
    );

    expect(plan.counts.relationships.created).toBe(2);
    expect(plan.counts.relationships.rejected).toBe(0);
  });

  it('P9 rejects a disallowed type pair and lists the rule', () => {
    const plan = planImport(
      [
        relationshipRow(
          {
            ...PLACED,
            from: { entityType: 'Supplier', sourceSystem: 'SCM', sourceId: 'supplier-1' },
          },
          1,
        ),
      ],
      snapshotWithEntities(),
      context(),
    );

    expect(plan.counts.relationships.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe(
      'PLACED requires from Customer → to Order; got Supplier → Order',
    );
  });

  it('P10 rejects a self-loop', () => {
    const plan = planImport(
      [
        relationshipRow(
          {
            type: 'RELATES_TO',
            sourceSystem: 'OPSGRAPH',
            sourceId: 'self',
            from: { id: CUSTOMER_ID },
            to: { id: CUSTOMER_ID },
            origin: 'MANUAL',
            confidence: 'LOW',
            basis: 'oops',
            observedAt: T1,
          },
          1,
        ),
      ],
      snapshotWithEntities(),
      context(),
    );

    expect(plan.counts.relationships.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe('A relationship cannot connect an entity to itself');
  });

  it('P11 rejects changing the type or endpoints of an existing relationship', () => {
    const stored = storedRelationship(PLACED, {
      id: RELATIONSHIP_ID,
      fromEntityId: CUSTOMER_ID,
      toEntityId: ORDER_ID,
      normalized: {
        type: 'PLACED',
        fromEntityId: CUSTOMER_ID,
        toEntityId: ORDER_ID,
        origin: 'SOURCE',
        confidence: 'HIGH',
        basis: null,
      },
    });
    const plan = planImport(
      [relationshipRow({ ...PLACED, type: 'RELATES_TO' }, 1)],
      stored,
      context(),
    );

    expect(plan.counts.relationships.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe(
      'Relationship OPSGRAPH/placed-1 already exists with a different type or endpoints',
    );
  });

  it('marks an identical stored relationship observation as unchanged', () => {
    const stored = storedRelationship(PLACED, {
      id: RELATIONSHIP_ID,
      fromEntityId: CUSTOMER_ID,
      toEntityId: ORDER_ID,
      normalized: {
        type: 'PLACED',
        fromEntityId: CUSTOMER_ID,
        toEntityId: ORDER_ID,
        origin: 'SOURCE',
        confidence: 'HIGH',
        basis: null,
      },
    });
    const plan = planImport([relationshipRow(PLACED)], stored, context());

    expect(plan.counts.relationships.unchanged).toBe(1);
    expect(plan.write.sourceRecords).toEqual([]);
    expect(plan.write.relationshipUpdates).toEqual([]);
  });

  it('updates an existing relationship for a new observation', () => {
    const stored = storedRelationship(PLACED, {
      id: RELATIONSHIP_ID,
      fromEntityId: CUSTOMER_ID,
      toEntityId: ORDER_ID,
      normalized: {
        type: 'PLACED',
        fromEntityId: CUSTOMER_ID,
        toEntityId: ORDER_ID,
        origin: 'SOURCE',
        confidence: 'HIGH',
        basis: null,
      },
    });
    const plan = planImport(
      [relationshipRow({ ...PLACED, observedAt: T2, confidence: 'LOW' })],
      stored,
      context(),
    );

    expect(plan.counts.relationships.updated).toBe(1);
    expect(plan.write.relationshipUpdates).toHaveLength(1);
    expect(plan.write.relationshipUpdates[0]).toMatchObject({
      id: RELATIONSHIP_ID,
      confidence: 'LOW',
    });
    expect(plan.write.relationshipInserts).toEqual([]);
    expect(plan.write.audits.map((audit) => audit.action)).toEqual(['relationship.observed']);
  });
});

describe('planImport events', () => {
  const EVENT = {
    type: 'order.blocked',
    sourceSystem: 'OMS',
    sourceId: 'evt-1',
    occurredAt: T1,
    observedAt: T1,
    subject: TO_KEY,
  };

  function eventObservation(
    candidate: Record<string, unknown>,
  ): ObservationRecord<NormalizedEvent> {
    const value = EventImportRowSchema.parse(candidate);
    return {
      observedAt: new Date(value.observedAt),
      seqOrder: 1,
      payloadHash: payloadHash(candidate),
      sourceSystem: value.sourceSystem,
      sourceId: value.sourceId,
      importId: 'import-1',
      normalized: {
        type: value.type,
        occurredAt: value.occurredAt,
        description: value.description ?? null,
        subjectEntityId: ORDER_ID,
        relatedEntityIds: [],
      },
    };
  }

  function storedEvent(
    candidate: Record<string, unknown>,
    relatedEntityIds: string[] = [],
  ): ImportSnapshot {
    const value = EventImportRowSchema.parse(candidate);
    const event: SnapshotEvent = {
      id: EVENT_ID,
      type: value.type,
      occurredAt: new Date(value.occurredAt),
      observedAt: new Date(value.observedAt),
      description: value.description ?? null,
      subjectEntityId: ORDER_ID,
      relatedEntityIds,
      sourceSystem: value.sourceSystem,
      sourceId: value.sourceId,
      importId: 'import-1',
    };
    return emptySnapshot({
      maxSourceRecordSeq: 10,
      entitiesById: snapshotWithEntities().entitiesById,
      identifiersByKey: snapshotWithEntities().identifiersByKey,
      eventsById: new Map([[EVENT_ID, event]]),
      eventsByKey: new Map([[recordKey(value.sourceSystem, value.sourceId), event]]),
      eventObservations: new Map([[EVENT_ID, [eventObservation(candidate)]]]),
    });
  }

  it('creates an event with its subject and related links', () => {
    const plan = planImport(
      [
        eventRow(
          {
            ...EVENT,
            related: [{ id: CUSTOMER_ID }, { id: SUPPLIER_ID }, { id: CUSTOMER_ID }],
            description: 'Blocked by credit hold',
          },
          1,
        ),
      ],
      snapshotWithEntities(),
      context(),
    );

    expect(plan.counts.events.created).toBe(1);
    expect(plan.write.eventInserts).toHaveLength(1);
    expect(plan.write.eventInserts[0]).toMatchObject({
      type: 'order.blocked',
      subjectEntityId: ORDER_ID,
      relatedEntityIds: [CUSTOMER_ID, SUPPLIER_ID],
      description: 'Blocked by credit hold',
    });
    expect(plan.write.eventEntityInserts).toEqual([
      { eventId: 'new-1', entityId: ORDER_ID, role: 'SUBJECT' },
      { eventId: 'new-1', entityId: CUSTOMER_ID, role: 'RELATED' },
      { eventId: 'new-1', entityId: SUPPLIER_ID, role: 'RELATED' },
    ]);
    expect(plan.write.audits.map((audit) => audit.action)).toEqual(['event.created']);
  });

  it('P13 rejects a related list that contains the subject', () => {
    const plan = planImport(
      [eventRow({ ...EVENT, related: [{ id: ORDER_ID }] }, 1)],
      snapshotWithEntities(),
      context(),
    );

    expect(plan.counts.events.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe("An event's subject cannot also be a related entity");
  });

  it('P12 rejects changing the type or subject of an existing event', () => {
    const stored = storedEvent(EVENT);
    const plan = planImport(
      [eventRow({ ...EVENT, subject: { id: CUSTOMER_ID } }, 1)],
      stored,
      context(),
    );

    expect(plan.counts.events.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe(
      'Event OMS/evt-1 already exists with a different type or subject',
    );
  });

  it('marks an identical stored event observation as unchanged', () => {
    const stored = storedEvent(EVENT);
    const plan = planImport([eventRow(EVENT)], stored, context());

    expect(plan.counts.events.unchanged).toBe(1);
    expect(plan.write.sourceRecords).toEqual([]);
    expect(plan.write.eventUpdates).toEqual([]);
  });

  it('replaces the related links when they change', () => {
    const stored = storedEvent(EVENT, [CUSTOMER_ID]);
    const plan = planImport(
      [eventRow({ ...EVENT, observedAt: T2, related: [{ id: SUPPLIER_ID }] }, 1)],
      stored,
      context(),
    );

    expect(plan.counts.events.updated).toBe(1);
    expect(plan.write.eventUpdates).toHaveLength(1);
    expect(plan.write.eventRelatedReplacements).toEqual([EVENT_ID]);
  });

  it('does not replace the related links when they are unchanged', () => {
    const stored = storedEvent(EVENT, [CUSTOMER_ID]);
    const plan = planImport(
      [eventRow({ ...EVENT, observedAt: T2, related: [{ id: CUSTOMER_ID }] }, 1)],
      stored,
      context(),
    );

    expect(plan.counts.events.updated).toBe(1);
    expect(plan.write.eventRelatedReplacements).toEqual([]);
    expect(plan.write.eventEntityInserts).toEqual([]);
  });
});
