# Research: Home Overview and Search

**Feature**: `010-home-dashboard-search` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

The spec has no clarification markers; its defaults are listed in its Assumptions. This document records the **design decisions**. They are binding for the implementer. Each one gives the decision, the rationale and the alternatives rejected. Section numbers (R1–R19) are referenced from plan.md, data-model.md and contracts/api.md.

Codebase facts this research relies on (state of `010-home-dashboard-search`: 001–003 implemented; 004–009 specified and planned, and 005–009 **must be merged before this feature starts**, see plan.md):

- `EntitiesService.list` (002, `apps/api/src/graph/entities.service.ts`) filters by `type`, `state`, `sourceSystem` and `q` (`displayName` or any `identifiers.sourceId` **contains**, case-insensitive, i.e. `ILIKE '%q%'`), ordered by `(displayName, id)` with a keyset cursor `{ displayName, id }`, and maps rows with `toEntityListItemDto`. `ListEntitiesQuerySchema` accepts one `type` and one `state`. `GET /api/source-systems` lists distinct `entity_identifiers.source_system`. `GraphModule` exports only `GRAPH_REPOSITORY`.
- Existing indexes: `entities (display_name, id)`, `(type, display_name, id)`, `(current_state, display_name, id)`; `entity_identifiers (source_id)` (B-tree, useless for `ILIKE '%q%'`); `source_records (entity_id, observed_at DESC, seq DESC)`. No `pg_trgm`. Prisma 6.19, PostgreSQL 16 (`postgres:16-alpine` Docker image, which ships the contrib extensions, `pg_trgm` included; the dev and test databases `opsgraph` and `opsgraph_test` are owned by the superuser `opsgraph`).
- Every source record has `source_system`, `source_id`, `observed_at`, `received_at` (Constitution I). Relationship-only systems (`InferenceRules`, `ManualEntry`) have no entity identifiers, so they are missing from `GET /api/source-systems`.
- 005: `RootCauseService.analyze(id, { depth, evaluatedAt })` (exported since 007) returns `RootCauseResponse` with `status` ∈ `ROOT_CAUSES_FOUND | NOT_BLOCKED | UNEXPLAINED` and `candidates` ordered confidence-first (stable on 003's ranking). Each candidate names its root-cause entity, `label` and `confidence`. p95 1.5 s per entity at 50k entities (005 SC-003).
- 006: `IMPACT_STATE_CLASS` (IMPAIRED, UNIMPAIRED, TERMINAL, INDETERMINATE), `PurchaseOrder`, `OrderValueReader.load(orderIds)` (current value + per-source latest values), pure `impact/analysis/money.ts` (`parseAmount`, `formatAmount`, `formatMoneyText`, bigint units of 10⁻⁴), the disagreement and range rules of 006 research R6. `GraphRepository.findAttributedCustomers`.
- 007: `ExceptionsQueryService.list(query, actor, now)` (exported since 008) with views `UNRESOLVED, OPEN, CRITICAL, MINE, MY_TEAMS, SLA_AT_RISK, ALL`, filter `sla[]`, sort `SLA_DUE`, `evaluatedAt`; `UNRESOLVED_STATUSES`; `exception_entities (entity_id, role)`; `formatDuration`.
- 008: 007's snapshot table renamed `analysis_snapshots` with denormalized `root_cause_entity_id`, `root_cause_label`, `taken_at`, `kind`, `exception_id | investigation_id`, index `(kind, taken_at, root_cause_label)`; pure `investigations/rules/recurrence.ts` (`labelEntitiesOf`, `inWindow(takenAt, T)`: `T − 30 d < takenAt ≤ T`); `InvestigationsQueryService.list(query, actor, now)` with view `MINE` (`ownerId = caller ∧ status ≠ CLOSED`) and sort `SEVERITY`.
- 009: `RisksQueryService.list(query)` (`status`, `level[]`, `type[]`, `entityId`, sorts), `SlaClockService.clocks({ asOf, filters, cursor, limit })` (status filter, `total`), the `risks` table (`entity_id`, `type`, `level`, `status`, partial unique open index), `risk_evaluations` (number, `as_of`, status, `graph_version`), `GraphChangeNotifier` (listener-list pattern), `RiskScheduler` (setTimeout chain, one pending slot), `GraphRepository.directLinks`, `graphVersion = max(source_records.seq)`.
- `AuditService.record(tx, input)` / `recordStandalone(input)`; `RolesGuard` audits `auth.forbidden`. `compareCodeUnits` is the only allowed in-memory string comparison. `env.ts` validates environment variables with zod.

---

## R1. Module layout

**Decision**:
- **`overview`** (new Nest module, `apps/api/src/overview/`): Home composition, revenue-at-risk snapshots, unresolved blockers, frequent root causes.
  - `overview.controller.ts`, `overview.service.ts` (route 1);
  - `snapshot/`: `SnapshotRunner`, `SnapshotTrigger` (listener + pending slot), `AtRiskOrdersReader`, `SnapshotQueryService`, `snapshots.controller.ts`, `at-risk-orders.controller.ts`, `blockers.controller.ts` (routes 2, 3, 5, 6);
  - `frequent-root-causes.service.ts` (+ controller, route 4);
  - `rules/` (pure: no Nest, no Prisma client, no clock): `categories.ts`, `at-risk.ts`, `analysis-order.ts`, `totals.ts`, `blockers.ts`, `frequent.ts`, `sentences.ts`, `drill.ts`, `layout.ts`.
- **`search`** (new Nest module, `apps/api/src/search/`): global search, the entity finder (structured criteria) and saved filters.
  - `search.controller.ts`, `search.service.ts`, `search.repository.ts` (fixed-shape raw SQL, no traversal), `entity-finder.controller.ts`, `entity-finder.service.ts`, `saved-filters.controller.ts`, `saved-filters.service.ts`;
  - `rules/` (pure): `query-text.ts` (trim, escape, number parsing), `highlight.ts`, `criteria.ts` (criteria → `Prisma.EntityWhereInput` parts), `built-in-filters.ts` is in shared (R9).
- **`graph`** gains `SourceFreshnessService` and the route `GET /api/source-systems/freshness` on the existing `SourceSystemsController`, plus an exported `EntitiesService` with the 002 filter building extracted into `buildEntityListWhere(query)` and the paging into `pageEntities(where, cursor, limit)` (behaviour unchanged).
- Exports added to existing modules (no behaviour change): `ImpactModule` → `OrderValueReader`; `InvestigationsModule` → `InvestigationsQueryService`; `RiskModule` → `RisksQueryService`, `SlaClockService`, `RiskEvaluationNotifier` (R3).
- Imports: `OverviewModule` imports `RootCauseModule`, `ImpactModule`, `ExceptionsModule`, `InvestigationsModule`, `RiskModule`, `GraphModule`, `AuditModule`. `SearchModule` imports `GraphModule`, `RiskModule`, `OverviewModule` (for the latest snapshot id), `AuditModule`.

**Rationale**: Home and search are two read-mostly contexts that sit on top of every other module. Putting them into `exceptions` or `risk` would make one producer depend on all the others (cycles: `risk` already imports `exceptions` and `graph`). Freshness is about source records, which `graph` already serves.

**Alternatives rejected**:
- **One `home` module holding search too**: search is used from every page, not only Home, and owns its own storage (saved filters).
- **Extending `GET /api/entities` in `graph`** with the new criteria: `graph` cannot import `risk` (for SLA clocks) or `overview` (for categories) without a cycle (R8).
- **Putting Home aggregation in the web app** (one request per figure): 10+ requests per Home load, and no single "evaluation time" echoed for determinism.

---

## R2. Reuse map: every figure comes from its owner

**Decision**: `OverviewService.load(actor, evaluatedAt)` calls existing services only. No figure is re-derived.

| Home figure | Call | Owner rule reused |
|---|---|---|
| Critical open exceptions (+ top 5) | `ExceptionsQueryService.list({ view: 'CRITICAL', sort: 'SLA_DUE', limit: 5, evaluatedAt })` → `total`, `items` | 007 views and SLA |
| Resolution SLA at risk / breached | `…list({ view: 'UNRESOLVED', sla: ['AT_RISK'] , limit: 1, evaluatedAt })` and `['BREACHED']` → `total` | 007 R7 SLA rule |
| Risks HIGH (+ top 5), MEDIUM | `RisksQueryService.list({ status: 'OPEN', level: ['HIGH'], sort: 'SCORE', limit: 5 })`, `level: ['MEDIUM'], limit: 1` → `total`, `latestEvaluation` | 009 lifecycle |
| SLA commitments at risk / breached (+ top 5) | `SlaClockService.clocks({ asOf: evaluatedAt, filters: { status: ['AT_RISK'] }, limit: 1 })`, `['BREACHED']`, and `['AT_RISK','BREACHED'], limit: 5` | 009 clock rule (shared with 007) |
| Revenue at risk, blockers | latest completed snapshot with `as_of ≤ evaluatedAt` (R3–R5, R12) | 005 analysis, 006 values, 009 risks/clocks |
| Frequent root causes | `FrequentRootCausesService.list(evaluatedAt)` over `analysis_snapshots` + 008 `labelEntitiesOf` (R10) | 007/008 snapshots, 008 window and recurrence |
| Data freshness | `SourceFreshnessService.list(evaluatedAt)` (R11) | provenance (Constitution I) |
| Assigned to me | `ExceptionsQueryService.list({ view: 'MINE' | 'MY_TEAMS', sort: 'SLA_DUE', limit: 5, evaluatedAt })`; `InvestigationsQueryService.list({ view: 'MINE', sort: 'SEVERITY', limit: 5, evaluatedAt })` | 007/008 views |

Each call runs in parallel (`Promise.allSettled`); a rejected call turns its section into `{ status: 'UNAVAILABLE', reason }` (spec FR-004), logged with the correlation id.

**Rationale**: spec FR-002 and the user request: the counts and lists a user opens from Home are the same services, so the equality "figure = list total" (FR-023) holds by construction and is still tested.

**Alternatives rejected**:
- **`COUNT(*)` queries in the overview module**: a second copy of 007's view predicates and 009's clock rules that would drift.
- **A cached Home payload**: hides staleness and breaks "same evaluation time → same figures".

---

## R3. Revenue-at-risk snapshots: trigger and lifecycle

**Decision**:
- **Storage**: `overview_snapshots` and `overview_snapshot_orders` (data-model §1). Totals per currency and category are stored on the snapshot (`totals` JSON) so Home reads them in one query; the order rows back every drill-down list.
- **Trigger**: 009's runner gains a `RiskEvaluationNotifier` (same listener-list pattern as 009's `GraphChangeNotifier`): after an evaluation's completion transaction commits with status COMPLETED, it calls `evaluationCompleted({ evaluationId, number, asOf })`. Listener errors are logged, never rethrown into the evaluation. `SnapshotTrigger` subscribes when `OVERVIEW_SNAPSHOT_AUTO=true` (default; `false` in `test/load-env.ts`).
- **Single run**: `SnapshotTrigger.trigger(kind)` keeps one in-process pending slot (009 R11 pattern: a trigger during a run causes exactly one more run). Across instances, the claim inserts the snapshot row with `running_slot = true`; the column is `UNIQUE` and nullable, and completion or failure sets it to `NULL`, so at most one RUNNING row exists (a unique violation `P2002` means another instance runs: retry in 15 s for automatic triggers, 409 `SNAPSHOT_IN_PROGRESS` for the manual route).
- **Manual**: `POST /api/overview/snapshots` (Administrators) runs synchronously and returns the completed snapshot, as 009's manual evaluation does. 409 `NO_RISK_EVALUATION` when no evaluation has completed.
- **Inputs**: the snapshot uses the **latest completed risk evaluation at claim time** (its id, number and `asOf`). `asOf` drives every time-dependent input: SLA clocks and 005's `evaluatedAt`.
- **Consistency**: `graph_version_start` and `graph_version_end` (`max(source_records.seq)`) are recorded; `consistent = start = end`. An inconsistent snapshot is still completed and shown with "data changed while this snapshot was computed"; the next evaluation triggers a new one.
- **Failure**: an exception outside per-order analysis marks the snapshot FAILED with its error (audit `overview.snapshot_failed`); Home keeps showing the previous completed snapshot.
- **Retention**: after each completion, in a separate transaction, delete snapshots (and their rows, `ON DELETE CASCADE`) whose `finished_at` is more than 24 hours before the completion time, never the latest completed one. When at least one is deleted, audit `overview.snapshots_pruned` (System, `{ count, numbers }`).

**Rationale**: spec FR-008, FR-015, FR-016. Per-order root-cause analysis costs up to 1.5 s, so it cannot run on each Home load; a stored snapshot keeps every figure equal to its drill-down list even while data changes, and aligns its time with the risk figures (same evaluation).

**Alternatives rejected**:
- **Live computation per request**: seconds to minutes per Home load; figure and list could differ.
- **Computing inside 009's evaluation transaction**: 005 must not run inside a transaction (007 plan), and a slow analysis would delay every risk.
- **Partial unique index on `status = 'RUNNING'`** (009's approach): Prisma cannot declare partial indexes; the nullable unique `running_slot` gives the same guarantee and stays drift-free.
- **Keeping snapshots forever**: about 288 snapshots a day; they are derived data, reproducible from the audit trail of their inputs.

---

## R4. The at-risk order set

**Decision** (pure `rules/at-risk.ts`, inputs from `AtRiskOrdersReader`):
1. **Impaired**: `entities WHERE type = 'Order' AND current_state = ANY(IMPAIRED_STATES)` with the current state observation (latest by `observed_at`, `seq`) for its citation (source system, source id, observed time).
2. **Risk**: `risks WHERE status = 'OPEN' AND level IN ('HIGH','MEDIUM')` joined to entities of type `Order` → `{ riskId, number, type, level }`. With several open risks on one order, keep the highest level, then score, then number.
3. **SLA**: `SlaClockService.clocks({ asOf, filters: { status: ['AT_RISK','BREACHED'], source: 'TERM' } })` (all pages) → clocks whose entity is an Order; keep the most urgent (009's order).
4. Union by order id; drop terminal orders (`IMPACT_STATE_CLASS = TERMINAL`). Reasons are stored in fixed order `IMPAIRED, RISK, SLA`.
5. **Customer**: `GraphRepository.directLinks({ entityIds, relationshipTypes: ['PLACED'], side: 'TO' })`; when several, the first by display name (`compareCodeUnits`), then id.
6. **Values**: `OrderValueReader.load(ids)` (006). Usable value, disagreement and per-order low/high in the current currency follow 006 research R6 exactly; amounts are stored as bigint units of 10⁻⁴.

**Rationale**: spec FR-009. Each reason is an existing conclusion (006 state class, 009 risk, 009 clock). LOW risks are below attention by 009's own thresholds.

**Alternatives rejected**:
- **006 "potential" orders** (affected if a problem continues): every order downstream of any impaired entity, which is most of the graph during an incident; that is impact analysis, not "requires attention".
- **Only impaired orders**: would miss orders that are fine today but about to breach (009's purpose).

---

## R5. Cause category attribution: one order, one category

**Decision**:
- **Analysis order** (pure `rules/analysis-order.ts`, spec FR-014): risk level HIGH, MEDIUM, none; then usable value descending, compared within currency code order (orders without a value last); then display name (`compareCodeUnits`); then id. The first `OVERVIEW_LIMITS.maxAnalyzedOrders` (5,000) are analyzed; the rest get outcome `NOT_ANALYZED`.
- **Analysis**: `RootCauseService.analyze(orderId, { depth: TRACE_DEFAULT_DEPTH (6), evaluatedAt: asOf })`, through a small promise pool (`common/concurrency/promise-pool.ts`, about 20 lines, `OVERVIEW_ANALYSIS_CONCURRENCY` default 4). Never inside a transaction. A thrown error records outcome `FAILED` with the message (cut to 500 characters) for that order only.
- **Primary candidate** = `candidates[0]` (005's order). Stored: outcome (= 005 status), root-cause entity id, label, confidence, `candidate_count`, and `other_categories` = the distinct categories of `candidates[1..]` that differ from the primary's, in category order.
- **Category** (pure `rules/categories.ts`): `ROOT_CAUSE_CATEGORY_BY_TYPE: Record<EntityType, CauseCategory>` in shared, so the compiler rejects a missing type (including 006's `PurchaseOrder`):

  | Category | Types |
  |---|---|
  | `SUPPLIER` | Supplier, Product, PurchaseOrder |
  | `PAYMENT` | Payment, Invoice |
  | `WAREHOUSE` | Warehouse, Shipment |
  | `APPROVAL` | Approval, BudgetRequirement |
  | `OTHER` | Order, Customer, Contract, SLA |

  Outcome `NOT_BLOCKED`, `UNEXPLAINED`, `NOT_ANALYZED`, `FAILED` → `OTHER` with that sub-reason.
- **Totals** (pure `rules/totals.ts`, using 006's `money.ts`): per currency, over orders with a usable value: total, per category amount and count, `lowConfidenceAmount` (primary confidence LOW), `disagreementAmount` and the range `{ low, high }` (sums of per-order low/high, null when no disagreement). Per category over all orders: order count and value-unknown count. **Invariant** (asserted in the runner before commit, and in tests): for every currency, Σ categories = total, and Σ category order counts = at-risk order count.

**Rationale**: spec FR-010 to FR-013 and the user's reconciliation request. 006 counts an order once however many paths reach it; attributing each order to exactly one category is the same rule along the "cause" axis, so the breakdown always adds up. Using 005's first-ranked candidate means the category matches what the order's Entity 360 Root cause section shows first.

**Alternatives rejected**:
- **Splitting an order's value across its candidates' categories**: fractional money, not explainable, and the parts would not match any list.
- **Counting an order in every category it touches**: categories would add up to more than the total (double counting).
- **Categorizing by the cause entities' 006 impact** (for each impaired supplier, payment…, its current orders): an order reached from two causes would need a precedence rule that is not 005's ranking, and the result would disagree with the order's own root-cause section.
- **Categorizing from 009's "longest unresolved dependency" factor**: that names the oldest impaired upstream entity, not the root cause (for Order #18492 it is the payment, while the root cause is the budget code).

---

## R6. Search indexes: `pg_trgm`, not full-text search

**Decision**:
- Enable the PostgreSQL **`pg_trgm`** extension in this feature's migration. In `schema.prisma`: `previewFeatures = ["postgresqlExtensions"]` on the generator and `extensions = [pg_trgm]` on the datasource, so Prisma generates `CREATE EXTENSION IF NOT EXISTS "pg_trgm"` and `prisma migrate diff` reports no drift. This is a database extension shipped with PostgreSQL contrib, not an npm dependency. `pg_trgm` is a trusted extension since PostgreSQL 13, so a database owner without superuser rights can create it.
- **GIN trigram indexes**, declared in `schema.prisma` with `type: Gin` and `ops: raw("gin_trgm_ops")` (supported by Prisma for PostgreSQL), so they are not drift:
  - `entities (display_name)`;
  - `entity_identifiers (source_id)`;
  - `exceptions (title)`;
  - `investigations (title)`.
- They accelerate `ILIKE '%q%'` (for patterns with at least 3 characters) and the similarity operator `%`. 002's existing `contains`/`mode: 'insensitive'` filter becomes index-backed with no code change.

**Rationale**: the user request names full-text or trigram indexes; the data is identifiers ("PAY-88213", "SO-18492", "18492"), short names and titles. Trigrams give substring, prefix and typo tolerance on exactly these, deterministically.

**Alternatives rejected**:
- **Full-text search (`tsvector`)**: tokenizes "PAY-88213" and "#18492" unpredictably, has no substring or typo matching, and stems words, which suits prose (descriptions, notes) that is out of scope.
- **Hand-written index SQL only**: Prisma would see the indexes as drift and drop them in a later migration.
- **`unaccent`**: a second extension for a need not in the spec (accent-insensitive search is out of scope).
- **An external search engine**: a new service and dependency.

---

## R7. Search query, ranking and highlights

**Decision**:
- **Input** (pure `rules/query-text.ts`): trim; 2–100 characters (zod). `likePattern = escapeLike(q)` escaping `\`, `%`, `_` (default `ESCAPE '\'`). `number = /^(?:EX-)?(\d{1,9})$/i` for exceptions and `/^(?:INV-)?(\d{1,9})$/i` for investigations.
- **One repository method per group** (`SearchRepository.entities | exceptions | investigations`), each a fixed-shape `$queryRaw` (data-model §4c) run in one `$transaction` that first executes `SET LOCAL pg_trgm.similarity_threshold = 0.3`, so the threshold never depends on server settings.
- **Tiers** computed in SQL, lowest wins for a row: `0 EXACT` (lower(field) = lower(q), or number = n), `1 PREFIX` (field `ILIKE pattern || '%'`, or number text starts with the digits), `2 CONTAINS` (`ILIKE '%' || pattern || '%'`). Entity fields: `display_name` and every `entity_identifiers.source_id`.
- **Similar fallback**: only when a group's tiered query returns **no row**, a second query returns `3 SIMILAR` rows (`display_name % q` / `title % q`, names and titles only). Trigram similarity of short names is noisy ("order #1849" is ≥ 0.3 similar to every "Order #…"), so mixing it with real matches would bury them; as a fallback it serves typos ("Fabrikam Componets").
- **Order**: `tier, <name or title> COLLATE "C", <id or number>`. `LIMIT` = 10 (box) or 50 (page). **Total**: `count(*)` over the same `WHERE` with `LIMIT 1001`; 1001 → `{ total: 1000, totalIsLowerBound: true }`.
- **Filters**: `groups` (ENTITY, EXCEPTION, INVESTIGATION; default all) and `entityTypes` (`type = ANY($types)`); a group not requested is not queried and is absent from the response.
- **Highlights** (pure `rules/highlight.ts`): for each returned field (display name, every identifier of the entity that contains the query, the title, the formatted number), the non-overlapping occurrences of `q` compared with `toLowerCase()`, as half-open `[start, end)` UTF-16 ranges, left to right. If lowercasing changes a string's length, that field gets no ranges (rare Unicode case). SIMILAR rows return their fields with empty ranges.
- **Matched identifiers**: the entity row lists the identifiers whose `source_id` contains the query (with source system), up to 3, plus the primary identifier.

**Rationale**: spec FR-028 to FR-032. Tiers make exact identifiers win (§20's "Payment #9912") while typos still find names. Literal matching avoids accidental wildcards. A fixed threshold and unique sort keys make results deterministic (spec Story 3 scenario 7).

**Alternatives rejected**:
- **`similarity()` scores as the ranking**: floating-point ranks are hard to explain and to test; the tier is a published rule.
- **`word_similarity`/`<%`**: better for long titles, but its threshold semantics differ per operator; one operator keeps behaviour simple.
- **Searching through 002's `GET /api/entities`**: ordered by name only, no tiers, no exceptions or investigations.

---

## R8. Structured criteria: the entity finder

**Decision**:
- New route `GET /api/entity-finder` (search module) whose query is a **superset** of 002's `ListEntitiesQuery`: `type` and `state` accept several values (repeated keys or comma-separated, 007's `csv` preprocess; one value behaves exactly as in 002), plus `stateClass[]`, `rootCauseCategory[]`, `riskLevel[]`, `riskType[]`, `slaStatus[]` (`AT_RISK`, `BREACHED`), `hasUnresolvedException`, `evaluatedAt`. The response is 002's `EntityListResponse` plus `meta` (data-model §2c).
- **Reuse of 002**: `buildEntityListWhere(base)` and `pageEntities(where, cursor, limit)` are extracted from `EntitiesService.list` (002's own behaviour, tests unchanged) and exported. The finder ANDs criteria parts (pure `rules/criteria.ts`):
  - `stateClass` → `currentState IN` the union of the classes' states (006's `IMPACT_STATE_CLASS`), intersected with `state` when both are given;
  - `rootCauseCategory` → `overviewSnapshotOrders: { some: { snapshotId: <latest completed>, category: { in } } }`; no completed snapshot → the part matches nothing and `meta.notes` says why;
  - `riskLevel`/`riskType` → `risks: { some: { status: 'OPEN', level?: { in }, type?: { in } } }` (one `some`, so both apply to the same risk);
  - `slaStatus` → `id IN` the entity ids of `SlaClockService.clocks({ asOf: evaluatedAt ?? now, filters: { status } })` (all pages; both TERM and SLA_RECORD clocks);
  - `hasUnresolvedException` → `exceptionLinks: { some | none: { exception: { status: { in: UNRESOLVED_STATUSES } } } }`.
- Ordering and keyset cursor are 002's (`displayName, id`), so the Entities page keeps its behaviour. The web Entities page calls the finder; `GET /api/entities` stays unchanged for its other callers (004, 007, 008 pickers).

**Rationale**: spec FR-033. `graph` cannot depend on `risk`/`overview`, so the cross-context criteria live in `search`; reusing 002's where-builder and pager keeps one entity-list behaviour.

**Alternatives rejected**:
- **Adding the criteria to `GET /api/entities`**: module cycle (R1), and 002's response would change for every caller.
- **Root-cause category computed live per entity**: one 005 analysis per candidate order per request.
- **SLA status stored on entities**: clocks are computed (009 R2), never stored.

---

## R9. Saved filters and built-in filters

**Decision**:
- **Storage**: `saved_filters (id, owner_id, name, name_key, criteria jsonb, created_at, updated_at)` with `name_key = lower(trim(name))` and a normal unique index `(owner_id, name_key)` (no expression index, so no drift).
- **Criteria** are `EntityFinderCriteriaSchema` (the finder query without `cursor`, `limit`, `evaluatedAt`), validated on write **and** on read (a stored filter that no longer parses, for example after an enum value is removed, is returned with `valid: false` and its issues, never silently altered).
- **Ownership**: every query filters on `owner_id = caller`. Another user's id → 404 (`Saved filter`), so existence is not revealed. No role can read others' filters.
- **Limits**: name 1–80 characters after trim; 50 per user (409 `SAVED_FILTER_LIMIT`); duplicate name per user ignoring case (409 `SAVED_FILTER_NAME_TAKEN`, from `P2002`).
- **Mutations**: `POST` (create), `PATCH` (name and/or criteria), `DELETE` (hard delete). Each writes its audit row in the same transaction (`before`/`after` = the DTO). A no-op `PATCH` returns 200 and writes nothing.
- **Built-in filters**: `BUILT_IN_FILTERS` constant in shared (contracts § Built-in filters), ids `builtin:<slug>`, returned by `GET /api/saved-filters` next to the user's own; they are not stored and cannot be changed (their ids are not UUIDs, so the mutation routes reject them with 400).

**Rationale**: spec FR-034 to FR-036. Private, per-user storage is the smallest model that answers §20's "advanced queries" without natural language.

**Alternatives rejected**:
- **Storing built-ins as rows owned by System**: needs a seed, migrations for changes, and an ownership exception.
- **Shared/team filters**: out of scope (spec Assumptions).
- **Saving page addresses as strings**: unvalidated, and breaks silently when parameters change.

---

## R10. Frequent root causes, reconciled with 008's "recurring"

**Decision** (`FrequentRootCausesService`, pure `rules/frequent.ts`):
- **Window**: 008's `inWindow(takenAt, T)`: `T − 30 days < takenAt ≤ T`.
- **Occurrences**: one query, `analysis_snapshots WHERE kind = 'ROOT_CAUSE' AND root_cause_label IS NOT NULL AND taken_at > $start AND taken_at <= $T`, selecting `root_cause_label, root_cause_entity_id, exception_id, investigation_id` (index `(kind, taken_at, root_cause_label)`), plus the statuses of the exceptions involved.
- **Frequent** (spec FR-018): group exception-owned occurrences by label → distinct exception ids; keep labels with **≥ 3** (`OVERVIEW_LIMITS.frequentMinExceptions`). Per label: `exceptionCount`, `rootCauseEntityCount` (distinct entities among those exceptions' occurrences), `unresolvedExceptionCount` (status ∈ `UNRESOLVED_STATUSES`).
- **Recurring indicator**: 008's own `labelEntitiesOf(occurrences)` over **all** occurrences (exceptions and investigation pins), and `recurring = map.get(label).size ≥ 2`, with 008's text family: `Recurring: <label> on <n> root causes in the last 30 days`. 008's module is imported, not copied.
- **Order**: `exceptionCount DESC`, then label (`compareCodeUnits`).
- **Drill-down**: 007's list gains `rootCauseLabel` and `rootCauseWindowEnd` (both required together): `snapshots: { some: { kind: 'ROOT_CAUSE', rootCauseLabel: L, takenAt: { gt: end − 30 d, lte: end } } }`. Combined with `view=ALL`, its `total` equals the row's `exceptionCount` (tested).

**Rationale**: the user asked for "same root cause causing ≥ 3 exceptions"; 008 already published "recurring" as "≥ 2 distinct root-cause entities", and states that one entity seen by several cases is one problem. The two measures answer different questions (how often vs how widespread), so they get different names, share labels, snapshots and window, and are shown side by side.

**Alternatives rejected**:
- **Redefining "recurring" as ≥ 3 exceptions**: silently changes 008's list view and its fixtures.
- **Requiring both rules**: hides the "same budget code broke three orders" case that the user's definition targets.
- **Only the latest snapshot per exception**: needs `DISTINCT ON` raw SQL; 008 chose "recorded in the window" for the same reason (008 R12).

---

## R11. Data freshness

**Decision** (`SourceFreshnessService` in `graph`, pure `graph/freshness.ts`):
- One aggregate: `SELECT source_system, max(observed_at), max(received_at) FROM source_records GROUP BY source_system`, served by a new index `source_records (source_system, observed_at, received_at)` (index-only scan).
- Per system at evaluation time T: `ageMs = max(0, T − newestObservedAt)`, `observedAfterEvaluation = newestObservedAt > T`, `status = STALE` when `T − newestObservedAt > 24 h` (`OVERVIEW_LIMITS.staleAfterMs`), else `FRESH`. Exactly 24 h is Fresh.
- Order: STALE first; then `newestObservedAt` ascending; then system name (`compareCodeUnits`).
- Sentence: `<system>: newest record observed <iso>, <dur> before the evaluation time; <Fresh|Stale> (stale after 1d).` (007's `formatDuration`).
- **Revenue-at-risk stale sources** (spec FR-021): the distinct `state_source_system` of the snapshot's rows with reason `IMPAIRED`, intersected with the stale systems at Home's evaluation time.

**Rationale**: spec FR-020, §52. Source records already hold both times; listing systems from `source_records` includes relationship-only systems (InferenceRules, ManualEntry).

**Alternatives rejected**:
- **`imports.received_at`**: an import may carry several source systems, and a rejected import has no records.
- **Per-system thresholds**: configuration UI and storage not required by the spec.

---

## R12. Unresolved blockers

**Decision**: computed from the snapshot (`SnapshotQueryService.blockers`, pure `rules/blockers.ts`):
- Group the snapshot's rows with outcome `ROOT_CAUSES_FOUND` by `root_cause_entity_id`: `orderCount`, per-currency amounts (usable values only), value-unknown count, `confidences` (orders per primary confidence) and the label (all rows of one entity share 005's label rule; if they differ, the most frequent, then `compareCodeUnits`).
- Entity refs are current (`entities`), plus the linked unresolved exceptions in any role (`exception_entities` ⨝ `exceptions`, status unresolved, ordered by severity rank then number; first 3 and the total).
- Order: `orderCount DESC`, display name, id. Count = number of groups.

**Rationale**: spec FR-017. The root causes behind at-risk orders are what an operations team can fix; listing every impaired entity would mix causes and symptoms (an impaired order is also "impaired").

**Alternatives rejected**:
- **009's `DIRECT_IMPAIRED_DEPENDENTS` > 0**: counts intermediate blockers (the payment and the approval) as separate problems.
- **A separate blockers table**: the snapshot rows already hold the grouping key.

---

## R13. Overview payload, drill targets and role layout

**Decision**:
- `GET /api/overview?evaluatedAt=` returns all sections in one response (contracts § Response schemas), each `{ status: 'OK', data } | { status: 'UNAVAILABLE', reason }`.
- **Drill targets**: every figure carries a typed `DrillTarget` (discriminated union in shared: `EXCEPTIONS`, `INVESTIGATIONS`, `RISKS`, `SLA_CLOCKS`, `AT_RISK_ORDERS`, `BLOCKERS`, `FREQUENT_ROOT_CAUSES`, `ENTITY_FINDER`), whose `query` is a partial of that list's **own request schema**. The web turns it into a page address with that feature's existing params serializer (`exceptions-params.ts`, `risks-params.ts`, `investigations-params.ts`, …). An e2e test sends each target's `query` to its API and asserts `total` = figure.
- **Layout** (pure `rules/layout.ts`): `ANALYST → ASSIGNED_FIRST`; `OPS_MANAGER`, `ADMIN → TOTALS_FIRST`. The payload is otherwise identical for every role (tested by deep equality after removing `layout` and the actor-specific Assigned section).
- **"As of" times**: `evaluatedAt` (echoed), `risks.latestEvaluation.asOf`, `revenueAtRisk.snapshot.asOf`, freshness `evaluatedAt`.
- **Snapshot selection**: latest COMPLETED snapshot with `as_of ≤ evaluatedAt` (order `as_of DESC, number DESC`); none → `revenueAtRisk.data = null`, `blockers.data = null` with the sentence `No revenue-at-risk snapshot is available yet.`

**Rationale**: spec FR-001, FR-003, FR-023. Typed drill targets tie every number to the request that reproduces it, so drift between Home and the lists fails a test rather than a user.

**Alternatives rejected**:
- **Server-built URL strings**: the API would hard-code web routes and query formats owned by other features.
- **One endpoint per section**: more round trips and no single evaluation time; section independence is achieved inside one response.

---

## R14. Determinism

**Decision**:
- Route 1, 4, 7 and the finder take an explicit `evaluatedAt` (default: request time, read once in the controller, echoed). The snapshot uses its evaluation's `asOf`.
- Pure modules never read the clock or randomness. Every SQL ordering ends in a unique key; in-memory ordering uses `compareCodeUnits`. Maps and sets are sorted before output.
- Money uses bigint units; no floating point anywhere.
- Search sets the trigram threshold per transaction (R7).
- **Snapshot determinism**: same graph version, same open risks and same `asOf` → identical rows and totals (tested by computing two manual snapshots without changes and comparing rows and totals byte for byte).

**Rationale**: Constitution III and spec FR-003, Story 3 scenario 7.

---

## R15. Audit

**Decision**: new `AUDIT_ACTIONS`:

| Action | Target | Actor | before | after | metadata |
|---|---|---|---|---|---|
| `saved_filter.created` | `saved_filter` / id | user | — | `SavedFilterDto` | — |
| `saved_filter.updated` | `saved_filter` / id | user | changed fields | changed fields | — |
| `saved_filter.deleted` | `saved_filter` / id | user | `SavedFilterDto` | — | — |
| `overview.snapshot_completed` | `overview_snapshot` / id | system, or user (manual) | — | `{ number, asOf, riskEvaluationNumber, orderCount, analyzedCount, consistent, totals }` | `{ durationMs }` |
| `overview.snapshot_failed` | `overview_snapshot` / id | system, or user | — | `{ status: 'FAILED', error }` | — |
| `overview.snapshots_pruned` | `overview_snapshot` / — | system | `{ numbers }` | `{ count }` | — |

Rows are written in the same transaction as the change. Reads (Home, search, lists) write nothing. Refusals of the manual snapshot route are audited by `RolesGuard` (`auth.forbidden`).

**Rationale**: Constitution IV, spec FR-038. Snapshot rows are derived data; auditing each snapshot (not each order row) keeps the trail meaningful.

---

## R16. Web design

**Decision**:
- **Header search** (`components/search/GlobalSearch.tsx`): a combobox (`role="combobox"`, `aria-expanded`, listbox with grouped `role="option"` items). `useSearchShortcut` listens on `document` for `/` (ignored when the event target is an input, textarea, select or contenteditable) and `Ctrl+K`/`Meta+K` (always, `preventDefault`). Debounce 200 ms, minimum 2 characters, TanStack Query key `['search', q, groups, entityTypes]`, `staleTime` 30 s, previous results kept while typing. Arrow keys move, Enter opens, Escape closes and restores focus. Empty box: saved and built-in filters. Footer: `See all results` → `/search?q=…`.
- **`Highlight`** renders ranges with `<mark>`; text outside ranges is plain text (no HTML injection: ranges are applied to the string, never to HTML).
- **Home** (`pages/home/`): `HomePage` reads `useOverview()` (refetch every 60 s, `evaluatedAt` from the URL when present for reproducible links) and renders `TotalsSection` and `AssignedToMeSection` in `layout` order. Each card is text and tables, never a chart, with its "as of" line and a link per number built by `drillHref(target)`. A failed section renders `role="alert"` text in its card only.
- **Drill pages**: `/overview/at-risk-orders`, `/overview/blockers`, `/overview/root-causes`; params in `overview-params.ts` (zod-validated, invalid → alert with reset link, as 004). Other figures open 007/008/009 pages.
- **Entities page**: calls `/api/entity-finder`; `EntityFilters` adds multi-selects for types, states, state classes, categories, risk levels and types, SLA status and the exception toggle; `SavedFiltersPanel` (built-in and mine) and `SaveFilterDialog`. Criteria live in the URL.
- **Exceptions page (007)**: `exceptions-params.ts` accepts `rootCauseLabel` + `rootCauseWindowEnd` and shows a removable chip "Root cause: <label>, 30 days to <time>".
- Every response is parsed with its shared schema through `apiFetch`.

**Rationale**: spec FR-027 to FR-036, invariant 6 (Home pairs numbers with text and lists, no graph view).

---

## R17. Testing strategy

**Decision**:
- **Vitest (shared)**: schemas (criteria, search query, overview), `ROOT_CAUSE_CATEGORY_BY_TYPE` completeness, built-in filters parse.
- **Jest unit (api, pure)**: `categories`, `at-risk`, `analysis-order`, `totals` (several currencies, value unknown, disagreement ranges, invariant), `blockers`, `frequent` (window boundaries, recurring indicator via 008), `sentences`, `drill`, `layout`, `query-text` (escaping, numbers), `highlight` (overlaps, case, Unicode length change), `criteria`, `freshness` (24 h boundary, future observations), `promise-pool` (concurrency bound, order of results, error isolation), `SnapshotTrigger` with fake timers.
- **Jest + supertest e2e** (real Postgres, risk scheduler and auto snapshots disabled):
  - `overview-snapshot.e2e-spec.ts`: H1, H2, determinism, single run (409), failure, pruning, no evaluation (409), 005 equality per row, 006 cross-checks;
  - `overview.e2e-spec.ts`: H5 per role, every drill target's total = figure, section failure isolation (a test module overriding one provider to throw);
  - `frequent-root-causes.e2e-spec.ts`: H3 and 007's new filter;
  - `source-freshness.e2e-spec.ts`: H4 and boundaries;
  - `search.e2e-spec.ts`: H7;
  - `entity-finder.e2e-spec.ts`, `saved-filters.e2e-spec.ts`: H6, privacy, limits, audit;
  - `overview-auto-snapshot.e2e-spec.ts`: with `OVERVIEW_SNAPSHOT_AUTO=true`, a manual risk evaluation triggers a snapshot within 30 s;
  - `authz-matrix.e2e-spec.ts`: + 13 rows; 002, 007, 008 and 009 suites unchanged and green (007 gains filter cases).
- **Built-set helpers**: a multi-currency, multi-candidate, value-disagreement dataset (test-only import document) for totals and attribution edge cases; direct `analysis_snapshots` inserts for H3 (as 008's built sets).
- **Performance** (`perf-overview.e2e-spec.ts`, `perf-search.e2e-spec.ts`) behind `RUN_PERF=1`.

---

## R18. Performance

**Decision** and budgets (SC-004 to SC-006):

| Operation | Budget | How |
|---|---|---|
| Search, 3 groups, 50k entities / 10k exceptions / 10k investigations, p95 | < 1 s | GIN trigram indexes, 3 bounded queries + 3 capped counts, run in parallel |
| Home, all sections, p95 | < 2 s | 11 existing service calls in parallel (each < 1 s by its own feature's budget); snapshot totals read from one row |
| At-risk orders / blockers first page, p95 | < 1 s | indexes `(snapshot_id, category, currency, amount_units)`, `(snapshot_id, root_cause_entity_id)` |
| Snapshot, 1,000 at-risk orders, 50k graph | < 2 min | 4 concurrent 005 analyses (avg ≤ 0.5 s each expected), batched readers, `createMany` in chunks of 1,000 |
| Freshness | < 200 ms | index-only aggregate |

The 5,000-order analysis cap bounds the worst case (about 10 minutes at 0.5 s and concurrency 4); the spec states the limit and the snapshot reports it.

**Risk** (recorded for review): 005's p95 of 1.5 s per analysis was measured for hub entities; if typical order analyses are slower than 0.5 s, SC-006 fails and the concurrency default or the cap must be revisited in `questions.md` before changing any rule.

---

## R19. Dependencies

**Decision**: **no new npm dependencies**. The PostgreSQL extension `pg_trgm` (contrib, shipped with the `postgres:16-alpine` image) and Prisma's `postgresqlExtensions` preview flag (a configuration of the installed Prisma) are the only platform additions. The promise pool is about 20 lines in `common/`. Keyboard shortcuts use DOM listeners.

**Alternatives rejected**: `p-limit` (one 20-line function), `cmdk`/`kbar` (a combobox the app can render with standard ARIA), `fuse.js` (client-side fuzzy search cannot scale to 50k entities).
