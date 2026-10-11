# Implementation Plan: Risk Detection and SLA Management

**Branch**: `009-risk-sla` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-risk-sla/spec.md`

## Summary

OpsGraph connects contract SLA terms to the orders they govern and detects operational risk before it becomes a breach (Product Overview §14, §15, §36, §50).

- **SLA commitments**: Administrators record a contract's SLA terms ("Ship within 24 hours of order"). Every governed order gets a computed **clock** (start, due, elapsed, remaining, status). Source SLA records with a `dueBy` get a clock too, shown next to their source-reported state.
- **Risk engine**: six fixed, rule-based rules (no ML) score entities from weighted factor **bands**. The result is a score from 0 to 100, a level (HIGH/MEDIUM/LOW), a confidence that measures how far the result depends on inferred links, fallbacks or conflicting sources, and an explicit factor list with values, weights, points and provenance.
- **Evaluations** run every 5 minutes, after each applied import and after configuration changes, one at a time across instances. Each records its `asOf`, graph version, configuration version and SLA-terms digest. **Same inputs, same output.**
- **Risks** are episodes (raise, change, clear) with immutable **assessments**, written only on material change.
- **Configuration** is versioned and immutable; Administrators edit weights, bands, thresholds, depths and auto-exception settings.
- **Risks & Alerts** area (Risks, Alerts, SLA commitments tabs), risk page with drill-down to Entity 360 and impact, Entity 360 **Risk & SLA** section, admin pages for rules and SLA terms.
- **Auto-exceptions** (off by default) go through 007's `ExceptionsService.create` as the System actor.
- **Seed**: configuration version 1 and the SHIP-24H term on CON-3982. Order #18492 at 2026-09-30T03:12Z is HIGH 73 (§14/§36 reference).

**Approach** (research R1–R22):
1. **Storage**: one migration with 7 enums and 5 tables. Configuration versions and assessments are append-only. Partial unique indexes give "one running evaluation" and "one open risk per type and entity". 007's `ExceptionCreatedFrom` gains `RISK`.
2. **Traversal**: one batched recursive CTE (`GraphRepository.reachBatch`) carries `live` and `sourced` flags. It gives 006-equal current/total counts and source-only counts for confidence in one round trip per 100 entities. `directLinks` and `dependentCounts` are fixed-shape.
3. **Rules as pure code**: clock classification (shared, also used by 007), measures, bands, score, confidence, texts, material-change keys, lifecycle planning, numbering. No clock and no randomness.
4. **Scheduling without dependencies**: a `setTimeout` chain, a database claim row and a listener-list change notifier.
5. **Reuse**: 006's state classes and direction rules, 007's SLA rule, exception creation, owner references, notifications and formatting, and 008's Entity 360 order.

All design decisions are in [research.md](./research.md) and are binding. The exact expected results are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures K1–K10.

## Prerequisites

- **Features 005, 006, 007 and 008 must be merged into this branch before implementation starts** (rebase `009-risk-sla` onto `main` once they land). This feature uses:
  - 006's `IMPACT_STATE_CLASS`, `PurchaseOrder`, `traceImpact` CTE shape and summaries (the equality test);
  - 007's exceptions, SLA rule, `OwnerRefSchema`, `TeamsService`, `formatDuration`, error codes and seed;
  - 008's Entity 360 section order and seed;
  - 005's evaluation-time pattern.

  If any of them is missing, stop and write the question in `questions.md`.
- The migration must run after 007's and 008's migrations. Do not edit earlier migrations.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS. Unchanged.

**Primary Dependencies**: unchanged. NestJS 11, Prisma 6, zod 3, React 19, React Router 7, TanStack Query 5, Tailwind 4. **No new dependencies** (research R22): no `@nestjs/schedule`, no cron library and no event emitter. Hashing uses Node `crypto`.

**Storage**: PostgreSQL 16 via Prisma 6.
- **One migration** (`<timestamp>_risk_sla`), data-model §1:
  - enums `RiskLevel`, `RiskType`, `RiskStatus`, `RiskClearReason`, `RiskEvaluationTrigger`, `RiskEvaluationStatus`, `SlaTermTargetType`;
  - tables `sla_terms`, `risk_config_versions`, `risk_evaluations`, `risks`, `risk_assessments`;
  - `ALTER TYPE "ExceptionCreatedFrom" ADD VALUE 'RISK'`;
  - the `risks` number sequence restarted at 10001;
  - CHECKs, the functional unique index on `lower(code)` and two partial unique indexes;
  - append-only triggers on 2 tables.
- **Reads**: `entities`, `relationships` (only through `GraphRepository`), `state_observations`, `events`, `event_entities`, `source_records` (graph version and attribute citations), `exceptions` and `exception_entities` (auto-exception skip), `audit_entries` (alerts).

**Testing**:
- **Vitest (shared)**: `sla-clock` boundaries and equality with 007's `computeSlaStatus`/`slaAtRiskAt`; config schema refinements.
- **Jest unit**: every pure engine module; the scheduler with fake timers; fixtures K1–K8 from hand-built inputs.
- **Jest + supertest e2e** (real Postgres, scheduler disabled):
  - `reachBatch` semantics and **equality with 006 summaries** on both seeds;
  - SLA terms and clocks (K6);
  - configuration;
  - evaluations K1–K9 (lifecycle, determinism, monotonic `asOf`, single-run claim, failure);
  - preview determinism (SC-002);
  - auto-exceptions K10;
  - lists and alerts;
  - authz rows for all 17 routes;
  - 007's and 008's suites unchanged and green.
- **Performance suite** behind `RUN_PERF=1`.

**Target Platform**: Linux server (API), evergreen browsers (web).

**Project Type**: Web application (pnpm monorepo: api + web + shared).

**Performance Goals** (SC-004):
- full evaluation of a graph with 50k entities and at least 150k relationships in < 2 min;
- Risks list first page with 10k open risks, p95 < 1 s;
- risk detail < 1 s;
- Entity 360 Risk & SLA section and preview < 2 s;
- SLA clocks page with 10k governed orders < 1 s.

**Constraints**:
- no `any`, no new dependencies;
- traversal SQL only in `prisma-graph.repository.ts`, always with a depth bound and the `UNION` cycle guard;
- pure engine modules never read the clock, the environment or randomness; the runner reads `now` once per evaluation;
- integer arithmetic for durations, shares, scores and bands;
- all ordering in SQL uses unique tie-breaks; in-memory ordering uses `compareCodeUnits`;
- one lifecycle transaction per evaluation;
- 007's analyses (auto-exceptions) run **outside** it;
- audit rows only for material changes;
- 007's responses, rules, texts and tests stay unchanged apart from the listed additions (research R14);
- the §39 and §40 seeds and the 007 and 008 seed rows stay unchanged.

**Scale/Scope**:
- 17 endpoints;
- 1 migration;
- 1 new Nest module (`risk`), plus small additions to `graph`, `ingestion` and `exceptions`;
- about 12 pure engine modules;
- about 25 web components, 10 hooks, 5 pages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | Every factor value cites its provenance (data-model §2e `evidence`): the state observation (source system, source id, observed time) behind unresolved durations, the event behind clock starts, stops and recent-event counts, the source record holding a utilization attribute, and the counted entities. SLA terms carry their contract, quoted clause, author and time. Source SLA records keep their source state next to the computed status. Every evaluation records the graph version it read. |
| II. Fact vs Inference | ✅ | Risks are labelled conclusions with a **confidence** computed from their dependence on non-source links (source-only re-scoring), fallbacks and source conflicts, with reasons. Counts state how many entities are reached only through inferred or manual links. Fallback clock starts are flagged. **Conflicts**: per-source state disagreements cap confidence at MEDIUM and are named. A source SLA record's reported state and the computed status are both shown with a disagreement sentence; neither replaces the other. |
| III. Explainability & Determinism | ✅ | The score is a published weighted sum of banded points that a reader can recompute. Levels come from shown thresholds. No ML or opaque scores. Same graph version + configuration version + terms digest + `asOf` → byte-identical output, tested (SC-002). The `asOf` input is explicit, echoed and pinnable. |
| IV. Auditability | ✅ | Audited: SLA term changes, configuration initialization and updates (rule before/after with a note), evaluation start/completion/failure, every risk raise, rescore, level change and clearance (System, naming the evaluation), auto-exception creation and failure, and 007's own `exception.created`. Configuration versions and assessments are append-only at the database level. Refusals are audited by `RolesGuard`. |
| V. Test-Gated Changes | ✅ | All 17 endpoints have zod schemas in `@opsgraph/shared` and e2e tests (success, 401, 400, and 403/404/409 where they apply). The new traversal method has tests for cycles, the depth bound, terminal handling and 006 equality. |
| VI. MVP Scope Discipline | ✅ | Answers §65 Q8 "What is likely to happen next?", supports Q6/Q7 (affected, how serious) and Q11 (evidence). §61 lists "basic risk" in the MVP. No ML, simulation, recommendations, workflow or notification channels (§62 respected). One speculative-looking item, configurable rules, is required by the spec (FR-023). |
| Tech constraints | ✅ | Strict TS, no new dependencies, traversal only in `GraphRepository`. The `risk` module is listed in CLAUDE.md. |

**Post-design re-check**: ✅ No unjustified violations. The deliberate choices are listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/009-risk-sla/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/api.md           # routes, schemas, default configuration, texts, fixtures K1–K10
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (new and changed files only)

```text
packages/shared/src/
├── common.ts                  # + ErrorCode EVALUATION_IN_PROGRESS, SLA_TERM_CODE_TAKEN
├── audit.ts                   # + 13 AUDIT_ACTIONS (research R13)
├── sla-clock.ts               # NEW: classifySlaClock, slaAtRiskAtFor, sentences, urgency, labels
├── exceptions.ts              # 007: computeSlaStatus/slaAtRiskAt delegate to sla-clock; createdFrom + RISK (not in request schema)
├── risk.ts                    # NEW: constants, RULE_DEFINITIONS, config schema + validateRule, payloads, request/response schemas
├── sla-terms.ts               # NEW
├── *.spec.ts                  # NEW sla-clock.spec.ts, risk.spec.ts, sla-terms.spec.ts
└── index.ts                   # + 3 exports

apps/api/prisma/
├── schema.prisma              # + 7 enums, 5 models, back-relations, ExceptionCreatedFrom.RISK
├── migrations/<ts>_risk_sla/migration.sql      # generated + data-model §1b SQL
└── seed.ts                    # + RiskSeedService.seed()

apps/api/src/
├── app.module.ts                          # + RiskModule
├── config/env.ts                          # + RISK_SCHEDULER_ENABLED, RISK_EVALUATION_INTERVAL_MS, RISK_EVALUATION_INITIAL_DELAY_MS
├── common/errors/app-error.ts             # + Errors.evaluationInProgress, slaTermCodeTaken; versionConflict(current, noun?)
├── graph/
│   ├── graph.repository.ts                # + reachBatch, directLinks, dependentCounts (interfaces)
│   ├── prisma-graph.repository.ts         # + their SQL (data-model §3)
│   ├── graph-change.notifier.ts (+ .spec.ts)   # NEW
│   └── graph.module.ts                    # + GraphChangeNotifier provider/export
├── ingestion/
│   ├── ingestion.module.ts                # + imports GraphModule
│   └── import.service.ts                  # + notifier.importApplied after an APPLIED commit
├── exceptions/                            # 007, small changes (research R14)
│   ├── exceptions.module.ts               # + exports ExceptionsService
│   └── exceptions.service.ts              # create(): options.createdFrom 'RISK' + auditMetadata for the system actor
└── risk/                                  # NEW module
    ├── risk.module.ts
    ├── risks.controller.ts  risks-query.service.ts  risk.mapper.ts           # routes 1–5
    ├── config/
    │   ├── risk-config.controller.ts  risk-config.service.ts                # routes 9–12
    │   └── defaults.ts (+ .spec.ts)                                         # contracts § Default configuration
    ├── sla/
    │   ├── sla-terms.controller.ts  sla-terms.service.ts  sla-term.mapper.ts # routes 13–16
    │   ├── sla-clocks.controller.ts  sla-clock.service.ts                   # route 17
    │   └── clock-inputs.reader.ts
    ├── evaluation/
    │   ├── risk-evaluations.controller.ts                                   # routes 6–8
    │   ├── risk-evaluation.service.ts     # runner (research R10)
    │   ├── risk-inputs.reader.ts          # batches, reach, observations, events, attributes
    │   ├── risk-lifecycle.ts              # applies the plan in a transaction
    │   ├── risk-scheduler.ts (+ .spec.ts) # research R11
    │   └── auto-exception.service.ts      # research R14
    ├── engine/                            # pure: no Nest, no Prisma client, no clock
    │   ├── measures.ts  bands.ts  score.ts  confidence.ts  factor-text.ts  headline.ts
    │   ├── material.ts  candidates.ts  evaluate-entity.ts  lifecycle.ts  numbering.ts  canonical-json.ts
    │   └── *.spec.ts                      # one per module; evaluate-entity.spec.ts holds K1–K8
    └── seed/risk-seed.service.ts          # research R19

apps/api/test/
├── load-env.ts                            # RISK_SCHEDULER_ENABLED=false
├── helpers.ts                             # resetDb: + 5 tables, 2 trigger pairs
├── graph-reach.e2e-spec.ts                # NEW (incl. 006 equality)
├── sla-terms.e2e-spec.ts  sla-clocks.e2e-spec.ts                            # NEW
├── risk-config.e2e-spec.ts  risk-evaluation.e2e-spec.ts  risk-preview.e2e-spec.ts   # NEW
├── risk-auto-exception.e2e-spec.ts  risks-list.e2e-spec.ts  risk-alerts.e2e-spec.ts # NEW
├── seed.e2e-spec.ts                       # + risk block (idempotency)
├── authz-matrix.e2e-spec.ts               # + 17 rows
└── perf-risk.e2e-spec.ts                  # NEW: RUN_PERF=1 only

apps/web/src/
├── router.tsx                             # risks, risks/:id, risks/rules, admin/risk-rules, admin/sla-terms
├── layout/AppShell.tsx                    # + "Risks & Alerts", admin "Risk rules", "SLA terms"
├── pages/risks/                           # NEW
│   ├── risks-params.ts (+ .test.ts)
│   ├── useRisks.ts  useRisk.ts  useRiskAlerts.ts  useSlaClocks.ts  useRiskPreview.ts
│   ├── useRiskConfig.ts  useRiskEvaluations.ts  useSlaTerms.ts
│   ├── RisksPage.tsx  RiskDetailPage.tsx  RiskRulesPage.tsx
│   ├── RiskTable.tsx  RiskFilters.tsx  AlertsFeed.tsx  SlaClockTable.tsx
│   ├── RiskLevelBadge.tsx  ConfidenceBadge.tsx  SlaStatusBadge.tsx
│   ├── FactorTable.tsx  ConfidenceReasons.tsx  AssessmentHistory.tsx  PreviewPanel.tsx
│   ├── RuleEditor.tsx  EvaluationsTable.tsx
│   ├── risks-test-data.ts
│   └── *.test.tsx
├── pages/admin/SlaTermsPage.tsx  SlaTermForm.tsx (+ tests)               # NEW
├── pages/entities/
│   ├── EntityDetailPage.tsx               # + header risk badge, + EntityRiskSection after ImpactSection
│   └── EntityRiskSection.tsx (+ .test.tsx)                                # NEW
└── pages/exceptions/                      # 007: "SLA" header → "Resolution SLA" (EntityExceptionsSection, ExceptionTable)
```

**Structure Decision**: the existing pnpm monorepo.
- Risk and SLA logic goes in the `risk` bounded context listed in CLAUDE.md.
- Traversal goes in `graph`.
- The only cross-context call is `risk → exceptions` (`ExceptionsService.create`), plus `ingestion → graph` for change notification.

## Key Design Notes (for the implementer)

1. **Build order.** Each step is independently testable. Do not start a step before the previous one's tests pass.
   1. **Shared**: `sla-clock.ts` with its spec, then make 007's `computeSlaStatus`/`slaAtRiskAt` delegate and run 007's shared tests unchanged. Then `risk.ts` constants, `RULE_DEFINITIONS`, defaults, config schema and `validateRule`; payload and request/response schemas; `sla-terms.ts`; error codes and audit actions. Rebuild shared.
   2. **Migration**: `schema.prisma`, then `prisma migrate dev --create-only`, then append data-model §1b (check the sequence name first), then apply. Update `resetDb` and `load-env.ts`. Run the whole suite: every existing test must pass unchanged.
   3. **Graph**: `reachBatch`, `directLinks`, `dependentCounts`, then `graph-reach.e2e-spec.ts` including the 006 equality test. Then `GraphChangeNotifier` and the ingestion hook.
   4. **SLA**: `ClockInputsReader`, `SlaClockService`, terms service/controller, clocks controller, then `sla-terms.e2e-spec.ts` and `sla-clocks.e2e-spec.ts` (K6, after step 9's seed or with the term created in the test).
   5. **Engine** (pure), in order: `canonical-json`, `bands`, `measures`, `score`, `confidence`, `factor-text`, `headline`, `material`, `candidates`, `evaluate-entity` (K1–K8 from hand-built inputs), `lifecycle`, `numbering`.
   6. **Configuration**: service (`ensureInitialized`, `updateRule`), controller, `risk-config.e2e-spec.ts`.
   7. **Evaluation**: `RiskInputsReader`, `RiskLifecycle`, `RiskEvaluationService`, controller, preview, then `risk-evaluation.e2e-spec.ts` (K1–K9) and `risk-preview.e2e-spec.ts`.
   8. **Scheduler** with fake-timer unit tests, then one e2e with the scheduler enabled and short intervals (data-change trigger).
   9. **Auto-exceptions**: the 007 changes (export, `create` options), `AutoExceptionService`, `risk-auto-exception.e2e-spec.ts` (K10).
   10. **Queries**: risks list/detail/assessments, alerts; `risks-list.e2e-spec.ts`, `risk-alerts.e2e-spec.ts`, authz rows.
   11. **Seed**: `RiskSeedService`, `prisma/seed.ts`, the `seed.e2e-spec.ts` block.
   12. **Web**: params and hooks; badges; Risks page tabs; risk detail; Entity 360 section and badge; rules page and editor; SLA terms admin; nav.
   13. **Performance**: `perf-risk.e2e-spec.ts`. Record timings in quickstart.md §4.
2. **Determinism.**
   - The runner reads `now` once and computes `asOf` from it (research R10). Everything below receives `asOf`.
   - Never call `new Date()` or `Date.now()` in `engine/`.
   - Never iterate a `Map`/`Set` for output without sorting it first.
   - Never use floating-point division in comparisons: use cross-multiplication (research R7).
3. **Transactions.**
   - The claim, the lifecycle and the completion are three separate short transactions. The lifecycle transaction uses `timeout: 120_000`.
   - Reads happen outside transactions, with the graph-version check (research R8).
   - 007's `create` is always called outside any transaction.
4. **Audit.**
   - Only material changes write risk audit rows (`recordMany` inside the lifecycle transaction).
   - Manual evaluations: the evaluation's own rows have the Administrator as actor; risk rows are System.
   - No-ops write nothing.
5. **007 boundary.**
   - Do not change 007's request schema: users still cannot send `createdFrom: 'RISK'`.
   - The system actor's `slaDueAt` bypasses the manager policy, exactly as 007's seed does.
   - Keep 007's texts byte-identical; its tests are the check.
6. **Scheduler.**
   - `unref()` every timer and clear it in `onModuleDestroy`.
   - Never start it in the seed's application context (guard on `RISK_SCHEDULER_ENABLED` and a `seed` flag), and never in tests unless a test enables it explicitly.
   - A listener error in `GraphChangeNotifier` is logged, never rethrown into the import.
7. **Web specifics.**
   - Parse every response with its shared schema through `apiFetch`.
   - Badges are text plus colour.
   - The factor table shows weight, points, contribution and band, and the score line repeats the sum ("28.0 + 25.0 + 0.0 + 5.0 + 15.0 = 73").
   - The Risk & SLA section has `id="risk"`, handles its own loading and error state, and must not blank the page.
   - Lists refetch every 60 s and state the evaluation they reflect.
   - The rule editor shows a live weight total and refuses to submit unless it is 100; the server validates regardless.
8. **Pitfalls**:
   - `noUncheckedIndexedAccess` is on. Use `.at()` with checks and invariant `Error`s, never `!`.
   - Never use `localeCompare`.
   - Postgres enum order is declaration order: keep `HIGH` first in `RiskLevel`.
   - The new enum value `RISK` must not be used in the migration that adds it.
   - `BigInt` values (`seq`, `graphVersion`) are serialized as decimal strings.
   - `resetDb` does not restart sequences, so do not assert absolute risk numbers except on a freshly migrated database.
   - The partial unique index on RUNNING evaluations means a crashed test can leave a RUNNING row: `resetDb` truncates it.
9. **Do not**:
   - add traversal or recursive SQL outside `prisma-graph.repository.ts`, or call `ImpactService`/`TracingService` from the engine (the 006 equality test is the only place 006 is called);
   - add dependencies;
   - add risk notifications, acknowledge/dismiss actions, recommendations or ML;
   - store clocks;
   - change 006/008 counts or labels other than the "Resolution SLA" header;
   - change §39/§40 seed rows;
   - edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, the constitution or CLAUDE.md.

   Ambiguities go to `questions.md`.
10. **Entity 360 order** after 005–009: Identity (with the exceptions badge, the risk badge, "Create exception" and "Start investigation"), Current state, Root cause, Blockers, Impact, **Risk & SLA**, Exceptions, Investigations, Dependencies, Relationships, Timeline, Source records. Update the `EntityDetailPage` order test accordingly.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New batched traversal method `reachBatch` with `live`/`sourced` flags, a second CTE beside 003's and 006's | Evaluating thousands of entities every 5 minutes needs one round trip per 100 starts. The flags give 006-equal current/total counts and source-only counts for confidence. It stays in `prisma-graph.repository.ts` with a depth bound and the `UNION` cycle guard. | Calling `ImpactService` per entity costs one CTE plus three path selections each, and a full run would take hours (research R21). A closure table needs maintenance on every import. |
| Scheduler built on `setTimeout` plus a database claim row, no library | Required cadence (5 min), triggers and single-run across instances. | `@nestjs/schedule`/cron adds a dependency for one interval and still needs cross-instance exclusion. Advisory locks do not work reliably with Prisma's pool (research R10, R11). |
| Small changes to 007 (enum value `RISK`, `create` options, module export, SLA functions delegating to shared, one column label) | Auto-exceptions must reuse 007's creation and audit path, and the SLA rule must have one implementation. | Inserting exceptions directly bypasses snapshots, notifications and 007's audit format. A second clock implementation would drift from 007's at-risk boundary. |
| Configuration stored as immutable JSON versions | Every assessment must be reproducible from its configuration version (Constitution III), and edits are audited as rule before/after. | Mutable per-rule rows let a run see a half-updated configuration and cannot reproduce past scores. |
