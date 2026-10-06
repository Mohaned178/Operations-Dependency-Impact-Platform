import {
  DEPENDENCY_DIRECTION,
  TRACEABLE_RELATIONSHIP_TYPES,
  type TraceableRelationshipType,
} from '@opsgraph/shared';
import { walkTypes } from './walk-types';

// Spec FR-002, written out literally so the table is asserted independently of the code.
const FROM_DEPENDS_ON_TO: TraceableRelationshipType[] = [
  'REQUIRES',
  'DEPENDS_ON',
  'FULFILLED_BY',
  'SUPPLIED_BY',
  'CONTAINS',
];
const TO_DEPENDS_ON_FROM: TraceableRelationshipType[] = [
  'BLOCKS',
  'PLACED',
  'HAS',
  'GOVERNS',
  'DEFINES',
  'GENERATES',
];

describe('walkTypes', () => {
  it('knows exactly the 11 types of spec FR-002', () => {
    expect([...FROM_DEPENDS_ON_TO, ...TO_DEPENDS_ON_FROM].sort()).toEqual(
      [...TRACEABLE_RELATIONSHIP_TYPES].sort(),
    );
    for (const type of FROM_DEPENDS_ON_TO) {
      expect(DEPENDENCY_DIRECTION[type]).toBe('FROM_DEPENDS_ON_TO');
    }
    for (const type of TO_DEPENDS_ON_FROM) {
      expect(DEPENDENCY_DIRECTION[type]).toBe('TO_DEPENDS_ON_FROM');
    }
  });

  it.each(FROM_DEPENDS_ON_TO)('%s: upstream follows from, downstream follows to', (type) => {
    expect(walkTypes('UPSTREAM', [type])).toEqual({ followFromTypes: [type], followToTypes: [] });
    expect(walkTypes('DOWNSTREAM', [type])).toEqual({ followFromTypes: [], followToTypes: [type] });
  });

  it.each(TO_DEPENDS_ON_FROM)('%s: upstream follows to, downstream follows from', (type) => {
    expect(walkTypes('UPSTREAM', [type])).toEqual({ followFromTypes: [], followToTypes: [type] });
    expect(walkTypes('DOWNSTREAM', [type])).toEqual({ followFromTypes: [type], followToTypes: [] });
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
