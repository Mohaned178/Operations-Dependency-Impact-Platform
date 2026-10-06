import { CONFIDENCE_RANK, type Confidence } from '@opsgraph/shared';
import { compareCodeUnits, comparePaths } from './path-order';
import type { InternalPath, TraversalEdge } from './types';

export interface BlockingPathsResult {
  /** Sorted by comparePaths. */
  paths: InternalPath[];
  enumerationCapped: boolean;
  /** Unique by key, unsorted; the repository sorts and caps. */
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

/**
 * Research R6: a deterministic depth-first search that lists every maximal simple path through
 * the blocker subgraph. A path ends where the chain ends, where a cycle closes, or at maxDepth.
 * No entity is ever added to a path that already contains it.
 */
export function enumerateBlockingPaths(
  startId: string,
  edges: readonly TraversalEdge[],
  maxDepth: number,
  maxEnumerated: number,
): BlockingPathsResult {
  const adjacency = new Map<string, TraversalEdge[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.sourceId);
    if (outgoing === undefined) {
      adjacency.set(edge.sourceId, [edge]);
    } else {
      outgoing.push(edge);
    }
  }
  for (const outgoing of adjacency.values()) {
    outgoing.sort(
      (a, b) => compareCodeUnits(a.targetId, b.targetId) || compareCodeUnits(a.key, b.key),
    );
  }

  const emitted: InternalPath[] = [];
  const cycleClosing = new Map<string, TraversalEdge>();
  let enumerationCapped = false;

  const entityIds: string[] = [startId];
  const hops: TraversalEdge[] = [];

  function emit(continuesBeyondDepth: boolean, endsInCycle: boolean): void {
    if (new Set(entityIds).size !== entityIds.length) {
      throw new Error('traversal invariant: repeated entity');
    }
    emitted.push({
      entityIds: [...entityIds],
      edges: [...hops],
      weakestConfidence: weakestOf(hops),
      nonSourceHops: hops.filter((hop) => hop.nonSource).length,
      continuesBeyondDepth,
      endsInCycle,
    });
    if (emitted.length >= maxEnumerated) {
      enumerationCapped = true;
    }
  }

  function walk(): void {
    const current = entityIds.at(-1);
    if (current === undefined) {
      throw new Error('traversal invariant: empty path');
    }

    const candidates: TraversalEdge[] = [];
    const skipped: TraversalEdge[] = [];
    for (const edge of adjacency.get(current) ?? []) {
      (entityIds.includes(edge.targetId) ? skipped : candidates).push(edge);
    }
    for (const edge of skipped) {
      cycleClosing.set(edge.key, edge);
    }

    if (candidates.length === 0 || hops.length === maxDepth) {
      if (hops.length >= 1) {
        emit(
          hops.length === maxDepth && candidates.length > 0,
          candidates.length === 0 && skipped.length > 0,
        );
      }
      return;
    }

    for (const edge of candidates) {
      entityIds.push(edge.targetId);
      hops.push(edge);
      walk();
      hops.pop();
      entityIds.pop();
      if (enumerationCapped) {
        return;
      }
    }
  }

  walk();

  return {
    paths: emitted.sort(comparePaths),
    enumerationCapped,
    cycleClosing: [...cycleClosing.values()],
  };
}
