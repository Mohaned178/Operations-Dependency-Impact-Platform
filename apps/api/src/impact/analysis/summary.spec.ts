import {
  IMPACT_HEADLINE_TYPES,
  impactCategoryLabel,
  type EntityType,
  type ImpactCategoryDto,
} from '@opsgraph/shared';
import { parseAmount } from './money';
import { buildSummary, type SummaryInput } from './summary';
import type { ExposureFigure, ExposureResult, ExposureShare } from './types';

type Counts = [
  total: number,
  direct: number,
  indirect: number,
  current: number,
  potential: number,
  inferredOnly: number,
  stateUnknown: number,
];

/** The 6 headline categories first (zero unless given), then the other given types by name. */
function categories(rows: Partial<Record<EntityType, Counts>>): ImpactCategoryDto[] {
  const headline = new Set<EntityType>(IMPACT_HEADLINE_TYPES);
  const make = (type: EntityType): ImpactCategoryDto => {
    const [total, direct, indirect, current, potential, inferredOnly, stateUnknown] =
      rows[type] ?? [0, 0, 0, 0, 0, 0, 0];
    return {
      type,
      label: impactCategoryLabel(type),
      headline: headline.has(type),
      total,
      direct,
      indirect,
      current,
      potential,
      inferredOnly,
      stateUnknown,
    };
  };
  const others = (Object.keys(rows) as EntityType[]).filter((type) => !headline.has(type)).sort();
  return [...IMPACT_HEADLINE_TYPES.map(make), ...others.map(make)];
}

const share = (amount: string, orderCount: number): ExposureShare => ({
  amount: parseAmount(amount),
  orderCount,
});

function figure(
  currency: string,
  shares: {
    total: [string, number];
    current: [string, number];
    potential: [string, number];
    inferredTotal?: [string, number];
    disagreements?: number;
    range?: [string, string];
  },
): ExposureFigure {
  const inferredTotal = shares.inferredTotal ?? ['0.00', 0];
  return {
    currency,
    total: share(...shares.total),
    current: share(...shares.current),
    potential: share(...shares.potential),
    inferredOnly: {
      total: share(...inferredTotal),
      current: share('0.00', 0),
      potential: share(...inferredTotal),
    },
    disagreementOrderCount: shares.disagreements ?? 0,
    range:
      shares.range === undefined
        ? null
        : { low: parseAmount(shares.range[0]), high: parseAmount(shares.range[1]) },
  };
}

function exposure(
  figures: ExposureFigure[],
  options: { valueUnknownCount?: number; own?: [string, string] } = {},
): ExposureResult {
  return {
    byCurrency: figures,
    valueUnknownCount: options.valueUnknownCount ?? 0,
    valueUnknownIds: new Set(),
    startOwnValue:
      options.own === undefined
        ? null
        : { amount: parseAmount(options.own[0]), currency: options.own[1] },
    orders: new Map(),
    customerExposure: new Map(),
  };
}

function input(overrides: Partial<SummaryInput>): SummaryInput {
  return {
    startName: 'Start',
    startState: 'BLOCKED',
    startClass: 'IMPAIRED',
    depth: 6,
    countedTotal: 0,
    categories: categories({}),
    exposure: exposure([]),
    notCountedTotal: 0,
    limits: { depthLimit: false, explorationLimit: false },
    ...overrides,
  };
}

describe('buildSummary: acceptance fixtures', () => {
  it('I1: Fabrikam Components (SUSPENDED)', () => {
    expect(
      buildSummary(
        input({
          startName: 'Fabrikam Components',
          startState: 'SUSPENDED',
          countedTotal: 31,
          categories: categories({
            Product: [4, 4, 0, 0, 4, 1, 0],
            PurchaseOrder: [5, 5, 0, 3, 2, 0, 0],
            Order: [12, 0, 12, 6, 6, 1, 0],
            Customer: [4, 0, 4, 3, 1, 0, 0],
            Shipment: [3, 0, 3, 2, 1, 0, 0],
            SLA: [3, 0, 3, 2, 1, 1, 0],
          }),
          exposure: exposure([
            figure('USD', {
              total: ['84000.00', 12],
              current: ['51250.00', 6],
              potential: ['32750.00', 6],
              inferredTotal: ['2400.00', 1],
            }),
          ]),
          notCountedTotal: 2,
        }),
      ),
    ).toEqual([
      'Fabrikam Components is SUSPENDED.',
      'Currently affected: 3 purchase orders, 6 customer orders, 3 customers, 2 shipments, 2 SLA commitments. 51,250.00 USD exposed.',
      'Potentially affected if it continues: 4 products, 2 purchase orders, 6 customer orders, 1 customer, 1 shipment, 1 SLA commitment. 32,750.00 USD more exposed.',
      'Total exposure: 84,000.00 USD across 12 customer orders.',
      '3 of the affected entities are reached only through inferred or manual links, including 2,400.00 USD of exposure.',
      'Not counted: 2 completed or cancelled entities.',
    ]);
  });

  const paymentCategories = categories({
    Order: [17, 1, 16, 17, 0, 0, 0],
    Customer: [4, 0, 4, 4, 0, 0, 0],
    Shipment: [1, 1, 0, 1, 0, 0, 0],
    SLA: [4, 0, 4, 3, 1, 4, 0],
    Invoice: [1, 0, 1, 1, 0, 0, 0],
  });

  it('I6: Payment PAY-88213 (PENDING)', () => {
    expect(
      buildSummary(
        input({
          startName: 'Payment PAY-88213',
          startState: 'PENDING',
          countedTotal: 27,
          categories: paymentCategories,
          exposure: exposure(
            [figure('USD', { total: ['31400.00', 17], current: ['31400.00', 17], potential: ['0.00', 0] })],
            { own: ['12480.00', 'USD'] },
          ),
        }),
      ),
    ).toEqual([
      'Payment PAY-88213 is PENDING.',
      'Currently affected: 17 customer orders, 4 customers, 1 shipment, 3 SLA commitments, 1 invoice. 31,400.00 USD exposed.',
      'Potentially affected if it continues: 1 SLA commitment.',
      'Total exposure: 31,400.00 USD across 17 customer orders.',
      '4 of the affected entities are reached only through inferred or manual links.',
      "Payment PAY-88213's own value, 12,480.00 USD, is not included.",
    ]);
  });

  it('I8: Order #18492 (BLOCKED)', () => {
    expect(
      buildSummary(
        input({
          startName: 'Order #18492',
          startState: 'BLOCKED',
          countedTotal: 26,
          categories: categories({
            Order: [16, 0, 16, 16, 0, 0, 0],
            Customer: [4, 0, 4, 4, 0, 0, 0],
            Shipment: [1, 1, 0, 1, 0, 0, 0],
            SLA: [4, 0, 4, 3, 1, 4, 0],
            Invoice: [1, 1, 0, 1, 0, 0, 0],
          }),
          exposure: exposure(
            [figure('USD', { total: ['18920.00', 16], current: ['18920.00', 16], potential: ['0.00', 0] })],
            { own: ['12480.00', 'USD'] },
          ),
        }),
      ),
    ).toEqual([
      'Order #18492 is BLOCKED.',
      'Currently affected: 16 customer orders, 4 customers, 1 shipment, 3 SLA commitments, 1 invoice. 18,920.00 USD exposed.',
      'Potentially affected if it continues: 1 SLA commitment.',
      'Total exposure: 18,920.00 USD across 16 customer orders.',
      '4 of the affected entities are reached only through inferred or manual links.',
      "Order #18492's own value, 12,480.00 USD, is not included.",
    ]);
  });

  it('I9: Warehouse WH-EAST-02 (ACTIVE)', () => {
    expect(
      buildSummary(
        input({
          startName: 'East Distribution Center 02',
          startState: 'ACTIVE',
          startClass: 'UNIMPAIRED',
          countedTotal: 27,
          categories: categories({
            Order: [17, 17, 0, 0, 17, 0, 0],
            Customer: [4, 0, 4, 0, 4, 0, 0],
            Shipment: [1, 1, 0, 0, 1, 0, 0],
            SLA: [4, 0, 4, 0, 4, 4, 0],
            Invoice: [1, 0, 1, 0, 1, 0, 0],
          }),
          exposure: exposure([
            figure('USD', { total: ['31400.00', 17], current: ['0.00', 0], potential: ['31400.00', 17] }),
          ]),
        }),
      ),
    ).toEqual([
      'East Distribution Center 02 is ACTIVE.',
      'If East Distribution Center 02 became unavailable: 17 customer orders, 4 customers, 1 shipment, 4 SLA commitments, 1 invoice. 31,400.00 USD exposed.',
      '4 of the affected entities are reached only through inferred or manual links.',
    ]);
  });

  it('I10: Warehouse WH-WEST-01 (ACTIVE), with not-counted entities', () => {
    expect(
      buildSummary(
        input({
          startName: 'West Distribution Center 01',
          startState: 'ACTIVE',
          startClass: 'UNIMPAIRED',
          countedTotal: 3,
          categories: categories({
            Order: [1, 1, 0, 0, 1, 0, 0],
            Customer: [1, 0, 1, 0, 1, 0, 0],
            Shipment: [1, 1, 0, 0, 1, 0, 0],
          }),
          exposure: exposure([
            figure('USD', { total: ['875.00', 1], current: ['0.00', 0], potential: ['875.00', 1] }),
          ]),
          notCountedTotal: 2,
        }),
      ),
    ).toEqual([
      'West Distribution Center 01 is ACTIVE.',
      'If West Distribution Center 01 became unavailable: 1 customer order, 1 customer, 1 shipment. 875.00 USD exposed.',
      'Not counted: 2 completed or cancelled entities.',
    ]);
  });

  it('I12: line 1 says everything is inferred, and there is no line 5', () => {
    const lines = buildSummary(
      input({
        startName: 'Contoso Metals',
        startState: 'ACTIVE',
        startClass: 'UNIMPAIRED',
        countedTotal: 28,
        categories: categories({
          Product: [1, 1, 0, 0, 1, 1, 0],
          Order: [17, 0, 17, 0, 17, 17, 0],
          Customer: [4, 0, 4, 0, 4, 4, 0],
          Shipment: [1, 0, 1, 0, 1, 1, 0],
          SLA: [4, 0, 4, 0, 4, 4, 0],
          Invoice: [1, 0, 1, 0, 1, 1, 0],
        }),
        exposure: exposure([
          figure('USD', {
            total: ['31400.00', 17],
            current: ['0.00', 0],
            potential: ['31400.00', 17],
            inferredTotal: ['31400.00', 17],
          }),
        ]),
      }),
    );
    expect(lines[0]).toBe(
      'Contoso Metals is ACTIVE, and everything it affects is reached only through inferred or manual links.',
    );
    expect(lines.some((line) => line.includes('of the affected entities'))).toBe(false);
  });

  it('I13: the last line says the figures are lower bounds at depth 3', () => {
    const lines = buildSummary(
      input({
        startName: 'Northwind Steel',
        startState: 'ACTIVE',
        startClass: 'UNIMPAIRED',
        depth: 3,
        countedTotal: 5,
        categories: categories({
          Product: [1, 1, 0, 0, 1, 0, 0],
          Order: [1, 0, 1, 0, 1, 0, 0],
          Customer: [1, 0, 1, 0, 1, 0, 0],
          Shipment: [1, 0, 1, 0, 1, 0, 0],
          Invoice: [1, 0, 1, 0, 1, 0, 0],
        }),
        exposure: exposure([
          figure('USD', { total: ['12480.00', 1], current: ['0.00', 0], potential: ['12480.00', 1] }),
        ]),
        limits: { depthLimit: true, explorationLimit: false },
      }),
    );
    expect(lines.at(-1)).toBe('Impact continues beyond 3 steps; these figures are lower bounds.');
  });

  it('I14: Invoice INV-55120 with nothing depending on it', () => {
    expect(
      buildSummary(
        input({
          startName: 'Invoice INV-55120',
          startState: 'PENDING',
          countedTotal: 0,
          exposure: exposure([], { own: ['12480.00', 'USD'] }),
        }),
      ),
    ).toEqual(['Invoice INV-55120 is PENDING.', 'Nothing is affected within 6 steps.']);
  });
});

describe('buildSummary: wording', () => {
  const oneOrder = categories({ Order: [1, 0, 1, 1, 0, 0, 0] });

  it('uses the singular form for one step', () => {
    expect(buildSummary(input({ depth: 1 }))[1]).toBe('Nothing is affected within 1 step.');
  });

  it('uses the singular and plural forms of nouns and verbs', () => {
    const single = buildSummary(
      input({
        countedTotal: 1,
        categories: oneOrder,
        exposure: exposure(
          [figure('USD', { total: ['5.00', 1], current: ['5.00', 1], potential: ['0.00', 0] })],
          { valueUnknownCount: 1 },
        ),
      }),
    );
    expect(single).toContain('Currently affected: 1 customer order. 5.00 USD exposed.');
    expect(single).toContain('Total exposure: 5.00 USD across 1 customer order.');
    expect(single).toContain('1 customer order without a recorded value is left out of exposure.');

    const plural = buildSummary(
      input({
        countedTotal: 3,
        categories: categories({ Order: [3, 0, 3, 3, 0, 0, 0] }),
        exposure: exposure([], { valueUnknownCount: 3 }),
      }),
    );
    expect(plural).toContain('3 customer orders without a recorded value are left out of exposure.');
  });

  it('joins several currencies with " and ", in currency order', () => {
    const lines = buildSummary(
      input({
        countedTotal: 2,
        categories: categories({ Order: [2, 0, 2, 2, 0, 0, 0] }),
        exposure: exposure([
          figure('EUR', { total: ['80.00', 1], current: ['80.00', 1], potential: ['0.00', 0] }),
          figure('USD', { total: ['100.00', 1], current: ['100.00', 1], potential: ['0.00', 0] }),
        ]),
      }),
    );
    expect(lines).toContain('Currently affected: 2 customer orders. 80.00 EUR and 100.00 USD exposed.');
    expect(lines).toContain('Total exposure: 80.00 EUR and 100.00 USD across 2 customer orders.');
  });

  it('says the state is unknown when the start state is unknown', () => {
    expect(
      buildSummary(
        input({ startName: 'Mystery', startState: 'UNKNOWN', startClass: 'INDETERMINATE' }),
      )[0],
    ).toBe('Mystery has an unknown state.');
  });

  it('says nothing is currently affected for an impaired start with only potential impact', () => {
    const lines = buildSummary(
      input({
        countedTotal: 2,
        categories: categories({ Order: [2, 0, 2, 0, 2, 0, 0] }),
        exposure: exposure([
          figure('USD', { total: ['20.00', 2], current: ['0.00', 0], potential: ['20.00', 2] }),
        ]),
      }),
    );
    expect(lines.slice(0, 3)).toEqual([
      'Start is BLOCKED.',
      'Nothing is currently affected.',
      'Potentially affected if it continues: 2 customer orders. 20.00 USD more exposed.',
    ]);
  });

  it('line 6: affected entities with an unknown state', () => {
    const plural = buildSummary(
      input({
        countedTotal: 2,
        categories: categories({ Shipment: [2, 2, 0, 0, 2, 0, 2] }),
      }),
    );
    expect(plural).toContain('2 affected entities have an unknown state and are counted as potential.');
    const single = buildSummary(
      input({
        countedTotal: 1,
        categories: categories({ Shipment: [1, 1, 0, 0, 1, 0, 1] }),
      }),
    );
    expect(single).toContain('1 affected entity has an unknown state and is counted as potential.');
  });

  it('line 9: values that disagree, with the range per currency', () => {
    const lines = buildSummary(
      input({
        countedTotal: 2,
        categories: categories({ Order: [2, 0, 2, 2, 0, 0, 0] }),
        exposure: exposure([
          figure('EUR', {
            total: ['60.00', 1],
            current: ['60.00', 1],
            potential: ['0.00', 0],
            disagreements: 1,
            range: ['55.00', '70.00'],
          }),
          figure('USD', {
            total: ['100.00', 1],
            current: ['100.00', 1],
            potential: ['0.00', 0],
            disagreements: 1,
            range: ['100.00', '120.00'],
          }),
        ]),
      }),
    );
    expect(lines).toContain(
      '2 customer orders have values that disagree between sources; exposure could range from 55.00 EUR to 70.00 EUR and 100.00 USD to 120.00 USD.',
    );
    const single = buildSummary(
      input({
        countedTotal: 1,
        categories: oneOrder,
        exposure: exposure([
          figure('USD', {
            total: ['100.00', 1],
            current: ['100.00', 1],
            potential: ['0.00', 0],
            disagreements: 1,
            range: ['100.00', '120.00'],
          }),
        ]),
      }),
    );
    expect(single).toContain(
      '1 customer order has values that disagree between sources; exposure could range from 100.00 USD to 120.00 USD.',
    );
  });

  it('line 10 is not emitted when nothing is counted', () => {
    const lines = buildSummary(
      input({ countedTotal: 0, exposure: exposure([], { own: ['12480.00', 'USD'] }) }),
    );
    expect(lines.some((line) => line.includes('own value'))).toBe(false);
  });

  it('line 12: the exploration limit', () => {
    const lines = buildSummary(
      input({
        countedTotal: 1,
        categories: oneOrder,
        limits: { depthLimit: false, explorationLimit: true },
      }),
    );
    expect(lines.at(-1)).toBe('The search stopped after 10,000 entities; these figures are lower bounds.');
  });

  it('puts the depth line before the exploration line', () => {
    const lines = buildSummary(
      input({
        countedTotal: 1,
        categories: oneOrder,
        limits: { depthLimit: true, explorationLimit: true },
      }),
    );
    expect(lines.slice(-2)).toEqual([
      'Impact continues beyond 6 steps; these figures are lower bounds.',
      'The search stopped after 10,000 entities; these figures are lower bounds.',
    ]);
  });
});
