import { describe, expect, it } from 'vitest';
import { OperationalStateSchema, RelationshipTypeSchema } from './graph';
import {
  BlockersQuerySchema,
  BlockersResponseSchema,
  DEPENDENCY_DIRECTION,
  DependenciesQuerySchema,
  DependenciesResponseSchema,
  SATISFIED_STATES,
  STATE_CLASSIFICATION,
  TRACEABLE_RELATIONSHIP_TYPES,
} from './tracing';

const UUID_A = '6f1b3c2a-4d5e-4f60-8a9b-1c2d3e4f5a6b';
const UUID_B = '7a2c4d3b-5e6f-4071-9b0c-2d3e4f5a6b7c';
const UUID_C = '8b3d5e4c-6f70-4182-8c1d-3e4f5a6b7c8d';
const UUID_D = '9c4e6f5d-7081-4293-9d2e-4f5a6b7c8d9e';
const AT = '2026-09-29T11:40:00.000Z';

const observation = {
  id: UUID_D,
  state: 'BLOCKED',
  sourceStatus: 'ON_HOLD',
  sourceSystem: 'OMS',
  sourceId: '18492',
  observedAt: AT,
  receivedAt: AT,
  importId: UUID_C,
} as const;

function tracedEntity(id: string, displayName: string) {
  return {
    id,
    type: 'Order',
    displayName,
    currentState: 'BLOCKED',
    state: { classification: 'UNSATISFIED', observation, latestBySource: [] },
  } as const;
}

const query = (kind: 'upstream' | 'downstream' | 'blockers') => ({
  entityId: UUID_A,
  kind,
  depth: 6,
  relationshipTypes: ['REQUIRES'],
  entityTypes: [],
});

const hop = {
  key: UUID_B,
  relationshipType: 'REQUIRES',
  fromEntityId: UUID_A,
  toEntityId: UUID_C,
  traversal: 'FORWARD',
  effectiveOrigin: 'SOURCE',
  effectiveConfidence: 'HIGH',
  assertions: [
    {
      relationshipId: UUID_B,
      origin: 'SOURCE',
      confidence: 'HIGH',
      basis: null,
      sourceSystem: 'Payments',
      sourceId: 'REQUIRES:18492:PAY-88213',
      observedAt: AT,
      importId: UUID_D,
    },
  ],
  entity: tracedEntity(UUID_C, 'Payment PAY-88213'),
} as const;

const path = {
  hops: [hop],
  length: 1,
  weakestConfidence: 'HIGH',
  nonSourceHops: 0,
  continuesBeyondDepth: false,
} as const;

describe('DEPENDENCY_DIRECTION', () => {
  it('covers exactly the 11 traceable relationship types', () => {
    expect(Object.keys(DEPENDENCY_DIRECTION).sort()).toEqual([...TRACEABLE_RELATIONSHIP_TYPES].sort());
    expect(TRACEABLE_RELATIONSHIP_TYPES).toHaveLength(11);
    expect(Object.keys(DEPENDENCY_DIRECTION)).not.toContain('RELATES_TO');
    expect(RelationshipTypeSchema.options).toContain('RELATES_TO');
  });
});

describe('STATE_CLASSIFICATION', () => {
  it('classifies all 12 states as in spec FR-006', () => {
    expect(Object.keys(STATE_CLASSIFICATION).sort()).toEqual([...OperationalStateSchema.options].sort());
    expect(STATE_CLASSIFICATION).toEqual({
      ACTIVE: 'SATISFIED',
      COMPLETED: 'SATISFIED',
      AT_RISK: 'SATISFIED',
      PENDING: 'UNSATISFIED',
      WAITING: 'UNSATISFIED',
      BLOCKED: 'UNSATISFIED',
      MISSING: 'UNSATISFIED',
      DELAYED: 'UNSATISFIED',
      FAILED: 'UNSATISFIED',
      CANCELLED: 'UNSATISFIED',
      SUSPENDED: 'UNSATISFIED',
      UNKNOWN: 'INDETERMINATE',
    });
  });

  it('lists satisfied states in schema order', () => {
    expect(SATISFIED_STATES).toEqual(['ACTIVE', 'AT_RISK', 'COMPLETED']);
  });
});

describe('DependenciesQuerySchema', () => {
  it('requires a direction', () => {
    expect(DependenciesQuerySchema.safeParse({}).success).toBe(false);
  });

  it('defaults depth to 6, limit to 50 and the lists to empty', () => {
    expect(DependenciesQuerySchema.parse({ direction: 'upstream' })).toEqual({
      direction: 'upstream',
      depth: 6,
      limit: 50,
      relationshipTypes: [],
      entityTypes: [],
    });
  });

  it.each(['0', '11', '2.5', 'abc'])('rejects depth %s', (depth) => {
    const result = DependenciesQuerySchema.safeParse({ direction: 'upstream', depth });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['depth']);
    }
  });

  it('accepts depth 1 and 10', () => {
    expect(DependenciesQuerySchema.parse({ direction: 'upstream', depth: '1' }).depth).toBe(1);
    expect(DependenciesQuerySchema.parse({ direction: 'upstream', depth: '10' }).depth).toBe(10);
  });

  it('de-duplicates relationship types and returns them in schema order', () => {
    const parsed = DependenciesQuerySchema.parse({
      direction: 'downstream',
      relationshipTypes: 'DEPENDS_ON,REQUIRES,REQUIRES',
    });
    expect(parsed.relationshipTypes).toEqual(['REQUIRES', 'DEPENDS_ON']);
  });

  it('rejects RELATES_TO with the index of the offending item', () => {
    const result = DependenciesQuerySchema.safeParse({
      direction: 'upstream',
      relationshipTypes: 'REQUIRES,RELATES_TO',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['relationshipTypes', 1]);
    }
  });

  it('treats an empty string as no filter', () => {
    const parsed = DependenciesQuerySchema.parse({
      direction: 'upstream',
      relationshipTypes: '',
      entityTypes: '',
    });
    expect(parsed.relationshipTypes).toEqual([]);
    expect(parsed.entityTypes).toEqual([]);
  });
});

describe('BlockersQuerySchema', () => {
  it('defaults depth to 6', () => {
    expect(BlockersQuerySchema.parse({}).depth).toBe(6);
  });

  it('rejects a relationship type outside REQUIRES, DEPENDS_ON and BLOCKS', () => {
    const result = BlockersQuerySchema.safeParse({ relationshipTypes: 'FULFILLED_BY' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['relationshipTypes', 0]);
    }
  });

  it('rejects an unknown entity type with its index', () => {
    const result = BlockersQuerySchema.safeParse({ entityTypes: 'Order,Truck' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['entityTypes', 1]);
    }
  });

  it('parses entity types in schema order', () => {
    expect(BlockersQuerySchema.parse({ entityTypes: 'Shipment,Order' }).entityTypes).toEqual([
      'Order',
      'Shipment',
    ]);
  });
});

describe('response schemas', () => {
  it('parses a blockers response', () => {
    const response = {
      query: query('blockers'),
      computedAt: AT,
      start: tracedEntity(UUID_A, 'Order #18492'),
      truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
      summary: 'Order #18492 is BLOCKED. No blockers found within 6 steps.',
      totalPaths: 1,
      paths: [{ ...path, endsInCycle: false, explanation: ['Order #18492 is blocked because …'] }],
      directBlockers: [
        {
          entity: tracedEntity(UUID_C, 'Payment PAY-88213'),
          pathLength: 1,
          possible: false,
          continuesBeyondDepth: false,
          inCycle: false,
        },
      ],
      deepestBlockers: [],
      cycleClosingHops: [],
      cycleClosingHopCount: 0,
    };
    expect(BlockersResponseSchema.safeParse(response).success).toBe(true);
  });

  it('parses a dependencies response', () => {
    const response = {
      query: query('upstream'),
      computedAt: AT,
      start: tracedEntity(UUID_A, 'Order #18492'),
      truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
      totalReached: 1,
      items: [{ entity: tracedEntity(UUID_C, 'Payment PAY-88213'), distance: 1, path }],
      nextCursor: null,
      cycleClosingHops: [
        {
          key: UUID_B,
          relationshipType: 'REQUIRES',
          fromEntityId: UUID_C,
          toEntityId: UUID_A,
          relationshipIds: [UUID_B],
        },
      ],
      cycleClosingHopCount: 1,
    };
    expect(DependenciesResponseSchema.safeParse(response).success).toBe(true);
  });

  it('rejects a hop with no assertions', () => {
    const response = {
      query: query('upstream'),
      computedAt: AT,
      start: tracedEntity(UUID_A, 'Order #18492'),
      truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
      totalReached: 1,
      items: [
        {
          entity: tracedEntity(UUID_C, 'Payment PAY-88213'),
          distance: 1,
          path: { ...path, hops: [{ ...hop, assertions: [] }] },
        },
      ],
      nextCursor: null,
      cycleClosingHops: [],
      cycleClosingHopCount: 0,
    };
    expect(DependenciesResponseSchema.safeParse(response).success).toBe(false);
  });
});
