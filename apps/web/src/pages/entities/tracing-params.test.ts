import { describe, expect, it } from 'vitest';
import { parseTracingParams, toDependenciesQueryString, writeTracingParams } from './tracing-params';

describe('tracing-params', () => {
  it('parses defaults from an empty query', () => {
    expect(parseTracingParams(new URLSearchParams())).toEqual({
      dep: 'upstream',
      depth: 6,
      rel: [],
      types: [],
    });
  });

  it('round-trips a full state through the URL', () => {
    const params = parseTracingParams(
      new URLSearchParams('dep=downstream&depth=3&rel=REQUIRES,BLOCKS&types=Order,Payment'),
    );
    expect(params).toEqual({
      dep: 'downstream',
      depth: 3,
      rel: ['REQUIRES', 'BLOCKS'],
      types: ['Order', 'Payment'],
    });

    const written = writeTracingParams(new URLSearchParams(), params);
    expect(written.get('dep')).toBe('downstream');
    expect(written.get('depth')).toBe('3');
    expect(written.get('rel')).toBe('REQUIRES,BLOCKS');
    expect(written.get('types')).toBe('Order,Payment');
    expect(parseTracingParams(written)).toEqual(params);
  });

  it('omits defaults when writing', () => {
    const written = writeTracingParams(new URLSearchParams('dep=downstream&depth=3&rel=REQUIRES'), {
      dep: 'upstream',
      depth: 6,
      rel: [],
      types: [],
    });
    expect(written.toString()).toBe('');
  });

  it('falls back for invalid values', () => {
    const params = parseTracingParams(
      new URLSearchParams('dep=sideways&depth=99&rel=REQUIRES,BOGUS&types=Order,Truck'),
    );
    expect(params.dep).toBe('upstream');
    expect(params.depth).toBe(6);
    expect(params.rel).toEqual(['REQUIRES']);
    expect(params.types).toEqual(['Order']);
  });

  it('keeps unrelated params when writing', () => {
    const written = writeTracingParams(new URLSearchParams('q=hello&dep=downstream'), {
      depth: 3,
    });
    expect(written.get('q')).toBe('hello');
    expect(written.get('dep')).toBe('downstream');
    expect(written.get('depth')).toBe('3');
  });

  it('builds the default dependencies query string without type params', () => {
    expect(
      toDependenciesQueryString({ dep: 'upstream', depth: 6, rel: [], types: [] }),
    ).toBe('?direction=upstream&depth=6&limit=50');
  });

  it('includes type filters and the cursor when present', () => {
    const qs = toDependenciesQueryString(
      { dep: 'downstream', depth: 3, rel: ['REQUIRES'], types: ['Order'] },
      'CURSOR',
      50,
    );
    const parsed = new URLSearchParams(qs.slice(1));
    expect(parsed.get('direction')).toBe('downstream');
    expect(parsed.get('depth')).toBe('3');
    expect(parsed.get('relationshipTypes')).toBe('REQUIRES');
    expect(parsed.get('entityTypes')).toBe('Order');
    expect(parsed.get('cursor')).toBe('CURSOR');
    expect(parsed.get('limit')).toBe('50');
  });
});
