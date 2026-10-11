# Research: Risk Detection and SLA Management

**Feature**: `009-risk-sla` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

The spec has no clarification markers; its defaults are listed in its Assumptions. This document records the **design decisions**. They are binding for the implementer. Each one gives the decision, the rationale and the alternatives rejected. Section numbers (R1–R22) are referenced from plan.md, data-model.md and contracts/api.md.

Codebase facts this research relies on (state of `009-risk-sla`: 001–003 implemented; 004–008 specified and planned, and 005–008 **must be merged before this feature starts**, see plan.md):

- `PrismaGraphRepository` holds the only recursive SQL. Its CTEs use `UNION` over `(entity_id, depth)` with `depth < maxDepth + 1` as the cycle guard and depth bound. 006 adds `traceImpact` / `impactReachable`, which does not expand terminal entities (COMPLETED, CANCELLED) other than the start.
- `DEPENDENCY_DIRECTION` (shared `tracing.ts`) maps the 11 traceable relationship types to their dependent end: REQUIRES, DEPENDS_ON, FULFILLED_BY, SUPPLIED_BY, CONTAINS → `from` depends on `to`; BLOCKS, PLACED, HAS, GOVERNS, DEFINES, GENERATES → `to` depends on `from`.
- 006 adds `IMPACT_STATE_CLASS` (IMPAIRED: PENDING, WAITING, BLOCKED, MISSING, DELAYED, FAILED, SUSPENDED, AT_RISK; UNIMPAIRED: ACTIVE; TERMINAL: COMPLETED, CANCELLED; INDETERMINATE: UNKNOWN), `IMPAIRED_STATES`, `TERMINAL_STATES`, and the `PurchaseOrder` entity type. `TracingModule` exports `StateEvidenceReader` (per-source latest state per entity).
- Every graph write (entity, state observation, relationship, event) comes with a `source_records` row in the same import transaction; `source_records.seq` is a global `BIGINT` identity. `ImportService.run` commits one `$transaction` per import with outcome APPLIED, REJECTED or DRY_RUN.
- 007 plans `ExceptionsService.create` with a system actor (`{ id: null, role: 'ADMIN', teamIds: ∅, system: true }`, used by the seed with `createdFrom: 'SEED'`), `ExceptionCreatedFrom` = EXCEPTIONS_AREA | ENTITY | ROOT_CAUSE | SEED, `OwnerRefSchema`, `SLA_WINDOW_MS`, `computeSlaStatus`, `slaAtRiskAt` (`dueAt − floor(max(0, window) / 4)`), `formatDuration`, the SLA sentences, `NotificationsService`, `TeamsService`, the `VERSION_CONFLICT` and `INVALID_STATE` error codes, and `exception_entities (entity_id, role)`.
- 008 renames 007's snapshot table and adds the Entity 360 "Investigations" section after "Exceptions".
- `AuditService.record(tx, input)`, `recordMany(tx, inputs)`, `recordStandalone(input)`; `actorType: 'system'` for automated work. `RolesGuard` audits `auth.forbidden`.
- `env.ts` validates environment variables with zod. `rxjs` is a dependency (Nest); no scheduling library is installed.
- `compareCodeUnits` (`apps/api/src/graph/traversal/path-order.ts`) is the only allowed string comparison.

---

## R1. Module layout

**Decision**:
- **`risk`** (new Nest module, `apps/api/src/risk/`), the bounded context CLAUDE.md lists. Sub-folders:
  - `sla/`: SLA terms (controller, service, mapper) and clock computation (`SlaClockService`, `ClockInputsReader`);
  - `config/`: configuration versions (controller, service, defaults, validation);
  - `engine/`: **pure** modules: measures, bands, scoring, confidence, factor sentences, headline, material-change comparison, ordering (no Nest, no Prisma client, no clock);
  - `evaluation/`: `RiskInputsReader`, `RiskEvaluationService` (runner), `RiskScheduler`, `RiskLifecycle` (diff and writes), `AutoExceptionService`, controllers;
  - `risks.controller.ts`, `risks-query.service.ts`, `risk.mapper.ts`, `seed/risk-seed.service.ts`.
- **`graph`** gains two `GraphRepository` methods (`reachBatch`, `directLinks`, R5) and a `GraphChangeNotifier` provider (R11), all exported.
- **`ingestion`** imports `GraphModule` and calls `GraphChangeNotifier.importApplied()` after an APPLIED import commits.
- **`exceptions`** exports `ExceptionsService` (007 change, R14).
- `RiskModule` imports `GraphModule`, `TracingModule` (for `StateEvidenceReader`), `ExceptionsModule`, `UsersModule` (owner validation through `TeamsService`), `AuditModule`.

**Rationale**: CLAUDE.md lists `risk`; SLA commitments exist only to feed risk and the Risks & Alerts area, so a separate `sla` module would be a second context with one consumer. All traversal stays in `GraphRepository`.

**Alternatives rejected**:
- **Calling `ImpactService.summary` per entity** for downstream counts: one CTE and three path selections per entity; at 50k entities a run would take hours (R21).
- **An `sla` module**: extra wiring; no other module uses clocks.
- **Putting the scheduler in `common`**: it only runs risk evaluations.

---

## R2. SLA terms and clocks

**Decision**:
- **Storage**: `sla_terms` (data-model §1a), mutable with a `version` column for optimistic concurrency, never deleted (`active` flag). Unique `(contract_entity_id, lower(code))` (hand-written index).
- **Governed orders**: `GraphRepository.directLinks({ entityIds: contractIds, relationshipTypes: ['GOVERNS'], side: 'FROM' })` returns one row per GOVERNS assertion (contract → order) with origin and confidence. A clock's **attachment** is `SOURCE` if any GOVERNS assertion between the pair is SOURCE, else the best non-source origin (MANUAL before INFERRED).
- **Clock inputs** (`ClockInputsReader`, plain fixed-shape Prisma queries, no traversal):
  - start events: `events` joined with `event_entities` (role SUBJECT, entity ∈ orders, type ∈ startEventTypes), earliest `occurredAt` then `id` per order;
  - stop events: same with role SUBJECT or RELATED and type ∈ stopEventTypes;
  - first observation: `min(observed_at)` per entity from `state_observations` (tie: lowest `seq`, for the citation);
  - completion / cancellation: the first observation (by `observedAt`, `seq`) with state COMPLETED / CANCELLED **at or after which the entity's current state is still terminal**: the earliest observation of the latest terminal run (same run algorithm as R6). An order that was COMPLETED and later re-opened is not stopped.
- **Source SLA records** (spec FR-003): every `SLA` entity whose `attributes.dueBy` parses as an ISO-8601 UTC datetime. `startAt` attribute if it parses, otherwise first observation (fallback). Attachment is `SOURCE` (the record itself is source data).
- **Pure computation** in shared `packages/shared/src/sla-clock.ts`:

  ```ts
  interface ClockTiming { startAt: Date; dueAt: Date; stoppedAt: Date | null; cancelled: boolean; atRiskPercent: number }
  classifySlaClock(t: ClockTiming, evaluatedAt: Date): { status: SlaClockStatus; elapsedMs: number; remainingMs: number | null; windowMs: number; atRiskAt: Date }
  slaAtRiskAtFor(startAt: Date, dueAt: Date, percent: number): Date   // dueAt − floor(max(0, dueAt − startAt) × percent / 100)
  ```

  - `windowMs = dueAt − startAt`; `elapsedMs = max(0, min(evaluatedAt, stoppedAt ?? evaluatedAt) − startAt)`;
  - cancelled → `CANCELLED`, `remainingMs = null`;
  - stopped → `MET` if `stoppedAt ≤ dueAt` else `MISSED`, `remainingMs = null`;
  - else `BREACHED` if `evaluatedAt > dueAt`; `AT_RISK` if `evaluatedAt ≥ atRiskAt`; else `ON_TRACK`; `remainingMs = dueAt − evaluatedAt`.

  `floor(window × percent / 100)` is computed in integers (`Math.floor((window * percent) / 100)` is exact because `window × percent < 2^53` for windows ≤ 90 days). With percent 25 it equals 007's `floor(window / 4)` for every integer window.
- **Most urgent clock** of an entity (spec Edge Cases): running clocks first, by `remainingMs × 100 / windowMs` ascending (compared by cross-multiplication `rA × wB` vs `rB × wA`), then `dueAt`, then term code (`compareCodeUnits`), then the SLA record id.
- **`SlaClockService.clocks({ asOf, filters })`** computes clocks for the API (R15) and `RiskInputsReader` reuses the same code path for the engine, so a clock in the SLA tab and a clock in a risk factor are the same computation.

**Rationale**: spec FR-001 to FR-004. Clocks are pure functions of stored data, terms and the evaluation time, so they need no storage and can never go stale. Integer arithmetic keeps boundaries exact (spec Story 2 scenario 2).

**Alternatives rejected**:
- **Storing clocks**: they change with every evaluation time; storing them would add a write per order per run.
- **Terms as attributes on contract records**: source records are append-only provenance; OpsGraph must not write into them (Constitution I). Importing structured terms is a later feature.
- **Shipments as governed entities**: needs a two-hop "contract → order → shipment" attachment; out of scope (spec Assumptions).

---

## R3. Reconciliation with 007's SLA

**Decision** (spec FR-005):
1. **One clock function.** `classifySlaClock` (R2) is the single implementation. 007's `computeSlaStatus` and `slaAtRiskAt` are rewritten as thin wrappers (`atRiskPercent = 25`, `startAt = createdAt`, `stoppedAt = resolvedAt` for resolved statuses, with 007's stored `slaOutcome` still authoritative for MET/MISSED). Their outputs, including `SlaDto.sentence`, must be byte-identical: 007's existing unit tests must pass unchanged.
2. **One vocabulary.** `SLA_STATUSES` (007) stays `ON_TRACK, AT_RISK, BREACHED, MET, MISSED`. This feature adds `SLA_CLOCK_STATUSES = [...SLA_STATUSES, 'CANCELLED'] as const` in `sla-clock.ts`. Labels (`On track`, `At risk`, `Breached`, `Met`, `Missed`, `Cancelled`) are one shared map, `SLA_STATUS_LABELS`, used by both features' badges.
3. **One sentence family.** The AT_RISK sentence takes the percentage: `` `… within the last ${p}% of the ${dur(window)} SLA window.` `` 007 passes 25, so its text is unchanged.
4. **Separate names, separate storage.** 007's exception `slaDueAt` is the case's **resolution SLA**; it is never derived from a contract. Clocks are never stored on exceptions. Where both appear on one page (Entity 360: Exceptions section and Risk & SLA section; the risk page's linked exceptions), 007's column header becomes **"Resolution SLA"** and this feature's heading is **"SLA commitments"**. This is a label change only in 007's `EntityExceptionsSection` and `ExceptionTable` (no behaviour change).
5. **The one coupling point** is auto-created exceptions (R14): for an SLA breach likely risk, `slaDueAt = min(now + SLA_WINDOW_MS.HIGH, clock.dueAt)` when `clock.dueAt > now`, otherwise 007's default. Only the system actor sets it (007's policy restricts `slaDueAt` to managers for users; the system actor bypasses the policy, as for the seed).
6. **006/008 "SLA commitments at risk"** counts SLA records whose **source-reported** state is AT_RISK. That stays unchanged; the Risk & SLA section shows the source state next to the computed status (FR-003), so the two are visibly related, never silently merged.

**Rationale**: the user request and Constitution II/III. One function guarantees that "At risk" means the same thing everywhere; distinct names prevent a reader from mistaking a case deadline for a customer commitment.

**Alternatives rejected**:
- **Deriving 007's exception SLA from contracts**: changes 007's published rules (windows per severity) and conflates "how fast we fix it" with "what we promised".
- **A second, independent clock implementation**: two at-risk boundaries would drift.
- **Renaming 007's field everywhere**: churn across 007's API and history with no behavioural benefit; the label change where both meet is enough.

---

## R4. Clock inputs at scale

**Decision**: `ClockInputsReader.load(asOfIgnored, terms)` runs, per evaluation, at most 5 queries regardless of the number of orders:
1. governed orders of all active terms' contracts (`directLinks`);
2. start events (one query, all orders, all start types);
3. stop events (one query);
4. first observation per order (`groupBy entityId _min observedAt`, then the citation rows);
5. terminal runs: observations with state COMPLETED or CANCELLED of the orders, plus their current state.

Results are grouped in memory by order id. The API's `GET /api/sla-clocks` uses the same reader with filters pushed into query 1 (contract, term, entity).

**Rationale**: SC-004 (2-minute evaluation at 50k entities). Each query is index-backed: `event_entities (entity_id)`, `events (occurred_at, id)`, `state_observations (entity_id, observed_at, seq)`.

---

## R5. Graph reach: one batched walk, owned by `GraphRepository`

**Decision**: add to `GraphRepository`:

```ts
reachBatch(q: { startIds: string[]; direction: 'UPSTREAM' | 'DOWNSTREAM'; maxDepth: number; startAlwaysLive: boolean }): Promise<ReachRow[]>
interface ReachRow { startId; entityId; depth; live: boolean; sourced: boolean; liveSourced: boolean }
directLinks(q: { entityIds: string[]; relationshipTypes: RelationshipType[]; side: 'FROM' | 'TO' }): Promise<DirectLinkRow[]>
dependentCounts(entityIds: string[]): Promise<Map<string, number>>   // directLinks over DEPENDENCY_DIRECTION, counted per entity
```

- **SQL** (data-model §3a): one recursive CTE seeded with `unnest($startIds::uuid[])`, following each traceable type in its dependency direction (DOWNSTREAM: from the depended-on end to the dependent end; UPSTREAM: the reverse), `UNION` over `(start_id, entity_id, depth, live, sourced)` as the cycle guard, `depth < maxDepth` as the bound, **terminal entities not expanded** (except the start), the start never re-entered. Aggregation: `min(depth)`, `bool_or(live)`, `bool_or(sourced)`, `bool_or(live AND sourced)` per `(start_id, entity_id)`.
  - `live(start)` = `startAlwaysLive OR start impaired`; `live(next) = live(prev) AND next impaired`.
  - `sourced(next) = sourced(prev) AND relationship.origin = 'SOURCE'`.
- **Batching**: the reader calls it with at most 100 start ids per call. Per start, at most `TRACING_LIMITS.maxReachedEntities` (10,000) entities are counted, in `(depth, entityId)` order; beyond that, the measure is flagged `lowerBound` ("at least").
- **006 equality** (spec FR-021): for a start S at depth D, `{ e | reached, non-terminal }` grouped by type equals 006's `categories[type].total` (current + potential) and `{ e | live }` equals `categories[type].current`. 006's edge filtering (drop edges out of terminal non-start entities, drop edges into the start) is exactly "terminal not expanded" and "start never re-entered". An e2e test asserts the equality for every Supplier, Payment, Approval, BudgetRequirement, Shipment and Warehouse of both seeded scenarios at depth 6 (R20).
- **Upstream** uses the same CTE with reversed direction and `startAlwaysLive: true`, so an ACTIVE order with a pending payment still sees the payment as an unresolved dependency.

**Rationale**: CLAUDE.md requires all traversal in `GraphRepository`, with a depth bound and cycle guard. One round trip per 100 starts keeps a full evaluation within budget (R21). Carrying `live` and `sourced` in the walk gives 006's "current" counts and the source-only counts for confidence (R7) without path enumeration.

**Alternatives rejected**:
- **Reusing 006's `traceImpact` per entity**: correct but one CTE plus three canonical path selections per start (R1).
- **A materialized dependency closure table**: must be maintained on every import; a new consistency problem.
- **Path arrays as the cycle guard**: exponential on dense graphs; the `UNION` tuple guard is what 003 and 006 use.

---

## R6. Per-entity measures

**Decision** (pure `engine/measures.ts`, inputs loaded by `RiskInputsReader`):

| Measure | Value | Inputs |
|---|---|---|
| `OWN_IMPAIRED` | boolean (+ state) | `entities.current_state` |
| `OWN_STATE_AGE` | duration since the start of the current impaired run | state observations of the entity |
| `OWN_UTILIZATION` | percent (hundredths) or UNAVAILABLE | `attributes.utilizationPct` |
| `SLA_REMAINING_SHARE` | remaining share of the most urgent running clock, or NONE | clocks (R2) |
| `UPSTREAM_MAX_STATE_AGE` | the largest `OWN_STATE_AGE` among **live** upstream entities (excluding the start), or NONE | `reachBatch(UPSTREAM)` + observations |
| `UPSTREAM_MAX_UTILIZATION` | the largest utilization among Warehouses in the upstream reach or the entity itself, or UNAVAILABLE / NONE | `reachBatch(UPSTREAM)` + attributes |
| `DOWNSTREAM_MIN_SLA_SHARE` | the smallest remaining share among running clocks of the entity and of non-terminal downstream entities, or NONE | `reachBatch(DOWNSTREAM)` + clocks |
| `DOWNSTREAM_CURRENT_COUNT` | count of `live` downstream entities (optionally of given types) | `reachBatch(DOWNSTREAM)` |
| `DOWNSTREAM_TOTAL_COUNT` | count of non-terminal downstream entities (optionally of given types) | `reachBatch(DOWNSTREAM)` |
| `DIRECT_IMPAIRED_DEPENDENTS` | count of impaired downstream entities at depth 1 | `reachBatch(DOWNSTREAM)` rows with depth 1 |
| `RECENT_EVENTS` | count of events of given types linked (subject or related) with `asOf − window < occurredAt ≤ asOf` | `events` + `event_entities` |

- **Impaired run**: order the entity's observations by `(observedAt, seq)`; walk back from the last while `IMPACT_STATE_CLASS[state] = 'IMPAIRED'`; the run starts at the earliest observation of that suffix. Duration `= max(0, asOf − runStart)`. The citation is that observation (source system, source id, observed time). If the current state is not impaired, the value is NONE.
- **Utilization**: `utilizationPct` must be a number in [0, 100] or a string matching `^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$`; stored as integer hundredths. Anything else is UNAVAILABLE, with the note "utilizationPct is not a percentage" when present but invalid. The citation is the latest ENTITY source record whose `normalized.attributes` holds the value.
- **Remaining share** is kept as the pair `(remainingMs, windowMs)`; it is never divided for comparisons (R7). A breached clock has negative `remainingMs`.
- **Ties** for "largest age": larger duration, then smaller depth, then display name (`compareCodeUnits`), then id. For "smallest share": R2's most-urgent order.
- **Value kinds** (shared): `BOOLEAN`, `DURATION`, `PERCENT`, `SHARE`, `COUNT`, `NONE` (nothing applicable), `UNAVAILABLE` (data missing). NONE and UNAVAILABLE score 0 points.
- **State conflicts**: for `OWN_IMPAIRED`, `OWN_STATE_AGE` and the entity chosen by `UPSTREAM_MAX_STATE_AGE`, `StateEvidenceReader` gives the per-source latest states; a **conflict** exists when they fall into different `IMPACT_STATE_CLASS` classes.

**Rationale**: spec FR-007. Each measure is one published sentence; together they cover §14's examples (payment unresolved, SLA remaining, warehouse capacity, downstream shipments) and §36's (elapsed, warehouse waiting, payment unresolved).

---

## R7. Scoring, levels and confidence

**Decision** (pure `engine/score.ts`, `engine/confidence.ts`):
- **Bands**: each factor has a direction fixed by its measure: `AT_LEAST` (higher is worse: durations, counts, utilization) or `AT_MOST` (lower is worse: shares). Bands are a list of `{ threshold, points }`, strictly increasing thresholds for `AT_LEAST` and strictly decreasing for `AT_MOST`. Points = the points of the **last** band whose condition holds, scanning in list order; none → 0. Boolean factors have one `points` value.
  - Durations compare in milliseconds (thresholds are configured in minutes); counts as integers; percents in hundredths; shares by cross-multiplication `remainingMs × 100 ≤ threshold × windowMs`.
- **Score** = `floor((Σ weight × points + 50) / 100)`, integers only (round half up). With Σ weights = 100 and points ≤ 100, the score is 0 to 100.
- **Level**: `≥ high` HIGH, `≥ medium` MEDIUM, `≥ low` LOW, else no risk.
- **Contribution** shown per factor = `weight × points / 100` with one decimal (`(weight × points) / 100` formatted with `toFixed(1)` from an integer; never re-summed for the score).
- **Confidence**, evaluated once per rule result:
  1. compute every factor a second time with **source-only inputs**: reach rows restricted to `sourced` (totals) / `liveSourced` (current); clocks restricted to SOURCE attachment; upstream ages restricted to `liveSourced` rows;
  2. `sourceOnlyLevel` from the source-only score;
  3. **LOW** if `sourceOnlyLevel` is lower than the level (no risk counts as lowest);
  4. else **MEDIUM** if any factor's source-only points differ, or a factor with points > 0 uses a clock with a fallback start, or a factor with points > 0 reads a state with a source conflict (R6);
  5. else **HIGH**.

  Reasons are fixed sentences (contracts § Confidence reasons), one per triggering condition, in factor order. HIGH has the single reason "All contributing values come from source relationships and records."
- **UNAVAILABLE** inputs never lower confidence (they can only understate a score); the risk page shows "This score may be understated: <factor> not available."

**Rationale**: spec FR-010 to FR-012, Constitution II and III. Integer arithmetic makes scores reproducible across platforms. Confidence measures how much the conclusion depends on inference, which is the constitution's fact-vs-inference distinction applied to a score.

**Alternatives rejected**:
- **Continuous (linear) scoring**: scores change every evaluation, generating assessment and audit noise; bands are easier to explain ("≥ 8h → 100 points").
- **Multiplying confidence into the score**: an opaque blend; the constitution forbids presenting inference as fact, not using it.
- **Confidence as the weakest relationship confidence in any path**: one LOW alternate-supplier link would make every supplier risk LOW even when the conclusion does not depend on it.

---

## R8. Determinism

**Decision**:
- **Inputs of an evaluation**: the stored graph, identified by `graphVersion = max(source_records.seq)`; the configuration version; the active SLA terms, identified by `termsDigest` (SHA-256, Node `crypto`, of the canonical JSON of active terms sorted by id, rule fields only); and `asOf`.
- **Pure engine**: `evaluateEntity(inputs, rule, asOf)` reads no clock, no randomness, no environment. Every collection it returns is ordered (factors in the rule's fixed order; cited entities by depth, display name, id; reasons in factor order).
- **Canonical serialization**: assessments are stored as the zod-parsed `RiskAssessmentPayload`, whose arrays are already ordered; the API returns them as stored.
- **Read consistency**: the runner reads `graphVersion` before and after loading inputs; if they differ, it reloads (at most 3 attempts) and records `consistent: false` if it never stabilizes, then triggers another DATA_CHANGE run (R10).
- **"As of" semantics**: like 005 R7, `asOf` affects time arithmetic only; durations and elapsed times clamp at 0 when a recorded time is later than `asOf`.
- **Tests** (spec SC-002): 100 consecutive previews per seeded entity at a pinned `asOf` produce identical JSON (deep equality and equal `JSON.stringify`); two evaluations with the same inputs on two fresh databases produce identical assessment payloads.

**Rationale**: Constitution III and the user's requirement that the same graph state always yields the same scores; `graphVersion` makes "same graph state" checkable.

**Alternatives rejected**:
- **Repeatable-read transaction across the whole read phase**: `GraphRepository` uses the shared client, so every repository method would need a transaction parameter; the version check gives the same guarantee for this use.
- **Hashing all graph rows**: expensive; source records are append-only and accompany every graph write, so their highest sequence identifies the state.

---

## R9. Configuration versions

**Decision**:
- `risk_config_versions(version INT PRIMARY KEY, config JSONB, note, created_by_id, created_at)`, **append-only** (reuses `forbid_provenance_mutation()`). The current configuration is the highest version.
- `config` is a complete `RiskConfig` (data-model §2b): all six rules, validated by `RiskConfigSchema` on write and on read (a read failure is an internal error).
- **Defaults** (`config/defaults.ts`, mirrored in contracts § Default configuration) are a constant. `RiskConfigService.ensureInitialized()` inserts version 1 = defaults as System with audit `risk.config_initialized`, if no version exists. It runs from the seed and before the first evaluation.
- **Update** (`PUT /api/risk-config/rules/:type`): body `{ expectedVersion, note, rule }`. The service checks `expectedVersion = current` (else 409 `VERSION_CONFLICT`, detail "Current version is N"), validates the rule (data-model §2c: weights sum, band order, thresholds, depths, factor keys and measures unchanged, parameters, auto-exception owner via `TeamsService` / users), copies the current config with that rule replaced, inserts `version + 1` (a concurrent insert of the same version fails on the primary key → 409), writes `risk.config_updated` (`before`/`after` = the rule, `metadata.note`, `metadata.version`), and triggers a CONFIG_CHANGE evaluation. An update equal to the current rule is a no-op: 200, no version, no audit.
- Factor keys, measures and directions are fixed in code (`RULE_DEFINITIONS`); the editable part of a factor is `weight`, `bands`, `points` (booleans) and `params` (data-model §2b).

**Rationale**: spec FR-023 to FR-025. Immutable versions make every assessment reproducible ("computed with configuration version 4"), and the audit trail shows what changed and why.

**Alternatives rejected**:
- **One mutable row per rule**: an evaluation could see a half-updated configuration, and past assessments could not be recomputed.
- **Free-form rule expressions**: an expression language is a non-goal (§62) and hard to explain.

---

## R10. Evaluation runner

**Decision**: `RiskEvaluationService.run({ trigger, actor, asOf? })`:
1. **Claim**: insert a `risk_evaluations` row with status RUNNING. A partial unique index `ON risk_evaluations ((true)) WHERE status = 'RUNNING'` allows one running evaluation across all instances; a unique violation means busy (R11). A RUNNING row whose `heartbeat_at` is older than 10 minutes is first marked FAILED with error "abandoned" (audited `risk.evaluation_failed`), then the claim is retried once. `asOf` = the given one (manual; must be ≥ latest completed `asOf`, else 400 on `asOf`) or `max(now, latest completed asOf)`. Audit `risk.evaluation_started`.
2. **Load**: `configVersion` (current), `terms` + `termsDigest`, `graphVersion`.
3. **Candidates** per rule (data-model §4a), from `entities` (non-terminal, by type), `dependentCounts` (gates), clocks.
4. **Inputs** (`RiskInputsReader`): `reachBatch` DOWNSTREAM for candidates needing downstream measures (depth = max over rules of their downstream depth, then filtered per rule in memory), `reachBatch` UPSTREAM for SLA candidates, observations of all entities that may be cited, attributes, events, per-source states. Update `heartbeat_at` after each batch.
5. **Compute**: `evaluateEntity` per candidate and rule (pure, R6–R7).
6. **Consistency check** (R8).
7. **Lifecycle** (R12) in **one transaction** (timeout 120 s): raises, changes, clears, assessments, risk audit rows (`recordMany`).
8. **Auto-exceptions** (R14), each in its own transaction after step 7.
9. **Complete**: update the evaluation row (status COMPLETED, counts, `autoExceptions` summary, `consistent`, `finishedAt`) and audit `risk.evaluation_completed` (`after` = the evaluation DTO without the per-risk lists).

On any error before step 7 commits: status FAILED with the error message (first 1,000 characters), audit `risk.evaluation_failed`, risks untouched. An error in step 8 is per risk (R14) and never fails the evaluation.

**Rationale**: spec FR-016 to FR-019. The database row is both the lock and the record, so no advisory locks or extra tables are needed; one lifecycle transaction means a reader never sees half an evaluation.

**Alternatives rejected**:
- **Postgres advisory locks**: session locks are tied to a connection, and Prisma's pool does not guarantee the same connection for lock and unlock.
- **One transaction for the whole run**: holds a transaction open during minutes of reads.

---

## R11. Scheduling and triggers without new dependencies

**Decision**:
- **`RiskScheduler`** (`OnApplicationBootstrap`, `OnModuleDestroy`), enabled by `RISK_SCHEDULER_ENABLED` (default `true`; `false` in the test environment, set in `test/load-env.ts`):
  - first run `RISK_EVALUATION_INITIAL_DELAY_MS` (default 10,000) after start, then a `setTimeout` chain: the next run is due `RISK_EVALUATION_INTERVAL_MS` (default 300,000, minimum 60,000) after the previous run **started**, or immediately if that time has passed. Timers are `unref()`ed and cleared on shutdown.
  - `trigger(kind)`: if a run is in progress in this process, set `pending = kind` (latest wins; one pending slot); otherwise start a run. After a run finishes, a pending trigger starts exactly one more run.
  - `DATA_CHANGE` and `CONFIG_CHANGE` triggers are **debounced** by 5 seconds (bursts of imports produce one run), so a run starts within 30 seconds (spec FR-016) unless one is already running.
  - A claim refused because another instance runs (R10) re-schedules the trigger in 15 seconds.
- **Data change**: `GraphChangeNotifier` (in `graph`, a plain class holding a listener list: `onImportApplied(listener)`, `importApplied(info)`); `ImportService.run` calls `importApplied({ importId })` **after** its transaction commits and only for outcome APPLIED. `RiskScheduler` subscribes in `onApplicationBootstrap`. Seed imports (`trigger: 'SEED'`) notify too; with the scheduler disabled nothing happens.
- **Manual**: `POST /api/risk-evaluations` runs synchronously in the request (R10) and returns the completed evaluation; 409 `EVALUATION_IN_PROGRESS` if busy.
- Environment variables are added to `config/env.ts` (zod, coerced).

**Rationale**: spec FR-016, SC-003; the constitution requires new dependencies to be justified, and `setTimeout` plus a database claim covers the need. The notifier keeps the dependency direction `ingestion → graph ← risk` (ingestion never imports risk).

**Alternatives rejected**:
- **`@nestjs/schedule` / `node-cron`**: a dependency for one fixed interval.
- **`@nestjs/event-emitter`**: a dependency for one event with one listener.
- **Database polling for changes** (`max(seq)` every few seconds): constant load, and still needs a timer.
- **A separate worker process**: deployment complexity beyond the MVP.

---

## R12. Risk lifecycle, numbering and material changes

**Decision**:
- **Keys**: a rule result is identified by `(type, entityId)`. Open risks: partial unique index `(type, entity_id) WHERE status = 'OPEN'`.
- **Raise**: results with no open risk. Numbers come from a sequence restarted at **10001** (`RSK-${n}`), assigned in this order within an evaluation: score descending, rule order (`RISK_TYPES`), entity display name (`compareCodeUnits`), entity id. Rows are inserted one by one in that order inside the lifecycle transaction. A raise writes the first assessment and audit `risk.raised`.
- **Material comparison** (pure `engine/material.ts`): `materialKey(result)` = level, score, confidence, and per factor: points, source-only points, and its **anchor**:

  | Measure | Anchor |
  |---|---|
  | `OWN_IMPAIRED` | state class |
  | `OWN_STATE_AGE`, `UPSTREAM_MAX_STATE_AGE` | entity id + run start time |
  | utilization measures | entity id + hundredths, or the kind (NONE / UNAVAILABLE) |
  | share measures | clock key (term id or SLA record id + target id) + `dueAt` + status |
  | count measures | count + `lowerBound` + non-source-only count |
  | `RECENT_EVENTS` | count |

  Durations and remaining times are **not** in the key: they change every evaluation, while their anchors do not. A result whose key equals the open risk's latest assessment key changes nothing (no write, no audit).
- **Change**: a different key writes a new assessment and updates the risk's current `level`, `score`, `confidence`, `latestAssessmentId`, `lastChangedAt`, `peakLevel`; audit `risk.level_changed` when the level differs, otherwise `risk.rescored`.
- **Clear**: an open risk without a result: `status CLEARED`, `clearedAt = asOf`, `clearReason` (`BELOW_THRESHOLD` if the rule ran on the entity and scored below `low`; `RULE_DISABLED`; `NOT_APPLICABLE` if the entity is terminal, no longer of an applicable type, or no longer passes the rule's gate or has no running clock); audit `risk.cleared`.
- **Re-raise** after clearance creates a new risk (spec Assumptions: risks are episodes).

**Rationale**: spec FR-019, SC-007. Anchors keep "nothing changed" true for a payment that is still pending five minutes later, so the history and audit trail record real changes only.

---

## R13. Audit

**Decision**: new `AUDIT_ACTIONS` (shared):

```ts
SLA_TERM_CREATED: 'sla_term.created',
SLA_TERM_UPDATED: 'sla_term.updated',
RISK_CONFIG_INITIALIZED: 'risk.config_initialized',
RISK_CONFIG_UPDATED: 'risk.config_updated',
RISK_EVALUATION_STARTED: 'risk.evaluation_started',
RISK_EVALUATION_COMPLETED: 'risk.evaluation_completed',
RISK_EVALUATION_FAILED: 'risk.evaluation_failed',
RISK_RAISED: 'risk.raised',
RISK_RESCORED: 'risk.rescored',
RISK_LEVEL_CHANGED: 'risk.level_changed',
RISK_CLEARED: 'risk.cleared',
RISK_EXCEPTION_CREATED: 'risk.exception_created',
RISK_EXCEPTION_FAILED: 'risk.exception_failed',
```

- Target types: `sla_term`, `risk_config` (`targetId` = version), `risk_evaluation`, `risk`.
- Engine actions use `actorType: 'system'`; a manual evaluation's `started`/`completed` rows use the requesting Administrator as actor, and the risk rows it causes are still System (the engine decided them), with `metadata.evaluationId`.
- before/after for risks hold `{ level, score, confidence }` (and `status`, `clearReason` for clears); the full factors are in the assessment, referenced by `metadata.assessmentId`.
- Permission refusals: `RolesGuard` (`@Roles('ADMIN')`) writes `auth.forbidden` as today.

**Rationale**: spec FR-038 and Constitution IV. One row per material change per risk; no rows for unchanged risks.

---

## R14. Automatic exceptions through 007

**Decision** (`AutoExceptionService.process(evaluation, config)`, after the lifecycle transaction):
1. **Eligible**: open risks with level HIGH, `autoExceptionId` null, whose rule has `autoException.enabled`, ordered by score descending then number; the first 20 are processed, the rest counted as deferred.
2. **Skip** when the entity has a link of any role to an exception with an unresolved status (`exception_entities` join `exceptions`, 007 `UNRESOLVED_STATUSES`); the evaluation records `{ riskId, outcome: 'SKIPPED_LINKED', exceptionNumbers }`. No audit (nothing changed).
3. **Create** via `ExceptionsService.create(SYSTEM_ACTOR, input, { createdFrom: 'RISK', auditMetadata: { riskId, riskNumber, evaluationId } })` with:
   - `subjectEntityId` = the entity; `severity HIGH`; `type` = the rule's configured exception type; `owner` = the configured owner or none;
   - `title` = `` `${entity.displayName}: ${RISK_TYPE_LABELS[type]} (${formatRiskNumber(n)})` `` cut to 200 characters (`…` at 200);
   - `description` = the headline, then `Level ${level}, score ${score}, confidence ${confidence}.`, then one line per factor sentence, cut to 4,000;
   - `slaDueAt` per R3 item 5 for SLA breach likely, otherwise omitted (007 default);
   - root cause: none chosen (007 takes the first-ranked candidate and records FIRST_RANKED).

   007's service takes the snapshots, inserts links, writes `exception.created` (actor System, `metadata.createdFrom 'RISK'` plus the risk ids) and notifies the owner (007 ASSIGNED, actor "System").
4. **Record** in a transaction: `risks.auto_exception_id`, `auto_exception_created_at`; audit `risk.exception_created` (`after: { exceptionId, number }`).
5. **Failure**: any error from step 3 → transaction: increment `auto_exception_attempts`, set `auto_exception_error` (first 500 characters); audit `risk.exception_failed`. Retried at the next evaluation while the risk is HIGH and open.

**Changes to 007** (exhaustive):
- `ExceptionCreatedFrom` gains `RISK` (Prisma enum `ALTER TYPE … ADD VALUE 'RISK'` in this feature's migration; shared enum; label "From risk"). `CreateExceptionRequestSchema.createdFrom` still accepts only the three user origins.
- `ExceptionsService.create` accepts `options.createdFrom` and `options.auditMetadata` for the system actor only (merged into the `exception.created` metadata); behaviour for users is unchanged.
- `ExceptionsModule` exports `ExceptionsService`.
- Label "SLA" → "Resolution SLA" in `EntityExceptionsSection` and `ExceptionTable` (R3 item 4).
- `computeSlaStatus`, `slaAtRiskAt` delegate to `classifySlaClock` (R3 item 1).

**Rationale**: the user requirement to reuse 007's creation and audit path: numbering, defaults, snapshots, links, notifications and history all stay in one place. Skipping linked entities prevents the §16 reference exception from being duplicated.

**Alternatives rejected**:
- **Inserting exception rows directly**: bypasses snapshots, links, notifications and 007's audit format.
- **Creating inside the lifecycle transaction**: 007 runs root-cause and impact analyses before its transaction (up to ~4 s each); they must not run inside a long write transaction.

---

## R15. API queries

**Decision**:
- **Risks list** (`GET /api/risks`): filters per spec FR-027 (`status` default OPEN, `level[]`, `type[]`, `entityType[]`, `confidence[]`, `entityId`, `raisedSince`, `hasException`), sorts (contracts § Sorts) with unique tie-break on `number`, keyset cursor `encodeCursor({ s, k })` like 007 R14, `total` by `count`. Rows join the entity and the latest assessment's `headline`. Above the list, the response carries `latestEvaluation` (number, `asOf`, `finishedAt`).
- **Indexes**: `risks (status, score DESC, number)`, `(status, level, score DESC, number)`, `(status, raised_at DESC, number DESC)`, `(status, last_changed_at DESC, number DESC)`, `(entity_id, status)`, `(type, status)`; partial unique `(type, entity_id) WHERE status = 'OPEN'`; `risk_assessments (risk_id, seq)`.
- **Assessments** (`GET /api/risks/:id/assessments`): oldest first, keyset on `seq`, each with the factors whose anchor or points changed against the previous assessment (`changedFactorKeys`, computed by `engine/material.ts`).
- **SLA clocks** (`GET /api/sla-clocks`): computed per request at `asOf` (default now, echoed), filters pushed into the governed-orders query, the whole filtered set sorted in memory by the urgency order of spec FR-031 (stable, with `compareCodeUnits` on entity display name then id), then sliced by a cursor `{ asOf, offset }`; a cursor whose `asOf` differs from the query's is 400. Maximum 200 per page.
- **SLA terms** (`GET /api/sla-terms`): every term (active first, then contract display name, then code), with `clockCounts` per status computed at `asOf`.

**Rationale**: stored risks use indexed keyset paging (as 007/008); clocks are computed, so an offset is stable only for a fixed `asOf`, which the cursor pins.

---

## R16. Alerts feed

**Decision**: `GET /api/risk-alerts?days=7&cursor=&limit=` reads `audit_entries` where `action ∈ {risk.raised, risk.level_changed, risk.cleared}` and `occurred_at > now − days` (1 to 90), newest first (`id DESC`), keyset on the audit id. Each item resolves the risk (number, type, entity) in one query and uses the row's before/after.

**Rationale**: spec FR-030. The audit trail already holds exactly these changes with before and after values; a second store could diverge.

---

## R17. Preview

**Decision**: `GET /api/risk-preview?entityId=&asOf=&configVersion=` runs steps 2–5 of R10 for one entity (all six rules, whether or not they apply, each reported as `NOT_APPLICABLE`, `BELOW_THRESHOLD` or a result), with no claim, no writes and no audit. It returns the same `RiskAssessmentPayload` the runner would store, plus `graphVersion`, `configVersion` and `termsDigest`. The risk page's **Preview now** calls it with the default `asOf`.

**Rationale**: spec FR-022; it is the determinism test harness and lets users see live durations without waiting for a material change.

---

## R18. Web design

**Decision**:

**Routes** (`router.tsx`):
- `risks` → `RisksPage` with tabs `?tab=risks|alerts|sla` (default `risks`) and their filters in the URL (`risks-params.ts`, same pattern as `exceptions-params.ts`);
- `risks/:id` → `RiskDetailPage`;
- `admin/risk-rules` → `RiskRulesPage` (rules, versions, evaluations, **Evaluate now**), `admin/sla-terms` → `SlaTermsPage` (list, create, edit), both under `RequireRole role="ADMIN"`; read-only versions of the rules page are reachable by everyone at `risks/rules` (same component, `readOnly`).
- Nav: "Risks & Alerts" after "Exceptions"; admin links "Risk rules" and "SLA terms".

**Components** (`pages/risks/`): `RiskLevelBadge`, `ConfidenceBadge`, `RiskTypeLabel`, `SlaStatusBadge` (shared with 007's badge colours), `RiskTable`, `RiskFilters`, `AlertsFeed`, `SlaClockTable`, `FactorTable` (factor, value sentence, weight, points, contribution, band, source-only points, evidence links), `ConfidenceReasons`, `AssessmentHistory`, `PreviewPanel`, `RuleEditor` (weights with a running total that must equal 100, band rows, thresholds, auto-exception owner via 007's `OwnerPicker`), `SlaTermForm`.

**Entity 360**: `EntityRiskSection` (`id="risk"`) between `ImpactSection` and `EntityExceptionsSection`; a header badge `Risk HIGH` from `GET /api/risks?entityId=&status=OPEN&limit=20`. The section shows open risks (score order) with their three top factors, clocks from `GET /api/sla-clocks?entityId=`, and for contracts `GET /api/sla-terms?contractId=`. It handles its own loading and error state.

**Refresh**: lists refetch every 60 s and on window focus; the header of the Risks tab states "As of evaluation #N, <asOf>".

**Rules**: parse every response with its shared schema through `apiFetch`; badges are text plus colour; never sort strings client-side; durations through 007's `formatDuration`.

**Entity 360 order** after 005–009: Identity, Current state, Root cause, Blockers, Impact, **Risk & SLA**, Exceptions, Investigations, Dependencies, Relationships, Timeline, Source records.

---

## R19. Seed

**Decision**: `RiskSeedService.seed()` runs from `prisma/seed.ts` after 007's and 008's seeds, idempotently:
1. `RiskConfigService.ensureInitialized()` (version 1, defaults, System).
2. The SHIP-24H term on CON-3982 (spec FR-040), created through `SlaTermsService.create` with the system actor if no term with that code exists on that contract; audit `sla_term.created` with `actorType 'system'`.

It does not run an evaluation and does not trigger one (the scheduler is not started by the seed's application context). Prints `risk seeded` or `risk already present`.

---

## R20. Testing strategy

**Shared (Vitest)**: `sla-clock.spec.ts` (every status, boundaries at `atRiskAt − 1 ms`, `atRiskAt`, `dueAt`, `dueAt + 1 ms`; percents 1, 25, 99; zero window; stop before and after due; cancelled; equality with 007's `computeSlaStatus` and `slaAtRiskAt` for 1,000 generated windows), schema specs (`RiskConfigSchema` refinements, request schemas).

**API unit (Jest)**, one spec per pure module: `measures.spec.ts` (runs, ages, clamps, utilization parsing, ties), `bands.spec.ts` (both directions, no match, booleans, cross-multiplication), `score.spec.ts` (rounding at .5, thresholds at the boundaries), `confidence.spec.ts` (each rule, reasons text), `material.spec.ts` (every anchor), `numbering.spec.ts`, `factor-text.spec.ts`, `config-validation.spec.ts`, `evaluate-entity.spec.ts` (fixtures K1–K8 from hand-built inputs), `scheduler.spec.ts` (fake timers: interval, debounce, pending coalescing, shutdown).

**e2e (Jest + supertest, real Postgres)**:
- `graph-reach.e2e-spec.ts`: `reachBatch` live/sourced flags, terminal not expanded, start not re-entered, depth bound, cycles; equality with 006 summaries on both seeded scenarios (R5);
- `sla-terms.e2e-spec.ts`: CRUD, validation, uniqueness, ADMIN-only, audit; `sla-clocks.e2e-spec.ts`: fixture K6, filters, paging, cursor pinning;
- `risk-config.e2e-spec.ts`: read, update, validation, conflicts, no-op, audit, versions;
- `risk-evaluation.e2e-spec.ts`: fixtures K1–K9 (evaluations at T1, T2, T3 on the seeded database), raise/change/clear/re-raise, material changes only, monotonic `asOf`, single running row, abandoned runs, FAILED path, data-change trigger (scheduler enabled in that test with short intervals);
- `risk-preview.e2e-spec.ts`: determinism (SC-002);
- `risk-auto-exception.e2e-spec.ts`: fixture K10, once per risk, skip linked, cap of 20, failure and retry, resolution SLA rule;
- `risks-list.e2e-spec.ts`, `risk-alerts.e2e-spec.ts`;
- `authz-matrix.e2e-spec.ts`: +17 rows; 007's and 008's suites unchanged and green;
- `perf-risk.e2e-spec.ts` (`RUN_PERF=1`): SC-004 on 006's perf graph generator.

**Vitest (web)**: params, every component, `EntityDetailPage` order, `RuleEditor` validation, `RiskDetailPage` drill-down links.

**`resetDb`**: add the 5 new tables; disable/enable triggers on the 2 append-only ones; restart nothing (tests never assert absolute risk numbers except on a freshly migrated database).

---

## R21. Performance

| Operation | Budget | How |
|---|---|---|
| Full evaluation, 50k entities, ≥ 150k relationships | < 2 min (SC-004) | candidates gated before walking; `reachBatch` per 100 starts; ≤ 10 fixed-shape input queries; pure compute; one lifecycle transaction |
| Risks list first page, 10k open risks | < 1 s p95 | indexed `WHERE` + keyset + one `count` |
| Risk detail | < 1 s | 1 risk + latest assessment + entity + linked exceptions |
| Entity Risk & SLA section / preview | < 2 s | ≤ 2 `reachBatch` calls for one start |
| SLA clocks page, 10k governed orders | < 1 s | R4's 5 queries, in-memory sort |

Expected cost: the 006 perf graph has ~30k candidate entities for `HIGH_DOWNSTREAM_DEPENDENCY` after the "has a dependent" gate (orders with shipments, products, POs, suppliers, shipments). Most reaches are small (an order reaches its shipment and SLA); hubs reach ~2,000. **First lever if over budget**: lower the default downstream depth of `HIGH_DOWNSTREAM_DEPENDENCY` to 4; **second**: run `reachBatch` batches with 2-way concurrency. Do not cache across evaluations.

---

## R22. Dependencies

**Decision**: **none**. Scheduling uses `setTimeout`; change notification is a listener list; hashing uses Node's built-in `crypto`. Postgres features: identity sequence, partial unique indexes, `CHECK`, functional index (`lower(code)`), triggers, `ALTER TYPE … ADD VALUE`, recursive CTE in `GraphRepository`.
