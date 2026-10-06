import type { Confidence, RelationshipOrigin, TraceableRelationshipType } from '@opsgraph/shared';
import { buildTraversalEdges } from './traversal-edges';
import type { EdgeRow } from './types';

let counter = 0;

function row(overrides: Partial<EdgeRow> & { id: string }): EdgeRow {
  counter += 1;
  return {
    type: 'REQUIRES',
    fromEntityId: 'A',
    toEntityId: 'B',
    origin: 'SOURCE',
    confidence: 'HIGH',
    basis: null,
    sourceSystem: `SYS-${counter}`,
    sourceId: `SRC-${counter}`,
    observedAt: new Date('2026-09-01T00:00:00.000Z'),
    importId: 'import-1',
    ...overrides,
  };
}

function assertion(origin: RelationshipOrigin, confidence: Confidence, id: string): EdgeRow {
  return row({ id, origin, confidence });
}

function single(type: TraceableRelationshipType, direction: 'UPSTREAM' | 'DOWNSTREAM') {
  const [edge] = buildTraversalEdges([row({ id: 'r1', type })], direction);
  if (edge === undefined) {
    throw new Error('expected one edge');
  }
  return edge;
}

describe('buildTraversalEdges direction', () => {
  it('walks REQUIRES upstream FORWARD, from the source to the target', () => {
    const edge = single('REQUIRES', 'UPSTREAM');
    expect(edge).toMatchObject({ traversal: 'FORWARD', sourceId: 'A', targetId: 'B' });
    expect(edge.fromEntityId).toBe('A');
    expect(edge.toEntityId).toBe('B');
  });

  it('walks BLOCKS upstream REVERSE, from `to` to `from`', () => {
    expect(single('BLOCKS', 'UPSTREAM')).toMatchObject({
      traversal: 'REVERSE',
      sourceId: 'B',
      targetId: 'A',
      fromEntityId: 'A',
      toEntityId: 'B',
    });
  });

  it('walks REQUIRES downstream REVERSE', () => {
    expect(single('REQUIRES', 'DOWNSTREAM')).toMatchObject({
      traversal: 'REVERSE',
      sourceId: 'B',
      targetId: 'A',
    });
  });

  it('walks PLACED upstream REVERSE', () => {
    expect(single('PLACED', 'UPSTREAM')).toMatchObject({
      traversal: 'REVERSE',
      sourceId: 'B',
      targetId: 'A',
    });
  });

  it('walks PLACED downstream FORWARD', () => {
    expect(single('PLACED', 'DOWNSTREAM')).toMatchObject({
      traversal: 'FORWARD',
      sourceId: 'A',
      targetId: 'B',
    });
  });
});

describe('buildTraversalEdges effective origin and confidence', () => {
  it('SOURCE beats MANUAL: {SOURCE/MEDIUM, MANUAL/HIGH} gives SOURCE/MEDIUM', () => {
    const [edge] = buildTraversalEdges(
      [assertion('MANUAL', 'HIGH', 'r1'), assertion('SOURCE', 'MEDIUM', 'r2')],
      'UPSTREAM',
    );
    expect(edge).toMatchObject({
      effectiveOrigin: 'SOURCE',
      effectiveConfidence: 'MEDIUM',
      nonSource: false,
    });
  });

  it('MANUAL beats INFERRED and keeps its own confidence: {INFERRED/HIGH, MANUAL/LOW} gives MANUAL/LOW', () => {
    const [edge] = buildTraversalEdges(
      [assertion('INFERRED', 'HIGH', 'r1'), assertion('MANUAL', 'LOW', 'r2')],
      'UPSTREAM',
    );
    expect(edge).toMatchObject({
      effectiveOrigin: 'MANUAL',
      effectiveConfidence: 'LOW',
      nonSource: true,
    });
  });

  it('INFERRED only takes the highest confidence: {INFERRED/LOW, INFERRED/MEDIUM} gives INFERRED/MEDIUM', () => {
    const [edge] = buildTraversalEdges(
      [assertion('INFERRED', 'LOW', 'r1'), assertion('INFERRED', 'MEDIUM', 'r2')],
      'UPSTREAM',
    );
    expect(edge).toMatchObject({
      effectiveOrigin: 'INFERRED',
      effectiveConfidence: 'MEDIUM',
      nonSource: true,
    });
  });
});

describe('buildTraversalEdges grouping and ordering', () => {
  it('groups assertions of one (type, from, to) into one edge keyed by the smallest id', () => {
    const edges = buildTraversalEdges(
      [
        assertion('SOURCE', 'HIGH', 'r3'),
        assertion('MANUAL', 'LOW', 'r1'),
        assertion('INFERRED', 'LOW', 'r2'),
      ],
      'UPSTREAM',
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]?.key).toBe('r1');
    expect(edges[0]?.assertions).toHaveLength(3);
  });

  it('orders assertions by origin, confidence, observedAt descending, then id', () => {
    const earlier = new Date('2026-09-01T00:00:00.000Z');
    const later = new Date('2026-09-02T00:00:00.000Z');
    const edges = buildTraversalEdges(
      [
        row({ id: 'r1', origin: 'INFERRED', confidence: 'HIGH' }),
        row({ id: 'r2', origin: 'SOURCE', confidence: 'LOW' }),
        row({ id: 'r3', origin: 'SOURCE', confidence: 'HIGH', observedAt: earlier }),
        row({ id: 'r4', origin: 'SOURCE', confidence: 'HIGH', observedAt: later }),
        row({ id: 'r6', origin: 'MANUAL', confidence: 'MEDIUM', observedAt: later }),
        row({ id: 'r5', origin: 'MANUAL', confidence: 'MEDIUM', observedAt: later }),
      ],
      'UPSTREAM',
    );
    expect(edges[0]?.assertions.map((a) => a.relationshipId)).toEqual([
      'r4',
      'r3',
      'r2',
      'r5',
      'r6',
      'r1',
    ]);
  });

  it('copies provenance onto every assertion', () => {
    const [edge] = buildTraversalEdges(
      [row({ id: 'r1', basis: 'why', sourceSystem: 'ERP', sourceId: 'X-1', importId: 'imp' })],
      'UPSTREAM',
    );
    expect(edge?.assertions[0]).toEqual({
      relationshipId: 'r1',
      origin: 'SOURCE',
      confidence: 'HIGH',
      basis: 'why',
      sourceSystem: 'ERP',
      sourceId: 'X-1',
      observedAt: new Date('2026-09-01T00:00:00.000Z'),
      importId: 'imp',
    });
  });

  it('gives two edges for two distinct types between the same pair', () => {
    const edges = buildTraversalEdges(
      [row({ id: 'r1', type: 'REQUIRES' }), row({ id: 'r2', type: 'DEPENDS_ON' })],
      'UPSTREAM',
    );
    expect(edges.map((edge) => edge.type).sort()).toEqual(['DEPENDS_ON', 'REQUIRES']);
  });

  it('keeps opposite directions between the same pair as separate edges', () => {
    const edges = buildTraversalEdges(
      [
        row({ id: 'r1', fromEntityId: 'A', toEntityId: 'B' }),
        row({ id: 'r2', fromEntityId: 'B', toEntityId: 'A' }),
      ],
      'UPSTREAM',
    );
    expect(edges).toHaveLength(2);
  });

  it('returns nothing for no rows', () => {
    expect(buildTraversalEdges([], 'UPSTREAM')).toEqual([]);
  });
});
