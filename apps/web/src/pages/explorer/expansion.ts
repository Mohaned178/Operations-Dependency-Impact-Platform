import { EXPLORER_LIMITS } from '@opsgraph/shared';

/**
 * The expand list after the user toggles `entityId`: collapse removes it, expand appends it (in
 * click order, which the server preserves). A new expansion is ignored once the limit is reached.
 */
export function toggleExpansion(previous: readonly string[], entityId: string): string[] {
  if (previous.includes(entityId)) {
    return previous.filter((expandedId) => expandedId !== entityId);
  }
  return previous.length >= EXPLORER_LIMITS.maxExpansions ? [...previous] : [...previous, entityId];
}

/** True when no further node can be expanded until one is collapsed. */
export function expansionLimitReached(expand: readonly string[]): boolean {
  return expand.length >= EXPLORER_LIMITS.maxExpansions;
}
