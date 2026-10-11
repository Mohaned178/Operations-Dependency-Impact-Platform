import { compareCodeUnits } from '../../graph/traversal/path-order';
import { compareUnits, parseAmount } from './money';
import type {
  Affected,
  ExposureFigure,
  ExposureOrder,
  ExposureResult,
  ExposureShare,
  OrderValue,
} from './types';

/**
 * Research R6: an order disagrees when its current value and its per-source values hold at least
 * 2 distinct (amount, currency) pairs. `currencyMismatch`: a source states another currency.
 */
export function orderValueFlags(value: OrderValue): {
  disagreement: boolean;
  currencyMismatch: boolean;
} {
  const pairs = new Set<string>();
  if (value.current !== null) {
    pairs.add(`${parseAmount(value.current.amount)}|${value.current.currency}`);
  }
  for (const source of value.bySource) {
    pairs.add(`${parseAmount(source.amount)}|${source.currency}`);
  }
  const current = value.current;
  return {
    disagreement: pairs.size >= 2,
    currencyMismatch:
      current !== null && value.bySource.some((source) => source.currency !== current.currency),
  };
}

interface Accumulator {
  total: ExposureShare;
  current: ExposureShare;
  potential: ExposureShare;
  inferredOnly: { total: ExposureShare; current: ExposureShare; potential: ExposureShare };
  disagreementOrderCount: number;
  low: bigint;
  high: bigint;
}

function emptyShare(): ExposureShare {
  return { amount: 0n, orderCount: 0 };
}

function addTo(share: ExposureShare, amount: bigint): void {
  share.amount += amount;
  share.orderCount += 1;
}

function newAccumulator(): Accumulator {
  return {
    total: emptyShare(),
    current: emptyShare(),
    potential: emptyShare(),
    inferredOnly: { total: emptyShare(), current: emptyShare(), potential: emptyShare() },
    disagreementOrderCount: 0,
    low: 0n,
    high: 0n,
  };
}

/**
 * Spec FR-013, research R6. Each counted order (never the start) is counted once, in the currency
 * of its current value. Orders without a usable current value are only counted as value-unknown.
 */
export function computeExposure(
  affected: readonly Affected[],
  values: ReadonlyMap<string, OrderValue>,
  startId: string,
): ExposureResult {
  const orders = new Map<string, ExposureOrder>();
  const valueUnknownIds = new Set<string>();
  const accumulators = new Map<string, Accumulator>();

  for (const item of affected) {
    if (
      item.entity.type !== 'Order' ||
      item.classification === 'NOT_COUNTED' ||
      item.entity.id === startId
    ) {
      continue;
    }
    const value = values.get(item.entity.id);
    if (value === undefined || value.current === null) {
      valueUnknownIds.add(item.entity.id);
      continue;
    }

    const amount = parseAmount(value.current.amount);
    const { currency } = value.current;
    const flags = orderValueFlags(value);
    orders.set(item.entity.id, { amount, currency, ...flags });

    let accumulator = accumulators.get(currency);
    if (accumulator === undefined) {
      accumulator = newAccumulator();
      accumulators.set(currency, accumulator);
    }
    const side = item.classification === 'CURRENT' ? 'current' : 'potential';
    addTo(accumulator.total, amount);
    addTo(accumulator[side], amount);
    if (item.flags.inferredOnly) {
      addTo(accumulator.inferredOnly.total, amount);
      addTo(accumulator.inferredOnly[side], amount);
    }
    if (flags.disagreement) {
      accumulator.disagreementOrderCount += 1;
    }

    // Only values in this order's own currency enter the range (research R6).
    const sameCurrency = [
      amount,
      ...value.bySource
        .filter((source) => source.currency === currency)
        .map((source) => parseAmount(source.amount)),
    ];
    accumulator.low += sameCurrency.reduce((low, units) => (compareUnits(units, low) < 0 ? units : low));
    accumulator.high += sameCurrency.reduce((high, units) => (compareUnits(units, high) > 0 ? units : high));
  }

  const byCurrency = [...accumulators.entries()]
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(
      ([currency, accumulator]): ExposureFigure => ({
        currency,
        total: accumulator.total,
        current: accumulator.current,
        potential: accumulator.potential,
        inferredOnly: accumulator.inferredOnly,
        disagreementOrderCount: accumulator.disagreementOrderCount,
        // No range when the disagreements are only about the currency (low equals high).
        range:
          accumulator.disagreementOrderCount > 0 && accumulator.low !== accumulator.high
            ? { low: accumulator.low, high: accumulator.high }
            : null,
      }),
    );

  const customerExposure = new Map<string, Map<string, bigint>>();
  for (const item of affected) {
    if (item.entity.type !== 'Customer' || item.classification === 'NOT_COUNTED') {
      continue;
    }
    for (const attribution of item.attributions) {
      const order = orders.get(attribution.attributedEntityId);
      if (order === undefined) {
        continue;
      }
      let perCurrency = customerExposure.get(item.entity.id);
      if (perCurrency === undefined) {
        perCurrency = new Map<string, bigint>();
        customerExposure.set(item.entity.id, perCurrency);
      }
      perCurrency.set(order.currency, (perCurrency.get(order.currency) ?? 0n) + order.amount);
    }
  }

  const own = values.get(startId)?.current ?? null;
  return {
    byCurrency,
    valueUnknownCount: valueUnknownIds.size,
    valueUnknownIds,
    startOwnValue: own === null ? null : { amount: parseAmount(own.amount), currency: own.currency },
    orders,
    customerExposure,
  };
}
