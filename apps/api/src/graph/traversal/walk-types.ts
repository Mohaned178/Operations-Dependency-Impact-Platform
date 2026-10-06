import {
  DEPENDENCY_DIRECTION,
  TRACEABLE_RELATIONSHIP_TYPES,
  type TraceableRelationshipType,
} from '@opsgraph/shared';
import type { WalkDirection } from './types';

/**
 * Splits the requested relationship types by which end of the relationship the walk starts from
 * (research R3 table). Both lists follow TRACEABLE_RELATIONSHIP_TYPES order.
 *
 * - followFromTypes: the walk is at the `from` end and moves to `to`.
 * - followToTypes: the walk is at the `to` end and moves to `from`.
 */
export function walkTypes(
  direction: WalkDirection,
  types: readonly TraceableRelationshipType[],
): { followFromTypes: TraceableRelationshipType[]; followToTypes: TraceableRelationshipType[] } {
  const followFromDirection =
    direction === 'UPSTREAM' ? 'FROM_DEPENDS_ON_TO' : 'TO_DEPENDS_ON_FROM';
  const requested = TRACEABLE_RELATIONSHIP_TYPES.filter((type) => types.includes(type));
  return {
    followFromTypes: requested.filter((type) => DEPENDENCY_DIRECTION[type] === followFromDirection),
    followToTypes: requested.filter((type) => DEPENDENCY_DIRECTION[type] !== followFromDirection),
  };
}
