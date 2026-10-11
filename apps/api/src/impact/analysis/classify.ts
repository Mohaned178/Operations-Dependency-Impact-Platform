import { IMPACT_STATE_CLASS } from '@opsgraph/shared';
import type { ImpactReachedEntity, TraversalPath } from '../../graph/graph.repository';
import type { Affected } from './types';

function sameHops(a: TraversalPath, b: TraversalPath): boolean {
  return a.hops.length === b.hops.length && a.hops.every((item, index) => item.key === b.hops[index]?.key);
}

/**
 * Spec FR-003 to FR-009, data-model 4b: classifies every reached entity of an impact trace, in the
 * trace order. Customers that are only attributed are added later by mergeCustomers.
 */
export function classifyReached(trace: { reached: readonly ImpactReachedEntity[] }): Affected[] {
  return trace.reached.map((row): Affected => {
    const stateClass = IMPACT_STATE_CLASS[row.entity.currentState];
    const terminal = stateClass === 'TERMINAL';
    const classification = terminal ? 'NOT_COUNTED' : row.livePath !== null ? 'CURRENT' : 'POTENTIAL';
    const primaryPath = terminal ? row.canonicalPath : (row.livePath ?? row.canonicalPath);
    const counted = classification !== 'NOT_COUNTED';

    return {
      entity: row.entity,
      classification,
      notCountedReason: terminal ? 'TERMINAL' : null,
      distance: row.distance,
      directness: row.distance === 1 ? 'DIRECT' : 'INDIRECT',
      primaryPath,
      shortestPath: sameHops(row.shortestPath, primaryPath) ? null : row.shortestPath,
      flags: {
        stateUnknown: stateClass === 'INDETERMINATE',
        otherCause: stateClass === 'IMPAIRED' && classification === 'POTENTIAL',
        inferredOnly: counted && !row.sourcedReach,
      },
      attributions: [],
    };
  });
}
