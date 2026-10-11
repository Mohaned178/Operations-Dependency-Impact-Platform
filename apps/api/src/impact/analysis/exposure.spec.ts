import { affected, attribution, ref } from '../../../test/impact-builders';
import { computeExposure, orderValueFlags } from './exposure';
import { parseAmount } from './money';
import type { Affected, OrderValue } from './types';

const AT = '2026-09-29T10:05:00.000Z';

function value(
  amount: string,
  currency: string,
  sources: Array<[system: string, amount: string, currency?: string]> = [],
): OrderValue {
  return {
    current: { amount, currency },
    bySource: sources.map(([sourceSystem, sourceAmount, sourceCurrency]) => ({
      sourceSystem,
      sourceId: `${sourceSystem}-1`,
      observedAt: AT,
      amount: sourceAmount,
      currency: sourceCurrency ?? currency,
    })),
  };
}

function order(
  name: string,
  overrides: Partial<Affected> = {},
): Affected {
  return affected(ref('Order', name), overrides);
}

const START = ref('Supplier', 'Start', 'SUSPENDED');

describe('computeExposure', () => {
  it('counts each order once, splits current from potential and sums exactly', () => {
    const a = order('A', { classification: 'CURRENT' });
    const b = order('B', { classification: 'POTENTIAL' });
    const result = computeExposure(
      [a, b],
      new Map([
        [a.entity.id, value('12480.00', 'USD')],
        [b.entity.id, value('0.0001', 'USD')],
      ]),
      START.id,
    );
    const [usd] = result.byCurrency;
    expect(result.byCurrency).toHaveLength(1);
    expect(usd?.currency).toBe('USD');
    expect(usd?.total).toEqual({ amount: parseAmount('12480.0001'), orderCount: 2 });
    expect(usd?.current).toEqual({ amount: parseAmount('12480.00'), orderCount: 1 });
    expect(usd?.potential).toEqual({ amount: 1n, orderCount: 1 });
    expect(usd?.range).toBeNull();
    expect(usd?.disagreementOrderCount).toBe(0);
  });

  it('excludes the start and reports its own value', () => {
    const start = ref('Order', 'Start order', 'BLOCKED');
    const other = order('Other', { classification: 'CURRENT' });
    const result = computeExposure(
      [affected(start, { classification: 'CURRENT' }), other],
      new Map([
        [start.id, value('12480.00', 'USD')],
        [other.entity.id, value('100.00', 'USD')],
      ]),
      start.id,
    );
    expect(result.byCurrency[0]?.total.orderCount).toBe(1);
    expect(result.byCurrency[0]?.total.amount).toBe(parseAmount('100.00'));
    expect(result.startOwnValue).toEqual({ amount: parseAmount('12480.00'), currency: 'USD' });
  });

  it.each(['Payment', 'Invoice'] as const)('reports the own value of a %s start', (type) => {
    const start = ref(type, `${type} start`, 'PENDING');
    const result = computeExposure([], new Map([[start.id, value('12480.00', 'USD')]]), start.id);
    expect(result.startOwnValue).toEqual({ amount: parseAmount('12480.00'), currency: 'USD' });
    expect(result.byCurrency).toEqual([]);
  });

  it('reports no own value when the start has none', () => {
    expect(computeExposure([], new Map(), START.id).startOwnValue).toBeNull();
  });

  it('leaves NOT_COUNTED orders out entirely', () => {
    const done = order('Done', { classification: 'NOT_COUNTED', notCountedReason: 'TERMINAL' });
    const result = computeExposure(
      [done],
      new Map([[done.entity.id, value('500.00', 'USD')]]),
      START.id,
    );
    expect(result.byCurrency).toEqual([]);
    expect(result.valueUnknownCount).toBe(0);
    expect(result.orders.size).toBe(0);
  });

  it('counts orders without a usable value as value-unknown', () => {
    const noCurrent = order('No current');
    const missing = order('Missing');
    const result = computeExposure(
      [noCurrent, missing],
      new Map([[noCurrent.entity.id, { current: null, bySource: [] }]]),
      START.id,
    );
    expect(result.valueUnknownCount).toBe(2);
    expect([...result.valueUnknownIds].sort()).toEqual(
      [noCurrent.entity.id, missing.entity.id].sort(),
    );
    expect(result.byCurrency).toEqual([]);
  });

  it('keeps currencies separate and sorted by code', () => {
    const usd = order('USD', { classification: 'CURRENT' });
    const eur = order('EUR', { classification: 'POTENTIAL' });
    const result = computeExposure(
      [usd, eur],
      new Map([
        [usd.entity.id, value('100.00', 'USD')],
        [eur.entity.id, value('80.00', 'EUR')],
      ]),
      START.id,
    );
    expect(result.byCurrency.map((figure) => figure.currency)).toEqual(['EUR', 'USD']);
    expect(result.byCurrency[0]?.total.amount).toBe(parseAmount('80.00'));
    expect(result.byCurrency[1]?.total.amount).toBe(parseAmount('100.00'));
  });

  it('tracks the inferredOnly shares', () => {
    const sourcedCurrent = order('Sourced', { classification: 'CURRENT' });
    const inferredCurrent = order('Inferred current', {
      classification: 'CURRENT',
      flags: { stateUnknown: false, otherCause: false, inferredOnly: true },
    });
    const inferredPotential = order('Inferred potential', {
      classification: 'POTENTIAL',
      flags: { stateUnknown: false, otherCause: false, inferredOnly: true },
    });
    const result = computeExposure(
      [sourcedCurrent, inferredCurrent, inferredPotential],
      new Map([
        [sourcedCurrent.entity.id, value('10.00', 'USD')],
        [inferredCurrent.entity.id, value('20.00', 'USD')],
        [inferredPotential.entity.id, value('30.00', 'USD')],
      ]),
      START.id,
    );
    const figure = result.byCurrency[0];
    expect(figure?.inferredOnly.total).toEqual({ amount: parseAmount('50.00'), orderCount: 2 });
    expect(figure?.inferredOnly.current).toEqual({ amount: parseAmount('20.00'), orderCount: 1 });
    expect(figure?.inferredOnly.potential).toEqual({ amount: parseAmount('30.00'), orderCount: 1 });
  });

  it('reports a range when sources disagree (OMS 100.00 against ERP 120.00)', () => {
    const disputed = order('Disputed', { classification: 'CURRENT' });
    const plain = order('Plain', { classification: 'CURRENT' });
    const result = computeExposure(
      [disputed, plain],
      new Map([
        [disputed.entity.id, value('100.00', 'USD', [['OMS', '100.00'], ['ERP', '120.00']])],
        [plain.entity.id, value('50.00', 'USD', [['OMS', '50.00']])],
      ]),
      START.id,
    );
    const figure = result.byCurrency[0];
    expect(figure?.disagreementOrderCount).toBe(1);
    expect(figure?.range).toEqual({ low: parseAmount('150.00'), high: parseAmount('170.00') });
    expect(figure?.total.amount).toBe(parseAmount('150.00'));
  });

  it('sets currencyMismatch for a source in another currency and keeps it out of the range', () => {
    const mixed = order('Mixed', { classification: 'POTENTIAL' });
    const mixedValue = value('100.00', 'USD', [['OMS', '100.00'], ['ERP', '90.00', 'EUR']]);
    const result = computeExposure([mixed], new Map([[mixed.entity.id, mixedValue]]), START.id);
    expect(orderValueFlags(mixedValue)).toEqual({ disagreement: true, currencyMismatch: true });
    expect(result.orders.get(mixed.entity.id)?.currencyMismatch).toBe(true);
    const figure = result.byCurrency[0];
    // The conflict stays visible, but a currency-only disagreement gives no range (low = high).
    expect(figure?.disagreementOrderCount).toBe(1);
    expect(figure?.range).toBeNull();
    expect(result.byCurrency).toHaveLength(1);
  });

  it('keeps the range when a currency-only disagreement sits beside an amount disagreement', () => {
    const mixed = order('Mixed', { classification: 'POTENTIAL' });
    const disputed = order('Disputed', { classification: 'CURRENT' });
    const result = computeExposure(
      [mixed, disputed],
      new Map([
        [mixed.entity.id, value('100.00', 'USD', [['OMS', '100.00'], ['ERP', '90.00', 'EUR']])],
        [disputed.entity.id, value('50.00', 'USD', [['OMS', '50.00'], ['ERP', '60.00']])],
      ]),
      START.id,
    );
    const figure = result.byCurrency[0];
    expect(figure?.disagreementOrderCount).toBe(2);
    expect(figure?.range).toEqual({ low: parseAmount('150.00'), high: parseAmount('160.00') });
  });

  it('does not call equal values from several sources a disagreement', () => {
    expect(orderValueFlags(value('10.00', 'USD', [['OMS', '10.00'], ['ERP', '10.0']]))).toEqual({
      disagreement: false,
      currencyMismatch: false,
    });
  });

  it('sums each customer’s attributed orders per currency', () => {
    const first = order('First', { classification: 'CURRENT' });
    const second = order('Second', { classification: 'POTENTIAL' });
    const eur = order('Euro', { classification: 'POTENTIAL' });
    const done = order('Done', { classification: 'NOT_COUNTED', notCountedReason: 'TERMINAL' });
    const customer = ref('Customer', 'Acme');
    const other = ref('Customer', 'Globex');
    const result = computeExposure(
      [
        first,
        second,
        eur,
        done,
        affected(customer, {
          distance: null,
          attributions: [
            attribution(first.entity.id, customer),
            attribution(second.entity.id, customer),
            attribution(eur.entity.id, customer),
            attribution(done.entity.id, customer),
          ],
        }),
        affected(other, { distance: null, attributions: [attribution(second.entity.id, other)] }),
      ],
      new Map([
        [first.entity.id, value('10.00', 'USD')],
        [second.entity.id, value('5.50', 'USD')],
        [eur.entity.id, value('7.00', 'EUR')],
        [done.entity.id, value('99.00', 'USD')],
      ]),
      START.id,
    );
    expect(result.customerExposure.get(customer.id)).toEqual(
      new Map([
        ['USD', parseAmount('15.50')],
        ['EUR', parseAmount('7.00')],
      ]),
    );
    expect(result.customerExposure.get(other.id)).toEqual(new Map([['USD', parseAmount('5.50')]]));
  });
});
