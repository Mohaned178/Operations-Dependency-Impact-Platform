import { EXPLORER_LIMITS } from '@opsgraph/shared';
import { describe, expect, it } from 'vitest';
import { expansionLimitReached, toggleExpansion } from './expansion';

const ids = (count: number) => Array.from({ length: count }, (_, i) => `id-${i}`);

describe('toggleExpansion', () => {
  it('appends in click order', () => {
    expect(toggleExpansion(toggleExpansion([], 'b'), 'a')).toEqual(['b', 'a']);
  });

  it('removes an expanded node and keeps the order of the rest', () => {
    expect(toggleExpansion(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('does not change its input', () => {
    const input = ['a'];
    toggleExpansion(input, 'b');
    expect(input).toEqual(['a']);
  });

  it('allows exactly the maximum and ignores the next expansion', () => {
    expect(EXPLORER_LIMITS.maxExpansions).toBe(50);
    const atLimit = ids(49);
    const full = toggleExpansion(atLimit, 'id-49');
    expect(full).toHaveLength(50);
    expect(toggleExpansion(full, 'one-too-many')).toEqual(full);
  });

  it('still lets the user collapse at the limit, which frees a slot', () => {
    const full = ids(50);
    const collapsed = toggleExpansion(full, 'id-10');
    expect(collapsed).toHaveLength(49);
    expect(toggleExpansion(collapsed, 'fresh')).toHaveLength(50);
  });
});

describe('expansionLimitReached', () => {
  it('is true only from 50 expansions', () => {
    expect(expansionLimitReached(ids(49))).toBe(false);
    expect(expansionLimitReached(ids(50))).toBe(true);
  });
});
