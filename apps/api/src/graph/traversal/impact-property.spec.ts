import {
  CONFIDENCE_RANK,
  IMPACT_STATE_CLASS,
  OperationalStateSchema,
  type Confidence,
  type OperationalState,
  type RelationshipOrigin,
} from '@opsgraph/shared';
import { computeImpactSelections, enumerateImpactPaths } from './impact-paths';
import { comparePaths } from './path-order';
import type { InternalPath, TraversalEdge } from './types';

/** Inline LCG (no dependency): deterministic for a given seed. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const ORIGINS: RelationshipOrigin[] = ['SOURCE', 'MANUAL', 'INFERRED'];
const CONFIDENCES: Confidence[] = ['HIGH', 'MEDIUM', 'LOW'];
const STATES = OperationalStateSchema.options;
const GRAPH_COUNT = 1_200;

interface RandomGraph {
  seed: number;
  startId: string;
  maxDepth: number;
  edges: TraversalEdge[];
  stateById: Map<string, OperationalState>;
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) {
    throw new Error('property test invariant: empty pick');
  }
  return item;
}

function randomGraph(seed: number): RandomGraph {
  const rand = lcg(seed);
  const nodeCount = 2 + Math.floor(rand() * 8);
  const ids = Array.from({ length: nodeCount }, (_, i) => `n${i}`);
  const edgeCount = Math.floor(rand() * (nodeCount * 3 + 1));
  const edges: TraversalEdge[] = [];
  for (let i = 0; i < edgeCount; i += 1) {
    const sourceId = pick(rand, ids);
    const targetId = pick(rand, ids);
    const origin = pick(rand, ORIGINS);
    edges.push({
      key: `k${String(i).padStart(2, '0')}`,
      type: 'REQUIRES',
      fromEntityId: sourceId,
      toEntityId: targetId,
      sourceId,
      targetId,
      traversal: 'FORWARD',
      effectiveOrigin: origin,
      effectiveConfidence: pick(rand, CONFIDENCES),
      nonSource: origin !== 'SOURCE',
      assertions: [],
    });
  }
  const stateById = new Map<string, OperationalState>();
  for (const id of ids) {
    stateById.set(id, pick(rand, STATES));
  }
  return { seed, startId: 'n0', maxDepth: 1 + Math.floor(rand() * 4), edges, stateById };
}

function weakestOf(edges: readonly TraversalEdge[]): Confidence {
  let weakest: Confidence = 'HIGH';
  for (const edge of edges) {
    if (CONFIDENCE_RANK[edge.effectiveConfidence] < CONFIDENCE_RANK[weakest]) {
      weakest = edge.effectiveConfidence;
    }
  }
  return weakest;
}

/**
 * Every simple path from the start of 1..depth hops. A terminal non-start entity is never
 * expanded and the start is never re-entered. Written without impactEdges on purpose.
 */
function brutePaths(graph: RandomGraph, depth: number): InternalPath[] {
  const found: InternalPath[] = [];
  const entityIds: string[] = [graph.startId];
  const hops: TraversalEdge[] = [];

  const walk = (): void => {
    const current = entityIds.at(-1);
    if (current === undefined) {
      throw new Error('property test invariant: empty path');
    }
    if (hops.length > 0) {
      found.push({
        entityIds: [...entityIds],
        edges: [...hops],
        weakestConfidence: weakestOf(hops),
        nonSourceHops: hops.filter((hop) => hop.nonSource).length,
        continuesBeyondDepth: false,
        endsInCycle: false,
      });
    }
    if (hops.length === depth) {
      return;
    }
    const state = graph.stateById.get(current);
    if (current !== graph.startId && state !== undefined && IMPACT_STATE_CLASS[state] === 'TERMINAL') {
      return;
    }
    for (const edge of graph.edges) {
      if (edge.sourceId !== current || entityIds.includes(edge.targetId)) {
        continue;
      }
      entityIds.push(edge.targetId);
      hops.push(edge);
      walk();
      hops.pop();
      entityIds.pop();
    }
  };

  walk();
  return found;
}

function signature(path: InternalPath): string {
  return `${path.entityIds.join('>')}|${path.edges.map((edge) => edge.key).join(',')}`;
}

function groupByTarget(paths: readonly InternalPath[]): Map<string, InternalPath[]> {
  const grouped = new Map<string, InternalPath[]>();
  for (const path of paths) {
    const target = path.entityIds.at(-1);
    if (target === undefined) {
      throw new Error('property test invariant: empty path');
    }
    const list = grouped.get(target);
    if (list === undefined) {
      grouped.set(target, [path]);
    } else {
      list.push(path);
    }
  }
  return grouped;
}

function isImpaired(state: OperationalState | undefined): boolean {
  return state !== undefined && IMPACT_STATE_CLASS[state] === 'IMPAIRED';
}

function minimum(paths: readonly InternalPath[]): InternalPath {
  const best = [...paths].sort(comparePaths)[0];
  if (best === undefined) {
    throw new Error('property test invariant: no path to minimise');
  }
  return best;
}

describe('impact traversal against brute force (SC-007)', () => {
  it(`agrees on ${GRAPH_COUNT} generated graphs`, () => {
    for (let index = 0; index < GRAPH_COUNT; index += 1) {
      const graph = randomGraph(index * 7919 + 17);
      const label = `graph #${index} (seed ${graph.seed}, maxDepth ${graph.maxDepth})`;
      const { startId, maxDepth, stateById } = graph;

      const beyond = brutePaths(graph, maxDepth + 1);
      const distanceById = new Map<string, number>();
      for (const path of beyond) {
        const target = path.entityIds.at(-1);
        if (target === undefined) continue;
        const known = distanceById.get(target);
        if (known === undefined || path.edges.length < known) {
          distanceById.set(target, path.edges.length);
        }
      }
      const within = beyond.filter((path) => path.edges.length <= maxDepth);
      const byTarget = groupByTarget(within);

      const selections = computeImpactSelections(startId, graph.edges, stateById, distanceById, maxDepth);

      // reached set
      expect([...selections.canonical.keys()].sort()).toEqual([...byTarget.keys()].sort());
      expect([...selections.shortest.keys()].sort()).toEqual([...byTarget.keys()].sort());
      expect(selections.canonical.has(startId)).toBe(false);

      const startImpaired = isImpaired(stateById.get(startId));
      const enumerated = enumerateImpactPaths(
        startId,
        selections.filteredEdges,
        distanceById,
        [...byTarget.keys()],
        maxDepth,
        1_000_000,
        10_000_000,
      );

      for (const [target, paths] of byTarget) {
        const where = `${label}, target ${target}`;
        const minDistance = Math.min(...paths.map((path) => path.edges.length));
        expect([where, distanceById.get(target)]).toEqual([where, minDistance]);

        const liveExpected =
          startImpaired &&
          paths.some((path) => path.entityIds.every((id) => isImpaired(stateById.get(id))));
        expect([where, 'live', selections.live.has(target)]).toEqual([where, 'live', liveExpected]);

        const sourcedExpected = paths.some((path) =>
          path.edges.every((edge) => edge.effectiveOrigin === 'SOURCE'),
        );
        expect([where, 'sourced', selections.sourced.has(target)]).toEqual([
          where,
          'sourced',
          sourcedExpected,
        ]);

        const canonical = selections.canonical.get(target);
        expect([where, 'canonical', canonical === undefined ? null : signature(canonical)]).toEqual([
          where,
          'canonical',
          signature(minimum(paths)),
        ]);

        const shortestPaths = paths.filter((path) => path.edges.length === minDistance);
        const shortest = selections.shortest.get(target);
        expect([where, 'shortest', shortest === undefined ? null : signature(shortest)]).toEqual([
          where,
          'shortest',
          signature(minimum(shortestPaths)),
        ]);

        if (liveExpected) {
          const livePaths = paths.filter((path) =>
            path.entityIds.every((id) => isImpaired(stateById.get(id))),
          );
          const live = selections.live.get(target);
          expect([where, 'live path', live === undefined ? null : signature(live)]).toEqual([
            where,
            'live path',
            signature(minimum(livePaths)),
          ]);
        }

        const listed = enumerated.get(target);
        expect([where, 'enumerated', listed?.found.map(signature)]).toEqual([
          where,
          'enumerated',
          [...paths].sort(comparePaths).map(signature),
        ]);
        expect(listed?.morePaths).toBe(false);
        for (const path of listed?.found ?? []) {
          expect(path.edges.length).toBeLessThanOrEqual(maxDepth);
          expect(new Set(path.entityIds).size).toBe(path.entityIds.length);
        }
      }
    }
  });
});
