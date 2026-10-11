import { ImpactListQuerySchema, type ImpactListSelector } from '@opsgraph/shared';
import { describe, expect, it } from 'vitest';
import { parseImpactParams, toImpactListQueryString, writeImpactParams } from './impact-params';

const SELECTORS: Array<[string, ImpactListSelector]> = [
  ['category.Order.current', { list: 'category', type: 'Order', bucket: 'current' }],
  ['category.PurchaseOrder.inferredOnly', { list: 'category', type: 'PurchaseOrder', bucket: 'inferredOnly' }],
  ['exposure.USD.total', { list: 'exposure', currency: 'USD', bucket: 'total' }],
  ['exposure.EUR.inferredOnly', { list: 'exposure', currency: 'EUR', bucket: 'inferredOnly' }],
  ['valueUnknown', { list: 'valueUnknown' }],
  ['notCounted', { list: 'notCounted', type: null }],
  ['notCounted.Shipment', { list: 'notCounted', type: 'Shipment' }],
];

describe('parseImpactParams', () => {
  it('defaults to depth 6 and no list', () => {
    expect(parseImpactParams(new URLSearchParams())).toEqual({ depth: 6, list: null });
  });

  it('reads idepth', () => {
    expect(parseImpactParams(new URLSearchParams('idepth=3')).depth).toBe(3);
    expect(parseImpactParams(new URLSearchParams('idepth=10')).depth).toBe(10);
  });

  it.each(['0', '11', 'abc', '2.5', ''])('falls back to 6 for idepth=%s', (value) => {
    expect(parseImpactParams(new URLSearchParams({ idepth: value })).depth).toBe(6);
  });

  it.each(SELECTORS)('reads ilist=%s', (raw, selector) => {
    expect(parseImpactParams(new URLSearchParams({ ilist: raw })).list).toEqual(selector);
  });

  it.each([
    'category',
    'category.Order',
    'category.Widget.total',
    'category.Order.sum',
    'category.Order.current.extra',
    'exposure.usd.total',
    'exposure.USD',
    'exposure.USD.direct',
    'valueUnknown.Order',
    'notCounted.Widget',
    'notCounted.Order.total',
    'nonsense',
    '',
  ])('ignores the invalid ilist=%s', (raw) => {
    expect(parseImpactParams(new URLSearchParams({ ilist: raw })).list).toBeNull();
  });
});

describe('writeImpactParams', () => {
  it.each(SELECTORS)('round-trips %s', (raw, selector) => {
    const written = writeImpactParams(new URLSearchParams(), { list: selector });
    expect(written.get('ilist')).toBe(raw);
    expect(parseImpactParams(written).list).toEqual(selector);
  });

  it('omits the defaults', () => {
    const opened = writeImpactParams(new URLSearchParams(), {
      depth: 3,
      list: { list: 'valueUnknown' },
    });
    expect(opened.toString()).toBe('idepth=3&ilist=valueUnknown');
    const reset = writeImpactParams(opened, { depth: 6, list: null });
    expect(reset.toString()).toBe('');
  });

  it('changes only what it is given', () => {
    const current = new URLSearchParams('idepth=4&ilist=valueUnknown');
    expect(writeImpactParams(current, { depth: 5 }).toString()).toBe('idepth=5&ilist=valueUnknown');
    expect(writeImpactParams(current, { list: null }).toString()).toBe('idepth=4');
  });

  it('keeps the Dependencies params', () => {
    const current = new URLSearchParams('dep=downstream&depth=3&rel=REQUIRES,BLOCKS&types=Order');
    const written = writeImpactParams(current, { depth: 2, list: { list: 'notCounted', type: null } });
    expect(written.get('dep')).toBe('downstream');
    expect(written.get('depth')).toBe('3');
    expect(written.get('rel')).toBe('REQUIRES,BLOCKS');
    expect(written.get('types')).toBe('Order');
    expect(written.get('idepth')).toBe('2');
    expect(written.get('ilist')).toBe('notCounted');
    expect(writeImpactParams(written, { list: null }).get('dep')).toBe('downstream');
  });

  it('does not change the input', () => {
    const current = new URLSearchParams('idepth=4');
    writeImpactParams(current, { depth: 6 });
    expect(current.toString()).toBe('idepth=4');
  });
});

describe('toImpactListQueryString', () => {
  it.each(SELECTORS)('builds a query the API accepts for %s', (_raw, selector) => {
    const qs = toImpactListQueryString(4, selector);
    const parsed = ImpactListQuerySchema.parse(Object.fromEntries(new URLSearchParams(qs)));
    expect(parsed.selector).toEqual(selector);
    expect(parsed.depth).toBe(4);
    expect(parsed.limit).toBe(50);
    expect(parsed.cursor).toBeUndefined();
  });

  it('adds the cursor and the limit', () => {
    const qs = new URLSearchParams(
      toImpactListQueryString(6, { list: 'valueUnknown' }, 'abc', 20),
    );
    expect(qs.get('cursor')).toBe('abc');
    expect(qs.get('limit')).toBe('20');
    expect(qs.get('depth')).toBe('6');
  });

  it('leaves out an empty or null cursor', () => {
    expect(toImpactListQueryString(6, { list: 'valueUnknown' }, null)).not.toContain('cursor');
    expect(toImpactListQueryString(6, { list: 'valueUnknown' }, '')).not.toContain('cursor');
  });
});
