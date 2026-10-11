# Seed Scenario: Product Overview §40 (Supplier failure, "Supplier X unavailable")

`apps/api/src/ingestion/seed/scenario-40.ts` → `buildScenario40Document()` MUST produce **exactly** the rows below, in the order given: entities, then relationships, then events. Do not add, remove or change any of them. This dataset is the acceptance fixture for spec Story 1 (fixtures I1 to I5 in contracts/api.md).

The dataset shares **no** entity key with the §39 dataset (`specs/002-operational-graph-model/seed-scenario.md`), and no relationship touches a §39 entity. All timestamps are UTC. Use helper functions to avoid repetition, but the output must match these tables.

## Conventions

- **Primary key per type**: Supplier and Product use `PIM`, PurchaseOrder uses `ERP`, Customer uses `CRM`, Contract and SLA use `ContractMgmt`, Order uses `OMS`, and Shipment uses `TMS`.
- **Relationship rows**:
  - `sourceId = "<TYPE>:<fromSourceId>:<toSourceId>"`;
  - `observedAt = 2026-10-05T12:00:00Z`;
  - `sourceSystem` is the primary system of the `from` entity, except for INFERRED rows, which use `InferenceRules`;
  - `from` and `to` are key refs `{ entityType, sourceSystem, sourceId }` using the primary keys above.
- **Order attributes**: every Order row has `attributes = { "amount": "<amount>", "currency": "USD" }`.

## Entities: 47 rows, 47 entities

### Master data

Every row has `observedAt = 2026-09-01T08:00:00Z` and state `ACTIVE`, with `sourceStatus` omitted.

| # | type | sourceId | displayName | attributes |
|---|---|---|---|---|
| 1 | Supplier | SUP-410 | Tailspin Parts | `{}` |
| 2 | Product | PRD-6101 | Hydraulic Pump Assembly | `{ "sku": "PRD-6101" }` |
| 3 | Product | PRD-6102 | Steel Mounting Bracket | `{ "sku": "PRD-6102" }` |
| 4 | Product | PRD-6103 | Control Valve Kit | `{ "sku": "PRD-6103" }` |
| 5 | Product | PRD-6104 | Pressure Sensor Module | `{ "sku": "PRD-6104" }` |
| 6 | Product | PRD-6105 | Rubber Seal Pack | `{ "sku": "PRD-6105" }` |
| 7 | Customer | CUST-2001 | Blue Yonder Machinery | `{ "segment": "Enterprise" }` |
| 8 | Customer | CUST-2002 | Woodgrove Manufacturing | `{ "segment": "Enterprise" }` |
| 9 | Customer | CUST-2003 | Litware Industrial | `{ "segment": "Mid-market" }` |
| 10 | Customer | CUST-2004 | Proseware Systems | `{ "segment": "Mid-market" }` |
| 11 | Customer | CUST-2005 | Adventure Works Supply | `{ "segment": "Mid-market" }` |
| 12 | Contract | CON-5001 | Contract CON-5001 | `{}` |
| 13 | Contract | CON-5002 | Contract CON-5002 | `{}` |
| 14 | Contract | CON-5003 | Contract CON-5003 | `{}` |
| 15 | Contract | CON-5004 | Contract CON-5004 | `{}` |
| 16 | Contract | CON-5005 | Contract CON-5005 | `{}` |

### Supplier X

| # | type | sourceId | displayName | observedAt | state / sourceStatus | attributes |
|---|---|---|---|---|---|---|
| 17 | Supplier | SUP-400 | Fabrikam Components | 2026-10-05T07:30:00Z | SUSPENDED / `UNAVAILABLE` | `{ "unavailableSince": "2026-10-05T07:30:00Z" }` |

### Purchase orders

Every row has type `PurchaseOrder` and source system `ERP`. `displayName = "Purchase order <sourceId>"`.

| # | sourceId | supplier | observedAt | state / sourceStatus | attributes |
|---|---|---|---|---|---|
| 18 | PO-7001 | SUP-400 | 2026-10-05T09:00:00Z | DELAYED / `SUPPLIER_DELAY` | `{ "expectedDelivery": "2026-10-04" }` |
| 19 | PO-7002 | SUP-400 | 2026-10-05T09:00:00Z | DELAYED / `SUPPLIER_DELAY` | `{ "expectedDelivery": "2026-10-05" }` |
| 20 | PO-7003 | SUP-400 | 2026-10-05T09:00:00Z | DELAYED / `SUPPLIER_DELAY` | `{ "expectedDelivery": "2026-10-06" }` |
| 21 | PO-7004 | SUP-400 | 2026-10-01T10:00:00Z | ACTIVE / `OPEN` | `{ "expectedDelivery": "2026-10-14" }` |
| 22 | PO-7005 | SUP-400 | 2026-10-01T10:00:00Z | ACTIVE / `OPEN` | `{ "expectedDelivery": "2026-10-16" }` |
| 23 | PO-7006 | SUP-400 | 2026-09-28T14:00:00Z | COMPLETED / `RECEIVED` | `{ "expectedDelivery": "2026-09-28" }` |
| 24 | PO-7010 | SUP-410 | 2026-10-01T10:00:00Z | ACTIVE / `OPEN` | `{ "expectedDelivery": "2026-10-12" }` |

### SLAs

Every row has type `SLA` and source system `ContractMgmt`, and `attributes = { "metric": "on-time delivery", "dueBy": "<dueBy>" }`.

| # | sourceId | displayName | observedAt | state | dueBy |
|---|---|---|---|---|---|
| 25 | SLA-5001-DEL | Blue Yonder Machinery delivery SLA | 2026-10-05T12:00:00Z | AT_RISK | 2026-10-08T17:00:00Z |
| 26 | SLA-5002-DEL | Woodgrove Manufacturing delivery SLA | 2026-10-05T12:00:00Z | AT_RISK | 2026-10-09T17:00:00Z |
| 27 | SLA-5004-DEL | Proseware Systems delivery SLA | 2026-10-01T08:00:00Z | ACTIVE | 2026-10-20T17:00:00Z |
| 28 | SLA-5005-DEL | Adventure Works Supply delivery SLA | 2026-10-01T08:00:00Z | ACTIVE | 2026-10-22T17:00:00Z |

`sourceStatus` is omitted for SLAs.

### Customer orders

Every row has type `Order`, source system `OMS` and `displayName = "Order <sourceId>"`.

| # | sourceId | customer | amount | observedAt | state / sourceStatus | group |
|---|---|---|---|---|---|---|
| 29 | SO-20401 | CUST-2001 | 9800.00 | 2026-10-05T10:00:00Z | WAITING / `BACKORDERED` | current |
| 30 | SO-20402 | CUST-2001 | 12400.00 | 2026-10-05T10:00:00Z | WAITING / `BACKORDERED` | current |
| 31 | SO-20403 | CUST-2002 | 7250.00 | 2026-10-05T10:00:00Z | WAITING / `BACKORDERED` | current |
| 32 | SO-20404 | CUST-2002 | 10600.00 | 2026-10-05T10:00:00Z | WAITING / `BACKORDERED` | current |
| 33 | SO-20405 | CUST-2003 | 5900.00 | 2026-10-05T10:00:00Z | WAITING / `BACKORDERED` | current |
| 34 | SO-20406 | CUST-2003 | 5300.00 | 2026-10-05T10:00:00Z | WAITING / `BACKORDERED` | current |
| 35 | SO-20407 | CUST-2001 | 6150.00 | 2026-10-02T09:00:00Z | ACTIVE / `OPEN` | potential |
| 36 | SO-20408 | CUST-2002 | 4800.00 | 2026-10-04T12:00:00Z | PENDING / `NEW` | potential (impaired for another reason) |
| 37 | SO-20409 | CUST-2004 | 7900.00 | 2026-10-02T09:00:00Z | ACTIVE / `OPEN` | potential |
| 38 | SO-20410 | CUST-2004 | 5600.00 | 2026-10-02T09:00:00Z | ACTIVE / `OPEN` | potential |
| 39 | SO-20411 | CUST-2004 | 2400.00 | 2026-10-02T09:00:00Z | ACTIVE / `OPEN` | potential, inferred only |
| 40 | SO-20412 | CUST-2003 | 5900.00 | 2026-10-02T09:00:00Z | ACTIVE / `OPEN` | potential |
| 41 | SO-20413 | CUST-2001 | 3100.00 | 2026-09-30T16:00:00Z | COMPLETED / `DELIVERED` | not counted |
| 42 | SO-20414 | CUST-2005 | 4200.00 | 2026-10-02T09:00:00Z | ACTIVE / `OPEN` | control |
| 43 | SO-20415 | CUST-2002 | 1750.00 | 2026-10-02T09:00:00Z | ACTIVE / `OPEN` | control |

The "customer" column is not a row field. It decides the PLACED and GOVERNS relationships below. Each customer CUST-200n has contract CON-500n.

**Checks**:
- **Current**: 9,800 + 12,400 + 7,250 + 10,600 + 5,900 + 5,300 = **51,250.00 USD**.
- **Potential**: 6,150 + 4,800 + 7,900 + 5,600 + 2,400 + 5,900 = **32,750.00 USD**.
- **Total**: **84,000.00 USD** from 12 orders.

### Shipments

Every row has type `Shipment` and source system `TMS`. `displayName = "Shipment <sourceId>"` and `attributes = { "carrier": "FastFreight" }`.

| # | sourceId | observedAt | state / sourceStatus |
|---|---|---|---|
| 44 | SHP-8001 | 2026-10-05T11:00:00Z | DELAYED / `HELD` |
| 45 | SHP-8002 | 2026-10-05T11:00:00Z | DELAYED / `HELD` |
| 46 | SHP-8003 | 2026-10-03T08:00:00Z | ACTIVE / `PLANNED` |
| 47 | SHP-8009 | 2026-10-03T08:00:00Z | ACTIVE / `PLANNED` |

## Relationships: 97 rows

All rows are SOURCE / HIGH with no basis, except S3 and S10.

| Group | Type | from → to | Count |
|---|---|---|---|
| S1 | SUPPLIED_BY | PRD-6101, PRD-6102, PRD-6103 → SUP-400 | 3 |
| S2 | SUPPLIED_BY | PRD-6104 → SUP-410; PRD-6105 → SUP-410 | 2 |
| S3 | SUPPLIED_BY | PRD-6104 → SUP-400, **INFERRED / LOW**, source system `InferenceRules`, basis `Alternate supplier inferred from 2026 purchase-order history` | 1 |
| S4 | SUPPLIED_BY | PO-7001 … PO-7006 → SUP-400; PO-7010 → SUP-410 | 7 |
| S5 | CONTAINS | PO-7001 → PRD-6101; PO-7002 → PRD-6102; PO-7003 → PRD-6101; PO-7003 → PRD-6103; PO-7004 → PRD-6102; PO-7005 → PRD-6103; PO-7006 → PRD-6101; PO-7010 → PRD-6105 | 8 |
| S6 | CONTAINS | SO-20401 → PRD-6101; SO-20402 → PRD-6101; SO-20402 → PRD-6103; SO-20403 → PRD-6102; SO-20404 → PRD-6102; SO-20405 → PRD-6101; SO-20406 → PRD-6103; SO-20407 → PRD-6102; SO-20408 → PRD-6102; SO-20409 → PRD-6103; SO-20410 → PRD-6103; SO-20411 → PRD-6104; SO-20412 → PRD-6101; SO-20413 → PRD-6101; SO-20414 → PRD-6105; SO-20415 → PRD-6105 | 16 |
| S7 | DEPENDS_ON | SO-20401 → PO-7001; SO-20402 → PO-7003; SO-20403 → PO-7002; SO-20404 → PO-7002; SO-20404 → PO-7003; SO-20405 → PO-7001; SO-20406 → PO-7003; SO-20408 → PO-7004; SO-20410 → PO-7005; SO-20413 → PO-7006 | 10 |
| S8 | DEPENDS_ON | SHP-8001 → SO-20401, SO-20402; SHP-8002 → SO-20403, SO-20404; SHP-8003 → SO-20409, SO-20410; SHP-8009 → SO-20414 | 7 |
| S9 | DEPENDS_ON | SLA-5001-DEL → SHP-8001; SLA-5004-DEL → SHP-8003; SLA-5005-DEL → SHP-8009 | 3 |
| S10 | DEPENDS_ON | SLA-5002-DEL → SHP-8002, **INFERRED / MEDIUM**, source system `InferenceRules`, basis `SLA measures on-time delivery of the customer's orders on this shipment` | 1 |
| S11 | HAS | CUST-200n → CON-500n, for n = 1 to 5 | 5 |
| S12 | DEFINES | CON-5001 → SLA-5001-DEL; CON-5002 → SLA-5002-DEL; CON-5004 → SLA-5004-DEL; CON-5005 → SLA-5005-DEL | 4 |
| S13 | PLACED | each customer → each of its orders (all 15) | 15 |
| S14 | GOVERNS | each customer's contract → each of that customer's orders (all 15) | 15 |

**Total**: 3 + 2 + 1 + 7 + 8 + 16 + 10 + 7 + 3 + 1 + 5 + 4 + 15 + 15 = **97**.

Every row satisfies the extended `RELATIONSHIP_RULES` (research R10).

## Events: 9 rows

Each event's `observedAt` is its `occurredAt` plus 1 minute.

| # | sourceSystem | sourceId | type | occurredAt | subject | related | description |
|---|---|---|---|---|---|---|---|
| F1 | PIM | EVT-PIM-7001 | supplier.unavailable | 2026-10-05T07:30:00Z | SUP-400 | — | `Supplier reports a production stoppage; no shipments until further notice` |
| F2 | ERP | EVT-ERP-7101 | purchase_order.delayed | 2026-10-05T09:00:00Z | PO-7001 | SUP-400 | `Supplier confirmed delay; no ship date` |
| F3 | ERP | EVT-ERP-7102 | purchase_order.delayed | 2026-10-05T09:00:00Z | PO-7002 | SUP-400 | `Supplier confirmed delay; no ship date` |
| F4 | ERP | EVT-ERP-7103 | purchase_order.delayed | 2026-10-05T09:00:00Z | PO-7003 | SUP-400 | `Supplier confirmed delay; no ship date` |
| F5 | OMS | EVT-OMS-7201 | order.backordered | 2026-10-05T10:00:00Z | SO-20401 | PO-7001 | `Order backordered: inbound stock delayed` |
| F6 | TMS | EVT-TMS-7301 | shipment.delayed | 2026-10-05T11:00:00Z | SHP-8001 | SO-20401, SO-20402 | `Load held: backordered orders` |
| F7 | TMS | EVT-TMS-7302 | shipment.delayed | 2026-10-05T11:00:00Z | SHP-8002 | SO-20403, SO-20404 | `Load held: backordered orders` |
| F8 | ContractMgmt | EVT-CLM-7401 | sla.at_risk | 2026-10-05T12:00:00Z | SLA-5001-DEL | SHP-8001 | `Delivery SLA approaching threshold` |
| F9 | ContractMgmt | EVT-CLM-7402 | sla.at_risk | 2026-10-05T12:00:00Z | SLA-5002-DEL | SHP-8002 | `Delivery SLA approaching threshold` |

## Expected impact of Fabrikam Components (SUP-400) at depth 6

These values are verified twice:
- by `scenario-40.spec.ts`, with a test-only walk over the document (spec FR-031);
- by `impact-seed.e2e-spec.ts` through the API (fixtures I1 to I5).

| Category | Entities | Distance | Current | Potential | Inferred only | Not counted |
|---|---|---|---|---|---|---|
| Products (4) | PRD-6101, PRD-6102, PRD-6103, PRD-6104 | 1 | — | all 4 | PRD-6104 | — |
| Purchase orders (5) | PO-7001, PO-7002, PO-7003 | 1 | ✓ | | | PO-7006 (COMPLETED) |
| | PO-7004, PO-7005 | 1 | | ✓ | | |
| Customer orders (12) | SO-20401 … SO-20406 | 2 | ✓ | | | SO-20413 (COMPLETED) |
| | SO-20407 … SO-20412 | 2 | | ✓ | SO-20411 | |
| Customers (4) | CUST-2001, CUST-2002, CUST-2003 | — | ✓ | | | |
| | CUST-2004 | — | | ✓ | | |
| Shipments (3) | SHP-8001, SHP-8002 | 3 | ✓ | | | |
| | SHP-8003 | 3 | | ✓ | | |
| SLA commitments (3) | SLA-5001-DEL | 4 | ✓ | | | |
| | SLA-5002-DEL | 4 | ✓ | | ✓ (S10) | |
| | SLA-5004-DEL | 4 | | ✓ | | |

- **Flags**: SO-20408 (PENDING) is flagged `otherCause`. Its only paths run through PO-7004 (ACTIVE) or PRD-6102 (ACTIVE).
- **Multi-path orders**: a purchase order CONTAINS its product, so it depends on the product, and a downstream walk can reach a purchase order through its product as well as directly. Distinct path counts within depth 6:
  - **SO-20401: 3**: SUP-400 → PO-7001 → SO-20401; SUP-400 → PRD-6101 → SO-20401; SUP-400 → PRD-6101 → PO-7001 → SO-20401.
  - **SO-20402: 5**: three paths into PO-7003 (direct, through PRD-6101, through PRD-6103), each continuing to the order, plus SUP-400 → PRD-6101 → SO-20402 and SUP-400 → PRD-6103 → SO-20402.
  - **SO-20404: 6**: two paths into PO-7002 and three into PO-7003, each continuing to the order, plus SUP-400 → PRD-6102 → SO-20404.
  - **SO-20408: 3**: two paths into PO-7004, each continuing to the order, plus SUP-400 → PRD-6102 → SO-20408.
  - **SO-20411: 1**.

  Each order is counted once.
- **Primary paths**:
  - SO-20401 (current): the live path SUP-400 → PO-7001 → SO-20401. Its shortest path is the same path.
  - SO-20411: SUP-400 → PRD-6104 → SO-20411, whose first hop is INFERRED / LOW.
- **Exposure (USD)**:
  - total 84,000.00 (12 orders);
  - current 51,250.00 (6 orders);
  - potential 32,750.00 (6 orders);
  - inferred only 2,400.00 (potential).
  - No range, because no order has disagreeing values.
- **Not counted**: 2 (PO-7006, SO-20413). SO-20413's 3,100.00 is in no figure.
- **Never reached**: SUP-410, PRD-6105, PO-7010, SO-20414, SO-20415, SHP-8009, SLA-5005-DEL, CUST-2005, and all contracts.
- **Customer attribution**:
  - CUST-2001 through SO-20401, SO-20402, SO-20407 and SLA-5001-DEL;
  - CUST-2002 through SO-20403, SO-20404, SO-20408 and SLA-5002-DEL;
  - CUST-2003 through SO-20405, SO-20406 and SO-20412;
  - CUST-2004 through SO-20409, SO-20410, SO-20411 and SLA-5004-DEL.
- **Attributed exposure** (customer list order):

  | Customer | Attributed exposure |
  |---|---|
  | CUST-2001 | 28,350.00 |
  | CUST-2002 | 22,650.00 |
  | CUST-2003 | 17,100.00 |
  | CUST-2004 | 15,900.00 |

## Required tests for this dataset

1. **`scenario-40.spec.ts`** (unit, no DB):
   - every row passes its shared row schema;
   - the counts are 47 entity rows (47 distinct keys), 97 relationships and 9 events;
   - every relationship satisfies `RELATIONSHIP_RULES`;
   - no entity key appears in `buildScenario39Document()`;
   - a test-only walk reproduces the table above:
     - dependents per FR-002 of 003;
     - no expansion from COMPLETED or CANCELLED;
     - a live set over impaired states;
     - attribution through PLACED and HAS/DEFINES;
     - the bigint sums.

   This walk is test-only code over the fixture document, not production traversal.
2. **`seed.e2e-spec.ts`** gains a `seedScenario40` block:
   - after the seed, the database holds 47 more entities and 97 more relationships;
   - a second run creates no new rows and no new audit entries;
   - provenance is non-null on every row;
   - seeding 40 before or after 39 gives the same final counts.
