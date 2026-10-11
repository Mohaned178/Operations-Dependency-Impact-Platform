import type { Confidence, RelationshipOrigin, RelationshipType } from '@opsgraph/shared';
import { selectCanonicalPaths } from './canonical-paths';
import { buildUndirectedTraversalEdges, groupEdgeRows } from './edge-groups';
import type { EdgeRow } from './types';

let counter = 0;

function row(overrides: Partial<EdgeRow<RelationshipType>> & { id: string }): EdgeRow<RelationshipType> {
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

function assertion(
  id: string,
  origin: RelationshipOrigin,
  confidence: Confidence,
  extra: Partial<EdgeRow<RelationshipType>> = {},
): EdgeRow<RelationshipType> {
  return row({ id, origin, confidence, ...extra });
}

describe('groupEdgeRows', () => {
  it('groups by (type, from, to)', () => {
    const groups = groupEdgeRows([
      row({ id: 'r1' }),
      row({ id: 'r2' }),
      row({ id: 'r3', type: 'DEPENDS_ON' }),
      row({ id: 'r4', fromEntityId: 'B', toEntityId: 'A' }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => [g.type, g.fromEntityId, g.toEntityId])).toEqual([
      ['REQUIRES', 'A', 'B'],
      ['DEPENDS_ON', 'A', 'B'],
      ['REQUIRES', 'B', 'A'],
    ]);
  });

  it('keys a group by its smallest relationship id', () => {
    const [group] = groupEdgeRows([
      row({ id: 'r9' }),
      row({ id: 'r2' }),
      row({ id: 'r5' }),
    ]);
    expect(group?.key).toBe('r2');
  });

  it('prefers SOURCE over MANUAL over INFERRED for the effective origin', () => {
    const origins = (list: RelationshipOrigin[]) =>
      groupEdgeRows(list.map((origin, i) => assertion(`r${i}`, origin, 'HIGH')))[0]?.effectiveOrigin;
    expect(origins(['INFERRED', 'MANUAL', 'SOURCE'])).toBe('SOURCE');
    expect(origins(['INFERRED', 'MANUAL'])).toBe('MANUAL');
    expect(origins(['INFERRED'])).toBe('INFERRED');
  });

  it('takes the highest confidence within the effective origin only', () => {
    const [group] = groupEdgeRows([
      assertion('r1', 'SOURCE', 'LOW'),
      assertion('r2', 'INFERRED', 'HIGH'),
      assertion('r3', 'SOURCE', 'MEDIUM'),
    ]);
    expect(group).toMatchObject({ effectiveOrigin: 'SOURCE', effectiveConfidence: 'MEDIUM' });
  });

  it('orders assertions by origin rank, confidence, newest first, then id', () => {
    const older = new Date('2026-08-01T00:00:00.000Z');
    const newer = new Date('2026-09-15T00:00:00.000Z');
    const [group] = groupEdgeRows([
      assertion('r1', 'INFERRED', 'HIGH'),
      assertion('r2', 'SOURCE', 'LOW'),
      assertion('r3', 'SOURCE', 'HIGH', { observedAt: older }),
      assertion('r4', 'SOURCE', 'HIGH', { observedAt: newer }),
      assertion('r5', 'SOURCE', 'HIGH', { observedAt: newer }),
    ]);
    expect(group?.assertions.map((a) => a.relationshipId)).toEqual(['r4', 'r5', 'r3', 'r2', 'r1']);
  });

  it('returns groups sorted by key in code-unit order', () => {
    const groups = groupEdgeRows([
      row({ id: 'b', fromEntityId: 'X', toEntityId: 'Y' }),
      row({ id: 'B', fromEntityId: 'P', toEntityId: 'Q' }),
      row({ id: 'a', fromEntityId: 'M', toEntityId: 'N' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['B', 'a', 'b']);
  });

  it('groups a RELATES_TO row like any other type', () => {
    const groups = groupEdgeRows([
      row({ id: 'r1', type: 'RELATES_TO' }),
      row({ id: 'r2', type: 'RELATES_TO', origin: 'MANUAL', confidence: 'LOW' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'r1',
      type: 'RELATES_TO',
      effectiveOrigin: 'SOURCE',
      effectiveConfidence: 'HIGH',
    });
    expect(groups[0]?.assertions).toHaveLength(2);
  });
});

describe('buildUndirectedTraversalEdges', () => {
  it('emits FORWARD then REVERSE for each group with the same key', () => {
    const edges = buildUndirectedTraversalEdges(groupEdgeRows([row({ id: 'r1' })]));
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      key: 'r1',
      traversal: 'FORWARD',
      sourceId: 'A',
      targetId: 'B',
      fromEntityId: 'A',
      toEntityId: 'B',
    });
    expect(edges[1]).toMatchObject({
      key: 'r1',
      traversal: 'REVERSE',
      sourceId: 'B',
      targetId: 'A',
      fromEntityId: 'A',
      toEntityId: 'B',
    });
  });

  it('sorts by key, FORWARD before REVERSE', () => {
    const edges = buildUndirectedTraversalEdges(
      groupEdgeRows([
        row({ id: 'r2', fromEntityId: 'C', toEntityId: 'D' }),
        row({ id: 'r1', fromEntityId: 'A', toEntityId: 'B' }),
      ]),
    );
    expect(edges.map((e) => [e.key, e.traversal])).toEqual([
      ['r1', 'FORWARD'],
      ['r1', 'REVERSE'],
      ['r2', 'FORWARD'],
      ['r2', 'REVERSE'],
    ]);
  });

  it('flags non-SOURCE effective origin', () => {
    const edges = buildUndirectedTraversalEdges(
      groupEdgeRows([
        row({ id: 'r1', origin: 'MANUAL' }),
        row({ id: 'r2', fromEntityId: 'B', toEntityId: 'C' }),
      ]),
    );
    expect(edges.filter((e) => e.key === 'r1').every((e) => e.nonSource)).toBe(true);
    expect(edges.filter((e) => e.key === 'r2').every((e) => !e.nonSource)).toBe(true);
  });

  it('lets selectCanonicalPaths reach entities through relationships in either direction', () => {
    // A → B (REQUIRES), C → B (BLOCKS), C RELATES_TO D: from A, B is forward, C is reverse-only.
    const edges = buildUndirectedTraversalEdges(
      groupEdgeRows([
        row({ id: 'r1', type: 'REQUIRES', fromEntityId: 'A', toEntityId: 'B' }),
        row({ id: 'r2', type: 'BLOCKS', fromEntityId: 'C', toEntityId: 'B' }),
        row({ id: 'r3', type: 'RELATES_TO', fromEntityId: 'C', toEntityId: 'D' }),
      ]),
    );
    const { paths } = selectCanonicalPaths('A', edges, 3);
    expect([...paths.keys()].sort()).toEqual(['B', 'C', 'D']);
    expect(paths.get('C')?.entityIds).toEqual(['A', 'B', 'C']);
    expect(paths.get('D')?.entityIds).toEqual(['A', 'B', 'C', 'D']);
    expect(paths.get('D')?.edges.map((e) => e.key)).toEqual(['r1', 'r2', 'r3']);
  });
});
