import { directPath, hop, path, ref } from '../../../test/impact-builders';
import { alternativePaths, compareTraversalPaths, sameHops } from './paths';

describe('sameHops', () => {
  it('compares hop key sequences', () => {
    const target = ref('Order', 'A');
    expect(sameHops(path([hop(target, { key: 'k1' })]), path([hop(target, { key: 'k1' })]))).toBe(true);
    expect(sameHops(path([hop(target, { key: 'k1' })]), path([hop(target, { key: 'k2' })]))).toBe(false);
    expect(sameHops(path([hop(target, { key: 'k1' })]), path([]))).toBe(false);
  });
});

describe('compareTraversalPaths', () => {
  const target = ref('Order', 'T');
  const middle = ref('Product', 'M');

  it('ranks stronger confidence first, then fewer non-SOURCE hops, then fewer hops', () => {
    const strong = path([hop(target, { key: 'a' })]);
    const weak = path([hop(target, { key: 'b', confidence: 'LOW' })]);
    const manual = path([hop(target, { key: 'c', origin: 'MANUAL' })]);
    const long = path([hop(middle, { key: 'd' }), hop(target, { key: 'e' })]);
    expect([weak, manual, long, strong].sort(compareTraversalPaths)).toEqual([strong, long, manual, weak]);
  });

  it('breaks ties by entity ids and then hop keys', () => {
    const low = ref('Product', 'Low', 'ACTIVE', '00000000-0000-4000-8000-0000000000a1');
    const high = ref('Product', 'High', 'ACTIVE', '00000000-0000-4000-8000-0000000000a2');
    const viaLow = path([hop(low, { key: 'z' })]);
    const viaHigh = path([hop(high, { key: 'a' })]);
    expect([viaHigh, viaLow].sort(compareTraversalPaths)).toEqual([viaLow, viaHigh]);
    const first = path([hop(low, { key: 'k1' })]);
    const second = path([hop(low, { key: 'k2' })]);
    expect([second, first].sort(compareTraversalPaths)).toEqual([first, second]);
  });
});

describe('alternativePaths', () => {
  const target = ref('Order', 'T');
  const primary = path([hop(target, { key: 'primary' })]);

  it('drops the primary path and duplicates, adds the shortest path and sorts', () => {
    const other = path([hop(target, { key: 'other', confidence: 'LOW' })]);
    const duplicateOfOther = path([hop(target, { key: 'other', confidence: 'LOW' })]);
    const shortest = path([hop(target, { key: 'shortest' })]);
    expect(alternativePaths([primary, other, duplicateOfOther], shortest, primary, 20)).toEqual([
      shortest,
      other,
    ]);
  });

  it('does not repeat a shortest path that was already enumerated', () => {
    const shortest = path([hop(target, { key: 'shortest' })]);
    expect(alternativePaths([shortest], path([hop(target, { key: 'shortest' })]), primary, 20)).toHaveLength(1);
  });

  it('keeps only the first `limit` paths', () => {
    const many = Array.from({ length: 5 }, (_, index) => directPath(target, { key: `k${index}` }));
    expect(alternativePaths(many, null, null, 3)).toEqual(many.slice(0, 3));
  });
});
