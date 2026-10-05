import {
  EntityImportRowSchema,
  type EntityImportRow,
  type JsonValue,
} from '@opsgraph/shared';
import type { ValidatedRow } from '../parsing/parsed-import';
import { payloadHash } from './canonical-json';
import {
  identifierKey,
  type ImportSnapshot,
  type NormalizedEntity,
  type ObservationRecord,
  type PlanContext,
  type SnapshotEntity,
} from './import-plan';
import { planImport } from './import-planner';

const NOW = new Date('2026-09-14T10:00:00.000Z');
const T1 = '2026-09-14T08:00:00+00:00';
const T2 = '2026-09-14T09:00:00+00:00';
const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

type EntityRow = ValidatedRow & { kind: 'entities' };

function entityRow(candidate: Record<string, unknown>, row = 1): EntityRow {
  const value: EntityImportRow = EntityImportRowSchema.parse(candidate);
  return {
    kind: 'entities',
    parsed: { kind: 'entities', row, raw: candidate as unknown as JsonValue, candidate },
    value,
  };
}

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

const BASE = {
  type: 'Order',
  sourceSystem: 'OMS',
  sourceId: '18492',
  displayName: 'Order #18492',
  observedAt: T1,
  attributes: { amount: '12480.00', currency: 'USD' },
};

function observation(candidate: Record<string, unknown>): ObservationRecord<NormalizedEntity> {
  const value = EntityImportRowSchema.parse(candidate);
  return {
    observedAt: new Date(value.observedAt),
    seqOrder: 1,
    payloadHash: payloadHash(candidate),
    sourceSystem: value.sourceSystem,
    sourceId: value.sourceId,
    importId: 'import-1',
    normalized: {
      entityType: value.type,
      displayName: value.displayName,
      attributes: value.attributes,
      state: value.state ?? null,
      sourceStatus: value.sourceStatus ?? null,
    },
  };
}

function snapshotWithStoredEntity(
  candidate: Record<string, unknown>,
  extraEntities: ReadonlyArray<readonly [string, SnapshotEntity]> = [],
): ImportSnapshot {
  const value = EntityImportRowSchema.parse(candidate);
  return emptySnapshot({
    maxSourceRecordSeq: 10,
    maxStateObservationSeq: 10,
    entitiesById: new Map([[ENTITY_ID, { id: ENTITY_ID, type: value.type }], ...extraEntities]),
    identifiersByKey: new Map([
      [
        identifierKey(value.type, value.sourceSystem, value.sourceId),
        {
          entityId: ENTITY_ID,
          entityType: value.type,
          sourceSystem: value.sourceSystem,
          sourceId: value.sourceId,
        },
      ],
    ]),
    entityObservations: new Map([[ENTITY_ID, [observation(candidate)]]]),
  });
}

describe('planImport entities', () => {
  it('creates a new entity, its identifier and its source record', () => {
    const plan = planImport([entityRow(BASE)], emptySnapshot(), context());

    expect(plan.counts.entities).toEqual({
      created: 1,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.changeCount).toBe(1);
    expect(plan.write.entityInserts).toHaveLength(1);
    expect(plan.write.entityInserts[0]).toMatchObject({
      id: 'new-1',
      type: 'Order',
      displayName: 'Order #18492',
      attributes: { amount: '12480.00', currency: 'USD' },
      currentState: 'UNKNOWN',
    });
    expect(plan.write.entityUpdates).toEqual([]);
    expect(plan.write.identifierInserts).toHaveLength(1);
    expect(plan.write.sourceRecords).toHaveLength(1);
    expect(plan.write.sourceRecords[0]).toMatchObject({
      kind: 'ENTITY',
      entityId: 'new-1',
      payloadHash: payloadHash(BASE),
    });
    expect(plan.write.audits.map((audit) => audit.action)).toEqual(['entity.created']);
  });

  it('keeps the projection of the latest observation for a new entity', () => {
    const plan = planImport(
      [
        entityRow({ ...BASE, observedAt: T1, displayName: 'Old name' }, 1),
        entityRow({ ...BASE, observedAt: T2, displayName: 'New name' }, 1),
      ],
      emptySnapshot(),
      context(),
    );

    expect(plan.counts.entities).toEqual({
      created: 1,
      updated: 1,
      unchanged: 0,
      rejected: 0,
    });
    expect(plan.changeCount).toBe(2);
    expect(plan.write.entityInserts[0]?.displayName).toBe('New name');
    expect(plan.write.sourceRecords).toHaveLength(2);
    expect(plan.write.audits.map((audit) => audit.action)).toEqual([
      'entity.created',
      'entity.observed',
    ]);
  });

  it('creates a state observation and projects the state', () => {
    const plan = planImport(
      [entityRow({ ...BASE, state: 'BLOCKED', sourceStatus: 'BLOCKED' })],
      emptySnapshot(),
      context(),
    );

    expect(plan.write.entityInserts[0]?.currentState).toBe('BLOCKED');
    expect(plan.write.stateObservations).toHaveLength(1);
    expect(plan.write.stateObservations[0]).toMatchObject({
      state: 'BLOCKED',
      sourceStatus: 'BLOCKED',
      sourceSystem: 'OMS',
    });
    expect(plan.write.audits.map((audit) => audit.action)).toEqual([
      'entity.created',
      'entity.state_observed',
    ]);
  });

  it('marks a stored identical observation as unchanged', () => {
    const plan = planImport([entityRow(BASE)], snapshotWithStoredEntity(BASE), context());

    expect(plan.counts.entities.unchanged).toBe(1);
    expect(plan.changeCount).toBe(0);
    expect(plan.write.sourceRecords).toEqual([]);
    expect(plan.write.entityInserts).toEqual([]);
    expect(plan.write.entityUpdates).toEqual([]);
    expect(plan.write.audits).toEqual([]);
  });

  it('updates an existing entity for a new observation', () => {
    const plan = planImport(
      [entityRow({ ...BASE, observedAt: T2, displayName: 'New name' })],
      snapshotWithStoredEntity(BASE),
      context(),
    );

    expect(plan.counts.entities.updated).toBe(1);
    expect(plan.changeCount).toBe(1);
    expect(plan.write.entityUpdates).toHaveLength(1);
    expect(plan.write.entityUpdates[0]).toMatchObject({
      id: ENTITY_ID,
      displayName: 'New name',
    });
    expect(plan.write.audits.map((audit) => audit.action)).toEqual(['entity.observed']);
    expect(plan.write.audits[0]?.before).toMatchObject({ displayName: 'Order #18492' });
    expect(plan.write.audits[0]?.after).toMatchObject({ displayName: 'New name' });
  });

  it('treats two identical rows in one file as created then unchanged', () => {
    const plan = planImport(
      [entityRow(BASE, 1), entityRow(BASE, 2)],
      emptySnapshot(),
      context(),
    );

    expect(plan.counts.entities).toEqual({
      created: 1,
      updated: 0,
      unchanged: 1,
      rejected: 0,
    });
    expect(plan.write.sourceRecords).toHaveLength(1);
  });

  it('P6 rejects all rows with the same key and observedAt but different content', () => {
    const plan = planImport(
      [
        entityRow({ ...BASE, displayName: 'First' }, 1),
        entityRow({ ...BASE, displayName: 'Second' }, 2),
      ],
      emptySnapshot(),
      context(),
    );

    expect(plan.counts.entities.rejected).toBe(2);
    expect(plan.write.sourceRecords).toEqual([]);
    expect(plan.errors).toHaveLength(2);
    expect(plan.errors[0]?.message).toMatch(/Ambiguous: rows 1, 2/);
  });

  it('P1 rejects an entityRef by id that does not exist', () => {
    const plan = planImport(
      [entityRow({ ...BASE, entityRef: { id: OTHER_ID } })],
      emptySnapshot(),
      context(),
    );

    expect(plan.counts.entities.rejected).toBe(1);
    expect(plan.errors[0]).toMatchObject({
      field: 'entityRef',
      message: `Entity ${OTHER_ID} does not exist`,
    });
  });

  it('P2 rejects an entityRef to an entity of another type', () => {
    const plan = planImport(
      [entityRow({ ...BASE, entityRef: { id: ENTITY_ID } })],
      emptySnapshot({ entitiesById: new Map([[ENTITY_ID, { id: ENTITY_ID, type: 'Customer' }]]) }),
      context(),
    );

    expect(plan.counts.entities.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe('Referenced entity is a Customer, row is a Order');
  });

  it('P3 rejects a reference chain', () => {
    const plan = planImport(
      [
        entityRow({ ...BASE, sourceId: 'attached', entityRef: { id: ENTITY_ID } }, 1),
        entityRow(
          {
            ...BASE,
            sourceId: 'chained',
            entityRef: { entityType: 'Order', sourceSystem: 'OMS', sourceId: 'attached' },
          },
          2,
        ),
      ],
      emptySnapshot({ entitiesById: new Map([[ENTITY_ID, { id: ENTITY_ID, type: 'Order' }]]) }),
      context(),
    );

    expect(plan.counts.entities.rejected).toBe(1);
    expect(plan.errors[0]?.message).toMatch(/Reference chains are not supported/);
  });

  it('P3 rejects an unknown key reference', () => {
    const plan = planImport(
      [
        entityRow({
          ...BASE,
          entityRef: { entityType: 'Order', sourceSystem: 'OMS', sourceId: 'nope' },
        }),
      ],
      emptySnapshot(),
      context(),
    );

    expect(plan.counts.entities.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe('No entity with key Order/OMS/nope');
  });

  it('P4 rejects attaching an identifier that belongs to another entity', () => {
    const plan = planImport(
      [entityRow({ ...BASE, entityRef: { id: OTHER_ID } })],
      snapshotWithStoredEntity(BASE, [[OTHER_ID, { id: OTHER_ID, type: 'Order' }]]),
      context(),
    );

    expect(plan.counts.entities.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe(
      `Identifier OMS/18492 already belongs to entity ${ENTITY_ID}`,
    );
  });

  it('P5 rejects two in-file rows resolving one key to different entities', () => {
    const plan = planImport(
      [
        entityRow(BASE, 1),
        entityRow({ ...BASE, observedAt: T2, entityRef: { id: ENTITY_ID } }, 2),
      ],
      emptySnapshot({ entitiesById: new Map([[ENTITY_ID, { id: ENTITY_ID, type: 'Order' }]]) }),
      context(),
    );

    expect(plan.counts.entities.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe('Rows 1, 2 resolve the same key to different entities');
  });

  it('attaches a new identifier through entityRef and counts it as updated', () => {
    const plan = planImport(
      [
        entityRow(
          {
            ...BASE,
            sourceSystem: 'ERP',
            sourceId: 'erp-18492',
            displayName: 'ERP Order #18492',
            entityRef: { id: ENTITY_ID },
          },
          1,
        ),
      ],
      snapshotWithStoredEntity(BASE),
      context(),
    );

    expect(plan.counts.entities.updated).toBe(1);
    expect(plan.write.identifierInserts).toHaveLength(1);
    expect(plan.write.identifierInserts[0]).toMatchObject({
      entityId: ENTITY_ID,
      sourceSystem: 'ERP',
      sourceId: 'erp-18492',
    });
    expect(plan.write.entityInserts).toEqual([]);
    expect(plan.write.entityUpdates).toHaveLength(1);
  });

  it("P2 uses the referenced entity's type for entityRef by key", () => {
    const plan = planImport(
      [
        entityRow(
          {
            ...BASE,
            type: 'Shipment',
            entityRef: { entityType: 'Customer', sourceSystem: 'CRM', sourceId: 'acme' },
          },
          1,
        ),
      ],
      emptySnapshot({
        entitiesById: new Map([[ENTITY_ID, { id: ENTITY_ID, type: 'Customer' }]]),
        identifiersByKey: new Map([
          [
            identifierKey('Customer', 'CRM', 'acme'),
            {
              entityId: ENTITY_ID,
              entityType: 'Customer',
              sourceSystem: 'CRM',
              sourceId: 'acme',
            },
          ],
        ]),
      }),
      context(),
    );

    expect(plan.counts.entities.rejected).toBe(1);
    expect(plan.errors[0]?.message).toBe('Referenced entity is a Customer, row is a Shipment');
  });
});
