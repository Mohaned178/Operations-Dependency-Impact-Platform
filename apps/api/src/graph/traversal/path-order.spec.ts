import type { Confidence } from '@opsgraph/shared';
import { compareCodeUnits, compareIdSequences, comparePaths } from './path-order';
import type { InternalPath, TraversalEdge } from './types';

function edge(key: string, sourceId: string, targetId: string): TraversalEdge {
  return {
    key,
    type: 'REQUIRES',
    fromEntityId: sourceId,
    toEntityId: targetId,
    sourceId,
    targetId,
    traversal: 'FORWARD',
    effectiveOrigin: 'SOURCE',
    effectiveConfidence: 'HIGH',
    nonSource: false,
    assertions: [],
  };
}

function path(
  entityIds: string[],
  keys: string[],
  overrides: { weakestConfidence?: Confidence; nonSourceHops?: number } = {},
): InternalPath {
  return {
    entityIds,
    edges: keys.map((key, i) => edge(key, entityIds[i] ?? '', entityIds[i + 1] ?? '')),
    weakestConfidence: overrides.weakestConfidence ?? 'HIGH',
    nonSourceHops: overrides.nonSourceHops ?? 0,
    continuesBeyondDepth: false,
    endsInCycle: false,
  };
}

describe('compareCodeUnits', () => {
  it('returns -1, 0 and 1', () => {
    expect(compareCodeUnits('a', 'b')).toBe(-1);
    expect(compareCodeUnits('b', 'a')).toBe(1);
    expect(compareCodeUnits('a', 'a')).toBe(0);
  });

  it('orders by code unit, not by locale', () => {
    expect(compareCodeUnits('B', 'a')).toBeLessThan(0);
  });
});

describe('compareIdSequences', () => {
  it('compares element by element', () => {
    expect(compareIdSequences(['a', 'c'], ['a', 'b'])).toBe(1);
    expect(compareIdSequences(['a', 'b'], ['a', 'c'])).toBe(-1);
    expect(compareIdSequences(['a', 'b'], ['a', 'b'])).toBe(0);
  });

  it('sorts a prefix before the longer sequence', () => {
    expect(compareIdSequences(['a'], ['a', 'b'])).toBe(-1);
    expect(compareIdSequences(['a', 'b'], ['a'])).toBe(1);
  });
});

describe('comparePaths', () => {
  it('rule 1: a stronger weakest confidence sorts first, ahead of every later rule', () => {
    const strong = path(['s', 'z', 'y', 'x'], ['k3', 'k2', 'k1'], {
      weakestConfidence: 'HIGH',
      nonSourceHops: 3,
    });
    const weak = path(['s', 'a'], ['k0'], { weakestConfidence: 'MEDIUM' });
    expect(comparePaths(strong, weak)).toBeLessThan(0);
    expect(comparePaths(weak, strong)).toBeGreaterThan(0);

    const low = path(['s', 'a'], ['k0'], { weakestConfidence: 'LOW' });
    expect(comparePaths(weak, low)).toBeLessThan(0);
  });

  it('rule 2: fewer non-SOURCE hops sorts first, ahead of length', () => {
    const fewer = path(['s', 'z', 'y'], ['k2', 'k1'], { nonSourceHops: 0 });
    const more = path(['s', 'a'], ['k0'], { nonSourceHops: 1 });
    expect(comparePaths(fewer, more)).toBeLessThan(0);
    expect(comparePaths(more, fewer)).toBeGreaterThan(0);
  });

  it('rule 3: fewer hops sorts first, ahead of entity ids', () => {
    const shorter = path(['s', 'z'], ['k9']);
    const longer = path(['s', 'a', 'b'], ['k1', 'k2']);
    expect(comparePaths(shorter, longer)).toBeLessThan(0);
    expect(comparePaths(longer, shorter)).toBeGreaterThan(0);
  });

  it('rule 4: the entity id sequence decides, ahead of hop keys', () => {
    const first = path(['s', 'a'], ['k9']);
    const second = path(['s', 'b'], ['k1']);
    expect(comparePaths(first, second)).toBeLessThan(0);
    expect(comparePaths(second, first)).toBeGreaterThan(0);
  });

  it('rule 5: the hop key sequence decides when everything else is equal', () => {
    const first = path(['s', 'a'], ['k1']);
    const second = path(['s', 'a'], ['k2']);
    expect(comparePaths(first, second)).toBeLessThan(0);
    expect(comparePaths(second, first)).toBeGreaterThan(0);
    expect(comparePaths(first, path(['s', 'a'], ['k1']))).toBe(0);
  });
});
