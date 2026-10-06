# Implementation Plan: Dependency Tracing & Entity 360

**Branch**: `003-dependency-tracing` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-dependency-tracing/spec.md`

## Summary

For any entity, this feature answers three questions:
- **"What does this depend on?"** (upstream)
- **"What depends on this?"** (downstream)
- **"What is blocking this?"** (blockers)

Every answer is a set of explicit paths, with origin, confidence and source evidence on every hop. Blocking paths also come with deterministic plain-language sentences. The existing entity detail page becomes the **Entity 360** page, with a blocker callout and Blockers and Dependencies sections.

**Approach** (research R3):
1. **Reachability**: one **recursive CTE** inside `PrismaGraphRepository` computes the set of entities reachable within `depth + 1` hops, with each entity's minimum depth. Blocker traces only pass through unsatisfied entities.
2. **Subgraph edges**: one plain query loads the relationship rows among those entities.
3. **Path selection**: pure, unit-tested TypeScript does the work, still inside the repository boundary.
   - **Upstream/downstream**: a layered dynamic program picks one **canonical path** per reached entity, ranked by spec FR-016 (evidence strength first, then length, then id tie-breaks).
   - **Blockers**: a depth-first search lists every maximal blocking path.

A thin new `tracing` Nest module adds two read-only endpoints. It also:
- pages and filters the results;
- attaches state evidence;
- builds the explanation sentences.

There are **no schema changes** and **no new dependencies**.

All design decisions and their reasons are in [research.md](./research.md). They are binding. The expected results on the seeded §39 scenario are spelled out exactly in [contracts/api.md](./contracts/api.md) § Acceptance fixtures.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS. Unchanged.
**Primary Dependencies**: unchanged from 002. NestJS 11, Prisma 6, zod 3, React 19, React Router 7, TanStack Query 5, Tailwind 4. **No new dependencies** (research R13).
**Storage**: PostgreSQL 16 via Prisma 6. **No migrations.** This feature reads `entities`, `relationships` and `state_observations` through raw SQL, using the existing `(from_entity_id, type)` and `(to_entity_id, type)` indexes.
**Testing**:
- **Jest unit tests** for the pure traversal and explanation modules, including a 1,000-graph randomized property test that compares the results against brute force.
- **Jest + supertest e2e** against real Postgres: seed acceptance fixtures F1–F10, small cyclic and edge-case graphs, validation, authorization.
- **Vitest + Testing Library** for the web components.
- **Vitest** for the shared schemas.
- **Performance suite** behind `RUN_PERF=1`.

**Target Platform**: Linux server (API), evergreen browsers (web).
**Project Type**: Web application (pnpm monorepo: api + web + shared).
**Performance Goals**: at 50k entities and 150k relationships:
- blockers p95 < 1 s (SC-003);
- the first page of dependencies p95 < 2 s;
- Entity 360's Identity, Current state and Blockers sections in < 3 s (SC-004).

**Constraints**:
- no `any`;
- no new dependencies;
- traversal SQL (`WITH RECURSIVE`) appears **only** in `prisma-graph.repository.ts`;
- depth 1–10, default 6;
- all ordering is done in TypeScript with code-unit string comparison;
- tracing writes nothing.

**Scale/Scope**: 2 new endpoints, 1 extended screen (5 new components plus a hook and a URL-state helper), about 6 new pure modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | Every hop carries every relationship assertion, each with its source system, source id, observation time, import id and basis. The reached entity carries its current state observation, with source system and observation time. `GET` responses expose all of it, and SC-006 is checked by an e2e test over the full seed. |
| II. Fact vs Inference | ✅ | Every hop has `effectiveOrigin` and `effectiveConfidence` (research R4). A HIGH inferred assertion cannot upgrade a manual link. Explanations name every non-SOURCE hop as "inferred" or "manually recorded", with its confidence and basis (FR-019). Path ranking prefers sourced paths over shorter inferred ones. UNKNOWN states are labelled "possible blocker", never confirmed. **Conflicts**: when sources disagree on a hop's entity state, every per-source state is returned and shown. Formal conflict flagging stays deferred, as in 002 (see Complexity Tracking). |
| III. Explainability & Determinism | ✅ | Results are explicit paths. There are no scores, only ordered rules (FR-016). Sentences come from fixed templates (R9). All ordering is done in TypeScript with code-unit comparison (R7). SC-005 runs 100 identical calls per query. No AI is involved. |
| IV. Auditability | ✅ | Tracing is read-only, so there are no mutations to audit. Refused requests follow the existing auth behaviour. A quickstart step verifies that no audit rows appear. |
| V. Test-Gated Changes | ✅ | Both endpoints have zod schemas in `@opsgraph/shared` and e2e tests for success, 401, 404 and every validation case. Traversal has unit tests for cycles (2-node, 3-node, back to the start) and for depth limits 1, 6 and 10, plus a randomized property test (SC-007). |
| VI. MVP Scope Discipline | ✅ | Answers §65 "Why is this blocked?", "What does this depend on?" and "What depends on this?", plus Q11 (evidence). No §62 non-goal is touched. It includes no graph visualization (004), no root cause (005), no impact metrics (006), and no risks, exceptions or investigations. |
| Tech constraints | ✅ | Strict TS. No new dependencies. All traversal goes through `GraphRepository`, with a maximum depth (CTE `WHERE` plus the path length check) and a cycle guard (`UNION` de-duplication plus "no repeated entity in a path", asserted at runtime and by tests). |

**Post-design re-check**: ✅ No unjustified violations. There are two deliberate choices, listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/003-dependency-tracing/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/api.md          # endpoints, schemas, explanation templates, acceptance fixtures F1–F10
├── checklists/requirements.md
└── tasks.md                  # /speckit-tasks
```

### Source Code (new and changed files only)

```text
packages/shared/src/
├── tracing.ts                 # NEW: constants (data-model §1) + query/response schemas (contracts/api.md)
├── tracing.spec.ts            # NEW
└── index.ts                   # + export * from './tracing'

apps/api/src/
├── app.module.ts              # + TracingModule
├── graph/
│   ├── graph.repository.ts            # + traceDependencies, traceBlockers and their types (data-model §2a)
│   ├── prisma-graph.repository.ts     # + the two recursive-CTE methods (research R3); the ONLY traversal SQL
│   └── traversal/                     # NEW, all pure, no Nest, no Prisma
│       ├── types.ts                   # EdgeRow, TraversalEdge, InternalPath, WalkDirection
│       ├── walk-types.ts              # walkTypes(direction, types) → { followFromTypes, followToTypes }
│       ├── traversal-edges.ts         # buildTraversalEdges (R4)
│       ├── path-order.ts              # compareCodeUnits, compareIdSequences, comparePaths (R7)
│       ├── canonical-paths.ts         # selectCanonicalPaths (R5)
│       ├── blocking-paths.ts          # enumerateBlockingPaths (R6)
│       └── *.spec.ts                  # one per module + traversal-property.spec.ts (R10)
└── tracing/                           # NEW module
    ├── tracing.module.ts              # imports GraphModule, PrismaModule
    ├── tracing.controller.ts          # GET entities/:id/dependencies, GET entities/:id/blockers
    ├── tracing.service.ts             # defaults, filters, paging, blocker lists, truncation, DTO assembly
    ├── tracing.mapper.ts              # pure: internal → DTO (data-model §3)
    ├── state-evidence.reader.ts       # 2 DISTINCT ON queries on state_observations
    ├── explanation.ts                 # pure: explainBlockingPath, summarizeBlockers (contracts/api.md)
    └── *.spec.ts                      # explanation.spec.ts, tracing.mapper.spec.ts

apps/api/test/
├── helpers.ts                         # + entityIdByKey(prisma, type, sourceSystem, sourceId)
├── graph-repository.e2e-spec.ts       # + CTE smoke test on a 3-node cycle (research R3 risk check)
├── tracing-seed.e2e-spec.ts           # NEW: fixtures F1–F10, SC-005 determinism, SC-006 provenance
├── tracing.e2e-spec.ts                # NEW: validation, 401/404, cycles, depth, UNKNOWN, multi-assertion, paging
├── authz-matrix.e2e-spec.ts           # + 2 AUTHENTICATED probes
└── perf-tracing.e2e-spec.ts           # NEW: RUN_PERF=1 only (research R11)

apps/web/src/pages/entities/
├── EntityDetailPage.tsx               # + BlockerCallout in header; + BlockersSection, DependenciesSection (R12 order)
├── useBlockers.ts                     # NEW: shared useQuery for /blockers (key ['entities', id, 'blockers'])
├── tracing-params.ts                  # NEW: pure parse/serialize of ?dep&depth&rel&types (+ .test.ts)
├── BlockerCallout.tsx                 # NEW
├── BlockersSection.tsx                # NEW
├── DependenciesSection.tsx            # NEW
├── PathView.tsx                       # NEW
├── HopEvidence.tsx                    # NEW
└── *.test.tsx                         # one per new component + updated EntityDetailPage.test.tsx
```

**Structure Decision**: the existing pnpm monorepo.
- Traversal (SQL and pure path algorithms) stays in the `graph` bounded context, behind `GraphRepository`.
- Presentation (paging, wording, DTOs) goes in a new `tracing` module, as CLAUDE.md lists.
- The web work extends the existing `pages/entities/` folder, keeping its flat layout.

## Key Design Notes (for the implementer)

1. **Build order.** Each step is independently testable. Do not start a step before the previous one's tests pass.
   1. **Shared**: `tracing.ts` constants and schemas, plus `tracing.spec.ts`. Rebuild shared (`pnpm --filter @opsgraph/shared build`).
   2. **Pure traversal modules, in dependency order**:
      1. `types.ts`;
      2. `path-order.ts`;
      3. `walk-types.ts`;
      4. `traversal-edges.ts`;
      5. `canonical-paths.ts`;
      6. `blocking-paths.ts`;
      7. `traversal-property.spec.ts` last.
   3. **Repository**: first the CTE smoke e2e test in `graph-repository.e2e-spec.ts` (R3 risk check), then `traceDependencies`, then `traceBlockers`.
   4. **`explanation.ts` + spec**: assert the exact F1–F4 and F10 strings from contracts/api.md.
   5. **Tracing module**: `StateEvidenceReader`, `tracing.mapper.ts`, `TracingService`, `TracingController`, `TracingModule`, registration in `app.module.ts`.
   6. **E2E tests**: `tracing.e2e-spec.ts`, `tracing-seed.e2e-spec.ts`, the authz-matrix rows.
   7. **Web**: `tracing-params.ts`, `useBlockers.ts`, `HopEvidence`, `PathView`, `BlockersSection`, `BlockerCallout`, `DependenciesSection`, then the `EntityDetailPage` wiring.
   8. **Performance**: `perf-tracing.e2e-spec.ts`, run locally, then record the timings in quickstart.md.
2. **`walkTypes(direction, types)`** (pure, `traversal/walk-types.ts`): returns `{ followFromTypes, followToTypes }`, each in `TRACEABLE_RELATIONSHIP_TYPES` order. It implements the table in research R3:
   - **UPSTREAM**: `followFromTypes` = types whose `DEPENDENCY_DIRECTION` is `FROM_DEPENDS_ON_TO`; `followToTypes` = the rest.
   - **DOWNSTREAM**: the two lists are swapped.
   - **Blockers**: call it with `'UPSTREAM'` and the blocker types.

   Unit-test all 11 types in both directions.
3. **`PrismaGraphRepository.traceDependencies(q)`**: follow these steps exactly.
   1. Run the R3 step-1 SQL with `maxDepth + 1`. The row with `depth = 0` is the start entity. **If there is no such row, return `null`.** The service turns that into 404.
   2. Split the remaining rows:
      - `within`: rows with `depth ≤ maxDepth`;
      - `depthLimitReached`: whether any row has `depth === maxDepth + 1`.
   3. Sort `within` by `(depth, type, displayName, id)` using `compareCodeUnits`. If it has more than `TRACING_LIMITS.maxReachedEntities` rows, keep the first 10,000 and set `explorationLimitReached`.
   4. Work out the id set:
      - when the limit was **not** reached: the start entity plus all rows, including those at `maxDepth + 1`;
      - when it **was** reached: the start entity plus the kept rows only.

      Run the R3 step-2 SQL with `allowedTypes = followFromTypes ∪ followToTypes`.
   5. Map rows to `EdgeRow` (`observedAt` is already a `Date`). Then:
      - `edges = buildTraversalEdges(rows, q.direction)`;
      - `{ paths, cycleClosing } = selectCanonicalPaths(start.id, edges, q.maxDepth)`.
   6. For each kept entity, read its canonical path from `paths`. Every kept entity MUST have one; throw an invariant error otherwise. Convert `InternalPath` to `TraversalPath`, using an id → `GraphEntityRef` map for each hop's `target`. `distance` is the CTE depth.
   7. Group, sort and cap `cycleClosing` into `CycleClosingHop[]`:
      - sort by `(fromEntityId, relationshipType, toEntityId)`;
      - `relationshipIds` = the assertion ids, in ascending order;
      - set `cycleClosingHopCount` to the uncapped total.
4. **`PrismaGraphRepository.traceBlockers(q)`**: the same steps, with these differences:
   - The CTE adds `JOIN entities n` and `n.current_state <> ALL(${SATISFIED_STATES}::"OperationalState"[])` (R3).
   - The walk types are `walkTypes('UPSTREAM', q.relationshipTypes)`.
   - Path selection uses `enumerateBlockingPaths(start.id, edges, q.maxDepth, TRACING_LIMITS.maxEnumeratedPaths)`.
   - It returns the sorted paths, `enumerationCapped`, `explorationLimitReached` and the cycle-closing hops.

   Build the two SQL variants with `Prisma.sql` fragments and `Prisma.empty`, exactly as `findNeighbors` does today. Do not concatenate strings.
5. **`TracingService`**:
   - Take `computedAt` once, at the start of each method.
   - Fill in the default relationship types, and map the direction parameter: `upstream → 'UPSTREAM'`.
   - A `null` trace means `throw Errors.notFound('Entity')`.
   - **Dependencies**:
     1. apply the entity-type filter to `reached`;
     2. find the page start from the cursor. Decode it with `decodeCursor(z.object({ distance: z.number().int(), type: EntityTypeSchema, displayName: z.string(), id: z.string().uuid() }), cursor)`, and start at the first item that sorts strictly after it;
     3. slice `limit` items;
     4. load state evidence for the start entity plus every entity on the page's paths;
     5. map to DTOs.
   - **Blockers**:
     1. keep the paths that have a non-start entity of a selected type;
     2. `top = kept.slice(0, 100)`;
     3. load state evidence for the start entity plus every entity on `top`;
     4. map each path to `BlockingPathDto`, with `explanation = explainBlockingPath(startDto, pathDto)`;
     5. build `directBlockers` and `deepestBlockers` (R6);
     6. build `summary = summarizeBlockers(startDto, deepestBlockers, query.depth)`;
     7. set the truncation flags: `depthLimit = kept.some(p => p.continuesBeyondDepth)`, `pathLimit = enumerationCapped || kept.length > 100`.
6. **`StateEvidenceReader`**: uses the two raw `DISTINCT ON` queries in data-model §3. Do not use Prisma `distinct` for multiple entities. Pass an empty id list straight through: return an empty map without querying.
7. **Pitfalls that cause wrong or non-deterministic results**:
   - **Strings**: never compare with `localeCompare` or rely on SQL `ORDER BY`. Use `compareCodeUnits` everywhere.
   - **Enum casts**: compare enums with the `::"RelationshipType"[]` and `::"OperationalState"[]` casts, not `::text`, so the indexes are used.
   - **`noUncheckedIndexedAccess`**: it is on, so `array[i]` is `T | undefined`. Use `.at()` with an explicit check, or iterate. Never use non-null `!` assertions on traversal data. Throw an invariant `Error` instead.
   - **Hops**: a hop's `entity` is its **target** (the entity reached), never its recorded `from`. For REVERSE hops (BLOCKS, PLACED, HAS, GOVERNS, DEFINES and GENERATES in the upstream direction), `fromEntityId` is the target.
   - **Distance and path length**: `distance` (the CTE minimum) and `path.length` can differ. Never derive one from the other.
   - **Entities beyond the depth limit**: never return entities with depth `maxDepth + 1`. They exist only to compute `depthLimitReached` and `continuesBeyondDepth`.
8. **Web specifics** (research R12):
   - **API calls**: all go through `apiFetch` with the response schema. Build query strings with `URLSearchParams`, writing `relationshipTypes` and `entityTypes` as comma-joined strings, and only when non-empty.
   - **`tracing-params.ts`**:
     - `parseTracingParams(searchParams)` returns `{ dep, depth, rel, types }`. It falls back to the default for any invalid value: an unknown `dep` becomes `upstream`, an out-of-range `depth` becomes 6, and unknown types are dropped.
     - `writeTracingParams(current, next)` returns a new `URLSearchParams`. It preserves unrelated parameters and omits values equal to their defaults.

     Unit-test both.
   - **Dependencies query**: `useInfiniteQuery` with key `['entities', id, 'dependencies', dep, depth, rel.join(','), types.join(',')]`.
   - **Blockers query**: `useBlockers(id)` is a single `useQuery` with key `['entities', id, 'blockers']`, shared by the callout and the section.
   - **Origin badges**: reuse `OriginBadge`, which already distinguishes SOURCE, INFERRED and MANUAL visually. Reuse `StateBadge` and `stateLabel`. Times use `formatTimestamp`.
   - **Loading and errors**: each section renders its own state, as in 002. One failing section MUST NOT blank the page.
9. **Do not**:
   - write any recursive or traversal SQL outside `prisma-graph.repository.ts`;
   - add `LIMIT` inside the CTE;
   - add a migration, a dependency, a graph diagram, or sections for risks, exceptions, impact or investigations;
   - cache or store results;
   - write audit entries from tracing;
   - change the 002 endpoints or `findNeighbors`;
   - edit `spec.md`, `plan.md`, research.md, the constitution or CLAUDE.md.

   Ambiguities go to `questions.md`.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Path selection runs in TypeScript, on a subgraph loaded by a recursive CTE, rather than entirely in SQL. | Choosing the best path per entity under FR-016 (weakest-hop confidence first, then non-SOURCE count, then length) is a bottleneck-plus-lexicographic objective. SQL cannot express it without enumerating every simple path, which is exponential around hubs. The CTE still does the traversal, with its depth bound and cycle-safe `UNION`. The pure code stays inside the `GraphRepository` implementation and is unit-tested against brute force. | All-paths enumeration in the CTE (a path array plus a `NOT = ANY(path)` guard) explodes at the 1,000-edge hubs used in 002's performance data. Shortest-path-only SQL violates FR-016 and fixtures F1, F5 and F9. |
| Constitution II "surface conflicts": formal conflict **flagging** stays deferred. Per-source states are shown on every hop when they disagree. | The spec keeps conflict detection out of scope, as 002 did. No source value is hidden: `latestBySource` appears on every hop whose sources disagree. | Building conflict detection would expand scope beyond what the user agreed. Hiding the disagreement would violate the principle. |
