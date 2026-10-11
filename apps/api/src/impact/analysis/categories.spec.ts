import { affected, ref } from '../../../test/impact-builders';
import { buildCategories, notCountedSummary } from './categories';
import type { Affected } from './types';

const flags = (overrides: Partial<Affected['flags']> = {}): Affected['flags'] => ({
  stateUnknown: false,
  otherCause: false,
  inferredOnly: false,
  ...overrides,
});

describe('buildCategories', () => {
  it('always lists the 6 headline categories, in order, even when empty', () => {
    const categories = buildCategories([]);
    expect(categories.map((category) => category.type)).toEqual([
      'Product',
      'PurchaseOrder',
      'Order',
      'Customer',
      'Shipment',
      'SLA',
    ]);
    expect(categories.every((category) => category.headline && category.total === 0)).toBe(true);
    expect(categories.map((category) => category.label)).toEqual([
      'Products',
      'Purchase orders',
      'Customer orders',
      'Customers',
      'Shipments',
      'SLA commitments',
    ]);
  });

  it('adds other types only when non-zero, sorted by type name', () => {
    const categories = buildCategories([
      affected(ref('Payment', 'P')),
      affected(ref('Approval', 'A')),
      affected(ref('Invoice', 'I'), { classification: 'NOT_COUNTED', notCountedReason: 'TERMINAL' }),
    ]);
    expect(categories.map((category) => category.type)).toEqual([
      'Product',
      'PurchaseOrder',
      'Order',
      'Customer',
      'Shipment',
      'SLA',
      'Approval',
      'Payment',
    ]);
    expect(categories.filter((category) => !category.headline).every((c) => !c.headline)).toBe(true);
  });

  it('counts direct, indirect, current, potential, inferredOnly and stateUnknown', () => {
    const categories = buildCategories([
      affected(ref('Order', 'A'), { classification: 'CURRENT', distance: 1 }),
      affected(ref('Order', 'B'), {
        classification: 'POTENTIAL',
        distance: 2,
        flags: flags({ inferredOnly: true }),
      }),
      affected(ref('Order', 'C'), {
        classification: 'POTENTIAL',
        distance: 3,
        flags: flags({ stateUnknown: true }),
      }),
    ]);
    const order = categories.find((category) => category.type === 'Order');
    expect(order).toMatchObject({
      total: 3,
      direct: 1,
      indirect: 2,
      current: 1,
      potential: 2,
      inferredOnly: 1,
      stateUnknown: 1,
    });
  });

  it('covers counted entities only for inferredOnly and stateUnknown', () => {
    const categories = buildCategories([
      affected(ref('Order', 'Done'), {
        classification: 'NOT_COUNTED',
        notCountedReason: 'TERMINAL',
        flags: flags({ inferredOnly: true, stateUnknown: true }),
      }),
    ]);
    expect(categories.find((category) => category.type === 'Order')).toMatchObject({
      total: 0,
      inferredOnly: 0,
      stateUnknown: 0,
    });
  });

  it('counts an attributed-only customer as indirect', () => {
    const categories = buildCategories([
      affected(ref('Customer', 'Acme'), { distance: null, classification: 'CURRENT' }),
    ]);
    expect(categories.find((category) => category.type === 'Customer')).toMatchObject({
      total: 1,
      direct: 0,
      indirect: 1,
      current: 1,
    });
  });
});

describe('notCountedSummary', () => {
  it('totals the not-counted entities and sorts the types by name', () => {
    const terminal = { classification: 'NOT_COUNTED', notCountedReason: 'TERMINAL' } as const;
    const summary = notCountedSummary([
      affected(ref('Shipment', 'S1'), terminal),
      affected(ref('Order', 'O1'), terminal),
      affected(ref('Shipment', 'S2'), terminal),
      affected(ref('Order', 'Counted')),
    ]);
    expect(summary).toEqual({
      total: 3,
      byType: [
        { type: 'Order', count: 1 },
        { type: 'Shipment', count: 2 },
      ],
    });
  });

  it('is empty when nothing is left out', () => {
    expect(notCountedSummary([affected(ref('Order', 'A'))])).toEqual({ total: 0, byType: [] });
  });
});
