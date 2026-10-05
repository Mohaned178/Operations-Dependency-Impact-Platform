import type { NormalizedEntity } from './import-plan';
import {
  latestStateBySource,
  projectEntity,
  projectEvent,
  projectRelationship,
  type EntityObservation,
  type EntityStateObservation,
  type EventObservation,
  type RelationshipObservation,
} from './projections';

const T1 = new Date('2026-09-14T08:00:00.000Z');
const T2 = new Date('2026-09-14T09:00:00.000Z');

function entityObservation(
  observedAt: Date,
  seqOrder: number,
  displayName: string,
  attributes: Record<string, string> = {},
): EntityObservation {
  const normalized: NormalizedEntity = {
    entityType: 'Order',
    displayName,
    attributes,
    state: null,
    sourceStatus: null,
  };
  return { observedAt, seqOrder, normalized };
}

function stateObservation(observedAt: Date, seqOrder: number, sourceSystem: string): EntityStateObservation & { sourceSystem: string } {
  return { observedAt, seqOrder, state: 'BLOCKED', sourceSystem };
}

describe('projectEntity', () => {
  it('takes the display name from the latest observation', () => {
    const projection = projectEntity(
      [entityObservation(T1, 1, 'Old name'), entityObservation(T2, 2, 'New name')],
      [],
    );
    expect(projection.displayName).toBe('New name');
    expect(projection.lastObservedAt).toEqual(T2);
  });

  it('does not let an older observation change the current values', () => {
    const projection = projectEntity(
      [entityObservation(T2, 2, 'New name'), entityObservation(T1, 1, 'Old name')],
      [],
    );
    expect(projection.displayName).toBe('New name');
    expect(projection.lastObservedAt).toEqual(T2);
  });

  it('breaks equal timestamps by the higher seq', () => {
    const projection = projectEntity(
      [entityObservation(T1, 1, 'First'), entityObservation(T1, 2, 'Second')],
      [],
    );
    expect(projection.displayName).toBe('Second');
  });

  it('shallow-merges attributes in observation order, keeping earlier keys', () => {
    const projection = projectEntity(
      [
        entityObservation(T1, 1, 'Order', { currency: 'USD', amount: '100.00', keep: 'me' }),
        entityObservation(T2, 2, 'Order', { amount: '12480.00' }),
      ],
      [],
    );
    expect(projection.attributes).toEqual({
      currency: 'USD',
      amount: '12480.00',
      keep: 'me',
    });
  });

  it('reports UNKNOWN when there is no state observation', () => {
    const projection = projectEntity([entityObservation(T1, 1, 'Order')], []);
    expect(projection.currentState).toBe('UNKNOWN');
  });

  it('takes the current state from the latest state observation', () => {
    const projection = projectEntity(
      [entityObservation(T2, 3, 'Order')],
      [
        { observedAt: T1, seqOrder: 1, state: 'PENDING' },
        { observedAt: T2, seqOrder: 2, state: 'BLOCKED' },
      ],
    );
    expect(projection.currentState).toBe('BLOCKED');
  });
});

describe('projectRelationship', () => {
  it('takes every field from the latest observation', () => {
    const base = {
      type: 'BLOCKS',
      fromEntityId: 'a',
      toEntityId: 'b',
      basis: null,
    } as const;
    const observations: [RelationshipObservation, ...RelationshipObservation[]] = [
      {
        observedAt: T1,
        seqOrder: 1,
        importId: 'import-1',
        normalized: { ...base, origin: 'SOURCE', confidence: 'HIGH' },
      },
      {
        observedAt: T2,
        seqOrder: 2,
        importId: 'import-2',
        normalized: { ...base, origin: 'INFERRED', confidence: 'MEDIUM', basis: 'Payment overdue' },
      },
    ];
    const projection = projectRelationship(observations);
    expect(projection).toEqual({
      origin: 'INFERRED',
      confidence: 'MEDIUM',
      basis: 'Payment overdue',
      observedAt: T2,
      importId: 'import-2',
    });
  });
});

describe('projectEvent', () => {
  it('takes the latest related set and observation metadata', () => {
    const observations: [EventObservation, ...EventObservation[]] = [
      {
        observedAt: T1,
        seqOrder: 1,
        importId: 'import-1',
        normalized: {
          type: 'order.blocked',
          occurredAt: T1.toISOString(),
          description: 'first',
          subjectEntityId: 'subject',
          relatedEntityIds: ['a'],
        },
      },
      {
        observedAt: T2,
        seqOrder: 2,
        importId: 'import-2',
        normalized: {
          type: 'order.blocked',
          occurredAt: T1.toISOString(),
          description: 'second',
          subjectEntityId: 'subject',
          relatedEntityIds: ['b', 'c'],
        },
      },
    ];
    const projection = projectEvent(observations);
    expect(projection.relatedEntityIds).toEqual(['b', 'c']);
    expect(projection.description).toBe('second');
    expect(projection.observedAt).toEqual(T2);
    expect(projection.importId).toBe('import-2');
  });
});

describe('latestStateBySource', () => {
  it('keeps one latest state per source system, sorted by source system', () => {
    const latest = latestStateBySource([
      stateObservation(T1, 1, 'OMS'),
      stateObservation(T2, 2, 'OMS'),
      stateObservation(T2, 3, 'ERP'),
      stateObservation(T1, 4, 'CRM'),
    ]);
    expect(latest.map((observation) => observation.sourceSystem)).toEqual(['CRM', 'ERP', 'OMS']);
    expect(latest[2]?.seqOrder).toBe(2);
  });
});
