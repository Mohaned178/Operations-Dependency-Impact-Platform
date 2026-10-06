# Questions

## Q1 — T001: e2e baseline cannot run, so the database is unreachable

**Where**: `tasks.md` T001 (baseline gate), which also blocks every later e2e checkpoint, starting with T009.

**Result so far** (branch `003-dependency-tracing`, no code changed):

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile`, shared build, `prisma generate` | OK |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass (shared 37, web 38, api 128 tests) |
| `pnpm test:e2e` | **fails in globalSetup** |

**Error** (`apps/api/test/global-setup.ts` runs `prisma migrate reset --force --skip-seed`):

```text
Datasource "db": PostgreSQL database "opsgraph_test", schema "public" at "localhost:5432"
Error: P1010: User was denied access on the database `(not available)`
```

**Environment facts**:
- `apps/api/.env.test` uses `postgresql://opsgraph:opsgraph@localhost:5432/opsgraph_test`.
- `apps/api/.env` points at port 5433, so the dev database differs from the test one.
- Something is listening on 5432, but it rejects the `opsgraph` user. It may be a different, locally installed Postgres instead of the project's container.
- `docker compose ps` fails: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`. Docker Desktop is not running.

**Options**

1. **Start Docker Desktop**, then `docker compose up -d db`. If the container conflicts on 5432 with the other Postgres, stop that service or remap the port.
2. **Provide credentials** for the Postgres already on 5432, with a role `opsgraph` allowed to create and reset `opsgraph_test`.
3. **Point `.env.test` at another database** that you confirm is disposable.

`migrate reset --force` wipes the target database, so I will not choose or alter a database on my own.

**Recommendation**: option 1.

**Blocked**: ticking T001, and all e2e checkpoints from Phase 2 on. Pure unit work (T002–T008) is not blocked.

## Q2 — T009: CTE smoke test is written but has not been run (same cause as Q1)

**Where**: `tasks.md` T009, plus the Phase 2 checkpoint item `pnpm --filter api test:e2e -- graph-repository`.

**Status**: the test is in `apps/api/test/graph-repository.e2e-spec.ts` (new `describe` at the end of the file). It imports the 3-node REQUIRES cycle, runs the exact R3 step-1 SQL and asserts 3 rows with depths A 0, B 1, C 2. **It has not been executed**, so T009 is **not ticked**.

**Why**: the database is unreachable, as in Q1. Docker Desktop is still not running. The only server on 5432 is the Windows service `postgresql-x64-18`, which is not the project's container and rejects the `opsgraph` role. `prisma migrate reset --force` would wipe whatever it points at, so I did not touch it.

```text
$ pnpm test:e2e -- graph-repository
Datasource "db": PostgreSQL database "opsgraph_test", schema "public" at "localhost:5432"
Error: P1010: User was denied access on the database `(not available)`
```

**What is unverified**: whether Postgres accepts the `CROSS JOIN LATERAL ( ... UNION ALL ... )` shape, and whether Prisma's `$queryRaw` accepts a JS string array against `::"RelationshipType"[]` (including the empty array). If either fails, R3 says to switch to the fallback SQL and record it here. T015 (`traceBlockers`) and T032 (`traceDependencies`) depend on the outcome.

**Needed from you**: one of the Q1 options (start Docker Desktop and `docker compose up -d db`, which is the recommendation), then run `pnpm --filter api test:e2e -- graph-repository`.

**Typos in `tasks.md`** (not edited, per the implementer rules): T008 says T015 and T026 replace the two stubs, and T009 says to use the fallback shape in T015 and T026. The second stub is removed by T032 (`traceDependencies`), and T026 is the web `BlockersSection`.

**T001 tick is unsupported**: T001 is ticked in `tasks.md`, but Q1 says the e2e baseline could not run, and no e2e suite has run on this branch. Lint, typecheck and unit tests pass. I left the tick as found, so please confirm or untick it.

## Resolution of Q1 and Q2 (Phase 3 session)

**Status**: resolved. The baseline gate is green and T001 and T009 are verified.

- **Cause**: `.env.test` says port 5432, which is the Windows `postgresql-x64-18` service. `docker-compose.override.yml` maps the project's container to **5433**. Docker Desktop is now running.
- **How the e2e suite runs**: `DATABASE_URL=postgresql://opsgraph:opsgraph@localhost:5433/opsgraph_test`, set in the shell only (`load-env.ts` never overrides an existing variable). No file was changed. `apps/api/.env.test` still points at 5432, so anyone else running e2e needs the same override or a stopped 5432 service.
- **Prisma consent guard**: `prisma migrate reset --force` (run by `global-setup.ts`) refuses to run from Claude Code without the user's explicit consent. The user consented to resetting `opsgraph_test` at localhost:5433 only.
- **Baseline at `056fc17`**: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. `pnpm test:e2e`: 14 suites passed, 2 skipped (`RUN_PERF`), 198 tests passed, 4 skipped.
- **T009 outcome**: Postgres accepts the R3 `CROSS JOIN LATERAL ( … UNION ALL … )` shape, and Prisma binds string arrays (including `[]`) against `::"RelationshipType"[]`. The R3 fallback SQL is **not** needed. The first version of the test failed in its own setup (Order imports need `attributes.amount` as a decimal string and `attributes.currency`), not in the SQL.

## FYI — cycle-closing sort order (Phase 3)

research R5 sorts cycle-closing hops by `(sourceId, type, targetId)` (walk direction), while plan KDN 3.7 and data-model §2b say `(fromEntityId, relationshipType, toEntityId)` (as recorded). I follow KDN 3.7. No Phase 3 assertion depends on the order.

## FYI — build at HEAD (Phase 3 session)

`pnpm build` also passes at the Phase 3 head (only the existing Vite chunk-size warning, 509 kB).

## FYI — quickstart step 1 vs T026 (needs a browser check)

Quickstart step 1 says to click **Budget code for Order #18492** "in a sentence". T026 says to render the sentence text as plain text, with the hop links below it via `PathView`, and that is what is built. Entity names are links in the `PathView` hop rows, the Direct/Deepest blocker lists and nowhere else, so a name inside a sentence is not clickable. I did not invent inline linking. **Decision needed**: either accept T026 (and adjust the quickstart wording) or ask for inline name-linking in a follow-up task.

## FYI — T018 flags on `directBlockers`

T018 says each blocker takes "its `pathLength` and flags from its first path". For `directBlockers` I set `pathLength = 1`, `continuesBeyondDepth = false` and `inCycle = false`, as the `BlockerDtoSchema` comments in contracts/api.md say ("false for direct blockers"). Taking the first path's flags would set SHP-77120 to `continuesBeyondDepth: true` in F10 (`depth=3`), which contradicts the schema comment. `deepestBlockers` take their flags from the first path they appear in. `possible` means state UNKNOWN in both lists. `tracing.e2e-spec.ts` (depth 1) and `tracing-seed.e2e-spec.ts` (F10) assert this.

## T045 cross-check (Phase 6): FR-001–FR-034, SC-001–SC-007

All FRs/SCs are covered. No blocking gap. Two deferred notes at the end.

- FR-001 (upstream/downstream/blockers): `TracingService.blockers/dependencies` + `TracingController` + `tracing-seed.e2e-spec.ts` F1–F10 + `tracing.e2e-spec.ts` shapes.
- FR-002 (direction table): `packages/shared/src/tracing.ts` `DEPENDENCY_DIRECTION` + `tracing.spec.ts` (11 types, no RELATES_TO) + `walk-types.spec.ts` (all 11 both directions, order, blocker split).
- FR-003 (upstream dependent→depended-on, downstream reverse): `walkTypes` + `PrismaGraphRepository.traceDependencies` + `tracing.e2e-spec.ts` symmetry on A REQUIRES B.
- FR-004 (defaults; blockers only REQUIRES/DEPENDS_ON/BLOCKS): `TracingService` defaults + `tracing-seed` F5 (all 11) / F6 (`REQUIRES,DEPENDS_ON`) + `BlockersQuerySchema` rejects `FULFILLED_BY`.
- FR-005 (never RELATES_TO): `TraceableRelationshipTypeSchema.exclude` + `tracing.e2e-spec.ts` ignores RELATES_TO (both kinds) + `perf-tracing.e2e-spec.ts` R3 noise check (no RELATES_TO hop).
- FR-006 (SATISFIED/ACTIVE,COMPLETED,AT_RISK; INDETERMINATE/UNKNOWN; rest UNSATISFIED): `STATE_CLASSIFICATION` + `tracing.spec.ts` (all 12 states, `SATISFIED_STATES` order).
- FR-007 (blocker starts anywhere; later only unsatisfied/indeterminate; never through satisfied): `reachableEntities(blockersOnly:true)` CTE `JOIN entities` + `<> ALL(SATISFIED)` + `tracing.e2e-spec.ts` stops at satisfied middle + F4 (ACTIVE start, no paths).
- FR-008 (direct/deepest; UNKNOWN = possible): `TracingService` R6 lists + `tracing-seed` F1/F2/F10 + `tracing.e2e-spec.ts` UNKNOWN middle/last variants.
- FR-009 (depth 1–10 default 6, reject else): `TraceDepthSchema` + `tracing.spec.ts` (`0/11/2.5/abc` rejected) + `tracing.e2e-spec.ts` validation table + F10 `depth=3/2/10`.
- FR-010 (no repeat, terminates, lists cycle-closing): `blocking-paths` + `canonical-paths` invariant throw + `traversal-property.spec.ts` (SC-007) + 2-node/3-node cycle unit + e2e 2-node cycles + `cycleClosingHops`.
- FR-011 (relationship-type + entity-type filters): `TracingService` filters + `tracing.e2e-spec.ts` entity/relationship filter tests + F6/F7/F10.
- FR-012 (explicit paths, assertions, effective origin/confidence, state evidence): `traversal-edges.ts` (R4) + `state-evidence.reader.ts` + `tracing.mapper.ts` + `tracing-seed` SC-006 + `traversal-edges.spec.ts` origin/confidence/order/key.
- FR-013 (echo query, computedAt, truncation): `TracingService` echo + `truncation` + seed fixtures assert `query`/`truncation`; `computedAt` excluded in SC-005 deep-equal.
- FR-014 (one entry per reached entity + distance + canonical path + total): `traceDependencies` + `selectCanonicalPaths` + F5–F9 distances/paths/totals + pagination concatenation test.
- FR-015 (all blocker paths ≤ limit in FR-016 order + direct/deepest with pathLength): `enumerateBlockingPaths` + service top-100 + F1–F4/F10 paths/direct/deepest/summary.
- FR-016 (rank: weakest confidence → non-SOURCE → length → entity ids → hop keys; reached order distance/type/name/id): `path-order.ts` `comparePaths` (5 rules unit) + `canonical-paths.spec.ts` rules 1–4 isolation + SHP→PAY cases + F1/F3/F5/F9 ordering + `compareReached`.
- FR-017 (deterministic except computedAt): `compareCodeUnits` everywhere, no SQL ORDER BY in traversal + `tracing-seed` SC-005 (100 runs deep-equal).
- FR-018 (one sentence per hop, deterministic templates): `explanation.ts` + `explanation.spec.ts` F1–F3 exact strings.
- FR-019 (non-SOURCE labelled inferred/manual + confidence/basis; UNKNOWN wording): `explanation.ts` Q(h) + `explanation.spec.ts` indeterminate/active/manual-null-basis/single-possible/inCycle/steps(1).
- FR-020 (one-line summary): `summarizeBlockers` + `explanation.spec.ts` F1/F2/F3/F4/F10 + seed summaries.
- FR-021 (10k exploration, 100 blocker paths, pagination 50/200): service `maxReachedEntities`/`maxBlockingPaths`/`maxEnumeratedPaths` + `blocking-paths.spec.ts` maxEnumerated + `tracing.e2e-spec.ts` star pagination (3 pages, concat = single page, last null) + depth-10/11-chain + F10 depthLimit. See deferred note on live 10k/100-path e2e.
- FR-022 (traversal only via GraphRepository): `prisma-graph.repository.ts` is the only `WITH RECURSIVE` in `apps/api/src` (plus T009 smoke test); `grep` below.
- FR-023 (all roles use; unauth refused): `authz-matrix.e2e-spec.ts` AUTHENTICATED probes for both routes + `tracing.e2e-spec.ts` 401s + read-only test as ANALYST/OPS_MANAGER/ADMIN 200s.
- FR-024 (read-only, no audit): `tracing.e2e-spec.ts` read-only counts unchanged + quickstart step 8.
- FR-025 (404 unknown; 400 invalid with field): `ParseUUIDPipe` + `ZodValidationPipe` + validation tables (depth/direction/relationshipTypes/entityTypes/cursor/non-UUID/missing UUID).
- FR-026 (detail page becomes 360 same route): `EntityDetailPage.tsx` wiring (T028/T040) + `EntityDetailPage.test.tsx` header/sections.
- FR-027 (order Identity→Current→Blockers→Dependencies→Relationships→Timeline→Source): `EntityDetailPage.test.tsx` h2 order test (T041).
- FR-028 (callout above fold; single line when none): `BlockerCallout` + `BlockersSection` empty F4 shape + quickstart step 1 manual at 1366×768 (T046).
- FR-029 (every named entity links): `PathView` links + direct/deepest links + dependency rows links + `PathView/BlockersSection/DependenciesSection` tests.
- FR-030 (tab/depth/filters in URL, link reproduces): `tracing-params.ts` parse/write + `DependenciesSection` URL-state + `tracing-params.test.ts` + `DependenciesSection.test.tsx` + quickstart step 4 copy-URL.
- FR-031 (text/lists, no diagram): T041 asserts no `svg`/canvas.
- FR-032 (no risk/exception/impact/investigation): T041 asserts no heading matches `/risk|exception|impact|investigation/i`.
- FR-033 (shared schemas + e2e success/auth/validation): `packages/shared/src/tracing.ts` + `tracing.spec.ts` + `apiFetch` schema parsing in web + `tracing-seed` + `tracing.e2e-spec.ts`.
- FR-034 (traversal tests: cycles, depth 1/default/10, filters, tie-breaks, origin/confidence, UNKNOWN, truncation, seed scenarios): cycles (2-node/3-node/back-to-start unit + e2e), depth 1/6/10 (canonical/blocking specs + e2e depth1/depth10/F10), filters (e2e + F6/F7), tie-breaks (path-order + canonical rules 1–4 + property), origin/confidence multi-assertion (traversal-edges spec + e2e two-source hop), UNKNOWN (e2e middle/last + explanation spec), truncation (maxEnumerated unit + depthLimit e2e + F10), seed scenarios (tracing-seed F1–F10).
- SC-001 (open Order, read why blocked <30s on one page): quickstart steps 1–3 manual (T046).
- SC-002 (100% Stories 1–2 scenarios pass; SHP paths end at Budget code): `tracing-seed.e2e-spec.ts` F1–F10.
- SC-003 (blockers p95 <1s at 50k/150k): `perf-tracing.e2e-spec.ts` blockers(g=0) p95 25 ms.
- SC-004 (first dependencies page p95 <2s; Identity/Current/Blockers <3s): `perf-tracing` downstream(g=6) 24 ms, downstream hub(g=7) 147 ms, upstream(g=0) 25 ms; page <3s follows from API p95s + quickstart Entity 360 walk (no separate web perf harness).
- SC-005 (100 identical runs): `tracing-seed` SC-005 (100 sequential calls ×4 queries, deep-equal minus computedAt).
- SC-006 (every hop has origin/confidence/source triple; non-SOURCE labelled): `tracing-seed` SC-006 over full seed + explanation INFERRED/MANUAL wording.
- SC-007 (1,000 graphs terminate, depth-bound, no repeat): `traversal-property.spec.ts` mulberry32 1,000 graphs × depths 1–4 vs brute force.

Grep checks (T045):
- `grep -rn "WITH RECURSIVE" apps/api/src apps/api/test apps/web/src packages/shared/src` → only `apps/api/src/graph/prisma-graph.repository.ts:395` and `apps/api/test/graph-repository.e2e-spec.ts:403` (T009 smoke). `apps/api/dist` also contains the compiled copy, which is build output.
- `grep -rn "\.localeCompare" apps/api/src/graph apps/api/src/tracing` → no matches (exit 1). The word `localeCompare` appears only in the `path-order.ts` comment stating never to use it.

Deferred (not blocking, no code change):
- Live 10,000-entity explorationLimit and 100-path pathLimit e2e: covered by unit (maxEnumerated cap, sort+slice 10k) and code review; seeding 10k+ reachable in e2e would make the suite slow and is left to the perf topology. DepthLimit and pagination paths are e2e-covered.
- SC-004 Entity 360 <3s page render: no Playwright harness in this feature; API p95s (all <150 ms) plus the quickstart page walk stand in.

## FYI — helpers used before Phase 4

`ReachableSet.within`, `ReachableSet.beyondDepth` and the `blockersOnly: false` branch of `PrismaGraphRepository.reachableEntities` are not used by `traceBlockers`. They are the shared step-1 helper that T032 (`traceDependencies`) reuses, and the `traceDependencies` stub is still in place until then.

## Review resolutions (branch review before PR)

- **Quickstart step 1 vs T026 (inline name links)**: resolved in favour of the spec. FR-029 and User Story 1 require every entity named in an explanation to link to its Entity 360 page. `ExplanationSentence` links the start and hop entity names inside each sentence (longest name first, and a name shared by two different entities on the path is left unlinked). It is used by `BlockersSection` and `BlockerCallout`. The API contract is unchanged.
- **`selectCanonicalPaths` cost**: `continuesBeyond` scanned every edge for each depth-limit path (O(reached × edges), about 570 ms of CPU for a 10k-leaf star). It now uses the per-source adjacency. A confidence threshold that adds no edges is skipped, because its reachable set is unchanged and already assigned. Same 10k star: about 70 ms. The brute-force property test (SC-007) still passes.
- **Relationship-type checkboxes**: unchecking the last checked type produced an empty list, which means "all types", so every box flipped back on and the query widened. The last checked type is now disabled.
