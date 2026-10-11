import {
  ImpactItemDetailResponseSchema,
  ImpactListResponseSchema,
  ImpactResponseSchema,
  type AffectedEntityDto,
  type EntityType,
  type ImpactCategoryDto,
  type ImpactItemDetailResponse,
  type ImpactListResponse,
  type ImpactResponse,
  type OperationalState,
  type PathDto,
} from '@opsgraph/shared';
import { hop, tracedEntity } from '../tracing-test-data';

/**
 * Fixtures shaped like contracts/api.md I1, I2 (current orders) and I14, parsed through the shared
 * schemas at load so a drift in the contract breaks the tests that use them.
 */

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const FAB_ID = id(1);
export const FABRIKAM = tracedEntity(FAB_ID, 'Supplier', 'Fabrikam Components', 'SUSPENDED');
export const INVOICE_ID = id(2);
export const INVOICE = tracedEntity(INVOICE_ID, 'Invoice', 'Invoice INV-55120', 'PENDING');

const COMPUTED_AT = '2026-10-06T09:00:00.000Z';

type Counts = [number, number, number, number, number, number, number];

const HEADLINE: Array<[EntityType, string]> = [
  ['Product', 'Products'],
  ['PurchaseOrder', 'Purchase orders'],
  ['Order', 'Customer orders'],
  ['Customer', 'Customers'],
  ['Shipment', 'Shipments'],
  ['SLA', 'SLA commitments'],
];

function category(type: EntityType, label: string, counts: Counts): ImpactCategoryDto {
  const [total, direct, indirect, current, potential, inferredOnly, stateUnknown] = counts;
  return {
    type,
    label,
    headline: true,
    total,
    direct,
    indirect,
    current,
    potential,
    inferredOnly,
    stateUnknown,
  };
}

function categories(counts: Partial<Record<EntityType, Counts>>): ImpactCategoryDto[] {
  return HEADLINE.map(([type, label]) => category(type, label, counts[type] ?? [0, 0, 0, 0, 0, 0, 0]));
}

const share = (amount: string, orderCount: number) => ({ amount, orderCount });

export const I1_SUMMARY: ImpactResponse = ImpactResponseSchema.parse({
  query: { entityId: FAB_ID, depth: 6 },
  computedAt: COMPUTED_AT,
  start: FABRIKAM,
  startClass: 'IMPAIRED',
  startOwnValue: null,
  limits: { depthLimit: false, explorationLimit: false, lowerBound: false },
  summary: [
    'Fabrikam Components is SUSPENDED.',
    'Currently affected: 3 purchase orders, 6 customer orders, 3 customers, 2 shipments, 2 SLA commitments. 51,250.00 USD exposed.',
    'Potentially affected if it continues: 4 products, 2 purchase orders, 6 customer orders, 1 customer, 1 shipment, 1 SLA commitment. 32,750.00 USD more exposed.',
    'Total exposure: 84,000.00 USD across 12 customer orders.',
    '3 of the affected entities are reached only through inferred or manual links, including 2,400.00 USD of exposure.',
    'Not counted: 2 completed or cancelled entities.',
  ],
  countedTotal: 31,
  categories: categories({
    Product: [4, 4, 0, 0, 4, 1, 0],
    PurchaseOrder: [5, 5, 0, 3, 2, 0, 0],
    Order: [12, 0, 12, 6, 6, 1, 0],
    Customer: [4, 0, 4, 3, 1, 0, 0],
    Shipment: [3, 0, 3, 2, 1, 0, 0],
    SLA: [3, 0, 3, 2, 1, 1, 0],
  }),
  exposure: {
    byCurrency: [
      {
        currency: 'USD',
        total: share('84000.00', 12),
        current: share('51250.00', 6),
        potential: share('32750.00', 6),
        inferredOnly: {
          total: share('2400.00', 1),
          current: share('0.00', 0),
          potential: share('2400.00', 1),
        },
        disagreementOrderCount: 0,
        range: null,
      },
    ],
    valueUnknownCount: 0,
  },
  notCounted: {
    total: 2,
    byType: [
      { type: 'Order', count: 1 },
      { type: 'PurchaseOrder', count: 1 },
    ],
  },
  cycleClosingHops: [],
  cycleClosingHopCount: 0,
});

/** I1 with two orders whose sources disagree and two orders without a recorded value. */
export const RANGE_SUMMARY: ImpactResponse = ImpactResponseSchema.parse({
  ...I1_SUMMARY,
  exposure: {
    byCurrency: [
      {
        ...I1_SUMMARY.exposure.byCurrency[0],
        disagreementOrderCount: 2,
        range: { low: '82000.00', high: '90500.00' },
      },
    ],
    valueUnknownCount: 2,
  },
});

export const I14_SUMMARY: ImpactResponse = ImpactResponseSchema.parse({
  query: { entityId: INVOICE_ID, depth: 6 },
  computedAt: COMPUTED_AT,
  start: INVOICE,
  startClass: 'IMPAIRED',
  startOwnValue: { amount: '12480.00', currency: 'USD' },
  limits: { depthLimit: false, explorationLimit: false, lowerBound: false },
  summary: ['Invoice INV-55120 is PENDING.', 'Nothing is affected within 6 steps.'],
  countedTotal: 0,
  categories: categories({}),
  exposure: { byCurrency: [], valueUnknownCount: 0 },
  notCounted: { total: 0, byType: [] },
  cycleClosingHops: [],
  cycleClosingHopCount: 0,
});

// ---------------------------------------------------------------------------------------------
// I2: the current customer orders
// ---------------------------------------------------------------------------------------------

let nextId = 100;

function twoHopPath(
  po: { id: string; name: string },
  order: ReturnType<typeof tracedEntity>,
): PathDto {
  const poEntity = tracedEntity(po.id, 'PurchaseOrder', po.name, 'DELAYED');
  return {
    hops: [
      hop('SUPPLIED_BY', 'REVERSE', po.id, FAB_ID, poEntity),
      hop('DEPENDS_ON', 'REVERSE', order.id, po.id, order),
    ],
    length: 2,
    weakestConfidence: 'HIGH',
    nonSourceHops: 0,
    continuesBeyondDepth: false,
  };
}

export function orderItem(
  name: string,
  amount: string,
  options: {
    pathCount?: number;
    state?: OperationalState;
    classification?: AffectedEntityDto['classification'];
    flags?: Partial<AffectedEntityDto['flags']>;
    weakest?: AffectedEntityDto['weakest'];
    morePaths?: boolean;
  } = {},
): AffectedEntityDto {
  nextId += 1;
  const order = tracedEntity(id(nextId), 'Order', name, options.state ?? 'WAITING');
  nextId += 1;
  const path = twoHopPath({ id: id(nextId), name: 'Purchase order PO-7001' }, order);
  return {
    entity: order,
    classification: options.classification ?? 'CURRENT',
    notCountedReason: null,
    directness: 'INDIRECT',
    distance: 2,
    primaryPath: path,
    shortestPath: null,
    pathCount: options.pathCount ?? 1,
    morePaths: options.morePaths ?? false,
    flags: { stateUnknown: false, otherCause: false, inferredOnly: false, ...options.flags },
    weakest: options.weakest ?? { origin: 'SOURCE', confidence: 'HIGH' },
    value: {
      current: { amount, currency: 'USD' },
      bySource: [
        {
          sourceSystem: 'OMS',
          sourceId: name,
          observedAt: '2026-10-05T10:00:00.000Z',
          amount,
          currency: 'USD',
        },
      ],
      disagreement: false,
      currencyMismatch: false,
    },
    attributionCount: 0,
    attributions: [],
  };
}

const CURRENT_ORDERS: Array<[string, string, number]> = [
  ['Order SO-20402', '12400.00', 5],
  ['Order SO-20404', '10600.00', 6],
  ['Order SO-20401', '9800.00', 3],
  ['Order SO-20403', '7250.00', 2],
  ['Order SO-20405', '5900.00', 2],
  ['Order SO-20406', '5300.00', 2],
];

export const I2_CURRENT_ORDERS: ImpactListResponse = ImpactListResponseSchema.parse({
  query: {
    entityId: FAB_ID,
    depth: 6,
    selector: { list: 'category', type: 'Order', bucket: 'current' },
  },
  computedAt: COMPUTED_AT,
  start: FABRIKAM,
  total: 6,
  sum: null,
  items: CURRENT_ORDERS.map(([name, amount, pathCount]) => orderItem(name, amount, { pathCount })),
  nextCursor: null,
});

/** The exposure list of the same six orders: it adds up to the 51,250.00 USD figure. */
export const I2_EXPOSURE_CURRENT: ImpactListResponse = ImpactListResponseSchema.parse({
  ...I2_CURRENT_ORDERS,
  query: {
    entityId: FAB_ID,
    depth: 6,
    selector: { list: 'exposure', currency: 'USD', bucket: 'current' },
  },
  sum: { amount: '51250.00', currency: 'USD' },
});

// ---------------------------------------------------------------------------------------------
// Item detail: an order with alternative paths
// ---------------------------------------------------------------------------------------------

const DETAIL_ITEM = orderItem('Order SO-20404', '10600.00', { pathCount: 3 });

function viaProduct(): PathDto {
  const product = tracedEntity(id(900), 'Product', 'Steel Mounting Bracket', 'ACTIVE');
  const entity = DETAIL_ITEM.entity;
  return {
    hops: [
      hop('SUPPLIED_BY', 'REVERSE', product.id, FAB_ID, product),
      hop('CONTAINS', 'REVERSE', entity.id, product.id, entity),
    ],
    length: 2,
    weakestConfidence: 'HIGH',
    nonSourceHops: 0,
    continuesBeyondDepth: false,
  };
}

export const ITEM_DETAIL: ImpactItemDetailResponse = ImpactItemDetailResponseSchema.parse({
  query: { entityId: FAB_ID, depth: 6 },
  computedAt: COMPUTED_AT,
  start: FABRIKAM,
  item: DETAIL_ITEM,
  alternativePaths: [viaProduct()],
  attributions: [],
  attributionCount: 0,
});

/** A customer with one order attribution, for the attribution rendering. */
const CUSTOMER = tracedEntity(id(950), 'Customer', 'Woodgrove Manufacturing', 'ACTIVE');
const ATTRIBUTED = DETAIL_ITEM.entity;

export const CUSTOMER_ITEM: AffectedEntityDto = {
  entity: CUSTOMER,
  classification: 'CURRENT',
  notCountedReason: null,
  directness: 'INDIRECT',
  distance: null,
  primaryPath: null,
  shortestPath: null,
  pathCount: 0,
  morePaths: false,
  flags: { stateUnknown: false, otherCause: false, inferredOnly: false },
  weakest: null,
  value: null,
  attributionCount: 1,
  attributions: [
    {
      entity: {
        id: ATTRIBUTED.id,
        type: ATTRIBUTED.type,
        displayName: ATTRIBUTED.displayName,
        currentState: ATTRIBUTED.currentState,
      },
      classification: 'CURRENT',
      link: {
        hops: [hop('PLACED', 'REVERSE', CUSTOMER.id, ATTRIBUTED.id, CUSTOMER)],
        length: 1,
        weakestConfidence: 'HIGH',
        nonSourceHops: 0,
        continuesBeyondDepth: false,
      },
    },
  ],
};

export const CUSTOMER_DETAIL: ImpactItemDetailResponse = ImpactItemDetailResponseSchema.parse({
  query: { entityId: FAB_ID, depth: 6 },
  computedAt: COMPUTED_AT,
  start: FABRIKAM,
  item: CUSTOMER_ITEM,
  alternativePaths: [],
  attributions: CUSTOMER_ITEM.attributions.map((attribution) => ({
    ...attribution,
    primaryPath: DETAIL_ITEM.primaryPath,
  })),
  attributionCount: 1,
});
