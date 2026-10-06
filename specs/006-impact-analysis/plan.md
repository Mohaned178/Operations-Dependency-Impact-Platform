# Implementation Plan: Impact Analysis

**Branch**: `006-impact-analysis` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-impact-analysis/spec.md`

## Summary

For any entity, OpsGraph computes **what is affected downstream** and how much is at stake:
- counts per entity type, with the 6 headline categories always shown (products, purchase orders, customer orders, customers, shipments, SLA commitments);
- each split into **direct vs indirect** (shortest distance 1 or more) and **current vs potential** (reached by an all-impaired "live" chain, or only reachable);
- **financial exposure**: the sum of affected customer-order values, each order counted once, per currency, split into current and potential, with the inferred-only share and a low-to-high range when sources disagree;
- a deterministic plain-language summary.

Every number drills down to its exact entities. Each entity has a primary path, its shortest path, a path count and flags. Customers are attributed through PLACED and HAS/DEFINES. The feature also adds a **PurchaseOrder** entity type and a disconnected **§40 supplier-failure seed** (Fabrikam Components: 84,000.00 USD exposure).

**Approach** (research R2 to R8):
1. **Traversal**: a new `GraphRepository.traceImpact`. One recursive CTE (which stops at COMPLETED and CANCELLED) plus the existing edge loading. Then **three runs of the unchanged 003 `selectCanonicalPaths`**, over all edges, the live (impaired-only) subgraph and the shortest-distance subgraph, plus a SOURCE-only reachability BFS. Path enumeration for drill-down is a bounded backward DFS exposed as `trace.paths(ids)`.
2. **Attribution**: a new `GraphRepository.findAttributedCustomers`, a fixed 2-hop non-recursive query that returns UPSTREAM link paths.
3. **Impact module**: `OrderValueReader` reads current and per-source amounts. Pure modules handle classification, customers, exposure (bigint money), categories, lists and cursors, and summary. `ImpactService` orchestrates 3 GET routes: summary, drill-down list and item detail.
4. **Web**: an **Impact** section on Entity 360, between Blockers and Dependencies. It has a clickable category table, exposure figures, in-place lists, row detail, and URL state (`idepth`, `ilist`).

All design decisions are in [research.md](./research.md) and are binding. The exact expected results are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures I1 to I14. The seed rows are in [seed-scenario-40.md](./seed-scenario-40.md).

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS. Unchanged.

**Primary Dependencies**: unchanged. NestJS 11, Prisma 6, zod 3, React 19, React Router 7, TanStack Query 5, Tailwind 4. **No new dependencies** (research R14).

**Storage**: PostgreSQL 16 via Prisma 6.
- **One migration** (`<ts>_purchase_order_entity_type`): `ALTER TYPE "EntityType" ADD VALUE 'PurchaseOrder'`.
- **No new tables.**
- **Reads**: `entities`, `relationships`, `source_records` (ENTITY `normalized.attributes`) and `state_observations`, through `StateEvidenceReader`.

**Testing**:
- **Jest unit tests**:
  - `impact-paths` (live, shortest, sourced, enumeration, terminal stop, cycles), plus a **brute-force property test** over at least 1,000 generated graphs (SC-007);
  - every pure impact module;
  - `scenario-40.spec.ts` (FR-031).
- **Jest + supertest e2e** against real Postgres:
  - fixtures I1 to I14 on both seeds;
  - built graphs for UNKNOWN, terminal, cycles, multiple currencies and value disagreements;
  - validation, 401 and 404;
  - the authz matrix;
  - the repository methods;
  - the seed.
- **Vitest** for the shared schemas and web components.
- **Performance suite** behind `RUN_PERF=1`.

**Target Platform**: Linux server (API), evergreen browsers (web).

**Project Type**: Web application (pnpm monorepo: api + web + shared).

**Performance Goals** (SC-003/SC-004): summary p95 under 2 s, and the first drill-down page p95 under 2 s, at 50k entities, ≥ 150k relationships and a supplier reaching ≥ 2,000 entities. The Impact section must render in under 3 s.

**Constraints**:
- no `any`, no new dependencies;
- traversal SQL only in `prisma-graph.repository.ts`;
- all ordering in TypeScript with `compareCodeUnits`;
- money as bigint units of 10⁻⁴, never `Number`;
- pure modules never read the clock;
- no writes, audit rows, storage or caching;
- the §39 seed output is byte-identical.

**Scale/Scope**:
- 3 new endpoints;
- 1 migration;
- 2 repository methods;
- 1 pure traversal file;
- about 7 pure impact modules;
- 1 seed dataset;
- 1 new web section (about 7 components and 3 hooks).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | Every listed entity carries its current state with source system and observation time, and per-source states when they disagree (`TracedEntityDto`). Every path hop carries all assertions with source system, source id and observation time. Order values show each source's stated value with source id and observation time. The new seed rows carry full provenance. |
| II. Fact vs Inference | ✅ | Every hop shows its origin and confidence. Entities without an all-SOURCE path are flagged `inferredOnly` with the weakest origin and confidence, in counts, lists and exposure shares. The summary says so, and in its first line when everything is inferred (I12). UNKNOWN entities are never current. "Current" requires an unbroken impaired chain, so an impaired entity is not blamed on the analyzed one (`otherCause`). **Conflicts**: disagreeing order values are all shown, with a low/high exposure range, and are never silently picked. |
| III. Explainability & Determinism | ✅ | There are no scores. Every number maps 1:1 to a list whose length or sum equals it (FR-017, tested). Every entity has a primary path, its shortest path and a path count. The summary is built from templates. Results depend only on data and the query; SC-006 checks 100 identical runs. No AI is involved. |
| IV. Auditability | ✅ | The feature is read-only, with no mutations and so no audit rows (FR-026). The seed import is audited by the existing import pipeline. |
| V. Test-Gated Changes | ✅ | All 3 endpoints have zod schemas in `@opsgraph/shared`, and e2e tests for success, 401, 404 and validation, plus authz-matrix rows. The new traversal code has unit tests for cycles, depth 1, the default and 10, terminal stops and the enumeration budget, plus a brute-force property test. |
| VI. MVP Scope Discipline | ✅ | Answers §65 "What is affected?" and "How severe is the exposure?". §61 lists "impact analysis" in the MVP. There is no what-if, prediction, risk, recommendation or graph view (spec Assumptions). PurchaseOrder is the minimum vocabulary that §40 and the user's categories need. |
| Tech constraints | ✅ | Strict TS, no new dependencies. All traversal (the CTE, the 2-hop attribution query and in-memory path work) lives in `GraphRepository` and `graph/traversal/`. Every traversal enforces the depth limit and cycle guard. |

**Post-design re-check**: ✅ No unjustified violations. There are two deliberate choices, listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/006-impact-analysis/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── seed-scenario-40.md        # exact §40 rows + expected results
├── contracts/api.md           # routes, schemas, summary templates, fixtures I1–I14
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (new and changed files only)

```text
packages/shared/src/
├── graph.ts                   # + 'PurchaseOrder'; CONTAINS/SUPPLIED_BY rules widened
├── money.ts                   # NEW: AMOUNT/CURRENCY patterns (moved), MoneyDto
├── imports.ts                 # imports patterns from money.ts (no behavior change)
├── impact.ts                  # NEW: constants (data-model §1c) + query/response schemas (contracts)
├── *.spec.ts                  # NEW money.spec.ts, impact.spec.ts; graph.spec.ts + PurchaseOrder rules
└── index.ts                   # + 2 exports

apps/api/prisma/
├── schema.prisma              # EntityType + PurchaseOrder
├── migrations/<ts>_purchase_order_entity_type/migration.sql
└── seed.ts                    # + seedScenario40()

apps/api/src/
├── app.module.ts              # + ImpactModule
├── graph/
│   ├── graph.repository.ts            # + Impact* / Attribution* types, traceImpact, findAttributedCustomers
│   ├── prisma-graph.repository.ts     # + impactReachable (CTE), traceImpact, findAttributedCustomers
│   └── traversal/
│       ├── impact-paths.ts            # NEW: impactEdges, computeImpactSelections, sourcedReach, enumerateImpactPaths
│       ├── impact-paths.spec.ts       # NEW
│       └── impact-property.spec.ts    # NEW: brute force vs selections, ≥1,000 graphs (SC-007)
├── tracing/
│   └── tracing.module.ts              # + exports: [StateEvidenceReader]
├── ingestion/seed/
│   ├── scenario-39.ts                 # PRIMARY_SYSTEM + PurchaseOrder: 'ERP' (type-level only)
│   ├── scenario-40.ts                 # NEW: buildScenario40Document()
│   ├── scenario-40.spec.ts            # NEW (FR-031)
│   └── seed.service.ts                # + seedScenario40()
└── impact/                            # NEW module
    ├── impact.module.ts               # imports GraphModule, TracingModule, PrismaModule
    ├── impact.controller.ts           # 3 GET routes
    ├── impact.service.ts              # analyze → summary | list | item (data-model §4c)
    ├── order-value.reader.ts          # data-model §4a
    ├── impact.mapper.ts               # Affected → AffectedEntityDto, categories/exposure → DTOs
    └── analysis/                      # pure: no Nest, no Prisma, no clock
        ├── types.ts
        ├── money.ts
        ├── classify.ts
        ├── customers.ts
        ├── exposure.ts
        ├── categories.ts
        ├── lists.ts
        ├── summary.ts
        └── *.spec.ts                  # one per module

apps/api/test/
├── graph-repository.e2e-spec.ts       # + traceImpact, findAttributedCustomers cases
├── seed.e2e-spec.ts                   # + seedScenario40 block
├── impact-seed.e2e-spec.ts            # NEW: fixtures I1–I14, determinism (SC-006)
├── impact.e2e-spec.ts                 # NEW: built graphs, validation, 401/404, list/sum invariants
├── authz-matrix.e2e-spec.ts           # + 3 AUTHENTICATED probes
└── perf-impact.e2e-spec.ts            # NEW: RUN_PERF=1 only (research R12)

apps/web/src/pages/entities/
├── EntityDetailPage.tsx               # + <ImpactSection> between BlockersSection and DependenciesSection
└── impact/                            # NEW
    ├── impact-params.ts (+ .test.ts)  # idepth / ilist parse + write (research R13)
    ├── useImpact.ts  useImpactList.ts  useImpactItem.ts
    ├── ImpactSection.tsx
    ├── ImpactTable.tsx
    ├── ExposureFigures.tsx
    ├── ImpactList.tsx
    ├── AffectedEntityRow.tsx
    ├── AffectedEntityDetail.tsx
    ├── impact-test-data.ts
    └── *.test.tsx                     # one per component + EntityDetailPage order test

docs/import-format.md                  # + PurchaseOrder type and rules
```

**Structure Decision**: the existing pnpm monorepo.
- Impact logic goes in the new `impact` bounded context, which is already listed in CLAUDE.md.
- Traversal, including attribution and in-memory path work, stays in `graph`.
- Web work is a subfolder `pages/entities/impact/`, because the section has more than 6 components. Shared building blocks (`PathView`, `StateBadge`, `OriginBadge`) are imported from `pages/entities/`.

## Key Design Notes (for the implementer)

1. **Build order.** Each step is independently testable. Do not start a step before the previous one's tests pass.
   1. **Vocabulary**:
      - `money.ts` (move the patterns), then `graph.ts` (`PurchaseOrder` and rules);
      - the Prisma enum and the migration (`--create-only`; check it is the single `ALTER TYPE`; apply);
      - `PRIMARY_SYSTEM` in `scenario-39.ts`, then `docs/import-format.md`.

      Run the whole test suite: **every existing test must pass unchanged**, except `graph.spec.ts`, which gains rule cases.
   2. **Shared impact**: `impact.ts` (constants, then schemas) and its specs. Rebuild shared.
   3. **Seed**: `scenario-40.ts`, `scenario-40.spec.ts` (with the test-only walk that reproduces the seed-scenario-40.md table), `seedScenario40`, `prisma/seed.ts`, then the `seed.e2e-spec.ts` block.
   4. **Traversal (pure)**: `impact-paths.ts` and its spec, then `impact-property.spec.ts`.
   5. **Repository**: the `impactReachable` CTE, `traceImpact`, `findAttributedCustomers`, then the `graph-repository.e2e-spec.ts` cases.
   6. **Impact pure modules**, in dependency order: `money`, `classify`, `customers`, `exposure`, `categories`, `lists`, `summary`, each with its spec.
   7. **API**: `OrderValueReader`, `impact.mapper`, `ImpactService`, `ImpactController`, `ImpactModule`, and the `StateEvidenceReader` export. Then `impact-seed.e2e-spec.ts`, `impact.e2e-spec.ts` and the authz-matrix rows.
   8. **Web**: `impact-params`, hooks, then the leaf components (`ImpactTable`, `ExposureFigures`, `AffectedEntityRow`, `AffectedEntityDetail`), then `ImpactList`, `ImpactSection`, and the `EntityDetailPage` wiring.
   9. **Performance**: `perf-impact.e2e-spec.ts`. Record the timings in quickstart.md §5.
2. **Do not modify** `reachableEntities`, `selectCanonicalPaths`, `enumerateBlockingPaths`, `comparePaths`, `STATE_CLASSIFICATION`, `DEPENDENCY_DIRECTION` or any 003 response shape. Impact **reuses** `selectCanonicalPaths` by calling it on edge subsets (research R2). It must never fork that function.
3. **`impactReachable`**: copy the post-processing of `reachableEntities` exactly: start detection, `within`, `beyondDepth`, the exploration cut and the `entities` map, including `maxDepth + 1` rows. Only the CTE differs (data-model §3b).
4. **Live selection**:
   - Build it only when the start is IMPAIRED.
   - Both edge ends must be impaired (or the source is the start).
   - UNKNOWN is **not** impaired.
   - AT_RISK and SUSPENDED **are** impaired. Do not reuse `SATISFIED_STATES`.
5. **Money**:
   - `parseAmount` pads the fraction to 4 digits and makes a `BigInt`.
   - Sums are bigint.
   - `formatAmount` keeps at least 2 decimals and trims trailing zeros beyond 2.
   - `formatMoneyText` inserts "," every 3 digits, then appends `' ' + currency`.
   - Never use `Number(...)`, `toFixed` or `toLocaleString` on money.
6. **Customers**:
   - Attribution input is counted Orders and SLAs **only**, never NOT_COUNTED ones.
   - Drop customers equal to the start.
   - Merge with downstream-reached Customer entities (data-model §4b).
7. **Lists**:
   - `total` must equal the summary cell for the same depth and data.
   - Exposure lists must add up exactly to `sum`.
   - Assert both in `impact.e2e-spec.ts` for **every** non-zero cell and figure of I1, I6 and I9 (a loop, not hand-picked).
   - Enumerate paths only for the page's entities.
8. **Evidence**:
   - Call `StateEvidenceReader.load` **once** per request, with the de-duplicated ids of the start and every hop target of every path being serialized, including attribution `link`s.
   - Map with the existing `toPathDto` and `toTracedEntityDto`.
9. **Web specifics** (research R13):
   - Parse every response with its shared schema through `apiFetch`.
   - Every number in `ImpactTable` and `ExposureFigures` is a real `<button>` with an accessible name, for example "6 customer orders, current".
   - The section anchor is `id="impact"`.
   - The section handles its own loading and error states. An impact failure must not blank the page or the other sections.
   - The data-changed notice compares the list's `total` with the summary number for the same selector.
   - Classification and flag badges are text plus colour.
10. **Pitfalls**:
    - `noUncheckedIndexedAccess` is on. Use `.at()` with checks and invariant `Error`s, never `!`.
    - Never use `localeCompare`.
    - A Postgres enum value added in a migration cannot be used in that same migration.
    - `buildTraversalEdges` direction: impact uses `'DOWNSTREAM'` and attribution uses `'UPSTREAM'`.
    - The DEFINES/HAS attribution path has 2 hops, and its middle entity is the Contract. Load the Contract refs too.
    - The start must never appear in `reached`, lists, attributions or exposure.
    - A Payment or Invoice start has an own value (I6 and I14). Line 10 needs `countedTotal > 0`.
11. **Do not**:
    - store, cache or audit analyses;
    - add traversal SQL outside `prisma-graph.repository.ts`;
    - change §39 rows or 003, 004 or 005 contracts;
    - add a graph view, risk, what-if or recommendations;
    - add dependencies;
    - edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `seed-scenario-40.md`, the constitution or CLAUDE.md.

    Ambiguities go to `questions.md`.
12. **Coexistence with 005**: 005 (root cause) adds a `RootCauseSection` between CurrentState and Blockers. This feature inserts `ImpactSection` between Blockers and Dependencies. The two edits touch different lines of `EntityDetailPage.tsx`. If 005 has merged first, keep its section; the order in spec Story 4 scenario 1 then holds. If not, the order is Identity, Current state, Blockers, Impact, Dependencies and so on, and the page-order test must assert only the relative order of Blockers, Impact and Dependencies.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A second recursive CTE (`impactReachable`) next to `reachableEntities` | Impact must not expand through COMPLETED or CANCELLED entities (FR-004), so the walk tuple needs an `expandable` column. The 003 CTE is pinned as a copy in the T009 smoke test of `graph-repository.e2e-spec.ts`, and the 003 performance budgets were measured on it. | Adding a flag would change the 003 SQL for every tracing query. Filtering afterwards in TypeScript would give wrong distances and reached sets, because nodes would be reached through terminal entities. The duplication is about 30 lines, in the one file allowed to hold traversal SQL. |
| `trace.paths(ids)`: a function returned on the repository's result, rather than a separate repository call | Path enumeration needs the in-memory edge set of the same trace. A second repository call would re-run the CTE and edge load (doubling list latency) or need a cache. | Returning raw edges to the impact module would move traversal logic out of `graph` (Constitution: traversal only through GraphRepository). The closure keeps all graph work inside the repository and `graph/traversal/`. |
