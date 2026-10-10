# Implementation Plan: Home Overview and Search

**Branch**: `010-home-dashboard-search` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-home-dashboard-search/spec.md`

## Summary

OpsGraph gets a Home page that answers "What requires attention right now?" (Product Overview §21, §47), a global search (§20) and saved structured filters (§20).

- **Home** aggregates conclusions from the features that own them: critical exceptions and resolution SLA (007), investigations (008), risks and SLA commitments (009), root causes (005), order values (006). Totals come first for Operations Managers and Administrators, **Assigned to me** first for Analysts. Every figure carries a typed drill target whose list total equals the figure.
- **Revenue at risk** is computed in a stored **snapshot** after each completed risk evaluation: the at-risk customer orders (impaired, open HIGH/MEDIUM risk, or SLA commitment at risk/breached), each analyzed with 005 and attributed to **exactly one** cause category (Supplier, Payment, Warehouse and shipping, Approval, Other) from its first-ranked root cause, so the categories add up to the total (006's no-double-counting rule). **Unresolved blockers** are the distinct root causes in the snapshot.
- **Frequent root causes** (≥ 3 distinct exceptions in 30 days) reuse 008's snapshots, window and labels, and show 008's **recurring** indicator (≥ 2 distinct root-cause entities) without changing it.
- **Data freshness** per source system from `source_records.observed_at` (stale after 24 h).
- **Global search** (header, `/` and Ctrl/⌘+K) over entities (name, any source id), exceptions and investigations (number, title): tiers exact → prefix → contains, a similar-name fallback for typos, highlight ranges, type filters, < 1 s at 50k entities with `pg_trgm` GIN indexes.
- **Entity finder** (structured criteria, superset of 002's list) with private **saved filters** and seven built-in filters.

**Approach** (research R1–R19):
1. **Storage**: one migration: the `pg_trgm` extension (declared in Prisma), 4 GIN trigram indexes, a freshness index, 5 enums, 3 tables (`overview_snapshots`, `overview_snapshot_orders`, `saved_filters`), CHECK constraints.
2. **No re-derivation**: Home calls 007/008/009 query services and 005's `RootCauseService`; 006's `OrderValueReader` and `money.ts`; 008's `recurrence.ts`. Small exports and one notifier are added to those modules.
3. **Rules as pure code**: at-risk merge, analysis order, category mapping, totals with an add-up invariant, blockers, frequent root causes, freshness, search escaping and highlights, finder criteria, layout, drill targets.
4. **No new dependencies**: a 20-line promise pool, DOM keyboard listeners, Postgres contrib extension.

All design decisions are in [research.md](./research.md) and are binding. The exact expected results are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures H1–H7.

## Prerequisites

- **Features 004, 005, 006, 007, 008 and 009 must be merged into this branch before implementation starts** (rebase `010-home-dashboard-search` onto `main` once they land). This feature uses:
  - 005's `RootCauseService.analyze` (exported by 007);
  - 006's `IMPACT_STATE_CLASS`, `PurchaseOrder`, `OrderValueReader`, `money.ts`, `CURRENCY_PATTERN`;
  - 007's `ExceptionsQueryService` (exported by 008), list schema, `csv`, `formatDuration`, `UNRESOLVED_STATUSES`;
  - 008's `analysis_snapshots`, `recurrence.ts`, `InvestigationsQueryService`;
  - 009's `RisksQueryService`, `SlaClockService`, `risk_evaluations`, `risks`, `GraphRepository.directLinks`, the scheduler pattern;
  - 004's `/graph/:id` route for links.

  If any of them is missing, stop and write the question in `questions.md`.
- The migration must run after 009's migration. Do not edit earlier migrations.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS. Unchanged.

**Primary Dependencies**: unchanged. NestJS 11, Prisma 6, zod 3, React 19, React Router 7, TanStack Query 5, Tailwind 4. **No new npm dependencies** (research R19). Platform additions: the PostgreSQL contrib extension `pg_trgm` and Prisma's `postgresqlExtensions` preview flag.

**Storage**: PostgreSQL 16 via Prisma 6.
- **One migration** (`<timestamp>_overview_search`), data-model §1:
  - `CREATE EXTENSION IF NOT EXISTS "pg_trgm"` (generated from `extensions = [pg_trgm]`);
  - GIN `gin_trgm_ops` indexes on `entities.display_name`, `entity_identifiers.source_id`, `exceptions.title`, `investigations.title`; `source_records (source_system, observed_at, received_at)`;
  - enums `CauseCategory`, `AtRiskReason`, `RootCauseOutcome`, `OverviewSnapshotStatus`, `OverviewSnapshotTrigger`;
  - tables `overview_snapshots`, `overview_snapshot_orders`, `saved_filters`;
  - CHECK constraints (data-model §1b).
- **Reads**: `entities`, `entity_identifiers`, `source_records`, `state_observations`, `risks`, `risk_evaluations`, `exceptions`, `exception_entities`, `analysis_snapshots`, `investigations`, plus every service listed in research R2.

**Testing**:
- **Vitest (shared)**: schemas, category mapping completeness, built-in filters.
- **Jest unit**: every pure module (research R17), the promise pool, `SnapshotTrigger` with fake timers.
- **Jest + supertest e2e** (real Postgres, risk scheduler and automatic snapshots disabled):
  - snapshots H1, H2 (with 005 equality per row and 006 cross-checks), determinism, single run, failure, pruning;
  - Home H5 per role, drill-target equality for every figure, section isolation;
  - frequent root causes H3 and 007's new filter; freshness H4; search H7; finder and saved filters H6;
  - one test with automatic snapshots enabled;
  - authz rows for all 13 routes; 002, 007, 008 and 009 suites unchanged and green.
- **Performance suites** behind `RUN_PERF=1`.

**Target Platform**: Linux server (API), evergreen browsers (web).

**Project Type**: Web application (pnpm monorepo: api + web + shared).

**Performance Goals** (SC-004 to SC-006, research R18):
- search p95 < 1 s (50k entities, 10k exceptions, 10k investigations);
- Home p95 < 2 s (same dataset, 10k open risks);
- at-risk orders and blockers first page p95 < 1 s;
- snapshot of 1,000 at-risk orders < 2 min on the 50k graph;
- freshness < 200 ms.

**Constraints**:
- no `any`, no new npm dependencies;
- no traversal or recursive SQL outside `prisma-graph.repository.ts` (search SQL is fixed-shape, non-recursive);
- no second implementation of another feature's rule (views, SLA status, clocks, risk levels, root causes, money, recurrence);
- 005 never runs inside a transaction;
- pure modules never read the clock or randomness; bigint money only;
- every SQL ordering ends in a unique key; in-memory ordering uses `compareCodeUnits`;
- the §39 and §40 seeds and the 007, 008 and 009 seed rows stay unchanged; the seed adds nothing.

**Scale/Scope**:
- 13 endpoints, plus one filter on 007's list;
- 1 migration;
- 2 new Nest modules (`overview`, `search`), small additions to `graph`, `impact`, `exceptions`, `investigations`, `risk`;
- about 14 pure modules;
- about 30 web components, 8 hooks, 5 pages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | Every at-risk order row cites the state observation behind "impaired" (source system, source id, observed time), the risk number, the SLA clock key; disagreeing source values are listed with their sources. Data freshness is computed from `source_records.observed_at`/`received_at` per source system, and Home names stale sources behind revenue at risk. Search shows the matching identifier with its source system. Nothing is normalized away. |
| II. Fact vs Inference | ✅ | Categories come from 005's candidates with their confidence; LOW-confidence ("possible") root causes are shown as such and their share of each category is stated. Other candidates' categories are shown as "not counted". Value disagreements are shown with a low/high range, never silently resolved. Similar search matches are labelled `SIMILAR`. No inferred conclusion is created by this feature. |
| III. Explainability & Determinism | ✅ | Published rules: the at-risk definition, the category mapping table, the analysis order, the add-up invariant, the frequent threshold and window, the stale threshold, the search tiers and similarity threshold. Every figure opens the exact list behind it (equality tested). Explicit `evaluatedAt` on every time-dependent route; snapshots record their evaluation, `asOf` and graph versions; same inputs → identical output (tested). No scores, no AI. |
| IV. Auditability | ✅ | Audited: saved filter create/update/delete (before/after), snapshot completion and failure (System or the requesting Administrator), pruning. Refusals audited by `RolesGuard`. Reads write nothing. |
| V. Test-Gated Changes | ✅ | All 13 endpoints have zod schemas in `@opsgraph/shared` and e2e tests (success, 401, 400, and 403/404/409 where they apply). No traversal logic is added. |
| VI. MVP Scope Discipline | ✅ | Answers §65 Q1 "What is happening?", Q6/Q7 (what is affected, how serious: revenue at risk), Q9 "Who owns the problem?" (assigned to me, blockers' exceptions), Q12 "Has this happened before?" (frequent root causes); search supports all of them. §47 Home and §20 Search are product areas; no BI, charts, NL, workflow or analytics (§62 respected). |
| Tech constraints | ✅ with deviations | Strict TS, no new npm dependencies, traversal only in `GraphRepository`. Two new bounded contexts (`overview`, `search`) not listed in CLAUDE.md, and a database extension: see Complexity Tracking. |

**Post-design re-check**: ✅ No unjustified violations. The deliberate choices are listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/010-home-dashboard-search/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/api.md           # routes, schemas, category mapping, built-in filters, texts, fixtures H1–H7
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (new and changed files only)

```text
packages/shared/src/
├── common.ts                  # + ErrorCode SNAPSHOT_IN_PROGRESS, NO_RISK_EVALUATION, SAVED_FILTER_NAME_TAKEN, SAVED_FILTER_LIMIT
├── audit.ts                   # + 6 AUDIT_ACTIONS (research R15)
├── overview.ts                # NEW: categories, mapping, limits, snapshot payloads, overview/drill/list schemas
├── search.ts                  # NEW: search and entity-finder schemas, STATE_CLASSES
├── saved-filters.ts           # NEW: stored criteria, BUILT_IN_FILTERS, request/response schemas
├── exceptions.ts              # 007: ExceptionListQuerySchema + rootCauseLabel, rootCauseWindowEnd
├── *.spec.ts                  # NEW overview.spec.ts, search.spec.ts, saved-filters.spec.ts
└── index.ts                   # + 3 exports

apps/api/prisma/
├── schema.prisma              # previewFeatures, extensions, 5 enums, 3 models, GIN + freshness indexes, back-relations
└── migrations/<ts>_overview_search/migration.sql   # generated + data-model §1b SQL

apps/api/src/
├── app.module.ts                          # + OverviewModule, SearchModule
├── config/env.ts                          # + OVERVIEW_SNAPSHOT_AUTO, OVERVIEW_ANALYSIS_CONCURRENCY
├── common/errors/app-error.ts             # + 4 Errors factories
├── common/concurrency/promise-pool.ts (+ .spec.ts)   # NEW
├── graph/
│   ├── entities.service.ts                # extract buildEntityListWhere / pageEntities (arrays accepted; 002 behaviour unchanged)
│   ├── source-systems.controller.ts       # + GET freshness (route 7)
│   ├── source-freshness.service.ts        # NEW
│   ├── freshness.ts (+ .spec.ts)          # NEW, pure
│   └── graph.module.ts                    # + exports EntitiesService
├── impact/impact.module.ts                # + exports OrderValueReader
├── exceptions/                            # 007: list filter rootCauseLabel/rootCauseWindowEnd (buildWhere + spec)
├── investigations/investigations.module.ts# + exports InvestigationsQueryService
├── risk/
│   ├── risk.module.ts                     # + exports RisksQueryService, SlaClockService, RiskEvaluationNotifier
│   ├── evaluation/risk-evaluation.notifier.ts (+ .spec.ts)   # NEW listener list (research R3)
│   └── evaluation/risk-evaluation.service.ts                 # + notifier.evaluationCompleted after COMPLETED commit
├── overview/                              # NEW module
│   ├── overview.module.ts  overview.controller.ts  overview.service.ts           # route 1
│   ├── frequent-root-causes.controller.ts  frequent-root-causes.service.ts      # route 4
│   ├── snapshot/
│   │   ├── snapshot-runner.ts  snapshot-trigger.ts (+ .spec.ts)  at-risk-orders.reader.ts
│   │   ├── snapshot-query.service.ts  snapshot.mapper.ts
│   │   └── snapshots.controller.ts  at-risk-orders.controller.ts  blockers.controller.ts   # routes 2, 3, 5, 6
│   └── rules/                             # pure
│       ├── categories.ts  at-risk.ts  analysis-order.ts  totals.ts  blockers.ts
│       ├── frequent.ts  sentences.ts  drill.ts  layout.ts
│       └── *.spec.ts
└── search/                                # NEW module
    ├── search.module.ts  search.controller.ts  search.service.ts  search.repository.ts   # route 8
    ├── entity-finder.controller.ts  entity-finder.service.ts                           # route 9
    ├── saved-filters.controller.ts  saved-filters.service.ts  saved-filter.mapper.ts   # routes 10–13
    └── rules/ query-text.ts  highlight.ts  criteria.ts  (+ *.spec.ts)

apps/api/test/
├── load-env.ts                            # OVERVIEW_SNAPSHOT_AUTO=false
├── helpers.ts                             # resetDb: + 3 tables
├── overview-snapshot.e2e-spec.ts  overview.e2e-spec.ts  overview-auto-snapshot.e2e-spec.ts   # NEW
├── frequent-root-causes.e2e-spec.ts  source-freshness.e2e-spec.ts                            # NEW
├── search.e2e-spec.ts  entity-finder.e2e-spec.ts  saved-filters.e2e-spec.ts                  # NEW
├── exceptions-list.e2e-spec.ts            # 007: + rootCauseLabel cases
├── authz-matrix.e2e-spec.ts               # + 13 rows
└── perf-overview.e2e-spec.ts  perf-search.e2e-spec.ts                                        # NEW: RUN_PERF=1 only

apps/web/src/
├── router.tsx                             # index → home/HomePage; search; overview/at-risk-orders, overview/blockers, overview/root-causes
├── layout/AppShell.tsx                    # + <GlobalSearch /> in the header
├── components/search/                     # NEW
│   ├── GlobalSearch.tsx  SearchResultList.tsx  Highlight.tsx  TierBadge.tsx
│   ├── useSearch.ts  useSearchShortcut.ts
│   └── *.test.tsx
├── pages/search/SearchPage.tsx (+ test)   # NEW (/search)
├── pages/home/                            # NEW (replaces pages/HomePage.tsx)
│   ├── HomePage.tsx  useOverview.ts  drill-href.ts (+ .test.ts)
│   ├── SectionFrame.tsx  TotalsSection.tsx  AssignedToMeSection.tsx
│   ├── ExceptionsCard.tsx  RisksCard.tsx  SlaCard.tsx  RevenueAtRiskCard.tsx  BlockersCard.tsx
│   ├── FrequentRootCausesCard.tsx  FreshnessCard.tsx
│   ├── overview-test-data.ts
│   └── *.test.tsx
├── pages/overview/                        # NEW
│   ├── overview-params.ts (+ .test.ts)  useAtRiskOrders.ts  useBlockers.ts  useFrequentRootCauses.ts
│   ├── AtRiskOrdersPage.tsx  BlockersPage.tsx  FrequentRootCausesPage.tsx
│   └── *.test.tsx
├── pages/entities/
│   ├── EntityListPage.tsx                 # uses /api/entity-finder; criteria in the URL
│   ├── EntityFilters.tsx  SavedFiltersPanel.tsx  SaveFilterDialog.tsx  useSavedFilters.ts  entity-finder-params.ts   # NEW
│   └── *.test.tsx
└── pages/exceptions/exceptions-params.ts  # 007: + rootCauseLabel / rootCauseWindowEnd and a removable chip
```

**Structure Decision**: the existing pnpm monorepo.
- Home aggregation and snapshots go in a new `overview` context; search, the finder and saved filters in a new `search` context (research R1).
- Freshness goes in `graph`, next to the existing source-systems route.
- The only cross-context calls are reads through exported services (`exceptions`, `investigations`, `risk`, `root-cause`, `impact`, `graph`) plus 009's completion notifier.

## Key Design Notes (for the implementer)

1. **Build order.** Each step is independently testable. Do not start a step before the previous one's tests pass.
   1. **Shared**: `overview.ts` (constants, mapping, payload and response schemas), `search.ts`, `saved-filters.ts`, error codes, audit actions, 007's two list parameters. Rebuild shared.
   2. **Migration**: `schema.prisma` (preview flag, extension, models, GIN indexes), `prisma migrate dev --create-only`, check that `CREATE EXTENSION` comes first, append data-model §1b, apply, then `prisma migrate diff` must show no drift. Update `resetDb` and `load-env.ts`. Run the whole suite: every existing test must pass unchanged (002's `q` filter is now index-backed with identical results).
   3. **Graph**: extract `buildEntityListWhere`/`pageEntities` (002 tests unchanged), export `EntitiesService`; `freshness.ts`, `SourceFreshnessService`, route 7, `source-freshness.e2e-spec.ts` (H4).
   4. **Search**: `query-text`, `highlight`, `SearchRepository`, service, route 8, `search.e2e-spec.ts` (H7).
   5. **Exports and notifier** in `impact`, `investigations`, `risk`; `RiskEvaluationNotifier` with its unit test; 009's suites stay green.
   6. **Overview rules** (pure), in order: `categories`, `at-risk`, `analysis-order`, `totals`, `blockers`, `frequent`, `sentences`, `drill`, `layout`; `promise-pool`.
   7. **Snapshots**: `AtRiskOrdersReader`, `SnapshotRunner`, `SnapshotQueryService`, routes 2, 3, 5, 6, `SnapshotTrigger`; `overview-snapshot.e2e-spec.ts` (H1, H2) and `overview-auto-snapshot.e2e-spec.ts`.
   8. **Frequent root causes**: 007's list filter (+ its e2e cases), service, route 4, `frequent-root-causes.e2e-spec.ts` (H3).
   9. **Home**: `OverviewService`, route 1, `overview.e2e-spec.ts` (H5, drill equality, isolation).
   10. **Finder and saved filters**: `criteria`, finder service, route 9, saved filters routes 10–13; `entity-finder.e2e-spec.ts`, `saved-filters.e2e-spec.ts` (H6); authz rows.
   11. **Web**: `GlobalSearch` and shortcut, search page; Home cards and sections; drill pages; Entities page finder and saved filters; 007's params chip; router and nav.
   12. **Performance**: `perf-search.e2e-spec.ts`, `perf-overview.e2e-spec.ts`. Record timings in quickstart.md §4.
2. **Reuse, never re-derive.**
   - Counts and lists of exceptions, investigations, risks and SLA clocks come from their query services with the same query objects the drill targets carry (research R2, R13).
   - Root causes come only from `RootCauseService.analyze`; values and money from 006; recurrence from 008's `recurrence.ts`.
   - If an exported service lacks something you need, stop and write the question in `questions.md`; do not query its tables with your own predicates.
3. **Determinism.**
   - Controllers read `now` once; everything below receives `evaluatedAt` or the snapshot's `asOf`.
   - Never call `new Date()`/`Date.now()` in `rules/`.
   - Sort every `Map`/`Set` before output; bigint money; `compareCodeUnits` only.
   - Search sets `pg_trgm.similarity_threshold` with `SET LOCAL` inside the same `$transaction` as its queries.
4. **Transactions.**
   - The snapshot claim, the row writes + completion, and the pruning are three separate transactions; 005 runs outside all of them.
   - Saved-filter mutations write their audit row in the same transaction.
5. **Snapshot invariant.** `assertTotalsInvariant` runs before the completion transaction: per currency, categories sum to the total; category order counts sum to the at-risk count. A violation fails the snapshot (it is a bug, never a data condition).
6. **Search safety.** Escape `\`, `%`, `_` before any `ILIKE`; pass every value as a `$queryRaw` parameter (never string-concatenate SQL); compute highlights on plain strings and render them with `<mark>` elements, never via HTML strings.
7. **Web specifics.**
   - Parse every response with its shared schema through `apiFetch`.
   - Home: text, numbers and tables only, no charts; every number is a link (`drillHref`); each card has its own loading and error state; the page refetches every 60 s; an `evaluatedAt` in the URL pins the view.
   - `/` must not trigger while typing in an input, textarea, select or contenteditable; Ctrl/⌘+K always opens search and prevents the browser default.
   - The combobox follows the ARIA combobox pattern; results are reachable and openable by keyboard only (SC-008).
   - Money is shown with 006's `formatMoneyText`; badges are text plus colour.
8. **Pitfalls**:
   - `noUncheckedIndexedAccess` is on. Use `.at()` with checks and invariant `Error`s, never `!`.
   - Never use `localeCompare`; in SQL, order text with `COLLATE "C"`.
   - Prisma `BigInt` values are serialized as decimal strings.
   - `pg_trgm` GIN indexes only help patterns of 3+ characters; 2-character queries scan, which is within budget at 50k entities.
   - Postgres enum order is declaration order: keep `CauseCategory` in the published order.
   - `resetDb` does not restart sequences: do not assert absolute snapshot numbers except on a freshly migrated database.
   - A crashed test can leave a RUNNING snapshot (`running_slot = true`): `resetDb` truncates the table.
9. **Do not**:
   - add traversal or recursive SQL anywhere;
   - add dependencies;
   - change 008's "recurring" rule, 009's levels or clocks, 006's exposure, or 007's views (only the two new list parameters);
   - add charts, natural-language search, shared filters or notifications;
   - add seed data for this feature or change §39/§40 rows;
   - edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, the constitution or CLAUDE.md.

   Ambiguities go to `questions.md`.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two new bounded contexts, `overview` and `search`, not in CLAUDE.md's module list | Home reads from 005–009 and search spans entities, exceptions and investigations; placing them in an existing context creates module cycles (`risk` already imports `exceptions` and `graph`). | Putting Home in `risk` or search in `graph`: cycles (`graph` cannot import `risk` for SLA criteria). Doing it in the web app: 10+ requests per Home load and no single evaluation time. |
| Stored revenue-at-risk snapshots (derived data, pruned after 24 h) | One 005 analysis per at-risk order (up to 1.5 s each) cannot run per Home load, and the figure must equal its drill-down list exactly. | Live computation: seconds to minutes per load, and figure and list could disagree. Caching in memory: not shared across instances, invisible to audit. |
| `pg_trgm` extension and Prisma's `postgresqlExtensions` preview flag | Substring and typo-tolerant search under 1 s at 50k entities (SC-004). Declaring both in the schema keeps migrations drift-free. | Full-text search does not match identifiers or substrings; hand-written indexes would be dropped by Prisma as drift; an external engine is a new service. |
| Separate `GET /api/entity-finder` beside 002's `GET /api/entities` | Cross-context criteria (risks, clocks, snapshot categories, exceptions) cannot live in `graph`. 002's where-builder and pager are extracted and reused, so ordering and cursors are identical. | Extending 002's route: module cycle and a changed response for 004/007/008 pickers. |
| Small changes to 007 (two list parameters), 008/009/006 (exports) and 009 (completion notifier) | Drill-downs must open the owners' lists with exact totals; Home must call the owners' services; snapshots must follow evaluations. | Duplicating view predicates or querying other contexts' tables directly would re-derive their rules and drift. |
