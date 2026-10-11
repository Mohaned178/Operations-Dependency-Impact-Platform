import type {
  Confidence,
  OperationalState,
  RelationshipOrigin,
  TraceableRelationshipType,
} from '@opsgraph/shared';
import {
  computeImpactSelections,
  enumerateImpactPaths,
  impactEdges,
  sourcedReach,
} from './impact-paths';
import { comparePaths } from './path-order';
import type { TraversalEdge } from './types';

interface EdgeOptions {
  type?: TraceableRelationshipType;
  origin?: RelationshipOrigin;
  confidence?: Confidence;
}

function edge(key: string, sourceId: string, targetId: string, options: EdgeOptions = {}): TraversalEdge {
  const origin = options.origin ?? 'SOURCE';
  return {
    key,
    type: options.type ?? 'REQUIRES',
    fromEntityId: sourceId,
    toEntityId: targetId,
    sourceId,
    targetId,
    traversal: 'FORWARD',
    effectiveOrigin: origin,
    effectiveConfidence: options.confidence ?? 'HIGH',
    nonSource: origin !== 'SOURCE',
    assertions: [],
  };
}

function states(entries: Record<string, OperationalState>): Map<string, OperationalState> {
  return new Map(Object.entries(entries));
}

/** Min distance over the impact edges, like the repository's CTE (start = 0). */
function distances(
  startId: string,
  edges: readonly TraversalEdge[],
  stateById: ReadonlyMap<string, OperationalState>,
  maxDepth: number,
): Map<string, number> {
  const filtered = impactEdges(startId, edges, stateById);
  const distance = new Map<string, number>();
  let frontier = [startId];
  for (let depth = 1; depth <= maxDepth + 1 && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of filtered) {
        if (e.sourceId === id && !distance.has(e.targetId)) {
          distance.set(e.targetId, depth);
          next.push(e.targetId);
        }
      }
    }
    frontier = next;
  }
  return distance;
}

function select(
  startId: string,
  edges: TraversalEdge[],
  stateById: Map<string, OperationalState>,
  maxDepth = 6,
) {
  return computeImpactSelections(
    startId,
    edges,
    stateById,
    distances(startId, edges, stateById, maxDepth),
    maxDepth,
  );
}

describe('computeImpactSelections: terminal stop', () => {
  it('lists a terminal entity but never expands through it', () => {
    const edges = [edge('k1', 'S', 'T'), edge('k2', 'T', 'X')];
    const result = select('S', edges, states({ S: 'BLOCKED', T: 'COMPLETED', X: 'ACTIVE' }));
    expect(result.canonical.has('T')).toBe(true);
    expect(result.canonical.has('X')).toBe(false);
  });

  it('still reaches X through another route', () => {
    const edges = [edge('k1', 'S', 'T'), edge('k2', 'T', 'X'), edge('k3', 'S', 'Y'), edge('k4', 'Y', 'X')];
    const result = select('S', edges, states({ S: 'BLOCKED', T: 'COMPLETED', Y: 'ACTIVE', X: 'ACTIVE' }));
    expect(result.canonical.get('X')?.entityIds).toEqual(['S', 'Y', 'X']);
  });

  it('expands from a terminal start', () => {
    const result = select('S', [edge('k1', 'S', 'A')], states({ S: 'COMPLETED' }));
    expect(result.canonical.has('A')).toBe(true);
  });
});

describe('computeImpactSelections: live', () => {
  it('marks a whole impaired chain live', () => {
    const result = select(
      'S',
      [edge('k1', 'S', 'A'), edge('k2', 'A', 'B')],
      states({ S: 'BLOCKED', A: 'BLOCKED', B: 'WAITING' }),
    );
    expect([...result.live.keys()].sort()).toEqual(['A', 'B']);
  });

  it('breaks the chain at an unimpaired entity', () => {
    const result = select(
      'S',
      [edge('k1', 'S', 'A'), edge('k2', 'A', 'B')],
      states({ S: 'BLOCKED', A: 'ACTIVE', B: 'WAITING' }),
    );
    expect(result.live.has('B')).toBe(false);
    expect(result.live.has('A')).toBe(false);
  });

  it('has no live entities when the start is ACTIVE', () => {
    const result = select(
      'S',
      [edge('k1', 'S', 'A')],
      states({ S: 'ACTIVE', A: 'BLOCKED' }),
    );
    expect(result.live.size).toBe(0);
  });

  it('never treats UNKNOWN as live', () => {
    const result = select(
      'S',
      [edge('k1', 'S', 'A'), edge('k2', 'A', 'B')],
      states({ S: 'BLOCKED', A: 'UNKNOWN', B: 'BLOCKED' }),
    );
    expect(result.live.size).toBe(0);
  });

  it('treats AT_RISK and SUSPENDED as live', () => {
    const result = select(
      'S',
      [edge('k1', 'S', 'A'), edge('k2', 'A', 'B')],
      states({ S: 'SUSPENDED', A: 'AT_RISK', B: 'SUSPENDED' }),
    );
    expect([...result.live.keys()].sort()).toEqual(['A', 'B']);
  });

  it('does not make a terminal entity live', () => {
    const result = select(
      'S',
      [edge('k1', 'S', 'A')],
      states({ S: 'BLOCKED', A: 'COMPLETED' }),
    );
    expect(result.live.has('A')).toBe(false);
  });
});

describe('computeImpactSelections: shortest vs canonical', () => {
  it('keeps the strongest path as canonical and the fewest hops as shortest', () => {
    const edges = [
      edge('k1', 'S', 'B', { origin: 'MANUAL', confidence: 'MEDIUM' }),
      edge('k2', 'S', 'A'),
      edge('k3', 'A', 'B'),
    ];
    const result = select('S', edges, states({}));
    expect(result.canonical.get('B')?.edges).toHaveLength(2);
    expect(result.shortest.get('B')?.edges).toHaveLength(1);
    expect(result.shortest.get('B')?.entityIds).toEqual(['S', 'B']);
  });
});

describe('sourcedReach', () => {
  it('leaves out an entity reached only through an INFERRED edge', () => {
    const edges = [edge('k1', 'S', 'X', { origin: 'INFERRED', confidence: 'LOW' })];
    expect(sourcedReach('S', edges, 6).has('X')).toBe(false);
  });

  it('includes an entity with an all-SOURCE path', () => {
    const edges = [
      edge('k1', 'S', 'A'),
      edge('k2', 'A', 'Y'),
      edge('k3', 'S', 'Y', { origin: 'INFERRED', confidence: 'LOW' }),
    ];
    const reached = sourcedReach('S', edges, 6);
    expect(reached.has('Y')).toBe(true);
    expect(reached.has('S')).toBe(false);
  });

  it('respects the depth bound', () => {
    const edges = [edge('k1', 'S', 'A'), edge('k2', 'A', 'B'), edge('k3', 'B', 'C')];
    expect([...sourcedReach('S', edges, 2)].sort()).toEqual(['A', 'B']);
  });

  it('is also computed by computeImpactSelections', () => {
    const edges = [
      edge('k1', 'S', 'A'),
      edge('k2', 'S', 'X', { origin: 'MANUAL', confidence: 'MEDIUM' }),
    ];
    const result = select('S', edges, states({}));
    expect(result.sourced.has('A')).toBe(true);
    expect(result.sourced.has('X')).toBe(false);
  });
});

describe('enumerateImpactPaths', () => {
  const all = (e: TraversalEdge[], depth = 6) => {
    const stateById = states({});
    return distances('S', e, stateById, depth);
  };

  it('finds both paths of a diamond, sorted', () => {
    const edges = [
      edge('k1', 'S', 'A'),
      edge('k2', 'S', 'B'),
      edge('k3', 'A', 'C'),
      edge('k4', 'B', 'C'),
    ];
    const found = enumerateImpactPaths('S', edges, all(edges), ['C'], 6, 21, 5000).get('C');
    expect(found?.morePaths).toBe(false);
    expect(found?.found.map((p) => p.entityIds)).toEqual([
      ['S', 'A', 'C'],
      ['S', 'B', 'C'],
    ]);
    const sorted = [...(found?.found ?? [])].sort(comparePaths);
    expect(found?.found).toEqual(sorted);
  });

  it('stops at maxPaths and says there may be more', () => {
    const edges = [
      edge('k1', 'S', 'A'),
      edge('k2', 'S', 'B'),
      edge('k3', 'S', 'D'),
      edge('k4', 'A', 'C'),
      edge('k5', 'B', 'C'),
      edge('k6', 'D', 'C'),
    ];
    const found = enumerateImpactPaths('S', edges, all(edges), ['C'], 6, 2, 5000).get('C');
    expect(found?.found).toHaveLength(2);
    expect(found?.morePaths).toBe(true);
  });

  it('stops on the search budget', () => {
    const edges = [edge('k1', 'S', 'A'), edge('k2', 'A', 'T')];
    const found = enumerateImpactPaths('S', edges, all(edges), ['T'], 6, 21, 1).get('T');
    expect(found?.morePaths).toBe(true);
  });

  it('terminates on a two-node cycle and never repeats an entity', () => {
    const edges = [
      edge('k1', 'S', 'A'),
      edge('k2', 'A', 'B'),
      edge('k3', 'B', 'A'),
    ];
    const result = enumerateImpactPaths('S', edges, all(edges), ['A', 'B'], 6, 21, 5000);
    for (const target of ['A', 'B']) {
      for (const path of result.get(target)?.found ?? []) {
        expect(new Set(path.entityIds).size).toBe(path.entityIds.length);
      }
    }
    expect(result.get('B')?.found.map((p) => p.entityIds)).toEqual([['S', 'A', 'B']]);
  });

  it('respects the depth bound', () => {
    const edges = [edge('k1', 'S', 'A'), edge('k2', 'A', 'B'), edge('k3', 'B', 'C')];
    const result = enumerateImpactPaths('S', edges, all(edges), ['C'], 2, 21, 5000);
    expect(result.get('C')?.found).toEqual([]);
  });

  it('returns nothing for the start and for an unknown target', () => {
    const edges = [edge('k1', 'S', 'A')];
    const result = enumerateImpactPaths('S', edges, all(edges), ['S', 'nope'], 6, 21, 5000);
    expect(result.get('S')).toEqual({ found: [], morePaths: false });
    expect(result.get('nope')).toEqual({ found: [], morePaths: false });
  });

  it('keeps parallel edges as distinct paths', () => {
    const edges = [edge('k1', 'S', 'A'), edge('k2', 'S', 'A', { type: 'DEPENDS_ON' })];
    const found = enumerateImpactPaths('S', edges, all(edges), ['A'], 6, 21, 5000).get('A');
    expect(found?.found).toHaveLength(2);
  });
});

describe('start handling', () => {
  it('drops edges into the start and never lists the start', () => {
    const edges = [edge('k1', 'S', 'A'), edge('k2', 'A', 'S')];
    const stateById = states({ S: 'BLOCKED', A: 'BLOCKED' });
    expect(impactEdges('S', edges, stateById).map((e) => e.key)).toEqual(['k1']);
    const result = select('S', edges, stateById);
    expect(result.canonical.has('S')).toBe(false);
    expect(result.live.has('S')).toBe(false);
    expect(result.shortest.has('S')).toBe(false);
    expect(result.sourced.has('S')).toBe(false);
    expect(result.filteredEdges.map((e) => e.key)).toEqual(['k1']);
  });
});
