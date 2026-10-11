import {
  CONFIDENCE_RANK,
  IMPACT_STATE_CLASS,
  type Confidence,
  type OperationalState,
} from '@opsgraph/shared';
import { selectCanonicalPaths } from './canonical-paths';
import { compareCodeUnits, comparePaths } from './path-order';
import type { InternalPath, TraversalEdge } from './types';

export interface ImpactSelections {
  /** Research R2 step 3. */
  filteredEdges: TraversalEdge[];
  canonical: Map<string, InternalPath>;
  live: Map<string, InternalPath>;
  shortest: Map<string, InternalPath>;
  sourced: Set<string>;
  /** Cycle-closing hops of the canonical selection. */
  cycleClosing: TraversalEdge[];
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

function isTerminal(
  id: string,
  stateById: ReadonlyMap<string, OperationalState>,
): boolean {
  const state = stateById.get(id);
  return state !== undefined && IMPACT_STATE_CLASS[state] === 'TERMINAL';
}

function isImpaired(
  id: string,
  stateById: ReadonlyMap<string, OperationalState>,
): boolean {
  const state = stateById.get(id);
  return state !== undefined && IMPACT_STATE_CLASS[state] === 'IMPAIRED';
}

/** Drops edges out of terminal non-start entities and edges into the start. Keeps the input order. */
export function impactEdges(
  startId: string,
  edges: readonly TraversalEdge[],
  stateById: ReadonlyMap<string, OperationalState>,
): TraversalEdge[] {
  return edges.filter(
    (edge) =>
      edge.targetId !== startId &&
      (edge.sourceId === startId || !isTerminal(edge.sourceId, stateById)),
  );
}

export function computeImpactSelections(
  startId: string,
  edges: readonly TraversalEdge[],
  stateById: ReadonlyMap<string, OperationalState>,
  distanceById: ReadonlyMap<string, number>,
  maxDepth: number,
): ImpactSelections {
  const filtered = impactEdges(startId, edges, stateById);
  const canonicalResult = selectCanonicalPaths(startId, filtered, maxDepth);

  const startImpaired = isImpaired(startId, stateById);
  const liveEdges = startImpaired
    ? filtered.filter(
        (edge) =>
          (edge.sourceId === startId || isImpaired(edge.sourceId, stateById)) &&
          isImpaired(edge.targetId, stateById),
      )
    : [];
  const live =
    liveEdges.length === 0
      ? new Map<string, InternalPath>()
      : selectCanonicalPaths(startId, liveEdges, maxDepth).paths;

  const distanceOf = (id: string): number | undefined =>
    id === startId ? 0 : distanceById.get(id);
  const dagEdges = filtered.filter((edge) => {
    const from = distanceOf(edge.sourceId);
    const to = distanceOf(edge.targetId);
    return from !== undefined && to !== undefined && to === from + 1;
  });
  const shortest = selectCanonicalPaths(startId, dagEdges, maxDepth).paths;

  const sourced = sourcedReach(
    startId,
    filtered.filter((edge) => edge.effectiveOrigin === 'SOURCE'),
    maxDepth,
  );

  return {
    filteredEdges: filtered,
    canonical: canonicalResult.paths,
    live,
    shortest,
    sourced,
    cycleClosing: canonicalResult.cycleClosing,
  };
}

/** Layered BFS over SOURCE-only edges; ids reached within maxDepth (start excluded). */
export function sourcedReach(
  startId: string,
  edges: readonly TraversalEdge[],
  maxDepth: number,
): Set<string> {
  const bySource = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.effectiveOrigin !== 'SOURCE' || edge.targetId === startId) {
      continue;
    }
    const targets = bySource.get(edge.sourceId);
    if (targets === undefined) {
      bySource.set(edge.sourceId, [edge.targetId]);
    } else {
      targets.push(edge.targetId);
    }
  }

  const reached = new Set<string>();
  let frontier: string[] = [startId];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const target of bySource.get(id) ?? []) {
        if (!reached.has(target)) {
          reached.add(target);
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  return reached;
}

/** Research R4. Backward DFS per target with distance pruning, path cap and budget. */
export function enumerateImpactPaths(
  startId: string,
  edges: readonly TraversalEdge[],
  distanceById: ReadonlyMap<string, number>,
  targetIds: readonly string[],
  maxDepth: number,
  maxPaths: number,
  budget: number,
): Map<string, { found: InternalPath[]; morePaths: boolean }> {
  const intoTarget = new Map<string, TraversalEdge[]>();
  for (const edge of edges) {
    if (edge.targetId === startId) {
      continue;
    }
    const incoming = intoTarget.get(edge.targetId);
    if (incoming === undefined) {
      intoTarget.set(edge.targetId, [edge]);
    } else {
      incoming.push(edge);
    }
  }
  for (const incoming of intoTarget.values()) {
    incoming.sort(
      (a, b) => compareCodeUnits(a.sourceId, b.sourceId) || compareCodeUnits(a.key, b.key),
    );
  }

  const distanceOf = (id: string): number | undefined =>
    id === startId ? 0 : distanceById.get(id);

  const result = new Map<string, { found: InternalPath[]; morePaths: boolean }>();
  for (const targetId of targetIds) {
    if (targetId === startId || distanceOf(targetId) === undefined) {
      result.set(targetId, { found: [], morePaths: false });
      continue;
    }

    const found: InternalPath[] = [];
    let morePaths = false;
    let stopped = false;
    let expansions = 0;
    /** Suffix of the path being built, in walk order from `u` down to the target. */
    const suffixIds: string[] = [targetId];
    const suffixEdges: TraversalEdge[] = [];

    const visit = (u: string): void => {
      if (u === startId) {
        const entityIds = [...suffixIds].reverse();
        const pathEdges = [...suffixEdges].reverse();
        if (new Set(entityIds).size !== entityIds.length) {
          throw new Error('traversal invariant: repeated entity');
        }
        found.push({
          entityIds,
          edges: pathEdges,
          weakestConfidence: weakestOf(pathEdges),
          nonSourceHops: pathEdges.filter((hop) => hop.nonSource).length,
          continuesBeyondDepth: false,
          endsInCycle: false,
        });
        if (found.length === maxPaths) {
          morePaths = true;
          stopped = true;
        }
        return;
      }
      for (const edge of intoTarget.get(u) ?? []) {
        expansions += 1;
        if (expansions > budget) {
          morePaths = true;
          stopped = true;
          return;
        }
        const predecessor = edge.sourceId;
        if (suffixIds.includes(predecessor)) {
          continue;
        }
        const predecessorDistance = distanceOf(predecessor);
        if (
          predecessorDistance === undefined ||
          predecessorDistance + suffixEdges.length + 1 > maxDepth
        ) {
          continue;
        }
        suffixIds.push(predecessor);
        suffixEdges.push(edge);
        visit(predecessor);
        suffixEdges.pop();
        suffixIds.pop();
        if (stopped) {
          return;
        }
      }
    };

    visit(targetId);
    result.set(targetId, { found: found.sort(comparePaths), morePaths });
  }
  return result;
}
