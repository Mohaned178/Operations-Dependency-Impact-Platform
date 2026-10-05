import type {
  Confidence,
  EntityImportRowInput,
  EntityKeyRef,
  EntityType,
  EventImportRowInput,
  ImportDocument,
  OperationalState,
  RelationshipImportRowInput,
  RelationshipOrigin,
  RelationshipType,
} from '@opsgraph/shared';

const MASTER_OBSERVED_AT = '2026-09-01T08:00:00Z';
const ERP_ACCOUNT_OBSERVED_AT = '2026-08-15T08:00:00Z';
const SLA_OBSERVED_AT = '2026-09-29T15:10:00Z';
const RELATIONSHIP_OBSERVED_AT = '2026-09-29T15:00:00Z';
const AFFECTED_ORDERS_OBSERVED_AT = '2026-09-29T14:32:00Z';
const USD = 'USD';

const PRIMARY_SYSTEM: Record<EntityType, string> = {
  Customer: 'CRM',
  Contract: 'ContractMgmt',
  Order: 'OMS',
  Product: 'PIM',
  Payment: 'Payments',
  Invoice: 'ERP',
  Approval: 'FinanceApprovals',
  Warehouse: 'WMS',
  Shipment: 'TMS',
  Supplier: 'PIM',
  SLA: 'ContractMgmt',
  BudgetRequirement: 'FinanceApprovals',
};

function ref(entityType: EntityType, sourceId: string): EntityKeyRef {
  return { entityType, sourceSystem: PRIMARY_SYSTEM[entityType], sourceId };
}

interface CustomerFixture {
  sourceId: string;
  displayName: string;
  segment: string;
  contractId: string;
  slaId: string;
  slaDisplayName: string;
  slaState: OperationalState;
  slaDueBy: string;
}

const CUSTOMERS: readonly CustomerFixture[] = [
  {
    sourceId: 'CUST-1001',
    displayName: 'Acme Corp',
    segment: 'Enterprise',
    contractId: 'CON-3982',
    slaId: 'SLA-3982-DEL',
    slaDisplayName: 'Acme Corp delivery SLA',
    slaState: 'AT_RISK',
    slaDueBy: '2026-10-02T17:00:00Z',
  },
  {
    sourceId: 'CUST-1002',
    displayName: 'Globex Retail',
    segment: 'Enterprise',
    contractId: 'CON-4107',
    slaId: 'SLA-4107-DEL',
    slaDisplayName: 'Globex Retail delivery SLA',
    slaState: 'AT_RISK',
    slaDueBy: '2026-10-02T17:00:00Z',
  },
  {
    sourceId: 'CUST-1003',
    displayName: 'Initech Supplies',
    segment: 'Mid-market',
    contractId: 'CON-4215',
    slaId: 'SLA-4215-DEL',
    slaDisplayName: 'Initech Supplies delivery SLA',
    slaState: 'AT_RISK',
    slaDueBy: '2026-10-03T17:00:00Z',
  },
  {
    sourceId: 'CUST-1004',
    displayName: 'Umbrella Logistics',
    segment: 'Mid-market',
    contractId: 'CON-4330',
    slaId: 'SLA-4330-DEL',
    slaDisplayName: 'Umbrella Logistics delivery SLA',
    slaState: 'ACTIVE',
    slaDueBy: '2026-10-09T17:00:00Z',
  },
];

interface OrderFixture {
  sourceId: string;
  customerId: string;
  amount: string;
  observedAt: string;
  state: OperationalState;
  sourceStatus: string;
  /** Reached by the reverse-dependency walk from BR-18492. */
  affected: boolean;
}

const ALL_ORDERS: readonly OrderFixture[] = [
  {
    sourceId: '18492',
    customerId: 'CUST-1001',
    amount: '12480.00',
    observedAt: '2026-09-29T09:12:00Z',
    state: 'PENDING',
    sourceStatus: 'NEW',
    affected: true,
  },
  {
    sourceId: '18493',
    customerId: 'CUST-1001',
    amount: '1250.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18494',
    customerId: 'CUST-1001',
    amount: '980.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18495',
    customerId: 'CUST-1001',
    amount: '1430.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18496',
    customerId: 'CUST-1001',
    amount: '1140.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18501',
    customerId: 'CUST-1002',
    amount: '1320.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18502',
    customerId: 'CUST-1002',
    amount: '1050.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18503',
    customerId: 'CUST-1002',
    amount: '1275.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18504',
    customerId: 'CUST-1002',
    amount: '990.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18505',
    customerId: 'CUST-1002',
    amount: '1165.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18511',
    customerId: 'CUST-1003',
    amount: '1480.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18512',
    customerId: 'CUST-1003',
    amount: '1210.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18513',
    customerId: 'CUST-1003',
    amount: '1060.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18514',
    customerId: 'CUST-1003',
    amount: '1350.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18521',
    customerId: 'CUST-1004',
    amount: '1060.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18522',
    customerId: 'CUST-1004',
    amount: '1090.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18523',
    customerId: 'CUST-1004',
    amount: '1070.00',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'WAITING',
    sourceStatus: 'RELEASED',
    affected: true,
  },
  {
    sourceId: '18530',
    customerId: 'CUST-1002',
    amount: '2340.00',
    observedAt: '2026-09-26T16:00:00Z',
    state: 'COMPLETED',
    sourceStatus: 'DELIVERED',
    affected: false,
  },
  {
    sourceId: '18531',
    customerId: 'CUST-1003',
    amount: '875.00',
    observedAt: '2026-09-29T12:00:00Z',
    state: 'ACTIVE',
    sourceStatus: 'IN_TRANSIT',
    affected: false,
  },
  {
    sourceId: '18532',
    customerId: 'CUST-1004',
    amount: '1615.00',
    observedAt: '2026-09-29T13:00:00Z',
    state: 'PENDING',
    sourceStatus: 'NEW',
    affected: false,
  },
];

function orderEntity(
  sourceId: string,
  observedAt: string,
  state: OperationalState,
  sourceStatus: string,
  attributes: Record<string, string>,
): EntityImportRowInput {
  return {
    type: 'Order',
    sourceSystem: PRIMARY_SYSTEM.Order,
    sourceId,
    displayName: `Order #${sourceId}`,
    observedAt,
    state,
    sourceStatus,
    attributes,
  };
}

function buildEntities(): EntityImportRowInput[] {
  const entities: EntityImportRowInput[] = [];

  for (const customer of CUSTOMERS) {
    entities.push({
      type: 'Customer',
      sourceSystem: PRIMARY_SYSTEM.Customer,
      sourceId: customer.sourceId,
      displayName: customer.displayName,
      observedAt: MASTER_OBSERVED_AT,
      state: 'ACTIVE',
      attributes: { segment: customer.segment },
    });
  }

  entities.push({
    type: 'Contract',
    sourceSystem: PRIMARY_SYSTEM.Contract,
    sourceId: 'CON-3982',
    displayName: 'Contract CON-3982',
    observedAt: MASTER_OBSERVED_AT,
    state: 'ACTIVE',
    attributes: {
      approvalThreshold: { amount: '10000.00', currency: USD },
      clause: 'Orders above 10,000.00 USD require finance approval with a budget code',
    },
  });
  for (const contractId of ['CON-4107', 'CON-4215', 'CON-4330']) {
    entities.push({
      type: 'Contract',
      sourceSystem: PRIMARY_SYSTEM.Contract,
      sourceId: contractId,
      displayName: `Contract ${contractId}`,
      observedAt: MASTER_OBSERVED_AT,
      state: 'ACTIVE',
      attributes: {},
    });
  }

  entities.push({
    type: 'Warehouse',
    sourceSystem: PRIMARY_SYSTEM.Warehouse,
    sourceId: 'WH-EAST-02',
    displayName: 'East Distribution Center 02',
    observedAt: MASTER_OBSERVED_AT,
    state: 'ACTIVE',
    attributes: { region: 'US-East' },
  });
  entities.push({
    type: 'Warehouse',
    sourceSystem: PRIMARY_SYSTEM.Warehouse,
    sourceId: 'WH-WEST-01',
    displayName: 'West Distribution Center 01',
    observedAt: MASTER_OBSERVED_AT,
    state: 'ACTIVE',
    attributes: { region: 'US-West' },
  });
  entities.push({
    type: 'Product',
    sourceSystem: PRIMARY_SYSTEM.Product,
    sourceId: 'PRD-5521',
    displayName: 'Industrial Pallet Racking Kit',
    observedAt: MASTER_OBSERVED_AT,
    state: 'ACTIVE',
    attributes: { sku: 'PRD-5521' },
  });
  entities.push({
    type: 'Supplier',
    sourceSystem: PRIMARY_SYSTEM.Supplier,
    sourceId: 'SUP-310',
    displayName: 'Northwind Steel',
    observedAt: MASTER_OBSERVED_AT,
    state: 'ACTIVE',
    attributes: {},
  });
  entities.push({
    type: 'Supplier',
    sourceSystem: PRIMARY_SYSTEM.Supplier,
    sourceId: 'SUP-322',
    displayName: 'Contoso Metals',
    observedAt: MASTER_OBSERVED_AT,
    state: 'ACTIVE',
    attributes: {},
  });

  entities.push({
    type: 'Customer',
    sourceSystem: 'ERP',
    sourceId: 'AC-778',
    displayName: 'ACME CORPORATION',
    observedAt: ERP_ACCOUNT_OBSERVED_AT,
    state: 'ACTIVE',
    sourceStatus: 'A',
    entityRef: { entityType: 'Customer', sourceSystem: 'CRM', sourceId: 'CUST-1001' },
    attributes: { erpAccount: 'AC-778', paymentTerms: 'NET30' },
  });

  for (const customer of CUSTOMERS) {
    entities.push({
      type: 'SLA',
      sourceSystem: PRIMARY_SYSTEM.SLA,
      sourceId: customer.slaId,
      displayName: customer.slaDisplayName,
      observedAt: SLA_OBSERVED_AT,
      state: customer.slaState,
      attributes: { metric: 'on-time delivery', dueBy: customer.slaDueBy },
    });
  }

  entities.push(
    orderEntity('18492', '2026-09-29T09:12:00Z', 'PENDING', 'NEW', {
      amount: '12480.00',
      currency: USD,
    }),
    orderEntity('18492', '2026-09-29T09:14:00Z', 'WAITING', 'AWAITING_PAYMENT', {
      amount: '12480.00',
      currency: USD,
    }),
    orderEntity('18492', '2026-09-29T11:40:00Z', 'BLOCKED', 'ON_HOLD', {
      amount: '12480.00',
      currency: USD,
      holdReason: 'Payment not cleared',
    }),
  );
  entities.push({
    type: 'Order',
    sourceSystem: 'ERP',
    sourceId: 'SO-18492',
    displayName: 'Order #18492',
    observedAt: '2026-09-29T09:20:00Z',
    state: 'PENDING',
    sourceStatus: 'OPEN',
    entityRef: { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
    attributes: { amount: '12480.00', currency: USD, erpSalesOrder: 'SO-18492' },
  });
  entities.push({
    type: 'Payment',
    sourceSystem: PRIMARY_SYSTEM.Payment,
    sourceId: 'PAY-88213',
    displayName: 'Payment PAY-88213',
    observedAt: '2026-09-29T10:05:00Z',
    state: 'PENDING',
    sourceStatus: 'AWAITING_APPROVAL',
    attributes: { amount: '12480.00', currency: USD, method: 'Wire' },
  });
  entities.push({
    type: 'Approval',
    sourceSystem: PRIMARY_SYSTEM.Approval,
    sourceId: 'APR-2291',
    displayName: 'Finance approval APR-2291',
    observedAt: '2026-09-29T10:05:00Z',
    state: 'BLOCKED',
    sourceStatus: 'MISSING_BUDGET_CODE',
    attributes: { approvalType: 'Finance' },
  });
  entities.push({
    type: 'BudgetRequirement',
    sourceSystem: PRIMARY_SYSTEM.BudgetRequirement,
    sourceId: 'BR-18492',
    displayName: 'Budget code for Order #18492',
    observedAt: '2026-09-29T10:05:00Z',
    state: 'MISSING',
    sourceStatus: 'NOT_PROVIDED',
    attributes: { requiredField: 'budgetCode' },
  });
  entities.push({
    type: 'Invoice',
    sourceSystem: PRIMARY_SYSTEM.Invoice,
    sourceId: 'INV-55120',
    displayName: 'Invoice INV-55120',
    observedAt: '2026-09-29T09:20:00Z',
    state: 'PENDING',
    sourceStatus: 'DRAFT',
    attributes: { amount: '12480.00', currency: USD },
  });
  entities.push({
    type: 'Shipment',
    sourceSystem: PRIMARY_SYSTEM.Shipment,
    sourceId: 'SHP-77120',
    displayName: 'Shipment SHP-77120 (consolidated)',
    observedAt: AFFECTED_ORDERS_OBSERVED_AT,
    state: 'DELAYED',
    sourceStatus: 'HELD',
    attributes: {
      consolidated: true,
      carrier: 'FastFreight',
      plannedDeparture: '2026-09-29T16:00:00Z',
    },
  });
  entities.push({
    type: 'Shipment',
    sourceSystem: PRIMARY_SYSTEM.Shipment,
    sourceId: 'SHP-77098',
    displayName: 'Shipment SHP-77098',
    observedAt: '2026-09-26T16:00:00Z',
    state: 'COMPLETED',
    sourceStatus: 'DELIVERED',
    attributes: { carrier: 'FastFreight' },
  });
  entities.push({
    type: 'Shipment',
    sourceSystem: PRIMARY_SYSTEM.Shipment,
    sourceId: 'SHP-77125',
    displayName: 'Shipment SHP-77125',
    observedAt: '2026-09-29T12:00:00Z',
    state: 'ACTIVE',
    sourceStatus: 'IN_TRANSIT',
    attributes: { carrier: 'FastFreight' },
  });

  for (const order of ALL_ORDERS) {
    if (order.sourceId === '18492') {
      continue;
    }
    entities.push(
      orderEntity(order.sourceId, order.observedAt, order.state, order.sourceStatus, {
        amount: order.amount,
        currency: USD,
      }),
    );
  }

  return entities;
}

function relationship(
  type: RelationshipType,
  sourceSystem: string,
  from: EntityKeyRef,
  to: EntityKeyRef,
  options?: { origin?: RelationshipOrigin; confidence?: Confidence; basis?: string },
): RelationshipImportRowInput {
  const row: RelationshipImportRowInput = {
    type,
    sourceSystem,
    sourceId: `${type}:${from.sourceId}:${to.sourceId}`,
    from,
    to,
    origin: options?.origin ?? 'SOURCE',
    confidence: options?.confidence ?? 'HIGH',
    observedAt: RELATIONSHIP_OBSERVED_AT,
  };
  return options?.basis === undefined ? row : { ...row, basis: options.basis };
}

function buildRelationships(): RelationshipImportRowInput[] {
  const relationships: RelationshipImportRowInput[] = [];

  for (const customer of CUSTOMERS) {
    relationships.push(
      relationship(
        'HAS',
        'CRM',
        ref('Customer', customer.sourceId),
        ref('Contract', customer.contractId),
      ),
    );
  }

  for (const customer of CUSTOMERS) {
    for (const order of ALL_ORDERS) {
      if (order.customerId !== customer.sourceId) {
        continue;
      }
      relationships.push(
        relationship(
          'PLACED',
          'OMS',
          ref('Customer', customer.sourceId),
          ref('Order', order.sourceId),
        ),
      );
    }
  }

  for (const customer of CUSTOMERS) {
    for (const order of ALL_ORDERS) {
      if (order.customerId !== customer.sourceId) {
        continue;
      }
      relationships.push(
        relationship(
          'GOVERNS',
          'ContractMgmt',
          ref('Contract', customer.contractId),
          ref('Order', order.sourceId),
        ),
      );
    }
  }

  for (const customer of CUSTOMERS) {
    relationships.push(
      relationship(
        'DEFINES',
        'ContractMgmt',
        ref('Contract', customer.contractId),
        ref('SLA', customer.slaId),
      ),
    );
  }

  relationships.push(
    relationship(
      'DEFINES',
      'ContractMgmt',
      ref('Contract', 'CON-3982'),
      ref('BudgetRequirement', 'BR-18492'),
    ),
    relationship('CONTAINS', 'OMS', ref('Order', '18492'), ref('Product', 'PRD-5521')),
    relationship('SUPPLIED_BY', 'PIM', ref('Product', 'PRD-5521'), ref('Supplier', 'SUP-310')),
  );
  relationships.push(
    relationship(
      'SUPPLIED_BY',
      'InferenceRules',
      ref('Product', 'PRD-5521'),
      ref('Supplier', 'SUP-322'),
      {
        origin: 'INFERRED',
        confidence: 'LOW',
        basis: 'Alternate supplier inferred from 2026 purchase-order history',
      },
    ),
  );
  relationships.push(
    relationship('GENERATES', 'ERP', ref('Order', '18492'), ref('Invoice', 'INV-55120')),
    relationship('REQUIRES', 'Payments', ref('Order', '18492'), ref('Payment', 'PAY-88213')),
    relationship(
      'REQUIRES',
      'FinanceApprovals',
      ref('Payment', 'PAY-88213'),
      ref('Approval', 'APR-2291'),
    ),
    relationship(
      'REQUIRES',
      'FinanceApprovals',
      ref('Approval', 'APR-2291'),
      ref('BudgetRequirement', 'BR-18492'),
    ),
    relationship('DEPENDS_ON', 'TMS', ref('Shipment', 'SHP-77120'), ref('Order', '18492')),
  );

  for (const order of ALL_ORDERS) {
    if (order.sourceId === '18492' || !order.affected) {
      continue;
    }
    relationships.push(
      relationship('DEPENDS_ON', 'TMS', ref('Order', order.sourceId), ref('Shipment', 'SHP-77120')),
    );
  }

  relationships.push(
    relationship('DEPENDS_ON', 'TMS', ref('Order', '18530'), ref('Shipment', 'SHP-77098')),
    relationship('DEPENDS_ON', 'TMS', ref('Order', '18531'), ref('Shipment', 'SHP-77125')),
  );

  for (const order of ALL_ORDERS) {
    if (!order.affected) {
      continue;
    }
    relationships.push(
      relationship(
        'FULFILLED_BY',
        'WMS',
        ref('Order', order.sourceId),
        ref('Warehouse', 'WH-EAST-02'),
      ),
    );
  }

  relationships.push(
    relationship('FULFILLED_BY', 'WMS', ref('Order', '18530'), ref('Warehouse', 'WH-WEST-01')),
    relationship('FULFILLED_BY', 'WMS', ref('Order', '18531'), ref('Warehouse', 'WH-WEST-01')),
    relationship(
      'FULFILLED_BY',
      'TMS',
      ref('Shipment', 'SHP-77120'),
      ref('Warehouse', 'WH-EAST-02'),
    ),
    relationship(
      'FULFILLED_BY',
      'TMS',
      ref('Shipment', 'SHP-77098'),
      ref('Warehouse', 'WH-WEST-01'),
    ),
    relationship(
      'FULFILLED_BY',
      'TMS',
      ref('Shipment', 'SHP-77125'),
      ref('Warehouse', 'WH-WEST-01'),
    ),
  );

  for (const customer of CUSTOMERS) {
    relationships.push(
      relationship(
        'DEPENDS_ON',
        'InferenceRules',
        ref('SLA', customer.slaId),
        ref('Shipment', 'SHP-77120'),
        {
          origin: 'INFERRED',
          confidence: 'MEDIUM',
          basis: "SLA measures on-time delivery of the customer's orders on this shipment",
        },
      ),
    );
  }

  relationships.push(
    relationship(
      'BLOCKS',
      'ManualEntry',
      ref('Payment', 'PAY-88213'),
      ref('Shipment', 'SHP-77120'),
      {
        origin: 'MANUAL',
        confidence: 'MEDIUM',
        basis:
          'Recorded by ops analyst: carrier will not book the consolidated load until payment clears',
      },
    ),
  );

  return relationships;
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
  return [
    event(
      'OMS',
      'EVT-OMS-1001',
      'order.created',
      '2026-09-29T09:12:00Z',
      ref('Order', '18492'),
      [ref('Customer', 'CUST-1001'), ref('Contract', 'CON-3982')],
      'Order #18492 created for 12,480.00 USD',
    ),
    event(
      'Payments',
      'EVT-PAY-2001',
      'payment.initiated',
      '2026-09-29T09:14:00Z',
      ref('Payment', 'PAY-88213'),
      [ref('Order', '18492')],
      'Wire payment initiated',
    ),
    event(
      'FinanceApprovals',
      'EVT-FA-3001',
      'approval.requested',
      '2026-09-29T10:03:00Z',
      ref('Approval', 'APR-2291'),
      [ref('Payment', 'PAY-88213'), ref('Contract', 'CON-3982')],
      'Contract CON-3982 requires finance approval above 10,000.00 USD',
    ),
    event(
      'FinanceApprovals',
      'EVT-FA-3002',
      'approval.blocked',
      '2026-09-29T10:05:00Z',
      ref('Approval', 'APR-2291'),
      [ref('BudgetRequirement', 'BR-18492')],
      'Approval cannot proceed: required budget code is missing',
    ),
    event(
      'FinanceApprovals',
      'EVT-FA-3003',
      'finance.notified',
      '2026-09-29T10:22:00Z',
      ref('Approval', 'APR-2291'),
      [],
      'Finance team notified of missing budget code',
    ),
    event(
      'WMS',
      'EVT-WMS-4001',
      'warehouse.fulfillment_held',
      '2026-09-29T11:40:00Z',
      ref('Order', '18492'),
      [ref('Warehouse', 'WH-EAST-02')],
      'Fulfillment not started: order not released',
    ),
    event(
      'TMS',
      'EVT-TMS-5001',
      'shipment.delayed',
      '2026-09-29T14:32:00Z',
      ref('Shipment', 'SHP-77120'),
      [ref('Order', '18492')],
      'Consolidated load held: Order #18492 not released',
    ),
    event(
      'ContractMgmt',
      'EVT-CLM-6001',
      'sla.at_risk',
      '2026-09-29T15:10:00Z',
      ref('SLA', 'SLA-3982-DEL'),
      [ref('Shipment', 'SHP-77120')],
      'Delivery SLA approaching threshold',
    ),
    event(
      'TMS',
      'EVT-TMS-5002',
      'shipment.delivered',
      '2026-09-26T16:00:00Z',
      ref('Shipment', 'SHP-77098'),
      [ref('Order', '18530')],
      'Delivered',
    ),
    event(
      'TMS',
      'EVT-TMS-5003',
      'shipment.departed',
      '2026-09-29T12:00:00Z',
      ref('Shipment', 'SHP-77125'),
      [ref('Order', '18531')],
      'Departed West Distribution Center 01',
    ),
  ];
}

export function buildScenario39Document(): ImportDocument {
  return {
    entities: buildEntities(),
    relationships: buildRelationships(),
    events: buildEvents(),
  };
}
