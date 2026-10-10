import { describe, expect, it } from 'vitest';
import {
  ExplorerUrlParamsSchema,
  NeighborhoodQuerySchema,
  NeighborhoodResponseSchema,
} from './explorer';

const UUID_A = '6f1b3c2a-4d5e-4f60-8a9b-1c2d3e4f5a6b';
const UUID_B = '7a2c4d3b-5e6f-4071-9b0c-2d3e4f5a6b7c';
const AT = '2026-09-29T11:40:00.000Z';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

function node(n: number) {
  return {
    id: uuid(n),
    type: 'Order',
    displayName: `Order #${n}`,
    currentState: 'PENDING',
    state: { classification: 'INDETERMINATE', observation: null, latestBySource: [] },
    distance: n === 1 ? 0 : 1,
    reasons: [n === 1 ? 'FOCUS' : 'NEIGHBORHOOD'],
    parentId: n === 1 ? null : uuid(1),
    viaEdgeKey: n === 1 ? null : uuid(1000 + n),
    expanded: false,
  };
}

function response(nodes: unknown[]) {
  return {
    query: {
      entityId: uuid(1),
      direction: 'all',
      depth: 2,
      relationshipTypes: ['REQUIRES'],
      entityTypes: [],
      expand: [],
      blockers: false,
    },
    computedAt: AT,
    focusId: uuid(1),
    nodes,
    edges: [],
    totals: { visible: Math.max(nodes.length, 1), omitted: 0, omittedIsLowerBound: false },
    ignoredExpansions: [],
    blockers: null,
  };
}

describe('NeighborhoodQuerySchema', () => {
  it('applies defaults to an empty query', () => {
    expect(NeighborhoodQuerySchema.parse({})).toEqual({
      direction: 'all',
      depth: 2,
      relationshipTypes: [],
      entityTypes: [],
      expand: [],
      blockers: false,
    });
  });

  it.each(['0', '5', '2.5', 'abc'])('rejects depth %s', (depth) => {
    const result = NeighborhoodQuerySchema.safeParse({ depth });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['depth']);
  });

  it('accepts depth 4', () => {
    expect(NeighborhoodQuerySchema.parse({ depth: '4' }).depth).toBe(4);
  });

  it('accepts RELATES_TO with direction all', () => {
    const parsed = NeighborhoodQuerySchema.parse({
      direction: 'all',
      relationshipTypes: 'RELATES_TO',
    });
    expect(parsed.relationshipTypes).toEqual(['RELATES_TO']);
  });

  it.each(['upstream', 'downstream'])('rejects RELATES_TO with direction %s', (direction) => {
    const result = NeighborhoodQuerySchema.safeParse({
      direction,
      relationshipTypes: 'RELATES_TO',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['relationshipTypes']);
  });

  it('de-duplicates and orders entityTypes by schema order', () => {
    expect(NeighborhoodQuerySchema.parse({ entityTypes: 'Shipment,Order,Order' }).entityTypes).toEqual(
      ['Order', 'Shipment'],
    );
  });

  it('rejects an unknown entity type', () => {
    expect(NeighborhoodQuerySchema.safeParse({ entityTypes: 'Foo' }).success).toBe(false);
  });

  it('keeps expand in first-occurrence order and drops duplicates', () => {
    const parsed = NeighborhoodQuerySchema.parse({ expand: `${UUID_B},${UUID_A},${UUID_B}` });
    expect(parsed.expand).toEqual([UUID_B, UUID_A]);
  });

  it('rejects a non-UUID expand item', () => {
    expect(NeighborhoodQuerySchema.safeParse({ expand: `${UUID_A},nope` }).success).toBe(false);
  });

  it('rejects 51 distinct expand ids and accepts 50', () => {
    const ids = (count: number) => Array.from({ length: count }, (_, i) => uuid(i + 1)).join(',');
    expect(NeighborhoodQuerySchema.safeParse({ expand: ids(51) }).success).toBe(false);
    expect(NeighborhoodQuerySchema.parse({ expand: ids(50) }).expand).toHaveLength(50);
  });

  it('parses blockers true and rejects yes', () => {
    expect(NeighborhoodQuerySchema.parse({ blockers: 'true' }).blockers).toBe(true);
    expect(NeighborhoodQuerySchema.safeParse({ blockers: 'yes' }).success).toBe(false);
  });
});

describe('ExplorerUrlParamsSchema', () => {
  it('has no expand key in its output', () => {
    const parsed = ExplorerUrlParamsSchema.parse({});
    expect(Object.keys(parsed)).not.toContain('expand');
    expect(parsed).toEqual({
      direction: 'all',
      depth: 2,
      relationshipTypes: [],
      entityTypes: [],
      blockers: false,
    });
  });

  it('rejects RELATES_TO with upstream', () => {
    const result = ExplorerUrlParamsSchema.safeParse({
      direction: 'upstream',
      relationshipTypes: 'RELATES_TO',
    });
    expect(result.success).toBe(false);
  });
});

describe('NeighborhoodResponseSchema', () => {
  it('accepts a focus-only response', () => {
    expect(NeighborhoodResponseSchema.safeParse(response([node(1)])).success).toBe(true);
  });

  it('rejects an empty node list', () => {
    expect(NeighborhoodResponseSchema.safeParse(response([])).success).toBe(false);
  });

  it('rejects more than 200 nodes', () => {
    const nodes = Array.from({ length: 201 }, (_, i) => node(i + 1));
    expect(NeighborhoodResponseSchema.safeParse(response(nodes)).success).toBe(false);
  });

  it('accepts exactly 200 nodes', () => {
    const nodes = Array.from({ length: 200 }, (_, i) => node(i + 1));
    expect(NeighborhoodResponseSchema.safeParse(response(nodes)).success).toBe(true);
  });
});
