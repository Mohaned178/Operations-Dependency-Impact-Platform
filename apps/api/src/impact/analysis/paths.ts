import { CONFIDENCE_RANK } from '@opsgraph/shared';
import type { TraversalPath } from '../../graph/graph.repository';
import { compareIdSequences } from '../../graph/traversal/path-order';

/** Two paths are the same path when their hop keys are the same sequence. */
export function sameHops(a: TraversalPath, b: TraversalPath): boolean {
  return a.hops.length === b.hops.length && a.hops.every((hop, index) => hop.key === b.hops[index]?.key);
}

/**
 * The comparePaths rules (research R7 of 003) on rendered paths: weakest confidence first, fewer
 * non-SOURCE hops, fewer hops, then the entity id sequence and the hop key sequence.
 */
export function compareTraversalPaths(a: TraversalPath, b: TraversalPath): number {
  const confidence = CONFIDENCE_RANK[b.weakestConfidence] - CONFIDENCE_RANK[a.weakestConfidence];
  if (confidence !== 0) {
    return Math.sign(confidence);
  }
  if (a.nonSourceHops !== b.nonSourceHops) {
    return Math.sign(a.nonSourceHops - b.nonSourceHops);
  }
  if (a.hops.length !== b.hops.length) {
    return Math.sign(a.hops.length - b.hops.length);
  }
  return (
    compareIdSequences(
      a.hops.map((hop) => hop.target.id),
      b.hops.map((hop) => hop.target.id),
    ) ||
    compareIdSequences(
      a.hops.map((hop) => hop.key),
      b.hops.map((hop) => hop.key),
    )
  );
}

/**
 * Contracts/api.md § Field rules: the enumerated paths plus the shortest path, without the primary
 * path and without duplicates, then the first `limit` by compareTraversalPaths.
 */
export function alternativePaths(
  found: readonly TraversalPath[],
  shortest: TraversalPath | null,
  primary: TraversalPath | null,
  limit: number,
): TraversalPath[] {
  const unique: TraversalPath[] = [];
  for (const path of [...found, ...(shortest === null ? [] : [shortest])]) {
    if (
      (primary === null || !sameHops(path, primary)) &&
      !unique.some((existing) => sameHops(existing, path))
    ) {
      unique.push(path);
    }
  }
  return unique.sort(compareTraversalPaths).slice(0, limit);
}
