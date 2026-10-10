# Data Model: Home Overview and Search

**Feature**: `010-home-dashboard-search` | **Date**: 2026-10-07

This feature stores **revenue-at-risk snapshots** (with one row per at-risk order) and **saved filters**, and adds **trigram indexes** for search. Home sections, unresolved blockers, frequent root causes, data freshness, search results and built-in filters are computed, not stored (research R2, R10–R12). Response schemas, texts and fixtures are in [contracts/api.md](./contracts/api.md). The reasons for every decision are in [research.md](./research.md).

---

## §1 Storage (Prisma + migration `<timestamp>_overview_search`)

The migration must run **after** 009's migration. Do not edit earlier migrations.

### §1a Prisma schema changes (`apps/api/prisma/schema.prisma`)

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]          // research R6
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pg_trgm]                              // research R6: CREATE EXTENSION IF NOT EXISTS "pg_trgm"
}

/// Declaration order is the display order of categories (contracts § Category mapping).
enum CauseCategory {
  SUPPLIER
  PAYMENT
  WAREHOUSE
  APPROVAL
  OTHER
}

enum AtRiskReason {
  IMPAIRED
  RISK
  SLA
}

/// 005's statuses plus the two outcomes of this feature (research R5).
enum RootCauseOutcome {
  ROOT_CAUSES_FOUND
  NOT_BLOCKED
  UNEXPLAINED
  NOT_ANALYZED
  FAILED
}

enum OverviewSnapshotStatus {
  RUNNING
  COMPLETED
  FAILED
}

enum OverviewSnapshotTrigger {
  AFTER_EVALUATION
  MANUAL
}

model OverviewSnapshot {
  id                String                  @id @default(uuid()) @db.Uuid
  number            Int                     @unique @default(autoincrement())
  trigger           OverviewSnapshotTrigger
  requestedById     String?                 @map("requested_by_id") @db.Uuid     // null = System
  riskEvaluationId  String                  @map("risk_evaluation_id") @db.Uuid
  asOf              DateTime                @map("as_of") @db.Timestamptz(3)     // = the risk evaluation's asOf
  status            OverviewSnapshotStatus  @default(RUNNING)
  runningSlot       Boolean?                @unique @map("running_slot")        // true while RUNNING, else NULL (research R3)
  startedAt         DateTime                @map("started_at") @db.Timestamptz(3)
  finishedAt        DateTime?               @map("finished_at") @db.Timestamptz(3)
  graphVersionStart BigInt                  @map("graph_version_start")
  graphVersionEnd   BigInt?                 @map("graph_version_end")
  consistent        Boolean?
  orderCount        Int?                    @map("order_count")                  // at-risk orders
  analyzedCount     Int?                    @map("analyzed_count")
  notAnalyzedCount  Int?                    @map("not_analyzed_count")
  failedCount       Int?                    @map("failed_count")
  totals            Json?                                                        // §2b SnapshotTotals, validated on write and read
  error             String?

  requestedBy    User?                  @relation("OverviewSnapshotRequestedBy", fields: [requestedById], references: [id], onDelete: Restrict)
  riskEvaluation RiskEvaluation         @relation(fields: [riskEvaluationId], references: [id], onDelete: Restrict)
  orders         OverviewSnapshotOrder[]

  @@index([status, asOf(sort: Desc), number(sort: Desc)])
  @@index([finishedAt])
  @@map("overview_snapshots")
}

model OverviewSnapshotOrder {
  snapshotId          String            @map("snapshot_id") @db.Uuid
  orderId             String            @map("order_id") @db.Uuid
  analysisRank        Int               @map("analysis_rank")                    // 1-based, research R5
  reasons             AtRiskReason[]                                             // fixed order IMPAIRED, RISK, SLA
  stateAtSnapshot     OperationalState  @map("state_at_snapshot")
  stateSourceSystem   String?           @map("state_source_system")              // current state observation (IMPAIRED reason)
  stateSourceId       String?           @map("state_source_id")
  stateObservedAt     DateTime?         @map("state_observed_at") @db.Timestamptz(6)
  riskId              String?           @map("risk_id") @db.Uuid                 // RISK reason
  riskLevel           RiskLevel?        @map("risk_level")
  slaClockKey         String?           @map("sla_clock_key")                    // SLA reason (009 clock key)
  slaStatus           String?           @map("sla_status")                       // 'AT_RISK' | 'BREACHED' (CHECK)
  slaDueAt            DateTime?         @map("sla_due_at") @db.Timestamptz(3)
  customerId          String?           @map("customer_id") @db.Uuid
  amountUnits         BigInt?           @map("amount_units")                     // 10⁻⁴ units of the current value; null = value unknown
  currency            String?           @db.Char(3)
  lowUnits            BigInt?           @map("low_units")                        // set only when disagreement
  highUnits           BigInt?           @map("high_units")
  disagreement        Boolean           @default(false)
  sourceValues        Json?             @map("source_values")                    // §2b SourceValue[] when disagreement
  outcome             RootCauseOutcome
  rootCauseEntityId   String?           @map("root_cause_entity_id") @db.Uuid
  rootCauseLabel      String?           @map("root_cause_label")
  rootCauseConfidence Confidence?       @map("root_cause_confidence")
  candidateCount      Int               @default(0) @map("candidate_count")
  otherCategories     CauseCategory[]   @map("other_categories")
  category            CauseCategory
  error               String?

  snapshot        OverviewSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  order           Entity           @relation("OverviewSnapshotOrderOrder", fields: [orderId], references: [id], onDelete: Restrict)
  rootCauseEntity Entity?          @relation("OverviewSnapshotOrderRootCause", fields: [rootCauseEntityId], references: [id], onDelete: Restrict)
  customer        Entity?          @relation("OverviewSnapshotOrderCustomer", fields: [customerId], references: [id], onDelete: Restrict)

  @@id([snapshotId, orderId])
  @@index([snapshotId, category, currency, amountUnits(sort: Desc)])
  @@index([snapshotId, rootCauseEntityId])
  @@index([orderId, snapshotId])
  @@map("overview_snapshot_orders")
}

model SavedFilter {
  id        String   @id @default(uuid()) @db.Uuid
  ownerId   String   @map("owner_id") @db.Uuid
  name      String
  nameKey   String   @map("name_key")                                            // lower(trim(name)), research R9
  criteria  Json                                                                 // EntityFinderCriteria, validated on write and read
  createdAt DateTime @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @map("updated_at") @db.Timestamptz(3)

  owner User @relation("SavedFilterOwner", fields: [ownerId], references: [id], onDelete: Restrict)

  @@unique([ownerId, nameKey])
  @@index([ownerId, createdAt])
  @@map("saved_filters")
}
```

**Back-relations**: `User.overviewSnapshotsRequested`, `User.savedFilters`; `Entity.overviewSnapshotOrders` (`OverviewSnapshotOrderOrder`, used by the finder's category criterion), `Entity.overviewSnapshotRootCauses`, `Entity.overviewSnapshotCustomers`; `RiskEvaluation.overviewSnapshots`.

**Trigram and freshness indexes on existing models** (declared in the schema, research R6, R11):

```prisma
model Entity {
  // … unchanged …
  @@index([displayName(ops: raw("gin_trgm_ops"))], type: Gin, map: "entities_display_name_trgm_idx")
}
model EntityIdentifier {
  @@index([sourceId(ops: raw("gin_trgm_ops"))], type: Gin, map: "entity_identifiers_source_id_trgm_idx")
}
model Exception {        // 007
  @@index([title(ops: raw("gin_trgm_ops"))], type: Gin, map: "exceptions_title_trgm_idx")
}
model Investigation {    // 008
  @@index([title(ops: raw("gin_trgm_ops"))], type: Gin, map: "investigations_title_trgm_idx")
}
model SourceRecord {
  @@index([sourceSystem, observedAt, receivedAt], map: "source_records_freshness_idx")
}
```

### §1b Hand-written SQL appended to the generated migration

```sql
-- Snapshot rows: one category per order, valid reasons, value fields together (research R4, R5)
ALTER TABLE overview_snapshot_orders
  ADD CONSTRAINT overview_snapshot_orders_reasons_ck CHECK (cardinality(reasons) BETWEEN 1 AND 3),
  ADD CONSTRAINT overview_snapshot_orders_value_ck CHECK ((amount_units IS NULL) = (currency IS NULL)),
  ADD CONSTRAINT overview_snapshot_orders_range_ck CHECK (
    (disagreement AND low_units IS NOT NULL AND high_units IS NOT NULL AND low_units <= high_units)
    OR (NOT disagreement AND low_units IS NULL AND high_units IS NULL)),
  ADD CONSTRAINT overview_snapshot_orders_sla_ck CHECK (sla_status IS NULL OR sla_status IN ('AT_RISK', 'BREACHED')),
  ADD CONSTRAINT overview_snapshot_orders_root_cause_ck CHECK (
    (outcome = 'ROOT_CAUSES_FOUND') = (root_cause_entity_id IS NOT NULL));

-- Snapshots: running slot only while RUNNING (research R3)
ALTER TABLE overview_snapshots
  ADD CONSTRAINT overview_snapshots_slot_ck CHECK ((status = 'RUNNING') = (running_slot IS NOT NULL)),
  ADD CONSTRAINT overview_snapshots_slot_true_ck CHECK (running_slot IS NULL OR running_slot);

-- Saved filters
ALTER TABLE saved_filters
  ADD CONSTRAINT saved_filters_name_ck CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
  ADD CONSTRAINT saved_filters_name_key_ck CHECK (name_key = lower(name));
```

After applying, `prisma migrate diff --from-migrations … --to-schema-datamodel …` must report no difference (the extension and GIN indexes are declared in the schema; CHECK constraints are invisible to Prisma). Check the generated `CREATE EXTENSION` precedes the GIN indexes in `migration.sql`.

### §1c Validation rules (zod in `packages/shared` and CHECKs in the database)

| Field | Rule | Where |
|---|---|---|
| search `q` | trimmed, 2–100 characters | `SearchQuerySchema` |
| search `groups`, `entityTypes` | csv of enums, no duplicates | `SearchQuerySchema` |
| finder `type`, `state`, `stateClass`, `rootCauseCategory`, `riskLevel`, `riskType`, `slaStatus` | csv of enums (007's `csv` preprocess), at most the enum's size | `EntityFinderQuerySchema` |
| finder `q` | as 002 (trimmed, 1–100) | `EntityFinderQuerySchema` |
| saved filter `name` | trimmed, 1–80; unique per owner ignoring case (409) | schema + unique index + CHECK |
| saved filter `criteria` | `EntityFinderCriteriaSchema`, at least one criterion | schema (400 `criteria`) |
| saved filters per user | ≤ 50 (409 `SAVED_FILTER_LIMIT`) | service: insert, then count the owner's rows in the same transaction; more than 50 → throw, which rolls the insert back |
| `evaluatedAt` | ISO-8601 UTC | every query schema that has it |
| `snapshotId` | uuid; must exist (404 `Snapshot`) | route 2, 3 |
| `category` | `CauseCategory` | route 2 |
| `currency` | `CURRENCY_PATTERN` (006) | route 2 |
| 007 `rootCauseLabel` + `rootCauseWindowEnd` | both or neither (400 on the missing one); label 1–200 | 007's `ExceptionListQuerySchema` superRefine |

---

## §2 Shared code

### §2a `packages/shared/src/overview.ts`: constants

```ts
export const CAUSE_CATEGORIES = ['SUPPLIER', 'PAYMENT', 'WAREHOUSE', 'APPROVAL', 'OTHER'] as const;
export type CauseCategory = (typeof CAUSE_CATEGORIES)[number];
export const CAUSE_CATEGORY_LABELS: Record<CauseCategory, string> = {
  SUPPLIER: 'Supplier issues', PAYMENT: 'Payment issues', WAREHOUSE: 'Warehouse and shipping issues',
  APPROVAL: 'Approval issues', OTHER: 'Other',
};
/** Research R5. Record<EntityType, …> makes a missing type a compile error. */
export const ROOT_CAUSE_CATEGORY_BY_TYPE: Record<EntityType, CauseCategory> = {
  Supplier: 'SUPPLIER', Product: 'SUPPLIER', PurchaseOrder: 'SUPPLIER',
  Payment: 'PAYMENT', Invoice: 'PAYMENT',
  Warehouse: 'WAREHOUSE', Shipment: 'WAREHOUSE',
  Approval: 'APPROVAL', BudgetRequirement: 'APPROVAL',
  Order: 'OTHER', Customer: 'OTHER', Contract: 'OTHER', SLA: 'OTHER',
};
export const AT_RISK_REASONS = ['IMPAIRED', 'RISK', 'SLA'] as const;
export const ROOT_CAUSE_OUTCOMES = ['ROOT_CAUSES_FOUND', 'NOT_BLOCKED', 'UNEXPLAINED', 'NOT_ANALYZED', 'FAILED'] as const;
export const OVERVIEW_LAYOUTS = ['TOTALS_FIRST', 'ASSIGNED_FIRST'] as const;

export const OVERVIEW_LIMITS = {
  maxAnalyzedOrders: 5000,
  topItems: 5,
  frequentWindowDays: 30,          // = 008's recurrenceWindowDays
  frequentMinExceptions: 3,
  staleAfterMs: 24 * 60 * 60 * 1000,
  snapshotRetentionMs: 24 * 60 * 60 * 1000,
  blockerExceptionsShown: 3,
  errorMax: 500,
} as const;
```

### §2b Snapshot payloads (`overview.ts`)

```ts
export const SourceValueSchema = z.object({
  sourceSystem: z.string(), sourceId: z.string(), observedAt: z.string().datetime(),
  amount: z.string(), currency: z.string().length(3),
});
export const CategoryTotalSchema = z.object({
  category: CauseCategorySchema,
  amountUnits: z.string().regex(/^\d+$/),            // bigint as decimal string
  orderCount: z.number().int().min(0),               // valued orders in this currency
  lowConfidenceUnits: z.string().regex(/^\d+$/),
  disagreementUnits: z.string().regex(/^\d+$/),
});
export const CurrencyTotalSchema = z.object({
  currency: z.string().length(3),
  totalUnits: z.string().regex(/^\d+$/),
  orderCount: z.number().int().min(0),
  range: z.object({ lowUnits: z.string(), highUnits: z.string() }).nullable(),
  categories: z.array(CategoryTotalSchema).length(5),     // CAUSE_CATEGORIES order
});
export const SnapshotTotalsSchema = z.object({
  currencies: z.array(CurrencyTotalSchema),                // by currency code
  categoryOrders: z.array(z.object({ category: CauseCategorySchema, orderCount: z.number().int(),
                                     valueUnknownCount: z.number().int() })).length(5),
  valueUnknownCount: z.number().int(),
  outcomes: z.record(RootCauseOutcomeSchema, z.number().int()),   // every key present
});
```

### §2c `packages/shared/src/search.ts` and `saved-filters.ts`

```ts
export const SEARCH_GROUPS = ['ENTITY', 'EXCEPTION', 'INVESTIGATION'] as const;
export const SEARCH_TIERS = ['EXACT', 'PREFIX', 'CONTAINS', 'SIMILAR'] as const;
export const SEARCH_LIMITS = { qMin: 2, qMax: 100, boxPerGroup: 10, pagePerGroup: 50, totalCap: 1000,
                               similarityThreshold: 0.3, matchedIdentifiersMax: 3 } as const;

export const STATE_CLASSES = ['IMPAIRED', 'UNIMPAIRED', 'TERMINAL', 'INDETERMINATE'] as const;   // 006
export const FINDER_SLA_STATUSES = ['AT_RISK', 'BREACHED'] as const;

export const EntityFinderCriteriaSchema = z.object({
  type: csv(EntityTypeSchema), state: csv(OperationalStateSchema), stateClass: csv(z.enum(STATE_CLASSES)),
  sourceSystem: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  rootCauseCategory: csv(CauseCategorySchema), riskLevel: csv(RiskLevelSchema), riskType: csv(RiskTypeSchema),
  slaStatus: csv(z.enum(FINDER_SLA_STATUSES)),
  hasUnresolvedException: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export const EntityFinderQuerySchema = EntityFinderCriteriaSchema.merge(PageQuerySchema)
  .extend({ evaluatedAt: z.string().datetime().optional() });
/** Stored criteria use arrays and booleans (not csv strings): `StoredCriteriaSchema` is the output type of
 *  EntityFinderCriteriaSchema, re-validated with a non-preprocessing twin; at least one key present. */

export const SAVED_FILTER_LIMITS = { nameMax: 80, perUser: 50 } as const;
export const BUILT_IN_FILTERS: ReadonlyArray<{ id: `builtin:${string}`; name: string; description: string;
                                               criteria: StoredCriteria }> = [ /* contracts § Built-in filters */ ];
```

### §2d Error codes and audit actions

- `ErrorCodeSchema` gains `SNAPSHOT_IN_PROGRESS`, `NO_RISK_EVALUATION`, `SAVED_FILTER_NAME_TAKEN`, `SAVED_FILTER_LIMIT` (`Errors` factories in `app-error.ts`).
- `AUDIT_ACTIONS` gains the six actions of research R15.

---

## §3 Internal types and pure modules

### §3a `apps/api/src/overview/rules/` (no Nest, no Prisma client, no clock)

| File | Exports | Responsibility |
|---|---|---|
| `categories.ts` | `categoryOf(outcome, rootCauseType)`, `otherCategories(primary, candidateTypes)` | research R5 |
| `at-risk.ts` | `mergeAtRisk(impaired, risks, clocks, terminalIds) → AtRiskCandidate[]` | reasons, highest risk, most urgent clock, terminal excluded (research R4) |
| `analysis-order.ts` | `compareForAnalysis(a, b)`, `rankForAnalysis(candidates, cap)` | spec FR-014 |
| `totals.ts` | `computeTotals(rows) → SnapshotTotals`, `assertTotalsInvariant(totals, rows)` | research R5 (006 `money.ts`) |
| `blockers.ts` | `groupBlockers(rows) → BlockerGroup[]`, `compareBlockers` | research R12 |
| `frequent.ts` | `frequentRootCauses(occurrences, statuses, T) → FrequentRow[]` (uses 008's `labelEntitiesOf`, `inWindow`) | research R10 |
| `sentences.ts` | category, reason, blocker, frequent and freshness sentences | contracts § Text templates |
| `drill.ts` | builders per `DrillTarget` kind | research R13 |
| `layout.ts` | `layoutFor(role)` | research R13 |

Internal shape of a candidate row (before analysis):

```ts
interface AtRiskCandidate {
  orderId: string; displayName: string; state: OperationalState;
  reasons: AtRiskReason[];                                    // fixed order
  impaired: { sourceSystem: string; sourceId: string; observedAt: Date } | null;
  risk: { id: string; level: 'HIGH' | 'MEDIUM' } | null;
  sla: { key: string; status: 'AT_RISK' | 'BREACHED'; dueAt: Date } | null;
  customerId: string | null;
  value: { units: bigint; currency: string } | null;
  sourceValues: SourceValue[]; disagreement: boolean; low: bigint | null; high: bigint | null;
}
```

### §3b `apps/api/src/search/rules/`

| File | Exports | Responsibility |
|---|---|---|
| `query-text.ts` | `escapeLike(q)`, `parseExceptionNumber(q)`, `parseInvestigationNumber(q)` | research R7 |
| `highlight.ts` | `highlightRanges(text, q): Array<[number, number]>` | research R7 |
| `criteria.ts` | `criteriaWhere(criteria, ctx: { latestSnapshotId: string | null; slaEntityIds: string[] | null }) → { where: Prisma.EntityWhereInput; notes: string[] }` | research R8 |

### §3c Other pure modules

- `apps/api/src/graph/freshness.ts`: `classifyFreshness(rows, T) → SourceFreshness[]` (research R11).
- `apps/api/src/common/concurrency/promise-pool.ts`: `mapWithConcurrency<T, R>(items, limit, fn): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>>`, results in input order.

---

## §4 Service algorithms

### §4a `SnapshotRunner.run({ trigger, actor })`

```text
evaluation = latest risk_evaluations WHERE status = COMPLETED ORDER BY number DESC   (none → NO_RISK_EVALUATION)
claim:  INSERT overview_snapshots (status RUNNING, running_slot true, trigger, requestedById, riskEvaluationId,
        asOf = evaluation.asOf, startedAt = now, graphVersionStart = max(source_records.seq))
        P2002 on running_slot → SNAPSHOT_IN_PROGRESS
try:
  candidates = AtRiskOrdersReader.load(asOf)              // research R4: 3 sources + terminal check + customers + values
  ranked     = rankForAnalysis(candidates, OVERVIEW_LIMITS.maxAnalyzedOrders)
  results    = mapWithConcurrency(ranked.analyzed, CONCURRENCY,
                 c => rootCause.analyze(c.orderId, { depth: 6, evaluatedAt: asOf.toISOString() }))
  rows       = ranked.all.map(c => toRow(c, results))      // outcome, primary candidate, otherCategories, category
  totals     = computeTotals(rows); assertTotalsInvariant(totals, rows)
  graphVersionEnd = max(source_records.seq)
  $transaction (timeout 120 s):
    createMany overview_snapshot_orders in chunks of 1000
    UPDATE snapshot SET status COMPLETED, running_slot NULL, finishedAt, graphVersionEnd, consistent, counts, totals
    audit overview.snapshot_completed
  prune (separate transaction, research R3)
catch e:
  UPDATE snapshot SET status FAILED, running_slot NULL, finishedAt, error = cut(e.message, 500); audit overview.snapshot_failed
```

`toRow`: outcome = analysis status, or `NOT_ANALYZED` beyond the cap, or `FAILED` when the pool returned an error (`error` = cut message). For `ROOT_CAUSES_FOUND`: `c0 = candidates[0]`, root-cause entity = `c0`'s root-cause step entity, `label = c0.label`, `confidence = c0.confidence`, `category = ROOT_CAUSE_CATEGORY_BY_TYPE[type]`, `otherCategories` from `candidates[1..]`. Otherwise `category = OTHER`.

### §4b `OverviewService.load(actor, evaluatedAt)`

`Promise.allSettled` over the calls of research R2, then per section `OK | UNAVAILABLE`. Snapshot-based sections read the snapshot (latest COMPLETED with `asOf ≤ evaluatedAt`), its `totals`, the blockers' first 5 (§5b) and the stale sources (research R11). `layout = layoutFor(actor.role)`.

### §4c Search SQL (`SearchRepository`, fixed shape, inside `$transaction([SET LOCAL pg_trgm.similarity_threshold = 0.3, …])`)

Entities (`$1` = q, `$2` = escaped q, `$3` = types or NULL, `$4` = limit):

```sql
-- tiered query (EXACT, PREFIX, CONTAINS)
WITH m AS (
  SELECT e.id, e.type, e.display_name, e.current_state,
    LEAST(
      CASE WHEN lower(e.display_name) = lower($1) THEN 0
           WHEN e.display_name ILIKE $2 || '%' THEN 1
           WHEN e.display_name ILIKE '%' || $2 || '%' THEN 2 ELSE 9 END,
      COALESCE((SELECT min(CASE WHEN lower(i.source_id) = lower($1) THEN 0
                                WHEN i.source_id ILIKE $2 || '%' THEN 1 ELSE 2 END)
                FROM entity_identifiers i
                WHERE i.entity_id = e.id AND i.source_id ILIKE '%' || $2 || '%'), 9)
    ) AS tier
  FROM entities e
  WHERE ($3::"EntityType"[] IS NULL OR e.type = ANY($3))
    AND (e.display_name ILIKE '%' || $2 || '%'
         OR e.id IN (SELECT entity_id FROM entity_identifiers WHERE source_id ILIKE '%' || $2 || '%'))
)
SELECT * FROM m ORDER BY tier, display_name COLLATE "C", id LIMIT $4;

-- similar fallback, only when the tiered total is 0 (research R7)
SELECT e.id, e.type, e.display_name, e.current_state, 3 AS tier
FROM entities e
WHERE ($3::"EntityType"[] IS NULL OR e.type = ANY($3)) AND e.display_name % $1
ORDER BY e.display_name COLLATE "C", e.id LIMIT $4;
```

Exceptions and investigations follow the same pattern over `title`, with the number tier (`number = $n` → 0; `number::text LIKE $digits || '%'` → 1, only when the query is digits with an optional prefix). Totals: the same `WHERE` in `SELECT count(*) FROM (… LIMIT 1001) t`, for the tiered query and, when it is 0, for the fallback. Then one query loads the identifiers of the page's entities, and one the exceptions' subjects / investigations' focus entities.

### §4d `EntityFinderService.list(query, now)`

```text
base   = buildEntityListWhere({ type, state, sourceSystem, q })     // 002, extended to arrays (one value = 002 behaviour)
ctx    = { latestSnapshotId: rootCauseCategory ? SnapshotQueryService.latestCompletedId() : null,
           slaEntityIds: slaStatus ? all pages of SlaClockService.clocks({ asOf: evaluatedAt ?? now, filters: { status } }) → entity ids : null }
parts  = criteriaWhere(criteria, ctx)
page   = pageEntities({ AND: [base, parts.where] }, cursor, limit)  // 002 ordering, cursor and mapper
return { ...page, meta: { evaluatedAt, snapshot, notes: parts.notes } }
```

### §4e `SavedFiltersService`

`list(actor)` → `{ builtIn: BUILT_IN_FILTERS, mine: rows of owner ordered by createdAt, id }` (each parsed; invalid ones flagged). `create`, `update`, `remove` as research R9, each with its audit row in the same transaction; P2002 → `SAVED_FILTER_NAME_TAKEN`; a row not owned by the caller → `Errors.notFound('Saved filter')`.

---

## §5 Queries

### §5a At-risk orders list (route 2)

`WHERE snapshot_id = $s [AND category = $c] [AND currency = $cur | AND amount_units IS NULL when valueUnknown]`, order `currency, amount_units DESC NULLS LAST, order.display_name COLLATE "C", order_id`, keyset cursor `{ currency, amountUnits, displayName, id }`. `summary` (same filter, no cursor): `count(*)`, `sum(amount_units)` per currency (equal to the figure, tested). Rows join the current `entities` for refs.

### §5b Blockers (route 3, Home top 5)

`GROUP BY root_cause_entity_id` over rows with `outcome = 'ROOT_CAUSES_FOUND'` of the snapshot: `count(*)`, per-currency `sum(amount_units)`, `count(*) FILTER (WHERE amount_units IS NULL)`, per-confidence counts, labels; then the linked unresolved exceptions for the page's entities in one query. Order and paging in TypeScript after grouping (at most one group per distinct root cause, bounded by the snapshot size).

### §5c 007 list addition

`ExceptionListQuerySchema` + `rootCauseLabel`, `rootCauseWindowEnd`; `buildWhere` adds `snapshots: { some: { kind: 'ROOT_CAUSE', rootCauseLabel: L, takenAt: { gt: end − 30 d, lte: end } } }`. No other 007 behaviour changes.

---

## §6 Entities (spec Key Entities → this model)

| Spec entity | Model |
|---|---|
| Overview Snapshot | `overview_snapshots` (+ `totals` JSON) |
| At-risk Order | `overview_snapshot_orders` |
| Cause Category | `CauseCategory` enum + `ROOT_CAUSE_CATEGORY_BY_TYPE` (shared) |
| Unresolved Blocker | computed from `overview_snapshot_orders` (§5b) |
| Frequent Root Cause | computed from `analysis_snapshots` (008) |
| Source Freshness | computed from `source_records` |
| Search Result | computed (§4c) |
| Saved Filter | `saved_filters` |
| Built-in Filter | `BUILT_IN_FILTERS` (shared constant) |
