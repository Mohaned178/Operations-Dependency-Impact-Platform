# Seed Scenario: Product Overview §39 (Acme Corp / Order #18492)

`apps/api/src/ingestion/seed/scenario-39.ts` → `buildScenario39Document()` MUST produce **exactly** the rows below, in the order given: entities, then relationships, then events. Do not add, remove or change any of them. Later features (003 tracing, 005 root cause, 006 impact) use this dataset as their acceptance fixture.

All timestamps are UTC. Use helper functions to avoid repetition, but the output must match these tables.

## Source systems

| Name | Meaning |
|---|---|
| `CRM` | Customer master |
| `ContractMgmt` | Contracts and SLAs |
| `OMS` | Order management |
| `ERP` | Finance / ERP |
| `Payments` | Payment processing |
| `FinanceApprovals` | Finance approval workflow |
| `WMS` | Warehouse management |
| `TMS` | Transport management |
| `PIM` | Product and supplier master |
| `InferenceRules` | Relationships inferred by rule (origin INFERRED) |
| `ManualEntry` | Relationships asserted by an operator (origin MANUAL) |

## Entities: 44 entities from 48 rows

### Master data

All rows in this table have `observedAt = 2026-09-01T08:00:00Z` and state `ACTIVE`, with `sourceStatus` omitted.

| # | type | sourceSystem | sourceId | displayName | attributes |
|---|---|---|---|---|---|
| 1 | Customer | CRM | CUST-1001 | Acme Corp | `{ "segment": "Enterprise" }` |
| 2 | Customer | CRM | CUST-1002 | Globex Retail | `{ "segment": "Enterprise" }` |
| 3 | Customer | CRM | CUST-1003 | Initech Supplies | `{ "segment": "Mid-market" }` |
| 4 | Customer | CRM | CUST-1004 | Umbrella Logistics | `{ "segment": "Mid-market" }` |
| 5 | Contract | ContractMgmt | CON-3982 | Contract CON-3982 | `{ "approvalThreshold": { "amount": "10000.00", "currency": "USD" }, "clause": "Orders above 10,000.00 USD require finance approval with a budget code" }` |
| 6 | Contract | ContractMgmt | CON-4107 | Contract CON-4107 | `{}` |
| 7 | Contract | ContractMgmt | CON-4215 | Contract CON-4215 | `{}` |
| 8 | Contract | ContractMgmt | CON-4330 | Contract CON-4330 | `{}` |
| 9 | Warehouse | WMS | WH-EAST-02 | East Distribution Center 02 | `{ "region": "US-East" }` |
| 10 | Warehouse | WMS | WH-WEST-01 | West Distribution Center 01 | `{ "region": "US-West" }` |
| 11 | Product | PIM | PRD-5521 | Industrial Pallet Racking Kit | `{ "sku": "PRD-5521" }` |
| 12 | Supplier | PIM | SUP-310 | Northwind Steel | `{}` |
| 13 | Supplier | PIM | SUP-322 | Contoso Metals | `{}` |

### Second source for Acme Corp

This row sets `entityRef`, which attaches it to row 1.

| # | type | sourceSystem | sourceId | displayName | observedAt | state / sourceStatus | entityRef | attributes |
|---|---|---|---|---|---|---|---|---|
| 14 | Customer | ERP | AC-778 | ACME CORPORATION | 2026-08-15T08:00:00Z | ACTIVE / `A` | `{ "entityType": "Customer", "sourceSystem": "CRM", "sourceId": "CUST-1001" }` | `{ "erpAccount": "AC-778", "paymentTerms": "NET30" }` |

Because row 14 is older than row 1, Acme's display name stays "Acme Corp".

### SLAs

All rows have `observedAt = 2026-09-29T15:10:00Z`.

| # | sourceId | displayName | state | attributes |
|---|---|---|---|---|
| 15 | SLA-3982-DEL | Acme Corp delivery SLA | AT_RISK | `{ "metric": "on-time delivery", "dueBy": "2026-10-02T17:00:00Z" }` |
| 16 | SLA-4107-DEL | Globex Retail delivery SLA | AT_RISK | `{ "metric": "on-time delivery", "dueBy": "2026-10-02T17:00:00Z" }` |
| 17 | SLA-4215-DEL | Initech Supplies delivery SLA | AT_RISK | `{ "metric": "on-time delivery", "dueBy": "2026-10-03T17:00:00Z" }` |
| 18 | SLA-4330-DEL | Umbrella Logistics delivery SLA | ACTIVE | `{ "metric": "on-time delivery", "dueBy": "2026-10-09T17:00:00Z" }` |

Every SLA row has type `SLA` and source system `ContractMgmt`.

### The §39 chain

| # | type | sourceSystem | sourceId | displayName | observedAt | state / sourceStatus | attributes |
|---|---|---|---|---|---|---|---|
| 19 | Order | OMS | 18492 | Order #18492 | 2026-09-29T09:12:00Z | PENDING / `NEW` | `{ "amount": "12480.00", "currency": "USD" }` |
| 20 | Order | OMS | 18492 | Order #18492 | 2026-09-29T09:14:00Z | WAITING / `AWAITING_PAYMENT` | `{ "amount": "12480.00", "currency": "USD" }` |
| 21 | Order | OMS | 18492 | Order #18492 | 2026-09-29T11:40:00Z | BLOCKED / `ON_HOLD` | `{ "amount": "12480.00", "currency": "USD", "holdReason": "Payment not cleared" }` |
| 22 | Order | ERP | SO-18492 | Order #18492 | 2026-09-29T09:20:00Z | PENDING / `OPEN` | `{ "amount": "12480.00", "currency": "USD", "erpSalesOrder": "SO-18492" }` |
| 23 | Payment | Payments | PAY-88213 | Payment PAY-88213 | 2026-09-29T10:05:00Z | PENDING / `AWAITING_APPROVAL` | `{ "amount": "12480.00", "currency": "USD", "method": "Wire" }` |
| 24 | Approval | FinanceApprovals | APR-2291 | Finance approval APR-2291 | 2026-09-29T10:05:00Z | BLOCKED / `MISSING_BUDGET_CODE` | `{ "approvalType": "Finance" }` |
| 25 | BudgetRequirement | FinanceApprovals | BR-18492 | Budget code for Order #18492 | 2026-09-29T10:05:00Z | MISSING / `NOT_PROVIDED` | `{ "requiredField": "budgetCode" }` |
| 26 | Invoice | ERP | INV-55120 | Invoice INV-55120 | 2026-09-29T09:20:00Z | PENDING / `DRAFT` | `{ "amount": "12480.00", "currency": "USD" }` |
| 27 | Shipment | TMS | SHP-77120 | Shipment SHP-77120 (consolidated) | 2026-09-29T14:32:00Z | DELAYED / `HELD` | `{ "consolidated": true, "carrier": "FastFreight", "plannedDeparture": "2026-09-29T16:00:00Z" }` |
| 28 | Shipment | TMS | SHP-77098 | Shipment SHP-77098 | 2026-09-26T16:00:00Z | COMPLETED / `DELIVERED` | `{ "carrier": "FastFreight" }` |
| 29 | Shipment | TMS | SHP-77125 | Shipment SHP-77125 | 2026-09-29T12:00:00Z | ACTIVE / `IN_TRANSIT` | `{ "carrier": "FastFreight" }` |

Row 22 also sets `entityRef`, which attaches it to row 19's entity: `{ "entityType": "Order", "sourceSystem": "OMS", "sourceId": "18492" }`.

The resulting state of Order #18492:
- **Current state**: BLOCKED, from the OMS observation at 11:40.
- **Per-source latest**: OMS BLOCKED and ERP PENDING. This is the FR-017 demonstration.
- **State history**: 4 observations.

### The other orders

Every row in this table has:
- type `Order`, source system `OMS`, `displayName = "Order #<sourceId>"`;
- `attributes = { "amount": "<amount>", "currency": "USD" }`.

| # | sourceId | customer | amount | observedAt | state / sourceStatus | group |
|---|---|---|---|---|---|---|
| 30 | 18493 | CUST-1001 | 1250.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 31 | 18494 | CUST-1001 | 980.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 32 | 18495 | CUST-1001 | 1430.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 33 | 18496 | CUST-1001 | 1140.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 34 | 18501 | CUST-1002 | 1320.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 35 | 18502 | CUST-1002 | 1050.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 36 | 18503 | CUST-1002 | 1275.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 37 | 18504 | CUST-1002 | 990.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 38 | 18505 | CUST-1002 | 1165.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 39 | 18511 | CUST-1003 | 1480.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 40 | 18512 | CUST-1003 | 1210.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 41 | 18513 | CUST-1003 | 1060.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 42 | 18514 | CUST-1003 | 1350.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 43 | 18521 | CUST-1004 | 1060.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 44 | 18522 | CUST-1004 | 1090.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 45 | 18523 | CUST-1004 | 1070.00 | 2026-09-29T14:32:00Z | WAITING / `RELEASED` | affected |
| 46 | 18530 | CUST-1002 | 2340.00 | 2026-09-26T16:00:00Z | COMPLETED / `DELIVERED` | control |
| 47 | 18531 | CUST-1003 | 875.00 | 2026-09-29T12:00:00Z | ACTIVE / `IN_TRANSIT` | control |
| 48 | 18532 | CUST-1004 | 1615.00 | 2026-09-29T13:00:00Z | PENDING / `NEW` | control |

**Check:** affected orders (18492 plus rows 30–45) = 17 orders across 4 customers.
- **Per-customer totals**: Acme 12,480 + 4,800 = 17,280. Globex 5,800. Initech 5,100. Umbrella 3,220.
- **Sum**: **31,400.00 USD**.

The "customer" column is not a row field. It decides which customer and contract the order is linked to in the relationships below. Contract per customer: CUST-1001 → CON-3982, CUST-1002 → CON-4107, CUST-1003 → CON-4215, CUST-1004 → CON-4330.

## Relationships: 102 rows

Every relationship row uses these conventions:
- `sourceId = "<TYPE>:<fromSourceId>:<toSourceId>"`
- `observedAt = 2026-09-29T15:00:00Z`
- `from` and `to` are key refs `{ entityType, sourceSystem, sourceId }`, using the **primary** key of each entity:
  - Customer → CRM
  - Contract and SLA → ContractMgmt
  - Order → OMS
  - Payment → Payments
  - Approval and BudgetRequirement → FinanceApprovals
  - Invoice → ERP
  - Warehouse → WMS
  - Shipment → TMS
  - Product and Supplier → PIM

| Group | Type | sourceSystem | from → to | origin / confidence | basis | Count |
|---|---|---|---|---|---|---|
| R1 | HAS | CRM | each customer → its contract | SOURCE / HIGH | — | 4 |
| R2 | PLACED | OMS | customer → each of its orders (all 20 orders) | SOURCE / HIGH | — | 20 |
| R3 | GOVERNS | ContractMgmt | the customer's contract → each of its orders (all 20) | SOURCE / HIGH | — | 20 |
| R4 | DEFINES | ContractMgmt | each contract → its customer's SLA | SOURCE / HIGH | — | 4 |
| R5 | DEFINES | ContractMgmt | CON-3982 → BR-18492 | SOURCE / HIGH | — | 1 |
| R6 | CONTAINS | OMS | 18492 → PRD-5521 | SOURCE / HIGH | — | 1 |
| R7 | SUPPLIED_BY | PIM | PRD-5521 → SUP-310 | SOURCE / HIGH | — | 1 |
| R8 | SUPPLIED_BY | InferenceRules | PRD-5521 → SUP-322 | INFERRED / LOW | `Alternate supplier inferred from 2026 purchase-order history` | 1 |
| R9 | GENERATES | ERP | 18492 → INV-55120 | SOURCE / HIGH | — | 1 |
| R10 | REQUIRES | Payments | 18492 → PAY-88213 | SOURCE / HIGH | — | 1 |
| R11 | REQUIRES | FinanceApprovals | PAY-88213 → APR-2291 | SOURCE / HIGH | — | 1 |
| R12 | REQUIRES | FinanceApprovals | APR-2291 → BR-18492 | SOURCE / HIGH | — | 1 |
| R13 | DEPENDS_ON | TMS | SHP-77120 → 18492 | SOURCE / HIGH | — | 1 |
| R14 | DEPENDS_ON | TMS | each affected order except 18492 (rows 30–45) → SHP-77120 | SOURCE / HIGH | — | 16 |
| R15 | DEPENDS_ON | TMS | 18530 → SHP-77098; 18531 → SHP-77125 | SOURCE / HIGH | — | 2 |
| R16 | FULFILLED_BY | WMS | each of the 17 affected orders → WH-EAST-02 | SOURCE / HIGH | — | 17 |
| R17 | FULFILLED_BY | WMS | 18530 → WH-WEST-01; 18531 → WH-WEST-01 | SOURCE / HIGH | — | 2 |
| R18 | FULFILLED_BY | TMS | SHP-77120 → WH-EAST-02; SHP-77098 → WH-WEST-01; SHP-77125 → WH-WEST-01 | SOURCE / HIGH | — | 3 |
| R19 | DEPENDS_ON | InferenceRules | each of the 4 SLAs → SHP-77120 | INFERRED / MEDIUM | `SLA measures on-time delivery of the customer's orders on this shipment` | 4 |
| R20 | BLOCKS | ManualEntry | PAY-88213 → SHP-77120 | MANUAL / MEDIUM | `Recorded by ops analyst: carrier will not book the consolidated load until payment clears` | 1 |

**Total: 102.**
- **Coverage**: SOURCE, INFERRED and MANUAL origins; HIGH, MEDIUM and LOW confidence (FR-041).
- **Order 18532**: it has no shipment and no warehouse yet. It still has its PLACED and GOVERNS relationships.

### Dependency check (verified by a unit test)

Follow the dependency relationships backwards from BR-18492. "A REQUIRES B" and "A DEPENDS_ON B" mean A depends on B. "A BLOCKS B" means B depends on A.

1. BR-18492 ← APR-2291
2. ← PAY-88213
3. ← 18492 (REQUIRES), and SHP-77120 (through BLOCKS)
4. ← SHP-77120 (DEPENDS_ON 18492)
5. ← the 16 orders in R14, and the 4 SLAs in R19

The result:
- **Orders reached**: 17, from 4 customers through PLACED, totalling 31,400.00 USD.
- **SLAs reached**: 4, of which 3 are AT_RISK.
- **Control orders 18530, 18531 and 18532**: not reached.

## Events: 10 rows

Each event's `observedAt` is its `occurredAt` plus 1 minute. Subjects and related entities are key refs, using the same primary keys as the relationships.

| # | sourceSystem | sourceId | type | occurredAt | subject | related | description |
|---|---|---|---|---|---|---|---|
| E1 | OMS | EVT-OMS-1001 | order.created | 2026-09-29T09:12:00Z | Order 18492 | CUST-1001, CON-3982 | `Order #18492 created for 12,480.00 USD` |
| E2 | Payments | EVT-PAY-2001 | payment.initiated | 2026-09-29T09:14:00Z | PAY-88213 | Order 18492 | `Wire payment initiated` |
| E3 | FinanceApprovals | EVT-FA-3001 | approval.requested | 2026-09-29T10:03:00Z | APR-2291 | PAY-88213, CON-3982 | `Contract CON-3982 requires finance approval above 10,000.00 USD` |
| E4 | FinanceApprovals | EVT-FA-3002 | approval.blocked | 2026-09-29T10:05:00Z | APR-2291 | BR-18492 | `Approval cannot proceed: required budget code is missing` |
| E5 | FinanceApprovals | EVT-FA-3003 | finance.notified | 2026-09-29T10:22:00Z | APR-2291 | — | `Finance team notified of missing budget code` |
| E6 | WMS | EVT-WMS-4001 | warehouse.fulfillment_held | 2026-09-29T11:40:00Z | Order 18492 | WH-EAST-02 | `Fulfillment not started: order not released` |
| E7 | TMS | EVT-TMS-5001 | shipment.delayed | 2026-09-29T14:32:00Z | SHP-77120 | Order 18492 | `Consolidated load held: Order #18492 not released` |
| E8 | ContractMgmt | EVT-CLM-6001 | sla.at_risk | 2026-09-29T15:10:00Z | SLA-3982-DEL | SHP-77120 | `Delivery SLA approaching threshold` |
| E9 | TMS | EVT-TMS-5002 | shipment.delivered | 2026-09-26T16:00:00Z | SHP-77098 | Order 18530 | `Delivered` |
| E10 | TMS | EVT-TMS-5003 | shipment.departed | 2026-09-29T12:00:00Z | SHP-77125 | Order 18531 | `Departed West Distribution Center 01` |

## Required tests for this dataset

1. **`scenario-39.spec.ts`** (unit, no DB):
   - every row passes its shared row schema;
   - the counts are 48 entity rows, 44 distinct entity keys after `entityRef` resolution, 102 relationships and 10 events;
   - the in-memory reverse-dependency walk above gives 17 orders, 4 customers, 31,400.00 USD, 4 SLAs and 3 AT_RISK, and excludes the 3 control orders;
   - every relationship satisfies `RELATIONSHIP_RULES`.

   This walk is test-only code over the fixture document, not production traversal.
2. **`seed.e2e-spec.ts`**:
   - after `SeedService.seedScenario39()`, the DB has 44 entities, 46 identifiers (44 primary keys plus ERP AC-778 and ERP SO-18492), 160 source records, 48 state observations, 102 relationships and 10 events;
   - Order #18492 has current state BLOCKED, 4 state observations, and per-source latest OMS BLOCKED / ERP PENDING;
   - a second run creates no new rows of any kind and no new audit entries;
   - every source record, state observation, relationship and event has a non-null source system, source id, observed time and import id (SC-002).
