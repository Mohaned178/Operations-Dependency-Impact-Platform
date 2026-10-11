import { DEPENDENCY_DIRECTION } from '@opsgraph/shared';
import { groupEdgeRows } from './edge-groups';
import type { EdgeRow, TraversalEdge, WalkDirection } from './types';

/**
 * Research R4: groups relationship rows by (type, from, to) into hop candidates and works out
 * the walk direction, the effective origin and confidence, and the assertion order.
 */
export function buildTraversalEdges(
  rows: readonly EdgeRow[],
  direction: WalkDirection,
): TraversalEdge[] {
  return groupEdgeRows(rows).map((group) => {
    const dependentIsFrom = DEPENDENCY_DIRECTION[group.type] === 'FROM_DEPENDS_ON_TO';
    const traversal = (direction === 'UPSTREAM') === dependentIsFrom ? 'FORWARD' : 'REVERSE';

    return {
      key: group.key,
      type: group.type,
      fromEntityId: group.fromEntityId,
      toEntityId: group.toEntityId,
      sourceId: traversal === 'FORWARD' ? group.fromEntityId : group.toEntityId,
      targetId: traversal === 'FORWARD' ? group.toEntityId : group.fromEntityId,
      traversal,
      effectiveOrigin: group.effectiveOrigin,
      effectiveConfidence: group.effectiveConfidence,
      nonSource: group.effectiveOrigin !== 'SOURCE',
      assertions: group.assertions,
    };
  });
}
