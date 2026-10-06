import type { Confidence, RelationshipOrigin, TraceableRelationshipType } from '@opsgraph/shared';
import { selectCanonicalPaths } from './canonical-paths';
import type { TraversalEdge } from './types';

interface EdgeOptions {
  type?: TraceableRelationshipType;
  origin?: RelationshipOrigin;
  confidence?: Confidence;
  traversal?: 'FORWARD' | 'REVERSE';
}

function edge(key: string, sourceId: string, targetId: string, options: EdgeOptions = {}): TraversalEdge {
  const traversal = options.traversal ?? 'FORWARD';
  const origin = options.origin ?? 'SOURCE';
  return {
    key,
    type: options.type ?? 'REQUIRES',
    fromEntityId: traversal === 'FORWARD' ? sourceId : targetId,
    toEntityId: traversal === 'FORWARD' ? targetId : sourceId,
    sourceId,
    targetId,
    traversal,
    effectiveOrigin: origin,
    effectiveConfidence: options.confidence ?? 'HIGH',
    nonSource: origin !== 'SOURCE',
    assertions: [],
  };
}

describe('selectCanonicalPaths', () => {
  it('sees only neighbours at depth 1', () => {
    const result = selectCanonicalPaths(
      'A',
      [edge('k1', 'A', 'B'), edge('k2', 'B', 'C')],
      1,
    );
    expect([...result.paths.keys()]).toEqual(['B']);
    expect(result.paths.get('B')?.entityIds).toEqual(['A', 'B']);
    expect(result.paths.has('C')).toBe(false);
  });

  it('prefers the 2-hop SOURCE/HIGH route over a direct MANUAL/MEDIUM edge (SHP→PAY)', () => {
    const result = selectCanonicalPaths(
      'SHP',
      [
        edge('k0', 'SHP', 'PAY', { origin: 'MANUAL', confidence: 'MEDIUM' }),
        edge('k1', 'SHP', 'ORD'),
        edge('k2', 'ORD', 'PAY'),
      ],
      6,
    );
    const pay = result.paths.get('PAY');
    expect(pay?.entityIds).toEqual(['SHP', 'ORD', 'PAY']);
    expect(pay?.weakestConfidence).toBe('HIGH');
    expect(pay?.nonSourceHops).toBe(0);
    expect(pay?.edges).toHaveLength(2);
    expect(pay?.endsInCycle).toBe(false);
  });

  it('rule 2: fewer non-SOURCE hops wins even when longer', () => {
    const result = selectCanonicalPaths(
      'S',
      [
        edge('k1', 'S', 'A'),
        edge('k2', 'A', 'T', { origin: 'MANUAL', confidence: 'HIGH' }),
        edge('k3', 'S', 'B'),
        edge('k4', 'B', 'C'),
        edge('k5', 'C', 'T'),
      ],
      6,
    );
    // Both routes are weakest HIGH; the 3-hop all-SOURCE route beats the 2-hop route with one MANUAL hop.
    expect(result.paths.get('T')?.entityIds).toEqual(['S', 'B', 'C', 'T']);
    expect(result.paths.get('T')).toMatchObject({ weakestConfidence: 'HIGH', nonSourceHops: 0 });
  });

  it('rule 3: fewer hops wins when rules 1–2 tie', () => {
    const result = selectCanonicalPaths(
      'S',
      [
        edge('k1', 'S', 'A'),
        edge('k2', 'A', 'T'),
        edge('k3', 'S', 'B'),
        edge('k4', 'B', 'C'),
        edge('k5', 'C', 'T'),
      ],
      6,
    );
    expect(result.paths.get('T')?.entityIds).toEqual(['S', 'A', 'T']);
  });

  it('rule 4: the entity-id sequence decides, then the hop key', () => {
    const byEntity = selectCanonicalPaths(
      'S',
      [edge('k9', 'S', 'B'), edge('k1', 'B', 'T'), edge('k8', 'S', 'A'), edge('k2', 'A', 'T')],
      6,
    );
    expect(byEntity.paths.get('T')?.entityIds).toEqual(['S', 'A', 'T']);

    const byKey = selectCanonicalPaths(
      'S',
      [
        edge('k2', 'S', 'M', { type: 'DEPENDS_ON' }),
        edge('k1', 'S', 'M'),
        edge('k3', 'M', 'T'),
      ],
      6,
    );
    expect(byKey.paths.get('M')?.edges.map((hop) => hop.key)).toEqual(['k1']);
    expect(byKey.paths.get('T')?.entityIds).toEqual(['S', 'M', 'T']);
    expect(byKey.paths.get('T')?.edges[0]?.key).toBe('k1');
  });

  it('closes a 2-node cycle with one path per entity and one cycle-closing edge', () => {
    const closing = edge('k2', 'B', 'A');
    const result = selectCanonicalPaths('A', [edge('k1', 'A', 'B'), closing], 6);
    expect([...result.paths.keys()]).toEqual(['B']);
    expect(result.paths.get('B')?.entityIds).toEqual(['A', 'B']);
    expect(result.paths.get('B')?.endsInCycle).toBe(false);
    expect(result.cycleClosing).toEqual([closing]);
  });

  it('closes a 3-node cycle with one path per entity', () => {
    const closing = edge('k3', 'C', 'A');
    const result = selectCanonicalPaths(
      'A',
      [edge('k1', 'A', 'B'), edge('k2', 'B', 'C'), closing],
      6,
    );
    expect([...result.paths.keys()].sort()).toEqual(['B', 'C']);
    expect(result.paths.get('C')?.entityIds).toEqual(['A', 'B', 'C']);
    expect(result.cycleClosing).toEqual([closing]);
  });

  it('never returns a path for the start entity; the edge back is cycle-closing', () => {
    const result = selectCanonicalPaths('A', [edge('k1', 'A', 'B'), edge('k2', 'B', 'A')], 6);
    expect(result.paths.has('A')).toBe(false);
    expect(result.cycleClosing.map((hop) => hop.key)).toEqual(['k2']);
  });

  it('reaches 10 entities on an 11-chain at maxDepth 10 and flags the last', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `N${i}`);
    const chain: TraversalEdge[] = [];
    for (let i = 0; i < 11; i += 1) {
      const from = ids[i];
      const to = ids[i + 1];
      if (from === undefined || to === undefined) {
        throw new Error('test setup: missing chain id');
      }
      chain.push(edge(`k${String(i).padStart(2, '0')}`, from, to));
    }
    const start = ids[0] ?? '';
    const result = selectCanonicalPaths(start, chain, 10);
    expect(result.paths.size).toBe(10);
    expect(result.paths.has(ids[11] ?? '')).toBe(false);
    const last = result.paths.get(ids[10] ?? '');
    expect(last?.entityIds).toHaveLength(11);
    expect(last?.continuesBeyondDepth).toBe(true);
    const first = result.paths.get(ids[1] ?? '');
    expect(first?.continuesBeyondDepth).toBe(false);
  });

  it('leaves an unreachable entity absent', () => {
    const result = selectCanonicalPaths('A', [edge('k1', 'A', 'B')], 6);
    expect(result.paths.has('B')).toBe(true);
    expect(result.paths.has('Z')).toBe(false);
  });
});
