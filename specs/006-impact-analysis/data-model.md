# Data Model: Impact Analysis

This feature stores **no new data**: the analysis is computed on demand (spec FR-020). It changes:

1. the shared vocabulary: the `PurchaseOrder` entity type, relationship rules and impact constants (§1);
2. the Prisma `EntityType` enum, with one migration (§2);
3. `GraphRepository`, with two methods and pure traversal helpers (§3);
4. the new `impact` module: reader, pure analysis modules and service algorithm (§4).

The response schemas are in [contracts/api.md](./contracts/api.md). The reasons for every decision are in [research.md](./research.md).

---

## §1 Shared (`packages/shared/src`)

### §1a `graph.ts` (changed)

```ts
export const EntityTypeSchema = z.enum([
  'Customer','Contract','Order','Product','Payment','Invoice',
  'Approval','Warehouse','Shipment','Supplier','SLA','BudgetRequirement',
  'PurchaseOrder',                                  // NEW, appended (research R10)
]);

export const RELATIONSHIP_RULES = {
  // …unchanged entries…
  CONTAINS:    { from: ['Order', 'PurchaseOrder'],   to: ['Product'] },    // CHANGED
  SUPPLIED_BY: { from: ['Product', 'PurchaseOrder'], to: ['Supplier'] },   // CHANGED
  // …
};
// MONETARY_ENTITY_TYPES unchanged: ['Order','Payment','Invoice'].
```

`DEPENDENCY_DIRECTION` (`tracing.ts`) is **unchanged**. CONTAINS and SUPPLIED_BY stay `FROM_DEPENDS_ON_TO`, so a purchase order depends on its supplier and on its products.

### §1b `money.ts` (new)

The patterns are moved here from `imports.ts`, which now imports them. Behavior is identical.

```ts
export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,12})(\.\d{1,4})?$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const AmountStringSchema = z.string().regex(AMOUNT_PATTERN);
export const CurrencyCodeSchema = z.string().regex(CURRENCY_PATTERN);
export const MoneyDtoSchema = z.object({ amount: AmountStringSchema, currency: CurrencyCodeSchema });
export type MoneyDto = z.infer<typeof MoneyDtoSchema>;
```

### §1c `impact.ts` (new): constants

The query and response schemas are in contracts/api.md.

```ts
export const ImpactStateClassSchema = z.enum(['IMPAIRED', 'UNIMPAIRED', 'TERMINAL', 'INDETERMINATE']);
export type ImpactStateClass = z.infer<typeof ImpactStateClassSchema>;

/** Spec FR-003, research R3. Exhaustive over OperationalState. */
export const IMPACT_STATE_CLASS: Record<OperationalState, ImpactStateClass> = {
  PENDING: 'IMPAIRED', WAITING: 'IMPAIRED', BLOCKED: 'IMPAIRED', MISSING: 'IMPAIRED',
  DELAYED: 'IMPAIRED', FAILED: 'IMPAIRED', SUSPENDED: 'IMPAIRED', AT_RISK: 'IMPAIRED',
  ACTIVE: 'UNIMPAIRED',
  COMPLETED: 'TERMINAL', CANCELLED: 'TERMINAL',
  UNKNOWN: 'INDETERMINATE',
};
export const IMPAIRED_STATES = OperationalStateSchema.options.filter((s) => IMPACT_STATE_CLASS[s] === 'IMPAIRED');
export const TERMINAL_STATES = OperationalStateSchema.options.filter((s) => IMPACT_STATE_CLASS[s] === 'TERMINAL');

/** Spec FR-012: always shown, in this order. */
export const IMPACT_HEADLINE_TYPES = ['Product', 'PurchaseOrder', 'Order', 'Customer', 'Shipment', 'SLA'] as const satisfies readonly EntityType[];

/** Research R9. Exhaustive over EntityType. [singular, plural]. */
export const IMPACT_NOUNS: Record<EntityType, readonly [string, string]> = {
  Customer: ['customer', 'customers'],
  Contract: ['contract', 'contracts'],
  Order: ['customer order', 'customer orders'],
  Product: ['product', 'products'],
  Payment: ['payment', 'payments'],
  Invoice: ['invoice', 'invoices'],
  Approval: ['approval', 'approvals'],
  Warehouse: ['warehouse', 'warehouses'],
  Shipment: ['shipment', 'shipments'],
  Supplier: ['supplier', 'suppliers'],
  SLA: ['SLA commitment', 'SLA commitments'],
  BudgetRequirement: ['budget requirement', 'budget requirements'],
  PurchaseOrder: ['purchase order', 'purchase orders'],
};

/** Category label in the table: the capitalized plural ("Customer orders", "SLA commitments"). */
export function impactCategoryLabel(type: EntityType): string;

export const IMPACT_LIMITS = {
  maxAlternativePaths: 20,        // spec FR-022
  maxEnumeratedPaths: 21,         // research R4: primary + 20
  pathSearchBudget: 5_000,        // edge expansions per target (research R4)
  maxAttributionPreviews: 5,      // list item (research R8)
  maxAttributions: 200,           // detail (research R8)
  defaultPageSize: 50,
  maxPageSize: 200,
} as const;
```

`index.ts` re-exports `money.ts` and `impact.ts`.

---

## §2 Prisma

```prisma
enum EntityType {
  // …existing 12 values…
  PurchaseOrder
}
```

**Migration** `apps/api/prisma/migrations/<timestamp>_purchase_order_entity_type/migration.sql`. Generate it with `pnpm --filter api prisma migrate dev --create-only --name purchase_order_entity_type`, then check that it contains exactly:

```sql
-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'PurchaseOrder';
```

The migration adds no tables, columns or triggers. `resetDb` (test helpers) is unchanged.

---

## §3 Graph repository (`apps/api/src/graph`)

### §3a Interface additions (`graph.repository.ts`)

```ts
export interface ImpactTraceQuery {
  startId: string;
  /** Already validated 1..10. */
  maxDepth: number;
}

export interface ImpactReachedEntity {
  entity: GraphEntityRef;
  /** CTE min depth over non-terminal expansion, 1..maxDepth. */
  distance: number;
  /** Best-ranked path over all filtered edges (research R2 `canonical`). */
  canonicalPath: TraversalPath;
  /** Best-ranked live path, or null when no live path reaches it (research R2 `live`). */
  livePath: TraversalPath | null;
  /** Best-ranked path among those of length `distance` (research R2 `shortest`). */
  shortestPath: TraversalPath;
  /** True when at least one path within maxDepth consists only of SOURCE hops. */
  sourcedReach: boolean;
}

export interface ImpactPathSet {
  /** At most IMPACT_LIMITS.maxEnumeratedPaths, sorted by comparePaths. */
  found: TraversalPath[];
  /** True when enumeration stopped on the path cap or the search budget. */
  morePaths: boolean;
}

export interface ImpactTrace {
  start: GraphEntityRef;
  /** Within maxDepth, start excluded, terminal entities included; sorted by (distance, type, displayName, id). At most 10,000. */
  reached: ImpactReachedEntity[];
  depthLimitReached: boolean;
  explorationLimitReached: boolean;
  cycleClosingHops: CycleClosingHop[];
  cycleClosingHopCount: number;
  /** Research R4. Pure and in memory: no SQL. Unknown ids map to { found: [], morePaths: false }. */
  paths(targetIds: readonly string[]): Map<string, ImpactPathSet>;
}

export interface AttributionQuery {
  orderIds: readonly string[];
  slaIds: readonly string[];
}

export interface CustomerAttribution {
  /** The Order or SLA that is attributed. */
  attributedEntityId: string;
  customer: GraphEntityRef;
  /** UPSTREAM path from the attributed entity to the customer: 1 hop (PLACED) or 2 hops (DEFINES, HAS). */
  link: TraversalPath;
}

export interface GraphRepository {
  // …existing four methods…
  /** Returns null when the start entity does not exist. */
  traceImpact(query: ImpactTraceQuery): Promise<ImpactTrace | null>;
  /** Fixed-shape attribution lookup (research R5). Sorted by (attributedEntityId, customer.id). Empty input returns [] without querying. */
  findAttributedCustomers(query: AttributionQuery): Promise<CustomerAttribution[]>;
}
```

### §3b `impactReachable` SQL (private, `prisma-graph.repository.ts`)

This is a separate method, not a flag on `reachableEntities` (research R2). The post-processing is identical to `reachableEntities`: start detection, `within`, `beyondDepth`, the exploration limit and the `entities` map.

```sql
WITH RECURSIVE walk(entity_id, depth, expandable) AS (
  SELECT ${startId}::uuid, 0, true
  UNION
  SELECT step.next_id, w.depth + 1, (n.current_state <> ALL(${terminalStates}::"OperationalState"[]))
  FROM walk w
  CROSS JOIN LATERAL (
    SELECT r.to_entity_id AS next_id
    FROM relationships r
    WHERE r.from_entity_id = w.entity_id
      AND r.type = ANY(${followFromTypes}::"RelationshipType"[])
    UNION ALL
    SELECT r.from_entity_id AS next_id
    FROM relationships r
    WHERE r.to_entity_id = w.entity_id
      AND r.type = ANY(${followToTypes}::"RelationshipType"[])
  ) step
  JOIN entities n ON n.id = step.next_id
  WHERE w.depth < ${maxDepthPlusOne}
    AND w.expandable
)
SELECT e.id::text AS id, e.type::text AS type, e.display_name AS display_name,
       e.current_state::text AS current_state, m.depth AS depth
FROM (SELECT entity_id, min(depth)::int AS depth FROM walk GROUP BY entity_id) m
JOIN entities e ON e.id = m.entity_id
```

- **Types followed**: `walkTypes('DOWNSTREAM', TRACEABLE_RELATIONSHIP_TYPES)`.
- **Terminal states**: `TERMINAL_STATES` from shared.
- **Start**: the start row is `expandable = true` even when it is terminal (research R3). A start re-reached through a cycle is harmless, because its min depth is 0.

### §3c `traceImpact` (`prisma-graph.repository.ts`)

```text
1. reachable = impactReachable(startId, maxDepth); null → return null
2. rows      = loadEdgeRows(reachable.entities.keys(), all traceable types)
3. edges     = buildTraversalEdges(rows, 'DOWNSTREAM')
4. selection = computeImpactSelections(start.id, edges, stateById, distanceById, maxDepth)   // §3d
5. reached   = reachable.within.map(row → {
                 entity, distance: row.depth,
                 canonicalPath:  toTraversalPath(selection.canonical.get(id)),   // must exist → else invariant Error
                 livePath:       selection.live.get(id) ?? null → toTraversalPath,
                 shortestPath:   toTraversalPath(selection.shortest.get(id)),     // must exist
                 sourcedReach:   selection.sourced.has(id) })
6. cycleClosing = toCycleClosingHops(selection.cycleClosing)
7. paths(targetIds) = enumerateImpactPaths(start.id, selection.filteredEdges, distanceById, targetIds, maxDepth,
                        IMPACT_LIMITS.maxEnumeratedPaths, IMPACT_LIMITS.pathSearchBudget)
                      → map each InternalPath through toTraversalPath
```

- **`stateById`**: built from `reachable.entities`, which includes the start and the entities at depth `maxDepth + 1`.
- **`distanceById`**: the CTE depths, with the start at 0.
- **Entities at `maxDepth + 1`**: they get a distance of `maxDepth + 1`. They are used only by `continuesBeyondDepth` (inside `selectCanonicalPaths`) and are never reported.

### §3d `graph/traversal/impact-paths.ts` (new, pure)

```ts
export interface ImpactSelections {
  /** Research R2 step 3. */
  filteredEdges: TraversalEdge[];
  canonical: Map<string, InternalPath>;
  live: Map<string, InternalPath>;
  shortest: Map<string, InternalPath>;
  sourced: Set<string>;
  /** Cycle-closing hops of the canonical selection. */
  cycleClosing: TraversalEdge[];
}

/** Drops edges out of terminal non-start entities and edges into the start. Keeps the input order. */
export function impactEdges(startId: string, edges: readonly TraversalEdge[],
  stateById: ReadonlyMap<string, OperationalState>): TraversalEdge[];

export function computeImpactSelections(startId: string, edges: readonly TraversalEdge[],
  stateById: ReadonlyMap<string, OperationalState>, distanceById: ReadonlyMap<string, number>,
  maxDepth: number): ImpactSelections;

/** Layered BFS over SOURCE-only edges; ids reached within maxDepth (start excluded). */
export function sourcedReach(startId: string, edges: readonly TraversalEdge[], maxDepth: number): Set<string>;

/** Research R4. Backward DFS per target with distance pruning, path cap and budget. */
export function enumerateImpactPaths(startId: string, edges: readonly TraversalEdge[],
  distanceById: ReadonlyMap<string, number>, targetIds: readonly string[], maxDepth: number,
  maxPaths: number, budget: number): Map<string, { found: InternalPath[]; morePaths: boolean }>;
```

**`computeImpactSelections`** works as follows:

```text
filtered = impactEdges(startId, edges, stateById)
canonicalResult = selectCanonicalPaths(startId, filtered, maxDepth)
startImpaired = IMPACT_STATE_CLASS[state(startId)] === 'IMPAIRED'
liveEdges = startImpaired
  ? filtered.filter(e => (e.sourceId === startId || isImpaired(e.sourceId)) && isImpaired(e.targetId))
  : []
live = liveEdges.length === 0 ? new Map() : selectCanonicalPaths(startId, liveEdges, maxDepth).paths
dagEdges = filtered.filter(e => dist(e.targetId) === dist(e.sourceId) + 1)   // dist(start) = 0
shortest = selectCanonicalPaths(startId, dagEdges, maxDepth).paths
sourced = sourcedReach(startId, filtered.filter(e => e.effectiveOrigin === 'SOURCE'), maxDepth)
return { filteredEdges: filtered, canonical: canonicalResult.paths, live, shortest, sourced,
         cycleClosing: canonicalResult.cycleClosing }
```

- **Cycle-closing hops**: these come only from the canonical run. The live and shortest runs are subgraphs, so they cannot add new cycle-closing relationships beyond the canonical run's set.
- **Live path flag**: `continuesBeyondDepth` on a live path is computed against live edges only. That is acceptable, because the result-level depth flag comes from the CTE.

**`enumerateImpactPaths`**: for each target, in input order:

```text
revAdj: targetId → edges into it, sorted by (sourceId, key) with compareCodeUnits
if dist(target) is undefined or target === startId → { found: [], morePaths: false }
stack-based DFS from target, suffix = [target]; expansions = 0
  at node u with suffix length L (hops so far):
    if u === startId → emit path (reverse the suffix); if found.length === maxPaths → stop, morePaths = true
    for each edge e into u (in order):
      p = e.sourceId
      if ++expansions > budget → stop, morePaths = true
      if p in suffix (by id) → skip
      if dist(p) === undefined or dist(p) + L + 1 > maxDepth → skip
      recurse with p prepended
found sorted by comparePaths
```

- **Emitted paths**: an emitted `InternalPath` carries `weakestConfidence`, `nonSourceHops`, `continuesBeyondDepth: false` and `endsInCycle: false`.
- **Invariant**: never emit a path with a repeated entity; throw `Error('traversal invariant: repeated entity')`, as in 003.
- **"More paths"**: when the cap is hit exactly on the last available path, `morePaths` may still be true. That is acceptable, because "more paths" reads as "there may be more".

### §3e `findAttributedCustomers` SQL

The relationship rows below are grouped with `buildTraversalEdges(rows, 'UPSTREAM')` and assembled into `link` paths (research R5).

```sql
-- Order chain: Customer PLACED Order
SELECT 'ORDER'::text AS chain, r.to_entity_id::text AS attributed_id, NULL::text AS contract_id,
       r.id::text AS id, r.type::text AS type, r.from_entity_id::text AS from_entity_id, r.to_entity_id::text AS to_entity_id,
       r.origin::text AS origin, r.confidence::text AS confidence, r.basis, r.source_system, r.source_id,
       r.observed_at, r.import_id::text AS import_id
FROM relationships r
WHERE r.type = 'PLACED' AND r.to_entity_id = ANY(${orderIds}::uuid[])
UNION ALL
-- SLA chain step 1: Contract DEFINES SLA
SELECT 'SLA_DEFINES', d.to_entity_id::text, d.from_entity_id::text, d.id::text, d.type::text, d.from_entity_id::text, d.to_entity_id::text,
       d.origin::text, d.confidence::text, d.basis, d.source_system, d.source_id, d.observed_at, d.import_id::text
FROM relationships d
WHERE d.type = 'DEFINES' AND d.to_entity_id = ANY(${slaIds}::uuid[])
UNION ALL
-- SLA chain step 2: Customer HAS Contract, for contracts found in step 1
SELECT 'SLA_HAS', d.to_entity_id::text, h.to_entity_id::text, h.id::text, h.type::text, h.from_entity_id::text, h.to_entity_id::text,
       h.origin::text, h.confidence::text, h.basis, h.source_system, h.source_id, h.observed_at, h.import_id::text
FROM relationships d
JOIN relationships h ON h.type = 'HAS' AND h.to_entity_id = d.from_entity_id
WHERE d.type = 'DEFINES' AND d.to_entity_id = ANY(${slaIds}::uuid[])
```

A second, one-statement query loads the `GraphEntityRef` of every customer and contract id that occurs (`SELECT … FROM entities WHERE id = ANY(...)`). The TypeScript assembly then:
- groups the rows per (attributed id, chain);
- builds hops;
- forms `link` paths: `[PLACED]`, or `[DEFINES, HAS]` through each contract;
- for the same (attributed, customer) pair, keeps the best path by `comparePaths`;
- sorts the result.

Every array has a `::uuid[]` cast, and empty arrays short-circuit (research R5).

---

## §4 Impact module (`apps/api/src/impact`)

### §4a `order-value.reader.ts`

`load(orderIds) → Map<orderId, OrderValue>`. For empty input it returns an empty map with no query.

```ts
export interface SourceValue { sourceSystem: string; sourceId: string; observedAt: string; amount: string; currency: string; }
export interface OrderValue {
  /** Null when the current attributes lack a usable amount/currency (research R6). */
  current: { amount: string; currency: string } | null;
  /** Latest stated value per source system; only sources whose payload has an amount. Sorted by sourceSystem. */
  bySource: SourceValue[];
}
```

```sql
SELECT id::text AS id, attributes->>'amount' AS amount, attributes->>'currency' AS currency
FROM entities WHERE id = ANY(${ids}::uuid[]);

SELECT DISTINCT ON (entity_id, source_system)
       entity_id::text AS entity_id, source_system, source_id, observed_at,
       normalized->'attributes'->>'amount' AS amount, normalized->'attributes'->>'currency' AS currency
FROM source_records
WHERE kind = 'ENTITY' AND entity_id = ANY(${ids}::uuid[]) AND (normalized->'attributes') ? 'amount'
ORDER BY entity_id, source_system, observed_at DESC, seq DESC;
```

Rows whose amount or currency fail `AMOUNT_PATTERN` or `CURRENCY_PATTERN` are dropped from `bySource`, and set `current = null` for the entity query.

### §4b Pure analysis modules (`impact/analysis/`, no Nest, no Prisma, no clock)

| File | Exports | Responsibility |
|---|---|---|
| `money.ts` | `parseAmount`, `formatAmount`, `formatMoneyText`, `compareUnits` | bigint units of 10⁻⁴ (research R6) |
| `classify.ts` | `classifyReached(trace) → Affected[]` | spec FR-003 to FR-009 per reached entity |
| `customers.ts` | `mergeCustomers(affected, attributions, startId) → Affected[]` | spec FR-010, research R5 |
| `exposure.ts` | `computeExposure(affected, values, startId) → ExposureResult` | spec FR-013, research R6 |
| `categories.ts` | `buildCategories(affected) → ImpactCategoryDto[]`, `notCountedSummary(affected)` | spec FR-012 |
| `lists.ts` | `selectList(affected, exposure, selector) → Affected[]`, `compareForList(selector)`, `paginate(items, cursor, limit, keyOf)` | spec FR-017/FR-018, research R7 |
| `summary.ts` | `buildSummary(input) → string[]` | spec FR-021, contracts § Summary text |

The internal shape shared by these modules:

```ts
export type Classification = 'CURRENT' | 'POTENTIAL' | 'NOT_COUNTED';

export interface Affected {
  entity: GraphEntityRef;
  classification: Classification;
  notCountedReason: 'TERMINAL' | null;
  /** Null only for attributed-only customers. */
  distance: number | null;
  directness: 'DIRECT' | 'INDIRECT';
  /** Null only for attributed-only customers. Live path if CURRENT, else canonical. */
  primaryPath: TraversalPath | null;
  /** Set only when it differs from primaryPath by hop-key sequence. */
  shortestPath: TraversalPath | null;
  flags: { stateUnknown: boolean; otherCause: boolean; inferredOnly: boolean };
  /** Customers only: attributions in (classification CURRENT first, then entity type, displayName, id) order. */
  attributions: CustomerAttribution[];
}
```

**`classifyReached` rules**. They apply to each `ImpactReachedEntity`, in the trace order:
- **Class**: `cls = IMPACT_STATE_CLASS[entity.currentState]`.
- **Terminal**: if `cls === 'TERMINAL'`, the entity is `NOT_COUNTED`, the reason is `TERMINAL`, and `primaryPath = canonicalPath`.
- **Otherwise**:
  - `classification = livePath !== null ? 'CURRENT' : 'POTENTIAL'`;
  - `primaryPath = livePath ?? canonicalPath`.
- **Directness**: `DIRECT` when `distance === 1`, otherwise `INDIRECT`.
- **Shortest path**: `shortestPath` is kept only if its hop keys differ from the primary path's.
- **Flags**:
  - `stateUnknown = cls === 'INDETERMINATE'`;
  - `otherCause = cls === 'IMPAIRED' && classification === 'POTENTIAL'`;
  - `inferredOnly = !sourcedReach` (counted entities only; false for not counted).

**`mergeCustomers` rules** (spec FR-010):
- **Inputs**: the attributions for counted Orders and SLAs, excluding customers whose id is the start id. They are grouped by customer.
- **A customer already in `affected`** (reached downstream, not `NOT_COUNTED`): attach its attributions.
  - It becomes `CURRENT` if any attributed entity is `CURRENT`.
  - `inferredOnly` becomes `reachedInferredOnly && every attributed entity is inferredOnly`.
- **A new attributed-only customer** gets:
  - `distance: null`, `directness: 'INDIRECT'`, `primaryPath: null`, `shortestPath: null`;
  - `classification`: `CURRENT` if any attributed entity is `CURRENT`, else `POTENTIAL`;
  - flags: `stateUnknown: false`, `otherCause: false`, and `inferredOnly`: every attributed entity is inferredOnly.

**`computeExposure` rules** (spec FR-013):
- **Included**: counted Orders (classification ≠ `NOT_COUNTED`), id ≠ start, with `values.get(id)?.current !== null`.
- **Value unknown**: counted Orders without a usable current value. They are counted in `valueUnknownCount` and appear in list `valueUnknown`.
- **Per currency C**, over the included orders whose current currency is C:
  - `total`, `current` and `potential` sums, each with an order count;
  - the `inferredOnly` sums: total, current and potential;
  - `disagreementOrderCount`;
  - `range`: `{ low, high }` if `disagreementOrderCount > 0`, else null.

  The low and high bounds are summed per order: the min and max over `{current} ∪ bySource.filter(currency C)`.
- **Disagreement**: an order disagrees when `{current} ∪ bySource` has at least 2 distinct `(amount units, currency)` pairs.
- **Own value**: `startOwnValue` is the start's current value, when the start is an Order with a usable value. Other monetary start types (Payment, Invoice) also show their own value (spec FR-011: "if it has a value").
- **Customer key**: `customerExposure: Map<customerId, Map<currency, bigint>>`, the sum of attributed included orders, used for customer ordering (research R7).

### §4c `ImpactService`

```ts
summary(id: string, query: ImpactQuery): Promise<ImpactResponse>
list(id: string, query: ImpactListQuery): Promise<ImpactListResponse>
item(id: string, targetId: string, query: ImpactQuery): Promise<ImpactItemDetailResponse>
```

All three call one private `analyze(id, depth)`:

```text
computedAt = new Date().toISOString()          // read once; never again
trace = graph.traceImpact({ startId: id, maxDepth: depth }); null → Errors.notFound('Entity')
affected = classifyReached(trace)
countedOrders = affected Order ids with classification ≠ NOT_COUNTED
countedSlas   = affected SLA ids with classification ≠ NOT_COUNTED
attributions = graph.findAttributedCustomers({ orderIds: countedOrders, slaIds: countedSlas })
affected = mergeCustomers(affected, attributions, id)
values = orderValues.load(countedOrders ∪ (start is monetary ? [id] : []))
exposure = computeExposure(affected, values, id)
return { computedAt, trace, affected, values, exposure }
```

**`summary`**:
1. Load evidence for the start only (`StateEvidenceReader.load([id])`).
2. Build the categories, the not-counted summary, the exposure DTO and the limits.
3. Call `buildSummary`.
4. Map to `ImpactResponse`.

**`list`**:
1. Validate that the selector's currency or type is legal. A currency with no exposure figure gives an empty list, not an error.
2. Run `selectList`, then sort with `compareForList`, then `paginate`.
3. Call `trace.paths(pageIds)` for the page's non-customer entities.
4. Collect the entity ids of every path that will be serialized: primary, shortest, attribution previews' links and the start. Call `StateEvidenceReader.load` once for all of them.
5. Map with `toPathDto` and `toTracedEntityDto` from `tracing.mapper.ts`.

**`item`**:
1. Find the target in `affected`. If it is missing, return `Errors.notFound('Affected entity')`.
2. Call `trace.paths([targetId])`.
3. For a customer, take all attributions up to `maxAttributions`. Each one carries the attributed entity's primary path, from `affected`.
4. Load evidence once, then map.

**Never**: write data or audit rows, call `new Date()` outside `analyze`, store results, or run traversal SQL.
