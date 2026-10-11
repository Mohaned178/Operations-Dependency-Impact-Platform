import { CONFIDENCE_RANK, type BlockingPathDto, type Confidence } from '@opsgraph/shared';
import type { CandidateGroup } from './types';

/**
 * Research R3: group blocking paths by their deepest entity, in first-appearance order. The first
 * path of a group is its primary chain; the rest are alternatives, in `paths` order.
 */
export function groupCandidates(paths: readonly BlockingPathDto[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  paths.forEach((path, index) => {
    const deepest = path.hops.at(-1);
    if (deepest === undefined) {
      throw new Error('groupCandidates: path without hops');
    }
    const existing = groups.get(deepest.entity.id);
    if (existing === undefined) {
      groups.set(deepest.entity.id, {
        deepestEntityId: deepest.entity.id,
        primary: path,
        primaryIndex: index,
        alternatives: [],
      });
    } else {
      existing.alternatives.push(path);
    }
  });
  return [...groups.values()];
}

/** Confidence descending, then the 003 ranking of the primary chain. Does not mutate the input. */
export function orderCandidates<T extends { confidence: Confidence; primaryIndex: number }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
      a.primaryIndex - b.primaryIndex,
  );
}
