import { CONFIDENCE_RANK } from '@opsgraph/shared';
import type { InternalPath } from './types';

/** Code-unit comparison. Never localeCompare: ordering must not depend on the locale. */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** Element-wise; a sequence that is a proper prefix of the other sorts first. */
export function compareIdSequences(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const result = compareCodeUnits(a[i] ?? '', b[i] ?? '');
    if (result !== 0) {
      return result;
    }
  }
  return Math.sign(a.length - b.length);
}

/**
 * Research R7, rules 1 to 5:
 * 1. weakest confidence, strongest first
 * 2. fewer non-SOURCE hops
 * 3. fewer hops
 * 4. entity id sequence
 * 5. hop key sequence
 */
export function comparePaths(a: InternalPath, b: InternalPath): number {
  const confidence = CONFIDENCE_RANK[b.weakestConfidence] - CONFIDENCE_RANK[a.weakestConfidence];
  if (confidence !== 0) {
    return Math.sign(confidence);
  }
  if (a.nonSourceHops !== b.nonSourceHops) {
    return Math.sign(a.nonSourceHops - b.nonSourceHops);
  }
  if (a.edges.length !== b.edges.length) {
    return Math.sign(a.edges.length - b.edges.length);
  }
  const ids = compareIdSequences(a.entityIds, b.entityIds);
  if (ids !== 0) {
    return ids;
  }
  return compareIdSequences(
    a.edges.map((edge) => edge.key),
    b.edges.map((edge) => edge.key),
  );
}
