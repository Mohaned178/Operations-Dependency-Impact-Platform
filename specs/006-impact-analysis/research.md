# Research: Impact Analysis

These decisions are **binding** for the implementer. Each one records what was chosen, why, and which alternatives were rejected. Section numbers (R1–R15) are referenced from plan.md, data-model.md and contracts/api.md.

Codebase facts this research relies on (state of `006-impact-analysis`, which is 003 complete, 004 and 005 not implemented):

- `PrismaGraphRepository.reachableEntities` is the only recursive SQL. It returns the min-depth reachable set plus entities at `maxDepth + 1`, then `loadEdgeRows` loads every relationship among them.
- Traversal logic is pure TypeScript in `apps/api/src/graph/traversal/`:
  - `buildTraversalEdges` groups assertions into hops;
  - `selectCanonicalPaths` picks the FR-016-best path per entity;
  - `enumerateBlockingPaths` does a DFS.
- `StateEvidenceReader` (tracing module) loads current and per-source state for a list of entity ids. `tracing.mapper.ts` turns traversal paths into `PathDto`s.
- `DEPENDENCY_DIRECTION` (shared) maps every traceable relationship type to its dependent end. Customers are never a dependent end (HAS, PLACED: the customer is the depended-on end).
- Entity attributes are a shallow merge of observations. Every ENTITY source record keeps `normalized.attributes`. Order `amount` is a decimal string matching `^(0|[1-9]\d{0,12})(\.\d{1,4})?$`, and `currency` matches `^[A-Z]{3}$`. Both are required on Order, Payment and Invoice.

---

## R1. Bounded context and module

**Decision**: create a new Nest module `apps/api/src/impact/` with:
- `ImpactModule`;
- `ImpactController` (3 GET routes);
- `ImpactService` (orchestration);
- `OrderValueReader` (value reads);
- pure `analysis/` modules.

`TracingModule` additionally **exports** `StateEvidenceReader`, so that impact responses carry the same `TracedEntityDto` state evidence as tracing. The `tracing.mapper.ts` functions are plain functions and are imported directly.

**Rationale**: CLAUDE.md lists `impact` as a bounded context, so there is no deviation. Impact owns classification, attribution, exposure and text. Traversal stays in `graph`.

**Alternatives rejected**:
- extending `TracingService`: it would mix business aggregation into a pure tracing context;
- duplicating the evidence reader: two sources of truth for hop state evidence.

## R2. Traversal: one new repository method, three canonical selections

**Decision**: add `GraphRepository.traceImpact({ startId, maxDepth })`. It follows every `TRACEABLE_RELATIONSHIP_TYPES` type DOWNSTREAM and works in four steps.

1. **Reachable set (SQL)**: a new private method `impactReachable` in `prisma-graph.repository.ts`. It runs a recursive CTE identical in shape to `reachableEntities`, with one difference: the walk tuple carries `expandable`, which is false when the entity just reached is **terminal** (COMPLETED or CANCELLED). Non-expandable rows are kept (they must be listed as not counted) but are never expanded. The start row is always expandable. The rest is unchanged:
   - `UNION`;
   - `min(depth)` per entity;
   - rows at `maxDepth + 1` to detect a depth cut;
   - the 10,000-entity exploration limit.

   The SQL is in data-model §3.
2. **Edges**: the existing `loadEdgeRows`, then `buildTraversalEdges(rows, 'DOWNSTREAM')`.
3. **Edge filtering** (pure, `graph/traversal/impact-paths.ts`, `impactEdges`): drop every edge whose `sourceId` is a terminal entity other than the start, and every edge whose `targetId` is the start.
4. **Selections** (pure). They reuse `selectCanonicalPaths` unchanged, on three edge subsets:

   | Selection | Edge subset | Gives |
   |---|---|---|
   | `canonical` | all filtered edges | best-ranked path (003 FR-016) per reached entity |
   | `live` | edges whose source is (the start and the start is impaired) or an impaired entity, and whose target is impaired; empty when the start is not impaired | best-ranked **live** path per current entity (spec FR-006/FR-007/FR-014) |
   | `shortest` | edges with `distance(target) = distance(source) + 1`, where distance is the CTE min depth and the start has distance 0 | best-ranked path among the shortest ones (spec FR-014) |

   Plus `sourcedReach`: a layered BFS over filtered edges whose `effectiveOrigin === 'SOURCE'`, bounded by `maxDepth`. It gives the entities that have at least one all-SOURCE path (spec FR-015).

`traceImpact` returns these maps, together with a `paths(targetIds)` function closed over the filtered edges (R4). The impact module therefore never touches edges or SQL.

**Rationale**:
- One SQL round trip, as in 003.
- Reusing `selectCanonicalPaths` guarantees that the impact primary path and the 003 canonical path use the same ranking.
- Running it on the shortest-distance subgraph yields the best shortest path exactly: every path in that subgraph has length `distance(v)`, so ranking by weakest confidence, non-SOURCE count, then ids is the right order.
- The live restriction is a pure subgraph, so a live path is by construction all-impaired.

**Why a separate CTE method rather than a flag on `reachableEntities`**: the 003 CTE is the research R3 query of 003. `graph-repository.e2e-spec.ts` (T009) keeps a copy of it as a smoke test, and its performance budget (SC-003/SC-004) was measured on it. Adding the `expandable` column would change the SQL of every tracing query and make that copy drift. The duplication is about 30 lines inside the one file that is allowed to hold traversal SQL (see plan Complexity Tracking).

**Alternatives rejected**:
- **Three separate SQL walks** (all, live, sourced): three round trips, and the min depths would have to be re-joined.
- **Computing everything in SQL**: path ranking is already TypeScript (R5 of 003). Splitting it would risk two rankings.
- **Reusing `traceDependencies` and filtering afterwards**: it expands through terminal entities, so its distances and reached set would be wrong (spec FR-004).

## R3. State classes for impact

**Decision**: add a new shared constant `IMPACT_STATE_CLASS: Record<OperationalState, ImpactStateClass>`, with `ImpactStateClass = 'IMPAIRED' | 'UNIMPAIRED' | 'TERMINAL' | 'INDETERMINATE'`:

| Class | States |
|---|---|
| IMPAIRED | PENDING, WAITING, BLOCKED, MISSING, DELAYED, FAILED, SUSPENDED, AT_RISK |
| UNIMPAIRED | ACTIVE |
| TERMINAL | COMPLETED, CANCELLED |
| INDETERMINATE | UNKNOWN |

Also add the derived arrays `IMPAIRED_STATES` and `TERMINAL_STATES`. 003's `STATE_CLASSIFICATION` is **not** changed, because blocker semantics differ (spec Assumptions).

- A **terminal start** is analyzed normally: it is expanded, but it is not impaired, so everything is potential.
- An **UNKNOWN start** is not impaired: everything is potential, and the summary says the state is unknown.

**Rationale**: spec FR-003 to FR-008. A separate constant keeps 003 untouched and makes the impact rule testable on its own.

## R4. Path counts and alternative paths: bounded backward DFS

**Decision**: `paths(targetIds)` runs, for each target, a deterministic **backward** DFS over the filtered edges (reverse adjacency, predecessors sorted by `(sourceId, key)` in code units).
- It extends a suffix only through a predecessor `p` with `distance(p) + suffixLength + 1 <= maxDepth`, which is admissible pruning.
- It never revisits an entity already in the suffix, and stops a branch when it reaches the start.
- It stops after finding `IMPACT_LIMITS.maxEnumeratedPaths` (21) paths **or** after `IMPACT_LIMITS.pathSearchBudget` (5,000) edge expansions for that target. Either stop sets `morePaths = true`.

It returns:
- `found`: up to 21 `TraversalPath`s, sorted by `comparePaths`;
- `morePaths`.

The service derives:
- `pathCount = found.length`, meaning "at least" when `morePaths` is true;
- `alternativePaths`: `found` plus the shortest path, minus the primary path (compared by hop-key sequence), first 20 by `comparePaths`.

Enumeration runs **only** for the entities on the requested list page (≤ 200) or the single detail target, never for the summary.

**Rationale**:
- The number of simple paths grows combinatorially. Spec FR-016/FR-022 only require counts "within the limits", with "more exist" flagged.
- Backward search from a known target with distance pruning visits only the part of the graph that can reach the target within depth.
- Counting and exposure never depend on this cap (spec Assumptions), because classification uses R2 maps, not enumerated paths.

**Alternatives rejected**:
- **Global forward enumeration**: exponential on 50k graphs.
- **DP path counting**: it counts walks, not simple paths, so it is wrong on cyclic graphs.

## R5. Customer attribution

**Decision**: add `GraphRepository.findAttributedCustomers({ orderIds, slaIds })`. It is a **fixed-shape, non-recursive** query (two `UNION ALL` branches) that returns one row per relationship assertion on an attribution chain:

- **Order chain**: `Customer PLACED Order`, where `order ∈ orderIds`.
- **SLA chain**: `Contract DEFINES SLA`, where `sla ∈ slaIds`, joined to `Customer HAS Contract`.

The repository groups the rows with `buildTraversalEdges(rows, 'UPSTREAM')`. It returns, per attributed entity, its customers, each with an **attribution path**: a `TraversalPath` walking UPSTREAM from the order or SLA to the customer (1 hop for PLACED, 2 hops for DEFINES then HAS).
- One entity can have several customers; all are returned.
- If two distinct chains reach the same (entity, customer) pair, they are ranked with `comparePaths` and the best is kept.

The service then counts customers (spec FR-010):
- the customers attributed to **counted** orders and SLA commitments, excluding the start entity;
- unioned with any Customer entity that the downstream walk reached itself. Generic `DEPENDS_ON`, `REQUIRES` or `BLOCKS` can make a customer a dependent, although the seed never does this.

Classification rules:
- **Reached customer**: its own distance and classification apply. A reached customer is direct or indirect by distance.
- **Attributed-only customer**: `distance: null`, `primaryPath: null`, indirect.
- **Current or potential**: a customer is current if it was reached as current, or if any of its attributed entities is current.
- **Inferred only**: a customer is inferred-only when every attributed entity is inferred-only **and** it was not reached by an all-SOURCE path.

**Rationale**:
- The query is bounded to at most 2 hops and does not recurse.
- It lives in `GraphRepository`, which satisfies spec FR-002 ("including customer attribution") and CLAUDE.md.
- Returning `TraversalPath`s lets the UI show the attributing relationships with the same hop component and provenance as everything else.

**Alternatives rejected**:
- **An upstream `traceDependencies` from every order**: N traversals.
- **Treating attribution as part of the downstream walk**: it would contradict the 003 direction table.

## R6. Order values and exposure arithmetic

**Decision**:

- **`OrderValueReader.load(orderIds)`** (impact module) reads values with two queries. This is plain reading, not traversal:
  1. `entities.attributes->>'amount'` and `->>'currency'` for the current value;
  2. `DISTINCT ON (entity_id, source_system)` over `source_records` where `kind = 'ENTITY'` and `normalized->'attributes' ? 'amount'`, ordered by `observed_at DESC, seq DESC`, for each source's latest stated value with `source_id` and `observed_at`.
- **Valid value**: a value is usable only if both strings match the shared `AMOUNT_PATTERN` and `CURRENCY_PATTERN`. These are moved from `imports.ts` into an exported `money.ts` in shared, and `imports.ts` re-uses them. Anything else is "value unknown".
- **Money arithmetic** (`impact/analysis/money.ts`, pure):
  - amounts are `bigint` in units of 10⁻⁴, so there is never floating point;
  - `parseAmount('12480.00') → 124800000n`;
  - `formatAmount(124800000n) → '12480.00'`: at least 2 decimals, trailing zeros beyond 2 trimmed;
  - `formatMoneyText(units, currency) → '12,480.00 USD'`: digit grouping with commas, no locale API.
- **Exposure** (spec FR-013): per currency of the **current** value, over counted Orders with a usable value (excluding the start). It reports:
  - total, current and potential sums;
  - the inferred-only share of each;
  - order counts.
- **Range**: computed only when at least one included order has a disagreement. A **disagreement** means the set of distinct `(amount, currency)` among the current value and the per-source values has size ≥ 2.
  - For currency C: `low = Σ min` and `high = Σ max`, taken over each order's values **in currency C** (current plus per-source).
  - Per-source values in another currency are shown on the order (`currencyMismatch: true`) but do not enter C's range.

**Rationale**:
- Exact decimal sums (SC-002: "add up exactly").
- Constitution II: the disagreeing values are stored and shown, and the range makes the uncertainty visible instead of silently picking one value.

**Alternatives rejected**:
- **`Number` arithmetic**: rounding errors would break "exactly".
- **`Prisma.Decimal`**: amounts are JSON strings, not a Decimal column, and a bigint helper is about 30 lines.
- **Currency conversion**: out of scope (spec Edge Cases).

## R7. Deterministic ordering and cursors

**Decision**: all ordering is done in TypeScript with `compareCodeUnits` (never `localeCompare`).

- **Categories**:
  - the 6 headline categories in `IMPACT_HEADLINE_TYPES` order: Product, PurchaseOrder, Order, Customer, Shipment, SLA;
  - then the other types with total > 0, by type name.
- **Lists** (spec FR-018):
  - **Orders**:
    1. orders with a usable value first;
    2. amount descending, compared as bigint units, regardless of currency;
    3. currency ascending;
    4. displayName;
    5. id.
  - **Customers**:
    1. the highest single-currency attributed exposure descending; a customer with no valued orders counts as 0;
    2. displayName;
    3. id.
  - **Others**:
    1. CURRENT before POTENTIAL before NOT_COUNTED;
    2. distance ascending, with null last;
    3. displayName;
    4. id.
- **Exposure currencies**: by code.
- **Cursor**: the same pattern as 003 `dependencies`. It is a base64url JSON of the last item's sort key, `{ k: (string|number)[] }`; bigint amounts are serialized as decimal strings of units. The next page starts at the first item whose key compares greater, using the same comparator. A malformed cursor is a 400 validation error, as in 003.

**Rationale**: spec FR-018 and FR-020. Key-based cursors stay valid if the data changes, and the UI detects a changed total (R13).

## R8. API shape: three read-only endpoints

**Decision** (contracts/api.md has the schemas):

1. `GET /api/entities/:id/impact?depth=` returns `ImpactResponse`: the summary sentences, categories, exposure, not-counted summary, limits and own value. It contains **no per-entity lists**.
2. `GET /api/entities/:id/impact/items?depth=&list=&type=&bucket=&currency=&cursor=&limit=` returns `ImpactListResponse`: one drill-down list. Each item has its primary path, shortest path (when different), path count, flags and value. Customers carry up to 5 attribution previews, each with its attribution path, plus a total count.
3. `GET /api/entities/:id/impact/items/:targetId?depth=` returns `ImpactItemDetailResponse`: one affected or not-counted entity, with all its paths (alternatives ≤ 20) and, for a customer, all its attributions (≤ 200, with count). Each attribution has the attributed entity's primary impact path and its attribution path.

The list selector (`list` plus the parameters it needs) is validated by one zod schema:

| `list` | Required | Optional | `bucket` values |
|---|---|---|---|
| `category` | `type` (EntityType), `bucket` | — | `total`, `direct`, `indirect`, `current`, `potential`, `inferredOnly`, `stateUnknown` |
| `exposure` | `currency` (3 letters), `bucket` | — | `total`, `current`, `potential`, `inferredOnly` |
| `valueUnknown` | — | — | — |
| `notCounted` | — | `type` | — |

A detail request for a target that is not in the analysis (not reached, beyond depth, the start itself, or a control entity) returns **404** with `Errors.notFound('Affected entity')`.

**Rationale**:
- Keeping the summary small keeps the 2-second budget.
- Lazy detail avoids multi-megabyte list pages: 50 items × 22 paths × 6 hops would be about 6 MB.
- Every number in the summary maps 1:1 to one selector (spec FR-017).

**Alternatives rejected**:
- **One endpoint returning everything**: unbounded payload.
- **Storing the analysis and paging it**: violates spec FR-020 (no storage).

## R9. Summary text

**Decision**: a pure `analysis/summary.ts` builds `summary: string[]` from the computed result only, using the templates in contracts/api.md § Summary text. Fixed rules:

- **Nouns** come from `IMPACT_NOUNS: Record<EntityType, [singular, plural]>` in shared. For example `Order → ['customer order', 'customer orders']` and `SLA → ['SLA commitment', 'SLA commitments']`.
- **Count lists** follow the category order, omit zeros, and are joined with ", ".
- **Money** is printed with `formatMoneyText`. Several currencies are joined with " and ".
- **States** are shown in raw upper case (for example "SUSPENDED"), as in the 003 summary. Unknown state is worded as "has an unknown state".
- **Lower bounds**: when `limits.lowerBound` is true, the last sentence says the figures are lower bounds.

Each sentence is a separate string, which lets the UI render the first one as the headline.

**Authoritative wording**: the spec's Overview quote is illustrative. Its wording differs slightly ("1 more customer"). The exact text is the template output in contracts/api.md, fixture I1.

**Rationale**: spec FR-021. It follows the 003 and 005 pattern of deterministic templates with no AI.

## R10. Purchase order vocabulary

**Decision**:
- **Type**: append `PurchaseOrder` to `EntityTypeSchema`, at the end, so existing option order and filters keep their positions.
- **Prisma**: add `PurchaseOrder` to the Prisma `EntityType` enum. The migration `<ts>_purchase_order_entity_type` is a single `ALTER TYPE "EntityType" ADD VALUE 'PurchaseOrder';`, generated by `prisma migrate dev --create-only` and checked.
- **`RELATIONSHIP_RULES`**:
  - `CONTAINS: { from: ['Order','PurchaseOrder'], to: ['Product'] }`;
  - `SUPPLIED_BY: { from: ['Product','PurchaseOrder'], to: ['Supplier'] }`.

  `DEPENDS_ON` is already unrestricted. `DEPENDENCY_DIRECTION` is unchanged.
- **Not monetary**: `PurchaseOrder` is **not** added to `MONETARY_ENTITY_TYPES`. Its value is optional and is never part of exposure (spec FR-025).
- **Seed**: `PRIMARY_SYSTEM` in `scenario-39.ts` is a `Record<EntityType, string>`, so it gains `PurchaseOrder: 'ERP'`. This is a type-level addition with no row change. The §39 output is unchanged, and `scenario-39.spec.ts` keeps passing.
- **Docs**: `docs/import-format.md` updates its entity-type list and relationship-rule table.
- **Web**: needs no change beyond what follows from `EntityTypeSchema.options`. Lists, filters and badges derive from it.

**Rationale**: spec FR-023 and FR-024. `ADD VALUE` is non-destructive.

**Caveat**: Postgres forbids using a new enum value inside the transaction that added it. The migration only adds it.

## R11. Supplier-failure seed dataset (§40)

**Decision**: `apps/api/src/ingestion/seed/scenario-40.ts` exports `buildScenario40Document()`, which produces **exactly** the rows in [seed-scenario-40.md](./seed-scenario-40.md). `SeedService` gains `seedScenario40()`, with the same import path, `trigger: 'SEED'`, `skipIfNoChanges: true` and file name `scenario-40.json`. `prisma/seed.ts` calls both scenarios.

- The dataset shares **no** entity keys with §39, so every 002–005 acceptance result is unchanged.
- `scenario-40.spec.ts` (unit, no DB) validates the rows and verifies the Story 1 numbers with a test-only walk over the document (spec FR-031), mirroring `scenario-39.spec.ts`.

**Rationale**: the §39 fixture is frozen (002 seed-scenario.md: "Do not add, remove or change any of them"). A separate import keeps both idempotent and independently testable.

## R12. Performance

**Budget**: the summary p95 must be under 2 s, and the first list page p95 under 2 s, over 20 runs at 50k entities and at least 150k relationships, with the analyzed supplier reaching at least 2,000 entities (SC-003).

**Expected cost**:

| Step | Cost |
|---|---|
| CTE | ~2.6k reached rows (003 dependencies on a comparable set: < 400 ms) |
| `loadEdgeRows` | ~8k rows |
| `buildTraversalEdges` | O(E) |
| 3 × `selectCanonicalPaths` | O(depth × E × depth), about 300k label copies |
| `sourcedReach` | O(depth × E) |
| `findAttributedCustomers` | 2 index-backed joins |
| `OrderValueReader` | 2 queries over ≤ 2k ids |
| Lists only | evidence for page paths, plus enumeration for ≤ 200 targets (bounded by 21 paths and 5,000 expansions each) |

**Indexes**: none needed. `relationships` already has `(from_entity_id, type)` and `(to_entity_id, type)` indexes from 002 (used by 003). `source_records(entity_id, observed_at DESC, seq DESC)` exists.

**Perf dataset**: `test/perf-impact.e2e-spec.ts` generates its own graph with `generate_series`, deterministically, in the style of `perf-tracing`:
- **50,000 entities** in 50 "supplier blocks" of 1,000 entities each:
  - 1 Supplier;
  - 30 Products;
  - 60 PurchaseOrders;
  - 600 Orders;
  - 60 Shipments;
  - 60 SLAs;
  - 189 Customers.
- **Relationships**:
  - Product SUPPLIED_BY Supplier;
  - PO SUPPLIED_BY Supplier;
  - PO CONTAINS 2 Products;
  - each Order CONTAINS 2 Products and DEPENDS_ON 1 PO;
  - Shipment DEPENDS_ON 10 Orders;
  - SLA DEPENDS_ON Shipment;
  - Customer PLACED Orders;
  - 50,000 RELATES_TO noise.

  That gives at least 150k relationships.
- **Hub supplier**: block 0's supplier additionally supplies the Products of blocks 1–3 through `SUPPLIED_BY` rows. Its impact therefore reaches at least 2,000 entities within depth 6. The test asserts the number reached.
- **States**: about 30% of POs and Orders are impaired, so the live selection does real work.
- **Timings**: recorded in quickstart.md.

**Escape hatch**: none needed by design. If the budget is missed, profile before optimizing. The first lever is to skip the `shortest` selection when it equals `canonical` for every entity. **Do not cache.**

## R13. Web design

**Decision**: add an **Impact** section `id="impact"` to `EntityDetailPage`, between `BlockersSection` and `DependenciesSection`. It is a self-contained subtree under `apps/web/src/pages/entities/impact/`.

**URL state** (`impact-params.ts`). The prefixes avoid collisions with the Dependencies `depth`:
- `idepth`: default 6, omitted when default; invalid values fall back to 6, as in 003.
- `ilist`: the opened list, serialized as one of:
  - `category.<Type>.<bucket>`
  - `exposure.<CUR>.<bucket>`
  - `valueUnknown`
  - `notCounted`
  - `notCounted.<Type>`

  Invalid values are ignored.

**Data fetching**:
- **Summary**: `useImpact(id, depth)` with key `['entities', id, 'impact', depth]`.
- **List**: `useImpactList(id, depth, selector)`, an infinite query with key `['entities', id, 'impact', depth, 'items', selector]`.
- **Detail**: `useImpactItem(id, depth, targetId)`, loaded on row expand.

**Components**:
- `ImpactSection`: summary sentences (the first in bold), the depth `<select>` (1–10) and a one-line form when nothing is affected.
- `ImpactTable`: an HTML `<table>`. Columns: Category, Current, Potential, Total, Direct, Indirect, "Only inferred", "State unknown". Every non-zero number is a `<button>` that sets `ilist`.
- `ExposureFigures`: per currency, total, current and potential buttons, the inferred-only share, the range and left-out notes.
- `ImpactList`: heading from the selector, total, rows and "Load more".
- `AffectedEntityRow`: state badge, classification, distance, value, flags and the primary path (`PathView`). An expand button loads `AffectedEntityDetail`.
- `AffectedEntityDetail`: alternative paths, and attributions with their attribution paths.

**Data changed**: when the list total differs from the number in the summary cell that opened it, show "The data has changed since the summary was computed." with a Refresh button. Refresh invalidates `['entities', id, 'impact']`.

**Reuse**: `PathView`, `StateBadge`, `OriginBadge`, `formatTimestamp`, and `formatMoney` (amounts arrive as decimal strings). Badges are text plus colour, never colour alone.

**Rationale**:
- Spec FR-027 to FR-029, Story 4.
- The section-level loading and error state follows the 003 and 005 rule: one failing section never blanks the page.

## R14. Dependencies

**Decision**: no new runtime or development dependencies.

## R15. No caching, no storage

**Decision**: every request recomputes the analysis. Nothing is stored, and no audit rows are written. The list and detail endpoints recompute the full trace, then page or select.

**Rationale**:
- Spec FR-020 and FR-026.
- Determinism is guaranteed by data, query and ordering alone.
- The performance budget (R12) is met without a cache.
