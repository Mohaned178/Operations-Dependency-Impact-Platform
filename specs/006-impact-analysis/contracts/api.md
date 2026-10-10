# API Contract: Impact Analysis

**Feature**: `006-impact-analysis` | **Date**: 2026-10-07

All schemas live in `@opsgraph/shared`:
- `packages/shared/src/impact.ts`;
- `packages/shared/src/money.ts`, which is new; its patterns are moved there from `imports.ts`.

Both are re-exported from `index.ts`. The backend validates every query with them, and the web app parses every response with them. `PathDtoSchema`, `TracedEntityDtoSchema`, `EntityRefDtoSchema`, `CycleClosingHopDtoSchema` and `TraceDepthSchema` are reused from `tracing.ts` and `graph.ts`, unchanged.

---

## Routes

| Method | Path | Roles | Success | Errors |
|---|---|---|---|---|
| GET | `/api/entities/:id/impact` | all signed-in | 200 `ImpactResponse` | 400 `VALIDATION_FAILED`, 401, 404 `NOT_FOUND` |
| GET | `/api/entities/:id/impact/items` | all signed-in | 200 `ImpactListResponse` | 400, 401, 404 |
| GET | `/api/entities/:id/impact/items/:targetId` | all signed-in | 200 `ImpactItemDetailResponse` | 400, 401, 404 (unknown entity, or target not in the analysis) |

- **Controller**: `ImpactController` (`@Controller('entities')`, in `apps/api/src/impact/`).
- **Validation**: path ids with `ParseUUIDPipe`, queries with `ZodValidationPipe`.
- **Writes**: none of the routes writes data or audit rows (spec FR-026).

---

## Query schemas

```ts
// impact.ts
export const ImpactQuerySchema = z.object({ depth: TraceDepthSchema });   // 1..10, default 6
export type ImpactQuery = z.infer<typeof ImpactQuerySchema>;

export const ImpactCategoryBucketSchema = z.enum(['total', 'direct', 'indirect', 'current', 'potential', 'inferredOnly', 'stateUnknown']);
export const ImpactExposureBucketSchema = z.enum(['total', 'current', 'potential', 'inferredOnly']);

export const ImpactListSelectorSchema = z.discriminatedUnion('list', [
  z.object({ list: z.literal('category'), type: EntityTypeSchema, bucket: ImpactCategoryBucketSchema }),
  z.object({ list: z.literal('exposure'), currency: CurrencyCodeSchema, bucket: ImpactExposureBucketSchema }),
  z.object({ list: z.literal('valueUnknown') }),
  z.object({ list: z.literal('notCounted'), type: EntityTypeSchema.nullable() }),
]);
export type ImpactListSelector = z.infer<typeof ImpactListSelectorSchema>;

/**
 * Flat query string → { depth, cursor?, limit, selector }.
 * Rules (each violation is one issue on the named path):
 * - list=category:     type and bucket (category bucket) required; currency forbidden
 * - list=exposure:     currency and bucket (exposure bucket) required; type forbidden
 * - list=valueUnknown: type, bucket and currency forbidden
 * - list=notCounted:   type optional; bucket and currency forbidden
 */
export const ImpactListQuerySchema = PageQuerySchema.extend({
  depth: TraceDepthSchema,
  list: z.enum(['category', 'exposure', 'valueUnknown', 'notCounted']),
  type: EntityTypeSchema.optional(),
  bucket: z.string().optional(),
  currency: CurrencyCodeSchema.optional(),
}).superRefine(/* rules above */).transform(/* → { depth, cursor, limit, selector } */);
export type ImpactListQuery = z.output<typeof ImpactListQuerySchema>;
```

The forbidden-field message is `"<field> is not allowed for list=<list>"`. A bucket that is not valid for the chosen list gives an issue on `bucket` listing the allowed values.

---

## Response schemas

```ts
export const ImpactClassificationSchema = z.enum(['CURRENT', 'POTENTIAL', 'NOT_COUNTED']);

export const ImpactQueryEchoSchema = z.object({ entityId: z.string().uuid(), depth: z.number().int() });

export const ImpactLimitsDtoSchema = z.object({
  depthLimit: z.boolean(),          // impact continues beyond the depth (CTE beyondDepth)
  explorationLimit: z.boolean(),    // 10,000-entity cap hit
  lowerBound: z.boolean(),          // depthLimit || explorationLimit
});

export const ImpactCategoryDtoSchema = z.object({
  type: EntityTypeSchema,
  label: z.string(),                // impactCategoryLabel(type), e.g. "Customer orders"
  headline: z.boolean(),
  total: z.number().int().min(0),
  direct: z.number().int().min(0),
  indirect: z.number().int().min(0),
  current: z.number().int().min(0),
  potential: z.number().int().min(0),
  inferredOnly: z.number().int().min(0),
  stateUnknown: z.number().int().min(0),
});

export const ExposureShareDtoSchema = z.object({ amount: AmountStringSchema, orderCount: z.number().int().min(0) });

export const ExposureFigureDtoSchema = z.object({
  currency: CurrencyCodeSchema,
  total: ExposureShareDtoSchema,
  current: ExposureShareDtoSchema,
  potential: ExposureShareDtoSchema,
  inferredOnly: z.object({ total: ExposureShareDtoSchema, current: ExposureShareDtoSchema, potential: ExposureShareDtoSchema }),
  disagreementOrderCount: z.number().int().min(0),
  range: z.object({ low: AmountStringSchema, high: AmountStringSchema }).nullable(),
});

export const ImpactResponseSchema = z.object({
  query: ImpactQueryEchoSchema,
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  startClass: ImpactStateClassSchema,
  /** Start's own value when it has a usable amount (Order, Payment, Invoice, or any entity with amount+currency). */
  startOwnValue: MoneyDtoSchema.nullable(),
  limits: ImpactLimitsDtoSchema,
  summary: z.array(z.string()).min(1),
  /** Counted entities over all categories, customers included. */
  countedTotal: z.number().int().min(0),
  /** 6 headline categories always, then other non-zero types by type name. */
  categories: z.array(ImpactCategoryDtoSchema).min(6),
  exposure: z.object({
    byCurrency: z.array(ExposureFigureDtoSchema),      // sorted by currency
    valueUnknownCount: z.number().int().min(0),
  }),
  notCounted: z.object({
    total: z.number().int().min(0),
    byType: z.array(z.object({ type: EntityTypeSchema, count: z.number().int().min(1) })),   // by type name
  }),
  cycleClosingHops: z.array(CycleClosingHopDtoSchema),
  cycleClosingHopCount: z.number().int().min(0),
});

export const OrderValueDtoSchema = z.object({
  current: MoneyDtoSchema.nullable(),
  bySource: z.array(z.object({
    sourceSystem: z.string(), sourceId: z.string(), observedAt: z.string().datetime(),
    amount: AmountStringSchema, currency: CurrencyCodeSchema,
  })),
  disagreement: z.boolean(),
  /** A source states the value in a currency other than the current one (research R6). */
  currencyMismatch: z.boolean(),
});

export const AttributionPreviewDtoSchema = z.object({
  entity: EntityRefDtoSchema,                 // the attributed Order or SLA
  classification: z.enum(['CURRENT', 'POTENTIAL']),
  link: PathDtoSchema,                        // UPSTREAM path: entity → customer (1 or 2 hops)
});

export const AffectedEntityDtoSchema = z.object({
  entity: TracedEntityDtoSchema,
  classification: ImpactClassificationSchema,
  notCountedReason: z.enum(['TERMINAL']).nullable(),
  directness: z.enum(['DIRECT', 'INDIRECT']),
  distance: z.number().int().min(1).nullable(),        // null: attributed-only customer
  primaryPath: PathDtoSchema.nullable(),                // null: attributed-only customer
  shortestPath: PathDtoSchema.nullable(),               // only when different from primaryPath
  pathCount: z.number().int().min(0),                   // "at least" when morePaths
  morePaths: z.boolean(),
  flags: z.object({ stateUnknown: z.boolean(), otherCause: z.boolean(), inferredOnly: z.boolean() }),
  weakest: z.object({ origin: RelationshipOriginSchema, confidence: ConfidenceSchema }).nullable(),
  value: OrderValueDtoSchema.nullable(),                // Orders only
  attributionCount: z.number().int().min(0),            // customers only, otherwise 0
  attributions: z.array(AttributionPreviewDtoSchema).max(5),
});

export const ImpactListResponseSchema = z.object({
  query: ImpactQueryEchoSchema.extend({ selector: ImpactListSelectorSchema }),
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  total: z.number().int().min(0),
  /** Exposure lists: the figure the list adds up to; otherwise null. */
  sum: MoneyDtoSchema.nullable(),
  items: z.array(AffectedEntityDtoSchema),
  nextCursor: z.string().nullable(),
});

export const AttributionDetailDtoSchema = AttributionPreviewDtoSchema.extend({
  primaryPath: PathDtoSchema,                  // the attributed entity's own impact path
});

export const ImpactItemDetailResponseSchema = z.object({
  query: ImpactQueryEchoSchema,
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  item: AffectedEntityDtoSchema,
  alternativePaths: z.array(PathDtoSchema).max(20),   // research R4
  attributions: z.array(AttributionDetailDtoSchema).max(200),
  attributionCount: z.number().int().min(0),
});
```

### Field rules

- **`weakest`**: the lowest `ORIGIN_RANK` and the lowest `CONFIDENCE_RANK` among the hops of `primaryPath`. It is computed independently per field, and is `null` when `primaryPath` is null.
- **`pathCount` and `morePaths`**:
  - from `trace.paths()`;
  - `pathCount = found.length`;
  - for attributed-only customers, `pathCount = 0` and `morePaths = false`.
- **`attributions`**:
  - in a **list item**, the first 5 in order: CURRENT first, then entity type, displayName, id;
  - in **detail**, the first 200 in the same order;
  - `attributionCount` is always the full number.
- **`alternativePaths`** (detail only): `found` plus the shortest path, minus the primary path (by hop-key sequence), then the first 20 by `comparePaths`. List items do not include alternatives.
- **List `total`**:
  - `category`: the matching category cell. `total` = Total, `direct` = Direct, and so on. `inferredOnly` and `stateUnknown` cover **counted** entities only.
  - `exposure`: the figure's `orderCount`.
  - `valueUnknown`: `valueUnknownCount`.
  - `notCounted`: `notCounted.total`, or the matching `byType` count.
- **List `sum`** (exposure lists only): `{ amount: figure.amount, currency }`. It must equal the bigint sum of the items' `value.current.amount`.
- **List ordering**: research R7. Exposure and valueUnknown lists use the Order ordering.

---

## Summary text (`summary: string[]`, research R9)

**Notation**:
- `name` is the start's display name, and `STATE` its current state in upper case.
- `steps(n)` is "1 step" or "n steps".
- `list(bucket)` takes the categories in table order, skips zeros, and renders each as `"<n> <noun>"` with the singular or plural form from `IMPACT_NOUNS`, joined by ", ".
- `money(shares)` renders each currency in currency order as `formatMoneyText`, joined by " and ". Zero amounts are omitted.
- `isAre(n)` gives "is" or "are", `hasHave(n)` gives "has" or "have", and `entity(n)` gives "entity" or "entities".

Lines are emitted in this order. A line is emitted only when its condition holds.

| # | Condition | Text |
|---|---|---|
| 1 | always | `"<name> is <STATE>."`. When `startClass` is INDETERMINATE: `"<name> has an unknown state."`. When `countedTotal > 0` and every counted entity is `inferredOnly`, the period is replaced by `", and everything it affects is reached only through inferred or manual links."` |
| 2 | `countedTotal = 0` | `"Nothing is affected within <steps(depth)>."` |
| 3a | `countedTotal > 0`, start IMPAIRED, some current | `"Currently affected: <list(current)>."`, plus `" <money(current)> exposed."` when the current exposure is non-zero |
| 3b | `countedTotal > 0`, start IMPAIRED, no current | `"Nothing is currently affected."` |
| 3c | `countedTotal > 0`, start IMPAIRED, some potential | `"Potentially affected if it continues: <list(potential)>."`, plus `" <money(potential)> more exposed."` when non-zero |
| 3d | `countedTotal > 0`, start IMPAIRED, total exposure non-zero | `"Total exposure: <money(total)> across <n> customer order(s)."`, where `n` is the sum of `total.orderCount` |
| 4 | `countedTotal > 0`, start not IMPAIRED | `"If <name> became unavailable: <list(potential)>."`, plus `" <money(total)> exposed."` when non-zero |
| 5 | some, but not all, counted entities are `inferredOnly` | `"<n> of the affected entities <isAre(n)> reached only through inferred or manual links"`, plus `", including <money(inferredOnly.total)> of exposure"` when non-zero, plus `"."` |
| 6 | `stateUnknown` total > 0 | `"<n> affected <entity(n)> <hasHave(n)> an unknown state and <isAre(n)> counted as potential."` |
| 7 | `notCounted.total > 0` | `"Not counted: <n> completed or cancelled <entity(n)>."` |
| 8 | `valueUnknownCount > 0` | `"<n> customer order(s) without a recorded value <isAre(n)> left out of exposure."` |
| 9 | some figure has `disagreementOrderCount > 0` | `"<n> customer order(s) <hasHave(n)> values that disagree between sources; exposure could range from <low> to <high>."`. Low and high are per currency, as `"<low money> to <high money>"`, joined with " and ". |
| 10 | `startOwnValue` not null and `countedTotal > 0` | `"<name>'s own value, <money>, is not included."` |
| 11 | `limits.depthLimit` | `"Impact continues beyond <steps(depth)>; these figures are lower bounds."` |
| 12 | `limits.explorationLimit` | `"The search stopped after 10,000 entities; these figures are lower bounds."` |

**Grammar**:
- "customer order(s)" uses `IMPACT_NOUNS.Order`, singular when n = 1.
- Money text is `"84,000.00 USD"`: digit groups with ",", at least 2 decimals, never a locale API.

---

## Acceptance fixtures

The fixtures cover both seeded datasets, at the default depth 6 unless stated. Entities are named by display name. "The 16 orders" are the §39 orders on SHP-77120 other than #18492. "The 4 customers" are Acme Corp, Globex Retail, Initech Supplies and Umbrella Logistics.

### I1. Fabrikam Components (SUP-400, SUSPENDED): summary

`startClass = IMPAIRED`, `countedTotal = 31`, `startOwnValue = null`, and every limit is false.

| type | headline | total | direct | indirect | current | potential | inferredOnly | stateUnknown |
|---|---|---|---|---|---|---|---|---|
| Product | ✓ | 4 | 4 | 0 | 0 | 4 | 1 | 0 |
| PurchaseOrder | ✓ | 5 | 5 | 0 | 3 | 2 | 0 | 0 |
| Order | ✓ | 12 | 0 | 12 | 6 | 6 | 1 | 0 |
| Customer | ✓ | 4 | 0 | 4 | 3 | 1 | 0 | 0 |
| Shipment | ✓ | 3 | 0 | 3 | 2 | 1 | 0 | 0 |
| SLA | ✓ | 3 | 0 | 3 | 2 | 1 | 1 | 0 |

There are no other categories.

**Exposure** (`byCurrency`, one USD figure):

| Share | Amount | Orders |
|---|---|---|
| total | 84000.00 | 12 |
| current | 51250.00 | 6 |
| potential | 32750.00 | 6 |
| inferredOnly.total | 2400.00 | 1 |
| inferredOnly.current | 0.00 | 0 |
| inferredOnly.potential | 2400.00 | 1 |

`disagreementOrderCount = 0`, `range = null`, `valueUnknownCount = 0`.

**Not counted**: `{ total: 2, byType: [{ Order, 1 }, { PurchaseOrder, 1 }] }`.

**Summary**, exactly:

```text
Fabrikam Components is SUSPENDED.
Currently affected: 3 purchase orders, 6 customer orders, 3 customers, 2 shipments, 2 SLA commitments. 51,250.00 USD exposed.
Potentially affected if it continues: 4 products, 2 purchase orders, 6 customer orders, 1 customer, 1 shipment, 1 SLA commitment. 32,750.00 USD more exposed.
Total exposure: 84,000.00 USD across 12 customer orders.
3 of the affected entities are reached only through inferred or manual links, including 2,400.00 USD of exposure.
Not counted: 2 completed or cancelled entities.
```

### I2. Fabrikam: customer-order lists

**`list=category&type=Order&bucket=current`**:
- `total = 6`, `sum = null`;
- items, in order: SO-20402 (12,400.00), SO-20404 (10,600.00), SO-20401 (9,800.00), SO-20403 (7,250.00), SO-20405 (5,900.00), SO-20406 (5,300.00);
- every item is CURRENT, INDIRECT, distance 2, and its `primaryPath` is the 2-hop live path through a DELAYED purchase order;
- `pathCount`: SO-20401 = 3, SO-20402 = 5, SO-20404 = 6, each with `morePaths = false`;
- SO-20401's `shortestPath = null`, because it equals the primary path.

**`list=category&type=Order&bucket=potential`**:
- items, in order: SO-20409 (7,900.00), SO-20407 (6,150.00), SO-20412 (5,900.00), SO-20410 (5,600.00), SO-20408 (4,800.00), SO-20411 (2,400.00);
- SO-20408 has `flags.otherCause = true`, and `pathCount = 3`;
- SO-20411 has `flags.inferredOnly = true`, `weakest = { INFERRED, LOW }` and `pathCount = 1`.

**`list=exposure&currency=USD&bucket=current`**:
- the same 6 orders as the current list;
- `sum = { amount: '51250.00', currency: 'USD' }`, which equals the bigint sum of the items.

**`list=exposure&currency=USD&bucket=inferredOnly`**: SO-20411 only, with `sum = 2400.00 USD`.

### I3. Fabrikam: customers, not counted, inferred

**`list=category&type=Customer&bucket=total`**:
- items, in order: Blue Yonder Machinery (CURRENT), Woodgrove Manufacturing (CURRENT), Litware Industrial (CURRENT), Proseware Systems (POTENTIAL);
- every item has `distance = null`, `primaryPath = null` and `directness = INDIRECT`;
- `attributionCount`:

  | Customer | Attributions |
  |---|---|
  | Blue Yonder Machinery | 4 (SO-20401, SO-20402, SO-20407, SLA-5001-DEL) |
  | Woodgrove Manufacturing | 4 |
  | Litware Industrial | 3 |
  | Proseware Systems | 4 |

- the SLA attributions' `link` paths have 2 hops (DEFINES, HAS), and the order attributions have 1 hop (PLACED).

**`list=notCounted`**: PO-7006 (COMPLETED, distance 1), then SO-20413 (COMPLETED, distance 2). Both have `classification = NOT_COUNTED` and `notCountedReason = TERMINAL`.

**`list=category&type=SLA&bucket=inferredOnly`**: SLA-5002-DEL, CURRENT, with `weakest = { INFERRED, MEDIUM }`.

**`list=category&type=Product&bucket=inferredOnly`**: Pressure Sensor Module (PRD-6104), POTENTIAL.

### I4. Fabrikam: detail and control

- **`items/<SO-20404>`**:
  - `item.pathCount = 6`;
  - `alternativePaths` has 5 entries, each starting at Fabrikam Components and ending at SO-20404, sorted by `comparePaths`;
  - `attributions = []`.
- **`items/<Blue Yonder Machinery>`**: 4 attributions, each with the attributed entity's `primaryPath` and its `link`.
- **Control entities**: `items/<id>` returns **404** for each of Tailspin Parts, PRD-6105, PO-7010, SO-20414, SO-20415, SHP-8009, SLA-5005-DEL, Adventure Works Supply and Contract CON-5001. It also returns 404 for Fabrikam Components itself (the start).

### I5. Fabrikam: determinism

100 consecutive `GET …/impact` responses, and 100 of each I2 list, are deep-equal after removing `computedAt`.

### I6. Payment PAY-88213 (PENDING)

| Category | Totals |
|---|---|
| Order | 17 (direct 1, indirect 16; all current) |
| Customer | 4 (all current) |
| Shipment | 1 (direct, current) |
| SLA | 4 (indirect; current 3, potential 1; inferredOnly 4) |
| Invoice (other) | 1 (indirect, current) |
| Product, PurchaseOrder | 0 |

**Exposure**: USD total = current = 31,400.00 (17 orders), potential 0.00 (0 orders).

**Shipment SHP-77120**:
- `directness = DIRECT`, `distance = 1`;
- `primaryPath` is the 2-hop SOURCE/HIGH path through Order #18492;
- `shortestPath` is the 1-hop path over "PAY-88213 BLOCKS SHP-77120" (MANUAL / MEDIUM).

**Each of the 16 orders**: `pathCount = 2`, `distance = 2`, and a 3-hop `primaryPath` whose `shortestPath` is 2 hops.

**Summary**:

```text
Payment PAY-88213 is PENDING.
Currently affected: 17 customer orders, 4 customers, 1 shipment, 3 SLA commitments, 1 invoice. 31,400.00 USD exposed.
Potentially affected if it continues: 1 SLA commitment.
Total exposure: 31,400.00 USD across 17 customer orders.
4 of the affected entities are reached only through inferred or manual links.
Payment PAY-88213's own value, 12,480.00 USD, is not included.
```

`startOwnValue = { 12480.00, USD }`. A payment is monetary (R10 of 002), so its own value is shown and is not part of the exposure.

### I7. Budget code for Order #18492 (MISSING)

- **Reached**: the 25 entities of 003 Story 2 scenario 1, plus the 4 customers.
- **Direct**: only Finance approval APR-2291.
- **Categories**: Order 17, Customer 4, Shipment 1, SLA 4 (current 3), Approval 1, Invoice 1, Payment 1.
- **Exposure**: 31,400.00 USD, all current.
- **Summary** line 2: `"Currently affected: 17 customer orders, 4 customers, 1 shipment, 3 SLA commitments, 1 approval, 1 invoice, 1 payment. 31,400.00 USD exposed."`

### I8. Order #18492 (BLOCKED)

- **Direct**: Invoice INV-55120 and Shipment SHP-77120.
- **Orders**: 16, all current.
- **Exposure**: 18,920.00 USD current.
- `startOwnValue = { 12480.00, USD }`.

**Summary**:

```text
Order #18492 is BLOCKED.
Currently affected: 16 customer orders, 4 customers, 1 shipment, 3 SLA commitments, 1 invoice. 18,920.00 USD exposed.
Potentially affected if it continues: 1 SLA commitment.
Total exposure: 18,920.00 USD across 16 customer orders.
4 of the affected entities are reached only through inferred or manual links.
Order #18492's own value, 12,480.00 USD, is not included.
```

### I9. Warehouse WH-EAST-02 (ACTIVE)

- `startClass = UNIMPAIRED`.
- **Direct**: 17 orders and SHP-77120.
- **Indirect**: Invoice INV-55120, the 4 SLAs and the 4 customers.
- **Current**: 0 in every category.
- **Exposure**: 31,400.00 USD, all potential.
- `flags.otherCause = true` on exactly 22 entities: the 17 orders, SHP-77120, INV-55120 and the 3 AT_RISK SLAs.

**Summary**:

```text
East Distribution Center 02 is ACTIVE.
If East Distribution Center 02 became unavailable: 17 customer orders, 4 customers, 1 shipment, 4 SLA commitments, 1 invoice. 31,400.00 USD exposed.
4 of the affected entities are reached only through inferred or manual links.
```

### I10. Warehouse WH-WEST-01 (ACTIVE)

- **Counted**: Order #18531 and Shipment SHP-77125 (both direct, potential) and Initech Supplies (attributed, potential).
- **Not counted**: Order #18530 and Shipment SHP-77098, both TERMINAL.
- **Exposure**: 875.00 USD potential (1 order).

**Summary**:

```text
West Distribution Center 01 is ACTIVE.
If West Distribution Center 01 became unavailable: 1 customer order, 1 customer, 1 shipment. 875.00 USD exposed.
Not counted: 2 completed or cancelled entities.
```

### I11. Supplier Northwind Steel (ACTIVE)

- **Categories**: Product 1 (direct), Order 17, Customer 4, Shipment 1, SLA 4 (inferredOnly 4), Invoice 1. All potential.
- **Exposure**: 31,400.00 USD potential.
- **Summary**:
  - line 2: `"If Northwind Steel became unavailable: 1 product, 17 customer orders, 4 customers, 1 shipment, 4 SLA commitments, 1 invoice. 31,400.00 USD exposed."`;
  - line 3: `"4 of the affected entities are reached only through inferred or manual links."`

### I12. Supplier Contoso Metals (ACTIVE, INFERRED / LOW link)

- **Counts**: equal to I11.
- **Inferred only**: every counted entity has `inferredOnly = true`, so the categories' `inferredOnly` equals their `total`. Exposure `inferredOnly.total` is 31,400.00.
- **Summary** line 1: `"Contoso Metals is ACTIVE, and everything it affects is reached only through inferred or manual links."` There is no line 5.

### I13. Northwind Steel at depth 3

- **Counted**: Product PRD-5521, Order #18492, Shipment SHP-77120, Invoice INV-55120 and Acme Corp.
- **Exposure**: 12,480.00 USD potential.
- **Limits**: `depthLimit = true`, `lowerBound = true`.
- **Summary**: the last line is `"Impact continues beyond 3 steps; these figures are lower bounds."`

### I14. Invoice INV-55120 (nothing depends on it)

- `countedTotal = 0`, and every category is 0.
- `startOwnValue = { 12480.00, USD }`.
- **Summary**:

  ```text
  Invoice INV-55120 is PENDING.
  Nothing is affected within 6 steps.
  ```

  Line 10 is not emitted, because `countedTotal = 0`.

### Validation and access

| Request | Expected |
|---|---|
| `…/impact?depth=0`, `depth=11` or `depth=abc` | 400 `VALIDATION_FAILED` on `depth` |
| `…/impact/items` without `list` | 400 on `list` |
| `list=category` without `type` | 400 on `type` |
| `list=category&type=Order&bucket=sum` | 400 on `bucket`, listing the allowed values |
| `list=category&type=Order&bucket=total&currency=USD` | 400 on `currency` ("currency is not allowed for list=category") |
| `list=exposure&bucket=total` without `currency` | 400 on `currency` |
| `list=exposure&currency=usd&bucket=total` | 400 on `currency` |
| `list=exposure&currency=EUR&bucket=total` on Fabrikam | 200, `total = 0`, `items = []`, `sum = { '0.00', 'EUR' }` |
| `list=notCounted&type=Widget` | 400 on `type` |
| `limit=0` or `limit=201` | 400 on `limit` |
| `cursor=garbage` | 400 on `cursor` |
| An unknown start id | 404 on all 3 routes |
| A malformed start id or `targetId` | 400 |
| `items/<id>` for an entity not in the analysis | 404 |
| No token, on any of the 3 routes | 401 |
| Any route, any role | 200, with no audit row and no data change |
