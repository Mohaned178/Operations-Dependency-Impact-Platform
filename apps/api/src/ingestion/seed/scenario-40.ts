import type {
  Confidence,
  EntityImportRowInput,
  EntityKeyRef,
  EventImportRowInput,
  ImportDocument,
  OperationalState,
  RelationshipImportRowInput,
  RelationshipOrigin,
  RelationshipType,
} from '@opsgraph/shared';

/**
 * Product Overview §40: "Supplier X unavailable". The rows are the exact ones of
 * specs/006-impact-analysis/seed-scenario-40.md, in that order. The dataset shares no entity key
 * with the §39 scenario.
 */

type SeedEntityType =
  | 'Supplier'
  | 'Product'
  | 'PurchaseOrder'
  | 'Customer'
  | 'Contract'
  | 'SLA'
  | 'Order'
  | 'Shipment';

const PRIMARY_SYSTEM: Record<SeedEntityType, string> = {
  Supplier: 'PIM',
  Product: 'PIM',
  PurchaseOrder: 'ERP',
  Customer: 'CRM',
  Contract: 'ContractMgmt',
  SLA: 'ContractMgmt',
  Order: 'OMS',
  Shipment: 'TMS',
};

const MASTER_OBSERVED_AT = '2026-09-01T08:00:00Z';
const RELATIONSHIP_OBSERVED_AT = '2026-10-05T12:00:00Z';
const USD = 'USD';

function ref(entityType: SeedEntityType, sourceId: string): EntityKeyRef {
  return { entityType, sourceSystem: PRIMARY_SYSTEM[entityType], sourceId };
}

interface StatedEntity {
  type: SeedEntityType;
  sourceId: string;
  displayName: string;
  observedAt: string;
  state: OperationalState;
  sourceStatus?: string;
  attributes: Record<string, string>;
}

function entityRow(fixture: StatedEntity): EntityImportRowInput {
  return {
    type: fixture.type,
    sourceSystem: PRIMARY_SYSTEM[fixture.type],
    sourceId: fixture.sourceId,
    displayName: fixture.displayName,
    observedAt: fixture.observedAt,
    state: fixture.state,
    ...(fixture.sourceStatus === undefined ? {} : { sourceStatus: fixture.sourceStatus }),
    attributes: fixture.attributes,
  };
}

function master(
  type: SeedEntityType,
  sourceId: string,
  displayName: string,
  attributes: Record<string, string>,
): StatedEntity {
  return {
    type,
    sourceId,
    displayName,
    observedAt: MASTER_OBSERVED_AT,
    state: 'ACTIVE',
    attributes,
  };
}

const MASTER_DATA: readonly StatedEntity[] = [
  master('Supplier', 'SUP-410', 'Tailspin Parts', {}),
  master('Product', 'PRD-6101', 'Hydraulic Pump Assembly', { sku: 'PRD-6101' }),
  master('Product', 'PRD-6102', 'Steel Mounting Bracket', { sku: 'PRD-6102' }),
  master('Product', 'PRD-6103', 'Control Valve Kit', { sku: 'PRD-6103' }),
  master('Product', 'PRD-6104', 'Pressure Sensor Module', { sku: 'PRD-6104' }),
  master('Product', 'PRD-6105', 'Rubber Seal Pack', { sku: 'PRD-6105' }),
  master('Customer', 'CUST-2001', 'Blue Yonder Machinery', { segment: 'Enterprise' }),
  master('Customer', 'CUST-2002', 'Woodgrove Manufacturing', { segment: 'Enterprise' }),
  master('Customer', 'CUST-2003', 'Litware Industrial', { segment: 'Mid-market' }),
  master('Customer', 'CUST-2004', 'Proseware Systems', { segment: 'Mid-market' }),
  master('Customer', 'CUST-2005', 'Adventure Works Supply', { segment: 'Mid-market' }),
  master('Contract', 'CON-5001', 'Contract CON-5001', {}),
  master('Contract', 'CON-5002', 'Contract CON-5002', {}),
  master('Contract', 'CON-5003', 'Contract CON-5003', {}),
  master('Contract', 'CON-5004', 'Contract CON-5004', {}),
  master('Contract', 'CON-5005', 'Contract CON-5005', {}),
];

const SUPPLIER_X: StatedEntity = {
  type: 'Supplier',
  sourceId: 'SUP-400',
  displayName: 'Fabrikam Components',
  observedAt: '2026-10-05T07:30:00Z',
  state: 'SUSPENDED',
  sourceStatus: 'UNAVAILABLE',
  attributes: { unavailableSince: '2026-10-05T07:30:00Z' },
};

interface PurchaseOrderFixture {
  sourceId: string;
  supplierId: string;
  observedAt: string;
  state: OperationalState;
  sourceStatus: string;
  expectedDelivery: string;
}

const PURCHASE_ORDERS: readonly PurchaseOrderFixture[] = [
  { sourceId: 'PO-7001', supplierId: 'SUP-400', observedAt: '2026-10-05T09:00:00Z', state: 'DELAYED', sourceStatus: 'SUPPLIER_DELAY', expectedDelivery: '2026-10-04' },
  { sourceId: 'PO-7002', supplierId: 'SUP-400', observedAt: '2026-10-05T09:00:00Z', state: 'DELAYED', sourceStatus: 'SUPPLIER_DELAY', expectedDelivery: '2026-10-05' },
  { sourceId: 'PO-7003', supplierId: 'SUP-400', observedAt: '2026-10-05T09:00:00Z', state: 'DELAYED', sourceStatus: 'SUPPLIER_DELAY', expectedDelivery: '2026-10-06' },
  { sourceId: 'PO-7004', supplierId: 'SUP-400', observedAt: '2026-10-01T10:00:00Z', state: 'ACTIVE', sourceStatus: 'OPEN', expectedDelivery: '2026-10-14' },
  { sourceId: 'PO-7005', supplierId: 'SUP-400', observedAt: '2026-10-01T10:00:00Z', state: 'ACTIVE', sourceStatus: 'OPEN', expectedDelivery: '2026-10-16' },
  { sourceId: 'PO-7006', supplierId: 'SUP-400', observedAt: '2026-09-28T14:00:00Z', state: 'COMPLETED', sourceStatus: 'RECEIVED', expectedDelivery: '2026-09-28' },
  { sourceId: 'PO-7010', supplierId: 'SUP-410', observedAt: '2026-10-01T10:00:00Z', state: 'ACTIVE', sourceStatus: 'OPEN', expectedDelivery: '2026-10-12' },
];

interface SlaFixture {
  sourceId: string;
  displayName: string;
  observedAt: string;
  state: OperationalState;
  dueBy: string;
}

const SLAS: readonly SlaFixture[] = [
  { sourceId: 'SLA-5001-DEL', displayName: 'Blue Yonder Machinery delivery SLA', observedAt: '2026-10-05T12:00:00Z', state: 'AT_RISK', dueBy: '2026-10-08T17:00:00Z' },
  { sourceId: 'SLA-5002-DEL', displayName: 'Woodgrove Manufacturing delivery SLA', observedAt: '2026-10-05T12:00:00Z', state: 'AT_RISK', dueBy: '2026-10-09T17:00:00Z' },
  { sourceId: 'SLA-5004-DEL', displayName: 'Proseware Systems delivery SLA', observedAt: '2026-10-01T08:00:00Z', state: 'ACTIVE', dueBy: '2026-10-20T17:00:00Z' },
  { sourceId: 'SLA-5005-DEL', displayName: 'Adventure Works Supply delivery SLA', observedAt: '2026-10-01T08:00:00Z', state: 'ACTIVE', dueBy: '2026-10-22T17:00:00Z' },
];

interface OrderFixture {
  sourceId: string;
  customerId: string;
  amount: string;
  observedAt: string;
  state: OperationalState;
  sourceStatus: string;
}

const BACKORDERED_AT = '2026-10-05T10:00:00Z';
const OPEN_AT = '2026-10-02T09:00:00Z';

const ORDERS: readonly OrderFixture[] = [
  { sourceId: 'SO-20401', customerId: 'CUST-2001', amount: '9800.00', observedAt: BACKORDERED_AT, state: 'WAITING', sourceStatus: 'BACKORDERED' },
  { sourceId: 'SO-20402', customerId: 'CUST-2001', amount: '12400.00', observedAt: BACKORDERED_AT, state: 'WAITING', sourceStatus: 'BACKORDERED' },
  { sourceId: 'SO-20403', customerId: 'CUST-2002', amount: '7250.00', observedAt: BACKORDERED_AT, state: 'WAITING', sourceStatus: 'BACKORDERED' },
  { sourceId: 'SO-20404', customerId: 'CUST-2002', amount: '10600.00', observedAt: BACKORDERED_AT, state: 'WAITING', sourceStatus: 'BACKORDERED' },
  { sourceId: 'SO-20405', customerId: 'CUST-2003', amount: '5900.00', observedAt: BACKORDERED_AT, state: 'WAITING', sourceStatus: 'BACKORDERED' },
  { sourceId: 'SO-20406', customerId: 'CUST-2003', amount: '5300.00', observedAt: BACKORDERED_AT, state: 'WAITING', sourceStatus: 'BACKORDERED' },
  { sourceId: 'SO-20407', customerId: 'CUST-2001', amount: '6150.00', observedAt: OPEN_AT, state: 'ACTIVE', sourceStatus: 'OPEN' },
  { sourceId: 'SO-20408', customerId: 'CUST-2002', amount: '4800.00', observedAt: '2026-10-04T12:00:00Z', state: 'PENDING', sourceStatus: 'NEW' },
  { sourceId: 'SO-20409', customerId: 'CUST-2004', amount: '7900.00', observedAt: OPEN_AT, state: 'ACTIVE', sourceStatus: 'OPEN' },
  { sourceId: 'SO-20410', customerId: 'CUST-2004', amount: '5600.00', observedAt: OPEN_AT, state: 'ACTIVE', sourceStatus: 'OPEN' },
  { sourceId: 'SO-20411', customerId: 'CUST-2004', amount: '2400.00', observedAt: OPEN_AT, state: 'ACTIVE', sourceStatus: 'OPEN' },
  { sourceId: 'SO-20412', customerId: 'CUST-2003', amount: '5900.00', observedAt: OPEN_AT, state: 'ACTIVE', sourceStatus: 'OPEN' },
  { sourceId: 'SO-20413', customerId: 'CUST-2001', amount: '3100.00', observedAt: '2026-09-30T16:00:00Z', state: 'COMPLETED', sourceStatus: 'DELIVERED' },
  { sourceId: 'SO-20414', customerId: 'CUST-2005', amount: '4200.00', observedAt: OPEN_AT, state: 'ACTIVE', sourceStatus: 'OPEN' },
  { sourceId: 'SO-20415', customerId: 'CUST-2002', amount: '1750.00', observedAt: OPEN_AT, state: 'ACTIVE', sourceStatus: 'OPEN' },
];

interface ShipmentFixture {
  sourceId: string;
  observedAt: string;
  state: OperationalState;
  sourceStatus: string;
}

const SHIPMENTS: readonly ShipmentFixture[] = [
  { sourceId: 'SHP-8001', observedAt: '2026-10-05T11:00:00Z', state: 'DELAYED', sourceStatus: 'HELD' },
  { sourceId: 'SHP-8002', observedAt: '2026-10-05T11:00:00Z', state: 'DELAYED', sourceStatus: 'HELD' },
  { sourceId: 'SHP-8003', observedAt: '2026-10-03T08:00:00Z', state: 'ACTIVE', sourceStatus: 'PLANNED' },
  { sourceId: 'SHP-8009', observedAt: '2026-10-03T08:00:00Z', state: 'ACTIVE', sourceStatus: 'PLANNED' },
];

function buildEntities(): EntityImportRowInput[] {
  return [
    ...MASTER_DATA.map(entityRow),
    entityRow(SUPPLIER_X),
    ...PURCHASE_ORDERS.map((po) =>
      entityRow({
        type: 'PurchaseOrder',
        sourceId: po.sourceId,
        displayName: `Purchase order ${po.sourceId}`,
        observedAt: po.observedAt,
        state: po.state,
        sourceStatus: po.sourceStatus,
        attributes: { expectedDelivery: po.expectedDelivery },
      }),
    ),
    ...SLAS.map((sla) =>
      entityRow({
        type: 'SLA',
        sourceId: sla.sourceId,
        displayName: sla.displayName,
        observedAt: sla.observedAt,
        state: sla.state,
        attributes: { metric: 'on-time delivery', dueBy: sla.dueBy },
      }),
    ),
    ...ORDERS.map((order) =>
      entityRow({
        type: 'Order',
        sourceId: order.sourceId,
        displayName: `Order ${order.sourceId}`,
        observedAt: order.observedAt,
        state: order.state,
        sourceStatus: order.sourceStatus,
        attributes: { amount: order.amount, currency: USD },
      }),
    ),
    ...SHIPMENTS.map((shipment) =>
      entityRow({
        type: 'Shipment',
        sourceId: shipment.sourceId,
        displayName: `Shipment ${shipment.sourceId}`,
        observedAt: shipment.observedAt,
        state: shipment.state,
        sourceStatus: shipment.sourceStatus,
        attributes: { carrier: 'FastFreight' },
      }),
    ),
  ];
}

function relationship(
  type: RelationshipType,
  from: EntityKeyRef,
  to: EntityKeyRef,
  inferred?: { confidence: Confidence; basis: string },
): RelationshipImportRowInput {
  const origin: RelationshipOrigin = inferred === undefined ? 'SOURCE' : 'INFERRED';
  return {
    type,
    sourceSystem: inferred === undefined ? from.sourceSystem : 'InferenceRules',
    sourceId: `${type}:${from.sourceId}:${to.sourceId}`,
    from,
    to,
    origin,
    confidence: inferred?.confidence ?? 'HIGH',
    ...(inferred === undefined ? {} : { basis: inferred.basis }),
    observedAt: RELATIONSHIP_OBSERVED_AT,
  };
}

/** [order, products] for S6, in the document order. */
const ORDER_PRODUCTS: ReadonlyArray<readonly [string, string]> = [
  ['SO-20401', 'PRD-6101'],
  ['SO-20402', 'PRD-6101'],
  ['SO-20402', 'PRD-6103'],
  ['SO-20403', 'PRD-6102'],
  ['SO-20404', 'PRD-6102'],
  ['SO-20405', 'PRD-6101'],
  ['SO-20406', 'PRD-6103'],
  ['SO-20407', 'PRD-6102'],
  ['SO-20408', 'PRD-6102'],
  ['SO-20409', 'PRD-6103'],
  ['SO-20410', 'PRD-6103'],
  ['SO-20411', 'PRD-6104'],
  ['SO-20412', 'PRD-6101'],
  ['SO-20413', 'PRD-6101'],
  ['SO-20414', 'PRD-6105'],
  ['SO-20415', 'PRD-6105'],
];

const PO_PRODUCTS: ReadonlyArray<readonly [string, string]> = [
  ['PO-7001', 'PRD-6101'],
  ['PO-7002', 'PRD-6102'],
  ['PO-7003', 'PRD-6101'],
  ['PO-7003', 'PRD-6103'],
  ['PO-7004', 'PRD-6102'],
  ['PO-7005', 'PRD-6103'],
  ['PO-7006', 'PRD-6101'],
  ['PO-7010', 'PRD-6105'],
];

const ORDER_PURCHASE_ORDERS: ReadonlyArray<readonly [string, string]> = [
  ['SO-20401', 'PO-7001'],
  ['SO-20402', 'PO-7003'],
  ['SO-20403', 'PO-7002'],
  ['SO-20404', 'PO-7002'],
  ['SO-20404', 'PO-7003'],
  ['SO-20405', 'PO-7001'],
  ['SO-20406', 'PO-7003'],
  ['SO-20408', 'PO-7004'],
  ['SO-20410', 'PO-7005'],
  ['SO-20413', 'PO-7006'],
];

const SHIPMENT_ORDERS: ReadonlyArray<readonly [string, string]> = [
  ['SHP-8001', 'SO-20401'],
  ['SHP-8001', 'SO-20402'],
  ['SHP-8002', 'SO-20403'],
  ['SHP-8002', 'SO-20404'],
  ['SHP-8003', 'SO-20409'],
  ['SHP-8003', 'SO-20410'],
  ['SHP-8009', 'SO-20414'],
];

const SLA_SHIPMENTS: ReadonlyArray<readonly [string, string]> = [
  ['SLA-5001-DEL', 'SHP-8001'],
  ['SLA-5004-DEL', 'SHP-8003'],
  ['SLA-5005-DEL', 'SHP-8009'],
];

const CUSTOMER_IDS = ['CUST-2001', 'CUST-2002', 'CUST-2003', 'CUST-2004', 'CUST-2005'];

function contractOf(customerId: string): string {
  return `CON-${customerId.slice('CUST-'.length).replace(/^2/, '5')}`;
}

function buildRelationships(): RelationshipImportRowInput[] {
  const rows: RelationshipImportRowInput[] = [];

  // S1
  for (const product of ['PRD-6101', 'PRD-6102', 'PRD-6103']) {
    rows.push(relationship('SUPPLIED_BY', ref('Product', product), ref('Supplier', 'SUP-400')));
  }
  // S2
  for (const product of ['PRD-6104', 'PRD-6105']) {
    rows.push(relationship('SUPPLIED_BY', ref('Product', product), ref('Supplier', 'SUP-410')));
  }
  // S3
  rows.push(
    relationship('SUPPLIED_BY', ref('Product', 'PRD-6104'), ref('Supplier', 'SUP-400'), {
      confidence: 'LOW',
      basis: 'Alternate supplier inferred from 2026 purchase-order history',
    }),
  );
  // S4
  for (const po of PURCHASE_ORDERS) {
    rows.push(relationship('SUPPLIED_BY', ref('PurchaseOrder', po.sourceId), ref('Supplier', po.supplierId)));
  }
  // S5
  for (const [po, product] of PO_PRODUCTS) {
    rows.push(relationship('CONTAINS', ref('PurchaseOrder', po), ref('Product', product)));
  }
  // S6
  for (const [order, product] of ORDER_PRODUCTS) {
    rows.push(relationship('CONTAINS', ref('Order', order), ref('Product', product)));
  }
  // S7
  for (const [order, po] of ORDER_PURCHASE_ORDERS) {
    rows.push(relationship('DEPENDS_ON', ref('Order', order), ref('PurchaseOrder', po)));
  }
  // S8
  for (const [shipment, order] of SHIPMENT_ORDERS) {
    rows.push(relationship('DEPENDS_ON', ref('Shipment', shipment), ref('Order', order)));
  }
  // S9
  for (const [sla, shipment] of SLA_SHIPMENTS) {
    rows.push(relationship('DEPENDS_ON', ref('SLA', sla), ref('Shipment', shipment)));
  }
  // S10
  rows.push(
    relationship('DEPENDS_ON', ref('SLA', 'SLA-5002-DEL'), ref('Shipment', 'SHP-8002'), {
      confidence: 'MEDIUM',
      basis: "SLA measures on-time delivery of the customer's orders on this shipment",
    }),
  );
  // S11
  for (const customer of CUSTOMER_IDS) {
    rows.push(relationship('HAS', ref('Customer', customer), ref('Contract', contractOf(customer))));
  }
  // S12
  for (const [contract, sla] of [
    ['CON-5001', 'SLA-5001-DEL'],
    ['CON-5002', 'SLA-5002-DEL'],
    ['CON-5004', 'SLA-5004-DEL'],
    ['CON-5005', 'SLA-5005-DEL'],
  ] as const) {
    rows.push(relationship('DEFINES', ref('Contract', contract), ref('SLA', sla)));
  }
  // S13
  for (const customer of CUSTOMER_IDS) {
    for (const order of ORDERS.filter((candidate) => candidate.customerId === customer)) {
      rows.push(relationship('PLACED', ref('Customer', customer), ref('Order', order.sourceId)));
    }
  }
  // S14
  for (const customer of CUSTOMER_IDS) {
    for (const order of ORDERS.filter((candidate) => candidate.customerId === customer)) {
      rows.push(
        relationship('GOVERNS', ref('Contract', contractOf(customer)), ref('Order', order.sourceId)),
      );
    }
  }

  return rows;
}

function addMinute(value: string): string {
  return new Date(Date.parse(value) + 60_000).toISOString();
}

function event(
  sourceSystem: string,
  sourceId: string,
  type: string,
  occurredAt: string,
  subject: EntityKeyRef,
  related: readonly EntityKeyRef[],
  description: string,
): EventImportRowInput {
  return {
    type,
    sourceSystem,
    sourceId,
    occurredAt,
    observedAt: addMinute(occurredAt),
    subject,
    ...(related.length > 0 ? { related: [...related] } : {}),
    description,
  };
}

function buildEvents(): EventImportRowInput[] {
  const delayed = 'Supplier confirmed delay; no ship date';
  const held = 'Load held: backordered orders';
  const slaAtRisk = 'Delivery SLA approaching threshold';
  return [
    event(
      'PIM',
      'EVT-PIM-7001',
      'supplier.unavailable',
      '2026-10-05T07:30:00Z',
      ref('Supplier', 'SUP-400'),
      [],
      'Supplier reports a production stoppage; no shipments until further notice',
    ),
    event('ERP', 'EVT-ERP-7101', 'purchase_order.delayed', '2026-10-05T09:00:00Z', ref('PurchaseOrder', 'PO-7001'), [ref('Supplier', 'SUP-400')], delayed),
    event('ERP', 'EVT-ERP-7102', 'purchase_order.delayed', '2026-10-05T09:00:00Z', ref('PurchaseOrder', 'PO-7002'), [ref('Supplier', 'SUP-400')], delayed),
    event('ERP', 'EVT-ERP-7103', 'purchase_order.delayed', '2026-10-05T09:00:00Z', ref('PurchaseOrder', 'PO-7003'), [ref('Supplier', 'SUP-400')], delayed),
    event(
      'OMS',
      'EVT-OMS-7201',
      'order.backordered',
      '2026-10-05T10:00:00Z',
      ref('Order', 'SO-20401'),
      [ref('PurchaseOrder', 'PO-7001')],
      'Order backordered: inbound stock delayed',
    ),
    event('TMS', 'EVT-TMS-7301', 'shipment.delayed', '2026-10-05T11:00:00Z', ref('Shipment', 'SHP-8001'), [ref('Order', 'SO-20401'), ref('Order', 'SO-20402')], held),
    event('TMS', 'EVT-TMS-7302', 'shipment.delayed', '2026-10-05T11:00:00Z', ref('Shipment', 'SHP-8002'), [ref('Order', 'SO-20403'), ref('Order', 'SO-20404')], held),
    event('ContractMgmt', 'EVT-CLM-7401', 'sla.at_risk', '2026-10-05T12:00:00Z', ref('SLA', 'SLA-5001-DEL'), [ref('Shipment', 'SHP-8001')], slaAtRisk),
    event('ContractMgmt', 'EVT-CLM-7402', 'sla.at_risk', '2026-10-05T12:00:00Z', ref('SLA', 'SLA-5002-DEL'), [ref('Shipment', 'SHP-8002')], slaAtRisk),
  ];
}

export function buildScenario40Document(): ImportDocument {
  return {
    entities: buildEntities(),
    relationships: buildRelationships(),
    events: buildEvents(),
  };
}
