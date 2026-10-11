import type { ImpactListSelector } from '@opsgraph/shared';
import { affected, attribution, ref } from '../../../test/impact-builders';
import { AppError } from '../../common/errors/app-error';
import { encodeCursor } from '../../common/pagination/cursor';
import { computeExposure } from './exposure';
import { compareForList, keyForList, paginate, selectList } from './lists';
import type { Affected, OrderValue } from './types';

const START = ref('Supplier', 'Start', 'SUSPENDED');

function money(amount: string, currency = 'USD'): OrderValue {
  return { current: { amount, currency }, bySource: [] };
}

const inferred = { stateUnknown: false, otherCause: false, inferredOnly: true };
const unknown = { stateUnknown: true, otherCause: false, inferredOnly: false };

// Orders
const o1 = affected(ref('Order', 'SO-1'), { classification: 'CURRENT', distance: 2 });
const o2 = affected(ref('Order', 'SO-2'), { classification: 'POTENTIAL', distance: 2, flags: inferred });
const o3 = affected(ref('Order', 'SO-3'), { classification: 'CURRENT', distance: 1 });
const o4 = affected(ref('Order', 'SO-4'), { classification: 'POTENTIAL', distance: 3, flags: unknown });
const o5 = affected(ref('Order', 'SO-5'), { classification: 'POTENTIAL', distance: 2 });
const done = affected(ref('Order', 'SO-6'), {
  classification: 'NOT_COUNTED',
  notCountedReason: 'TERMINAL',
  distance: 2,
});
const doneShipment = affected(ref('Shipment', 'SHP-1', 'COMPLETED'), {
  classification: 'NOT_COUNTED',
  notCountedReason: 'TERMINAL',
  distance: 1,
});
const shipment = affected(ref('Shipment', 'SHP-2'), { classification: 'CURRENT', distance: 1 });

// Customers (attributed only)
const acme = ref('Customer', 'Acme');
const globex = ref('Customer', 'Globex');
const initech = ref('Customer', 'Initech');
const customers = [
  affected(acme, {
    distance: null,
    classification: 'CURRENT',
    attributions: [attribution(o1.entity.id, acme)],
  }),
  affected(globex, {
    distance: null,
    classification: 'POTENTIAL',
    attributions: [attribution(o3.entity.id, globex), attribution(o2.entity.id, globex)],
  }),
  affected(initech, { distance: null, classification: 'POTENTIAL', attributions: [] }),
];

const ALL: Affected[] = [o1, o2, o3, o4, o5, done, doneShipment, shipment, ...customers];
const VALUES = new Map<string, OrderValue>([
  [o1.entity.id, money('100.00')],
  [o2.entity.id, money('250.00')],
  [o3.entity.id, money('100.00')],
  [o4.entity.id, money('40.00', 'EUR')],
  // o5 has no value at all: value-unknown
]);
const EXPOSURE = computeExposure(ALL, VALUES, START.id);

function names(items: readonly Affected[]): string[] {
  return items.map((item) => item.entity.displayName);
}

function select(selector: ImpactListSelector): string[] {
  return names(selectList(ALL, EXPOSURE, selector)).sort();
}

describe('selectList', () => {
  it.each([
    ['total', ['SO-1', 'SO-2', 'SO-3', 'SO-4', 'SO-5']],
    ['direct', ['SO-3']],
    ['indirect', ['SO-1', 'SO-2', 'SO-4', 'SO-5']],
    ['current', ['SO-1', 'SO-3']],
    ['potential', ['SO-2', 'SO-4', 'SO-5']],
    ['inferredOnly', ['SO-2']],
    ['stateUnknown', ['SO-4']],
  ] as const)('category Order / %s', (bucket, expected) => {
    expect(select({ list: 'category', type: 'Order', bucket })).toEqual(expected);
  });

  it('never lists a not-counted entity under a category', () => {
    expect(select({ list: 'category', type: 'Shipment', bucket: 'total' })).toEqual(['SHP-2']);
  });

  it('lists customers by bucket', () => {
    expect(select({ list: 'category', type: 'Customer', bucket: 'current' })).toEqual(['Acme']);
    expect(select({ list: 'category', type: 'Customer', bucket: 'indirect' })).toEqual([
      'Acme',
      'Globex',
      'Initech',
    ]);
  });

  it.each([
    ['total', ['SO-1', 'SO-2', 'SO-3']],
    ['current', ['SO-1', 'SO-3']],
    ['potential', ['SO-2']],
    ['inferredOnly', ['SO-2']],
  ] as const)('exposure USD / %s', (bucket, expected) => {
    expect(select({ list: 'exposure', currency: 'USD', bucket })).toEqual(expected);
  });

  it('keeps currencies apart and gives an empty list for a currency with no figure', () => {
    expect(select({ list: 'exposure', currency: 'EUR', bucket: 'total' })).toEqual(['SO-4']);
    expect(select({ list: 'exposure', currency: 'GBP', bucket: 'total' })).toEqual([]);
  });

  it('lists the value-unknown orders', () => {
    expect(select({ list: 'valueUnknown' })).toEqual(['SO-5']);
  });

  it('lists the not-counted entities, optionally of one type', () => {
    expect(select({ list: 'notCounted', type: null })).toEqual(['SHP-1', 'SO-6']);
    expect(select({ list: 'notCounted', type: 'Order' })).toEqual(['SO-6']);
    expect(select({ list: 'notCounted', type: 'Product' })).toEqual([]);
  });

  it('has a length that equals the summary number for the same selector', () => {
    const figure = EXPOSURE.byCurrency.find((entry) => entry.currency === 'USD');
    expect(select({ list: 'exposure', currency: 'USD', bucket: 'total' })).toHaveLength(
      figure?.total.orderCount ?? -1,
    );
    expect(select({ list: 'valueUnknown' })).toHaveLength(EXPOSURE.valueUnknownCount);
  });
});

describe('compareForList', () => {
  function sorted(selector: ImpactListSelector): string[] {
    return names([...selectList(ALL, EXPOSURE, selector)].sort(compareForList(selector, EXPOSURE)));
  }

  it('sorts orders by value descending, then currency, name and id; value-unknown last', () => {
    const selector: ImpactListSelector = { list: 'category', type: 'Order', bucket: 'total' };
    // 250.00 USD, then 100.00 USD twice (by name), then 40.00 EUR, then the order without a value.
    expect(sorted(selector)).toEqual(['SO-2', 'SO-1', 'SO-3', 'SO-4', 'SO-5']);
  });

  it('compares amounts as numbers, not as text', () => {
    const big = affected(ref('Order', 'Big'), { classification: 'CURRENT' });
    const small = affected(ref('Order', 'Small'), { classification: 'CURRENT' });
    const exposure = computeExposure(
      [small, big],
      new Map([
        [small.entity.id, money('9.00')],
        [big.entity.id, money('10000.00')],
      ]),
      START.id,
    );
    const selector: ImpactListSelector = { list: 'category', type: 'Order', bucket: 'total' };
    expect(names([small, big].sort(compareForList(selector, exposure)))).toEqual(['Big', 'Small']);
  });

  it('sorts customers by their highest single-currency exposure', () => {
    // Globex has 350.00 USD, Acme 100.00 USD, Initech nothing.
    expect(sorted({ list: 'category', type: 'Customer', bucket: 'total' })).toEqual([
      'Globex',
      'Acme',
      'Initech',
    ]);
  });

  it('sorts other entities CURRENT, POTENTIAL, NOT_COUNTED, then distance with null last, name, id', () => {
    const a = affected(ref('Shipment', 'B'), { classification: 'CURRENT', distance: 2 });
    const b = affected(ref('Shipment', 'A'), { classification: 'CURRENT', distance: 2 });
    const c = affected(ref('Shipment', 'C'), { classification: 'CURRENT', distance: 1 });
    const d = affected(ref('Shipment', 'D'), { classification: 'POTENTIAL', distance: 1 });
    const e = affected(ref('Shipment', 'E'), {
      classification: 'NOT_COUNTED',
      notCountedReason: 'TERMINAL',
      distance: 1,
    });
    const f = affected(ref('Shipment', 'F'), { classification: 'POTENTIAL', distance: null });
    const selector: ImpactListSelector = { list: 'category', type: 'Shipment', bucket: 'total' };
    expect(
      names([e, f, a, d, b, c].sort(compareForList(selector, EXPOSURE))),
    ).toEqual(['C', 'A', 'B', 'D', 'F', 'E']);
  });

  it('uses the others order for a not-counted list, whatever the types', () => {
    expect(sorted({ list: 'notCounted', type: null })).toEqual(['SHP-1', 'SO-6']);
  });

  it('breaks full ties by id', () => {
    const first = affected(ref('Product', 'Same', 'ACTIVE', '00000000-0000-4000-8000-00000000000a'), {});
    const second = affected(ref('Product', 'Same', 'ACTIVE', '00000000-0000-4000-8000-00000000000b'), {});
    const selector: ImpactListSelector = { list: 'category', type: 'Product', bucket: 'total' };
    expect([second, first].sort(compareForList(selector, EXPOSURE))).toEqual([first, second]);
  });
});

describe('paginate', () => {
  const selector: ImpactListSelector = { list: 'category', type: 'Order', bucket: 'total' };
  const items = selectList(ALL, EXPOSURE, selector).sort(compareForList(selector, EXPOSURE));
  const keyOf = keyForList(selector, EXPOSURE);

  it('is stable across pages: no gaps and no duplicates', () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = paginate(items, cursor, 2, keyOf);
      seen.push(...names(page.items));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);
    expect(pages).toBe(3);
    expect(seen).toEqual(names(items));
  });

  it('returns no cursor when everything fits on one page', () => {
    const page = paginate(items, undefined, 50, keyOf);
    expect(page.items).toHaveLength(items.length);
    expect(page.nextCursor).toBeNull();
  });

  it('returns an empty page for a cursor after the last item', () => {
    const last = items.at(-1);
    if (last === undefined) throw new Error('fixture has no items');
    const cursor = encodeCursor({ k: keyOf(last) });
    expect(paginate(items, cursor, 5, keyOf)).toEqual({ items: [], nextCursor: null });
  });

  it('keeps working when the item behind the cursor has disappeared', () => {
    const first = paginate(items, undefined, 2, keyOf);
    const removed = items.filter((item) => item !== first.items.at(-1));
    const next = paginate(removed, first.nextCursor ?? undefined, 2, keyOf);
    expect(names(next.items)).toEqual(names(items.slice(2, 4)));
  });

  it('rejects a malformed cursor on the cursor field', () => {
    expect.assertions(3);
    try {
      paginate(items, 'garbage', 2, keyOf);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION_FAILED');
      expect((error as AppError).details).toEqual([{ path: 'cursor', message: 'Invalid cursor' }]);
    }
  });
});
