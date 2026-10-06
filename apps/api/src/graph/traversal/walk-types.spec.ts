import {
  DEPENDENCY_DIRECTION,
  TRACEABLE_RELATIONSHIP_TYPES,
  type TraceableRelationshipType,
} from '@opsgraph/shared';
import { walkTypes } from './walk-types';

describe('walkTypes', () => {
  const cases = TRACEABLE_RELATIONSHIP_TYPES.flatMap((type) =>
    (['UPSTREAM', 'DOWNSTREAM'] as const).map((direction) => [type, direction] as const),
  );

  it.each(cases)('places %s for %s in the right list', (type, direction) => {
    const dependentIsFrom = DEPENDENCY_DIRECTION[type] === 'FROM_DEPENDS_ON_TO';
    const movesFromEnd = direction === 'UPSTREAM' ? dependentIsFrom : !dependentIsFrom;

    const result = walkTypes(direction, [type]);

    expect(result).toEqual(
      movesFromEnd
        ? { followFromTypes: [type], followToTypes: [] }
        : { followFromTypes: [], followToTypes: [type] },
    );
  });

  it('splits the blocker types for an upstream walk', () => {
    expect(walkTypes('UPSTREAM', ['REQUIRES', 'DEPENDS_ON', 'BLOCKS'])).toEqual({
      followFromTypes: ['REQUIRES', 'DEPENDS_ON'],
      followToTypes: ['BLOCKS'],
    });
  });

  it('swaps the lists for a downstream walk', () => {
    expect(walkTypes('DOWNSTREAM', ['REQUIRES', 'DEPENDS_ON', 'BLOCKS'])).toEqual({
      followFromTypes: ['BLOCKS'],
      followToTypes: ['REQUIRES', 'DEPENDS_ON'],
    });
  });

  it('orders both lists by TRACEABLE_RELATIONSHIP_TYPES, whatever the input order', () => {
    const shuffled: TraceableRelationshipType[] = ['BLOCKS', 'DEPENDS_ON', 'REQUIRES'];
    expect(walkTypes('UPSTREAM', shuffled)).toEqual({
      followFromTypes: ['REQUIRES', 'DEPENDS_ON'],
      followToTypes: ['BLOCKS'],
    });
  });

  it('covers all 11 types when none is filtered out', () => {
    const result = walkTypes('UPSTREAM', TRACEABLE_RELATIONSHIP_TYPES);
    expect(result.followFromTypes).toHaveLength(5);
    expect(result.followToTypes).toHaveLength(6);
  });
});
