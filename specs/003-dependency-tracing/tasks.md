# Tasks: Dependency Tracing & Entity 360

**Input**: `specs/003-dependency-tracing/` (plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md)
**Tests**: REQUIRED. Constitution V requires e2e tests for every endpoint and unit tests for cycles and depth limits in traversal. Spec FR-033 and FR-034 add to that, and SC-005 to SC-007 are verified by tests.

## Rules for the implementer (read first)

1. Do tasks **in ID order** within a phase. `[P]` tasks touch different files and may be done in any order.
2. Before each task, re-read the referenced section: research (R#), data-model.md (§#), contracts/api.md, or plan.md "Key Design Notes" (KDN #). **Do not invent alternatives.** The expected values in contracts/api.md § Acceptance fixtures (F1–F10) are exact: assert them literally.
3. **No new dependencies, no migrations, no `any`, no `TODO`s, no non-null `!` on traversal data.** Compare strings only with `compareCodeUnits` (never `localeCompare`, never SQL `ORDER BY`).
4. `WITH RECURSIVE` may appear **only** in `apps/api/src/graph/prisma-graph.repository.ts`.
5. After each **phase**, run its **Checkpoint**. Fix every failure, tick the boxes, and commit with Conventional Commits (`feat(tracing): …`, `test(graph): …`), one commit per task or small group of tasks.
6. If anything is ambiguous, contradicts an acceptance fixture, or Postgres rejects a query shape, stop. Write the question, with the exact error output, to `specs/003-dependency-tracing/questions.md`.
7. Rebuild shared after every change to `packages/shared`: `pnpm --filter @opsgraph/shared build`.

**Standard gate** (used by the checkpoints): `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`

---

## Phase 1: Setup

- [x] T001 On branch `003-dependency-tracing`, confirm the baseline is green before any change. With `docker compose up -d db` running, run the standard gate plus `pnpm build`. If anything fails, stop and record it in `specs/003-dependency-tracing/questions.md`. Do not fix 002 code in this feature.

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: shared vocabularies and schemas, the pure building blocks used by both trace kinds, the repository interface, state evidence, DTO mapping, and the de-risking SQL smoke test.

### Shared (`packages/shared/src`)

- [x] T002 Create `packages/shared/src/tracing.ts`. Add:
  - the constants from data-model.md §1: `TraceableRelationshipTypeSchema`, `BlockerRelationshipTypeSchema`, `TRACEABLE_RELATIONSHIP_TYPES`, `BLOCKER_RELATIONSHIP_TYPES`, `DEPENDENCY_DIRECTION`, `StateClassificationSchema`, `STATE_CLASSIFICATION`, `SATISFIED_STATES`, `TRACING_LIMITS`, `CONFIDENCE_RANK`, `ORIGIN_RANK`;
  - every query and response schema in contracts/api.md: `commaList` (not exported), `TraceDepthSchema`, `TraceDirectionParamSchema`, `DependenciesQuerySchema`, `BlockersQuerySchema`, `EntityStateEvidenceDtoSchema`, `TracedEntityDtoSchema`, `HopAssertionDtoSchema`, `HopDtoSchema`, `PathDtoSchema`, `BlockingPathDtoSchema`, `TraceQueryEchoSchema`, `TruncationDtoSchema`, `CycleClosingHopDtoSchema`, `DependencyItemDtoSchema`, `DependenciesResponseSchema`, `BlockerDtoSchema`, `BlockersResponseSchema`.

  Export an inferred type for each schema. Import base schemas from `./graph` and `PageQuerySchema` from `./common`. Add `export * from './tracing';` to `packages/shared/src/index.ts`.
- [x] T003 Create `packages/shared/src/tracing.spec.ts` (Vitest). Cover:
  - `DEPENDENCY_DIRECTION` has exactly the 11 traceable types, and RELATES_TO is absent;
  - `STATE_CLASSIFICATION` matches spec FR-006 for all 12 states, and `SATISFIED_STATES` equals `['ACTIVE','AT_RISK','COMPLETED']` in schema order;
  - `DependenciesQuerySchema`:
    - `direction` is required;
    - `depth` defaults to 6, and `"0"`, `"11"`, `"2.5"` and `"abc"` are rejected;
    - `relationshipTypes: "DEPENDS_ON,REQUIRES,REQUIRES"` gives `['REQUIRES','DEPENDS_ON']` (schema order, de-duplicated);
    - `"REQUIRES,RELATES_TO"` fails with issue path `['relationshipTypes', 1]`;
    - an empty string gives `[]`;
  - `BlockersQuerySchema` rejects `FULFILLED_BY`, and `entityTypes: "Order,Truck"` fails at index 1;
  - one hand-built `BlockersResponse` sample and one `DependenciesResponse` sample each parse.

  Run `pnpm --filter @opsgraph/shared build test`.

### Pure traversal building blocks (`apps/api/src/graph/traversal/`)

- [x] T004 [P] Create `types.ts` with `EdgeRow`, `TraversalEdge`, `InternalPath` and `WalkDirection`, exactly as in data-model.md §2b. `HopAssertion` is imported from `../graph.repository` (it is added in T008). Do T008's type additions first if your compiler needs them.
- [x] T005 [P] Create `path-order.ts` with:
  - `compareCodeUnits(a, b)`: returns `-1`, `0` or `1`, using `<` and `>`;
  - `compareIdSequences(a, b)`: element-wise, and a shorter sequence that is a prefix of the other sorts first;
  - `comparePaths(a, b)`: research R7, rules 1 to 5, using `CONFIDENCE_RANK`.

  Create `path-order.spec.ts` with one test per rule in isolation, plus a test that `compareCodeUnits('B','a') < 0` (code units, not locale).
- [x] T006 [P] Create `walk-types.ts`: `walkTypes(direction: WalkDirection, types: readonly TraceableRelationshipType[]): { followFromTypes: TraceableRelationshipType[]; followToTypes: TraceableRelationshipType[] }` (plan KDN 2, research R3 table). Create `walk-types.spec.ts`:
  - for each of the 11 types and both directions, assert which list it lands in;
  - `walkTypes('UPSTREAM', ['REQUIRES','DEPENDS_ON','BLOCKS'])` gives `{ followFromTypes: ['REQUIRES','DEPENDS_ON'], followToTypes: ['BLOCKS'] }`;
  - the output order follows `TRACEABLE_RELATIONSHIP_TYPES`.
- [x] T007 Create `traversal-edges.ts`: `buildTraversalEdges(rows, direction)` (research R4). It handles grouping by `(type, from, to)`, FORWARD/REVERSE using `DEPENDENCY_DIRECTION` and the direction, `sourceId`/`targetId`, effective origin and confidence, the assertion sort order, `key` = the smallest id by `compareCodeUnits`, and `nonSource`. Create `traversal-edges.spec.ts` covering:
  - REQUIRES upstream is FORWARD (source = from);
  - BLOCKS upstream is REVERSE (source = to, target = from);
  - REQUIRES downstream is REVERSE;
  - PLACED upstream is REVERSE;
  - the effective values for these assertion sets:
    - {SOURCE/MEDIUM, MANUAL/HIGH} gives SOURCE/MEDIUM;
    - {INFERRED/HIGH, MANUAL/LOW} gives MANUAL/LOW;
    - {INFERRED/LOW, INFERRED/MEDIUM} gives INFERRED/MEDIUM;
  - the assertion order;
  - two distinct types between the same pair give two edges.

### Repository interface and SQL smoke test

- [x] T008 In `apps/api/src/graph/graph.repository.ts`, add every type and the two method signatures from data-model.md §2a: `TraceDirection`, `GraphEntityRef`, `HopAssertion`, `TraversalHop`, `TraversalPath`, `CycleClosingHop`, `DependencyTraceQuery`, `ReachedEntity`, `DependencyTrace`, `BlockerTraceQuery`, `BlockerTrace`, `traceDependencies`, `traceBlockers`. Leave `findNeighbors` and `countNeighbors` untouched. In `prisma-graph.repository.ts`, add both methods with the body `throw new Error('not implemented')` **only temporarily**, so the code compiles. T015 and T026 replace them. No such stub may remain at the end of Phase 4.
- [x] T009 Extend `apps/api/test/graph-repository.e2e-spec.ts` with a **CTE smoke test** (research R3 "Risk to verify first").
  - **Setup**: use `runImport` to import 3 Order entities, A, B and C, all PENDING, with A REQUIRES B, B REQUIRES C and C REQUIRES A (a 3-node cycle).
  - **Query**: from the test, run the exact step-1 SQL of research R3 through `prisma.$queryRaw`, with `followFromTypes = ['REQUIRES']`, `followToTypes = []` and `maxDepth + 1 = 7`.
  - **Assert**:
    - it terminates;
    - it returns exactly 3 rows;
    - the depths are A 0, B 1, C 2.

  If Postgres rejects the `CROSS JOIN LATERAL` shape, switch to the fallback SQL in research R3, note it in `questions.md`, and use that same shape in T015 and T026.

### State evidence and DTO mapping (`apps/api/src/tracing/`)

- [x] T010 [P] Create `state-evidence.reader.ts`: an `@Injectable() StateEvidenceReader` with `load(entityIds: readonly string[]): Promise<Map<string, { observation: StateObservationDto | null; latestBySource: StateObservationDto[] }>>`. It runs the two `DISTINCT ON` raw queries from data-model.md §3. Rules:
  - empty input returns an empty map without querying;
  - every requested id gets an entry, `{ observation: null, latestBySource: [] }` when it has no observations;
  - `latestBySource` is non-empty only when at least 2 distinct states exist, and is then sorted by `sourceSystem` with `compareCodeUnits`;
  - Dates are mapped to ISO strings.
- [x] T011 [P] Create `tracing.mapper.ts` (pure). It has:
  - `toTracedEntityDto(ref: GraphEntityRef, evidence)`: adds `state.classification` from `STATE_CLASSIFICATION`;
  - `toHopDto(hop: TraversalHop, evidenceMap)`;
  - `toPathDto(path: TraversalPath, evidenceMap)`: `length = hops.length`;
  - `toCycleClosingHopDto(hop)`;
  - `collectEntityIds(paths: TraversalPath[], startId): string[]`: unique, in first-seen order.

  A missing evidence entry is an invariant error (throw). Create `tracing.mapper.spec.ts` covering classification, ISO dates, `length`, and that `collectEntityIds` de-duplicates.
- [x] T012 [P] Add `entityIdByKey(prisma, entityType, sourceSystem, sourceId): Promise<string>` to `apps/api/test/helpers.ts`. It looks the entity up through the `entity_identifiers` unique key and throws a descriptive error if it is missing. This is the same lookup `seed.e2e-spec.ts` does inline, but leave that file unchanged.

**Checkpoint**: `pnpm --filter @opsgraph/shared build test`, `pnpm --filter api test`, `pnpm --filter api test:e2e -- graph-repository`, `pnpm lint`, `pnpm typecheck`.

---

## Phase 3: User Story 1 — "What is blocking this?" (P1) 🎯 MVP

**Goal**: `GET /api/entities/:id/blockers` returns ranked, evidenced blocking paths with explanation sentences, and the Entity 360 page shows them (callout plus Blockers section).
**Independent test**: with the seed loaded, contracts/api.md fixtures F1–F4 and the blocker half of F10 pass, and quickstart steps 1–3 behave as written.

### Backend

- [x] T013 [US1] Create `apps/api/src/graph/traversal/blocking-paths.ts`: `enumerateBlockingPaths(startId, edges, maxDepth, maxEnumerated): BlockingPathsResult` (research R6 pseudocode, **including** the combined end condition). Details:
  - adjacency is sorted by `(targetId, key)` with `compareCodeUnits`;
  - `cycleClosing` is unique by `key`;
  - each path's `weakestConfidence` and `nonSourceHops` are computed from its edges;
  - the output is sorted with `comparePaths`;
  - stop as soon as `maxEnumerated` paths have been emitted, and set `enumerationCapped`;
  - assert no repeated entity per path, and throw `Error('traversal invariant: repeated entity')` if one repeats.
- [x] T014 [US1] Create `blocking-paths.spec.ts` with hand-built `TraversalEdge`s:
  - a linear chain gives 1 maximal path, with no prefixes emitted;
  - a branch gives 2 paths in comparator order;
  - a 2-node cycle A→B→A from A gives 1 path A→B, `endsInCycle`, and 1 cycle-closing edge;
  - a 3-node cycle;
  - `maxDepth = 1` on a longer chain gives `continuesBeyondDepth`;
  - a path ending exactly at the depth limit where the only further edge is a cycle gives `endsInCycle = true` and `continuesBeyondDepth = false`;
  - `maxEnumerated = 2` with 3 possible paths gives 2 paths and `enumerationCapped`;
  - a start with no edges gives `[]`;
  - the SHP-77120 shape (DEPENDS_ON chain plus a MANUAL/MEDIUM BLOCKS shortcut) gives the 4-hop all-HIGH path first.
- [x] T015 [US1] Implement `PrismaGraphRepository.traceBlockers` (plan KDN 3 and 4, research R3 blocker variant, research R8 limits):
  - the CTE with the `JOIN entities n` and `<> ALL(${SATISFIED_STATES}::"OperationalState"[])` lines, using `walkTypes('UPSTREAM', q.relationshipTypes)` and `maxDepth + 1`;
  - return `null` when there is no depth-0 row;
  - the exploration cap;
  - the edge query;
  - `buildTraversalEdges(rows, 'UPSTREAM')`;
  - `enumerateBlockingPaths(..., TRACING_LIMITS.maxEnumeratedPaths)`;
  - conversion of `InternalPath` to `TraversalPath` (each hop's `target` comes from the CTE entity rows);
  - cycle-closing hops grouped, sorted, capped at 100, with the total count.

  Use `Prisma.sql` and `Prisma.empty` fragments only. Remove the T008 stub for this method.
- [x] T016 [US1] Create `apps/api/src/tracing/explanation.ts` (pure): `explainBlockingPath(start: TracedEntityDto, path: BlockingPathDto-without-explanation | PathDto): string[]` and `summarizeBlockers(start: TracedEntityDto, deepest: BlockerDto[], depth: number): string`, exactly per contracts/api.md § Explanation text (subject, object and qualifier tables, `steps()`, summary pseudocode). A hop type other than REQUIRES, DEPENDS_ON or BLOCKS throws.
- [x] T017 [US1] Create `apps/api/src/tracing/explanation.spec.ts`. Build the DTOs by hand (no DB) and assert these **exact** strings:
  - all 4 sentences of F1 `paths[0]` and F1 `paths[1].explanation[0]`;
  - F2 `explanation[0]`;
  - F3 `paths[0].explanation[0]`;
  - the summaries of F1, F2, F3, F4 and F10 (2-blocker, depth-limit form).

  Also cover:
  - an INDETERMINATE middle entity: `has an unknown state, and` / `whose state is unknown`;
  - an ACTIVE start: `is active, but`;
  - a MANUAL hop with a `null` basis: no `: "…"` part;
  - a single possible blocker: `state unknown, possible blocker`;
  - `inCycle`: ` It is part of a dependency cycle.`;
  - `steps(1)` gives `1 step`.
- [x] T018 [US1] Create `apps/api/src/tracing/tracing.service.ts` with `blockers(id: string, query: BlockersQuery): Promise<BlockersResponse>` (plan KDN 5 "Blockers", research R6 blocker lists):
  - `computedAt`;
  - the default types;
  - `null` throws `Errors.notFound('Entity')`;
  - the entity-type filter (paths with a non-start entity of a selected type);
  - the top 100;
  - evidence for the start entity plus every path entity via `StateEvidenceReader`;
  - DTOs via the mapper, with `explanation` from T016;
  - `directBlockers` and `deepestBlockers`, each ordered by its first appearance and taking its `pathLength` and flags from its first path;
  - `summary`;
  - the `truncation` flags;
  - `totalPaths = kept.length`;
  - the query echo (`kind: 'blockers'`).
- [x] T019 [US1] Create `apps/api/src/tracing/tracing.controller.ts`: `@Controller('entities')` with `@Get(':id/blockers')`, using `ParseUUIDPipe` and `ZodValidationPipe(BlockersQuerySchema)`, and calling `TracingService.blockers`. Create `tracing.module.ts` (imports `GraphModule` and `PrismaModule`; provides `TracingService` and `StateEvidenceReader`; declares the controller) and add `TracingModule` to `apps/api/src/app.module.ts`.
- [x] T020 [US1] Create `apps/api/test/tracing-seed.e2e-spec.ts`. In `beforeAll`: `resetDb`, `SeedService.seedScenario39()`, then create an ANALYST and log in. Resolve the ids with `entityIdByKey`. For each request, parse the response with `BlockersResponseSchema` and assert **every line** of:
  - fixtures F1, F2, F3 and F4;
  - the two blocker items of F10 (`depth=3` on the SLA, and `depth=10` on SHP-77120).
- [x] T021 [US1] Create `apps/api/test/tracing.e2e-spec.ts` (blockers part). Each test imports its own small graph with `runImport` after `resetDb`. Cover:
  - **401** without a token;
  - **404** for a random UUID;
  - **400** for each blocker row of the contracts/api.md validation table (`depth` 0/11/2.5/abc, `FULFILLED_BY`, `Truck`, a non-UUID id), each asserting `details[0].path`;
  - a **2-node cycle** (A REQUIRES B, B REQUIRES A, both PENDING): one path, with `endsInCycle`, `inCycle` on the deepest blocker, `cycleClosingHopCount = 1`, and a summary ending `It is part of a dependency cycle.`;
  - **UNKNOWN**: A (BLOCKED) REQUIRES U (no state, so UNKNOWN), and U REQUIRES M (MISSING). The path is A→U→M, U's sentence uses `has an unknown state, and`, and M is the deepest blocker. A variant where U is the last entity gives `possible = true`;
  - a **satisfied middle entity** stops traversal: A REQUIRES S (ACTIVE) REQUIRES M (MISSING) gives no paths;
  - **multiple assertions**: the same A REQUIRES B link from two source systems (MANUAL/LOW and SOURCE/MEDIUM) gives one hop with 2 assertions and effective SOURCE/MEDIUM;
  - **entity-type filter**: `entityTypes=Approval` keeps only paths containing an Approval;
  - **relationship-type filter**: `relationshipTypes=REQUIRES` drops a path that needs DEPENDS_ON;
  - **depth 1** on a 3-chain: one 1-hop path with `continuesBeyondDepth` and `truncation.depthLimit`.
- [x] T022 [US1] In `apps/api/test/authz-matrix.e2e-spec.ts`, add the probe `GET /entities/:id/blockers` → `/api/entities/${MISSING_ID}/blockers`, expected `AUTHENTICATED`.

### Web (`apps/web/src/pages/entities/`)

- [x] T023 [P] [US1] Create `useBlockers.ts`: `useBlockers(entityId: string)` returns `useQuery({ queryKey: ['entities', entityId, 'blockers'], queryFn: () => apiFetch(\`/entities/${entityId}/blockers\`, { schema: BlockersResponseSchema }), enabled: entityId !== '' })`.
- [x] T024 [P] [US1] Create `HopEvidence.tsx` (research R12). Props: `{ hop: HopDto }`. It shows:
  - every assertion, as an `OriginBadge` plus basis plus `sourceSystem · sourceId · formatTimestamp(observedAt)`;
  - the state line, `State: <stateLabel> — reported by <system> at <time>`, or `No state observation`;
  - when `latestBySource` is non-empty, a `Sources disagree:` list (`<system>: <stateLabel>`).

  Create `HopEvidence.test.tsx` covering two assertions, the disagreement list, and a null observation.
- [x] T025 [P] [US1] Create `PathView.tsx`. Props: `{ start: TracedEntityDto; path: PathDto; direction: 'upstream' | 'downstream' }`. It renders an ordered list, one item per hop:
  - the relationship **as recorded**, `‹from name› TYPE ‹to name›`, with names resolved from the start entity and the hop entities by id;
  - the arrow `↑` for upstream or `↓` for downstream;
  - an `OriginBadge` with the effective origin and confidence;
  - the target's `StateBadge`;
  - a link to `/entities/<target id>`;
  - a `<details><summary>Evidence</summary><HopEvidence/></details>`.

  Create `PathView.test.tsx`. A REVERSE BLOCKS hop must render `Payment PAY-88213 BLOCKS Shipment SHP-77120 (consolidated)`, and a MANUAL hop must show `Manual · MEDIUM`.
- [x] T026 [US1] Create `BlockersSection.tsx` (`<section id="blockers">`, heading `Blockers`), using `useBlockers`. It has these states:
  - **Loading** and **error**, each handled locally.
  - **No paths**: one `<p>` with the summary.
  - **Otherwise**:
    - the summary;
    - a card per path, titled `Path N`, holding:
      - the sentences as an `<ol>`, where every entity name in a sentence links to its page: render the sentence text, and below it the hop links via `PathView`;
      - badges for `Ends in a cycle`, `Continues beyond depth <depth>`, and `Possible blocker (state unknown)` when the last entity is UNKNOWN;
      - a `PathView` with `direction="upstream"`;
    - the `Direct blockers` and `Deepest blockers` lists as links;
    - notices when any `truncation` flag is true, for example `Showing the first 100 blocking paths.`

  Create `BlockersSection.test.tsx`, mocking `apiFetch` as `EntityDetailPage.test.tsx` does. Cover the F1-shaped data (2 cards, the Manual badge on Path 2, the summary text), the empty F4 shape (a single line), and the error state.
  *Note: this task is not `[P]` only because it depends on T023–T025.*
- [x] T027 [US1] Create `BlockerCallout.tsx`, using `useBlockers`. It renders nothing while loading, on error, or when `paths.length === 0`. Otherwise it shows a highlighted box with the summary, the `paths[0].explanation` sentences, and `<a href="#blockers">See all blocking paths</a>`. Create `BlockerCallout.test.tsx` covering: rendered with paths, absent without paths, and that both components share one request (render both, assert `apiFetch` was called once for `/blockers`).
- [x] T028 [US1] Update `EntityDetailPage.tsx`:
  - render `<BlockerCallout entityId={entity.id} />` in the header, under the state badge;
  - render `<BlockersSection entityId={entity.id} />` between `CurrentStateSection` and `RelationshipsSection`.

  Update `EntityDetailPage.test.tsx` so its `apiFetch` mock answers `/blockers` with F1-shaped data, and assert the callout text appears.

**Checkpoint**: standard gate. Then, with the dev DB seeded (`pnpm --filter api prisma db seed`) and `pnpm dev`, walk quickstart steps 1–3.

---

## Phase 4: User Story 2 — Upstream and downstream dependencies (P1)

**Goal**: `GET /api/entities/:id/dependencies` returns paginated reached entities, each with distance and a canonical path, and the Entity 360 page has a Dependencies section with Upstream and Downstream tabs, filters, depth control, and URL state.
**Independent test**: with the seed loaded, fixtures F5–F9 and the downstream half of F10 pass, and quickstart steps 4–5 behave as written.

### Backend

- [x] T029 [US2] Create `apps/api/src/graph/traversal/canonical-paths.ts`: `selectCanonicalPaths(startId, edges, maxDepth): CanonicalPathsResult`, exactly per the research R5 pseudocode. It covers:
  - the thresholds HIGH → MEDIUM → LOW;
  - the layered DP with `compareLabels`;
  - never re-entering the start entity;
  - the minimum over `d` by `(nonSource, d, entityIds, hopKeys)`;
  - `weakestConfidence` = the path's actual weakest edge, which is ≥ the threshold;
  - `continuesBeyondDepth`;
  - `endsInCycle` always `false`;
  - the cycle-closing edges;
  - the repeated-entity invariant throw.
- [x] T030 [US2] Create `canonical-paths.spec.ts` with hand-built edges:
  - depth 1 sees only neighbours;
  - **SHP→PAY**: a direct MANUAL/MEDIUM edge versus a 2-hop SOURCE/HIGH route picks the 2-hop route;
  - **rule 2**: equal weakest confidence, so fewer non-SOURCE hops wins even when longer;
  - **rule 3**: equal on rules 1–2, so fewer hops wins;
  - **rule 4**: two equal routes are decided by the entity-id sequence, then by the hop key;
  - a 2-node cycle and a 3-node cycle each give one path per entity and list the cycle-closing edges;
  - an edge back to the start entity is cycle-closing and never a path;
  - `maxDepth = 10` on an 11-chain reaches 10 entities and the last has `continuesBeyondDepth`;
  - an unreachable entity is absent.
- [x] T031 [US2] Create `apps/api/src/graph/traversal/traversal-property.spec.ts` (research R10, SC-007). It has:
  - an inline `mulberry32(seed)` PRNG;
  - 1,000 random graphs (2–9 entities, 0–20 edges, random types from the traceable set, origins and confidences, cycles and parallel edges allowed);
  - for each graph and depth 1–4:
    - **canonical paths**: brute-force every simple path from entity `"e0"` with a plain DFS, sort with `comparePaths`, and take the first per target. `selectCanonicalPaths` must equal that, both in its set of keys and in each path's entity ids and edge keys;
    - **blocking paths**: brute-force every *maximal* simple path. `enumerateBlockingPaths` (with `maxEnumerated` = 10,000) must return the same paths in the same order;
    - no path is longer than the depth, and no entity repeats.

  Use fixed seeds so the test is deterministic.
- [x] T032 [US2] Implement `PrismaGraphRepository.traceDependencies` exactly per plan KDN 3 (steps 1–7):
  - the CTE without the state filter, using `walkTypes(q.direction, q.relationshipTypes)` and `maxDepth + 1`;
  - `null` when there is no start entity;
  - `within`, `depthLimitReached`, and the sort and 10,000 cap;
  - the id set: rows at `maxDepth + 1` are included only when the cap was not hit;
  - the edge query;
  - `buildTraversalEdges(rows, q.direction)`;
  - `selectCanonicalPaths`;
  - `ReachedEntity[]` with `distance` taken from the CTE;
  - the cycle-closing hops.

  Remove the T008 stub. Confirm with `grep -rn "not implemented" apps/api/src` that no stubs remain.
- [x] T033 [US2] Add `dependencies(id: string, query: DependenciesQuery): Promise<DependenciesResponse>` to `TracingService` (plan KDN 5 "Dependencies"):
  - map the direction;
  - default the types;
  - `null` throws 404;
  - apply the entity-type filter;
  - handle the keyset cursor over `(distance, type, displayName, id)` with `decodeCursor`, using the R7 order with `compareCodeUnits`;
  - take a page of `limit` items, setting `nextCursor` only when more items exist;
  - load evidence for the start entity plus every entity on the page's paths;
  - set `totalReached` = the filtered count;
  - set `truncation` (`pathLimit: false`);
  - include the query echo (`kind: 'upstream' | 'downstream'`).

  Add `@Get(':id/dependencies')` to `TracingController` with `ZodValidationPipe(DependenciesQuerySchema)`.
- [x] T034 [US2] Extend `apps/api/test/tracing-seed.e2e-spec.ts`. Parse each response with `DependenciesResponseSchema`, and use `limit=200` to get every item in one page. Assert every line of:
  - fixtures F5, F6, F7, F8 and F9;
  - the downstream item of F10 (`depth=2`).

  Also assert:
  - **SC-005**: 100 sequential calls each of blockers(SHP-77120), blockers(Order #18492), downstream(BR-18492) and upstream(Order #18492) give bodies that are deep-equal once `computedAt` is removed;
  - **SC-006**: for every entity in the seed, call blockers and upstream. Every hop must have `effectiveOrigin`, `effectiveConfidence` and at least one assertion with non-empty `sourceSystem`, `sourceId` and `observedAt`. Every hop whose `entity.state.observation` is non-null must have a non-empty `sourceSystem`. Every non-SOURCE hop in a blocking path must have its explanation sentence contain `inferred,` or `manually recorded,`.
- [x] T035 [US2] Extend `apps/api/test/tracing.e2e-spec.ts` (dependencies part):
  - **401** and **404**;
  - **400** for the dependency rows of the validation table: missing direction, `sideways`, `RELATES_TO` at index 1;
  - **RELATES_TO ignored**: A RELATES_TO B is never traversed, so the result is empty;
  - **2-node cycle**: both entities are reached once, and `cycleClosingHopCount ≥ 1`;
  - **pagination**: a star of 5 dependencies with `limit=2` gives 3 pages, the concatenated items equal a single `limit=200` call, and the last `nextCursor` is `null`;
  - an **invalid cursor** gives 400 with path `cursor`;
  - **depth 10** on an 11-chain: 10 reached, and `truncation.depthLimit = true`;
  - **upstream vs downstream** symmetry on A REQUIRES B: upstream(A) = [B] and downstream(B) = [A].
- [x] T036 [US2] In `apps/api/test/authz-matrix.e2e-spec.ts`, add the probe `GET /entities/:id/dependencies` → `/api/entities/${MISSING_ID}/dependencies?direction=upstream`, expected `AUTHENTICATED`.

### Web (`apps/web/src/pages/entities/`)

- [x] T037 [P] [US2] Create `tracing-params.ts` (pure) with:
  - `parseTracingParams(sp: URLSearchParams): { dep: 'upstream' | 'downstream'; depth: number; rel: TraceableRelationshipType[]; types: EntityType[] }`, falling back to the defaults for invalid values as plan KDN 8 describes;
  - `writeTracingParams(current: URLSearchParams, next: Partial<…>): URLSearchParams`, which keeps unrelated params and omits defaults (`dep=upstream`, `depth=6`, empty lists);
  - `toDependenciesQueryString(params, cursor?, limit = 50): string`.

  Create `tracing-params.test.ts` covering the round trip, defaults omitted, invalid values falling back, and unrelated params kept.
- [x] T038 [US2] Create `DependenciesSection.tsx` (heading `Dependencies`, research R12). It reads its state only from `useSearchParams()` through `parseTracingParams`, and writes with `setSearchParams(writeTracingParams(...), { replace: true })`. It contains:
  - tab buttons, `Upstream — what this depends on` and `Downstream — what depends on this`, with `aria-pressed`;
  - a depth `<select>` with options 1–10;
  - a relationship-type checkbox group with the 11 types, where all checked means no filter;
  - an entity-type checkbox group with the 12 types;
  - `useInfiniteQuery` with the plan KDN 8 key, `getNextPageParam: (p) => p.nextCursor`;
  - one row per item: entity link, type, `StateBadge`, `N steps`, plus ` · path shown: M steps` when `path.length !== distance`, and a `<details>` holding `PathView`;
  - `Showing X of Y`;
  - `Load more`;
  - an empty state, `Nothing found within N steps.`;
  - notices for `depthLimit` (`More entities exist beyond depth N.`), `explorationLimit`, and `cycleClosingHopCount > 0`.
- [x] T039 [US2] Create `DependenciesSection.test.tsx`. Render it inside a `MemoryRouter` with `initialEntries` and mock `apiFetch`. Cover:
  - the default request: `/entities/<id>/dependencies?direction=upstream&depth=6&limit=50`, with no type params;
  - clicking Downstream changes the URL to `dep=downstream` and requests `direction=downstream`;
  - ticking Order adds `types=Order` to the URL and `entityTypes=Order` to the request;
  - opening with `?dep=downstream&depth=3&types=Order` reproduces that state (FR-030);
  - `Load more` requests the next cursor;
  - the `path shown` text appears when the path length differs from the distance.
- [x] T040 [US2] In `EntityDetailPage.tsx`, render `<DependenciesSection entityId={entity.id} />` between `BlockersSection` and `RelationshipsSection`. In `EntityDetailPage.test.tsx`, add a mock answer for `/dependencies`.

**Checkpoint**: standard gate. Then walk quickstart steps 4–5 against the seeded dev DB.

---

## Phase 5: User Story 3 — Entity 360: the whole context on one page (P2)

**Goal**: the page shows all sections in the FR-027 order, the most relevant answer is above the fold, links are shareable, and nothing outside the scope is shown.
**Independent test**: quickstart steps 6 and 8, plus the tests below.

- [x] T041 [US3] In `EntityDetailPage.test.tsx`, add a test that the `h2` headings appear in exactly this order: `Identity`, `Current state`, `Blockers`, `Dependencies`, `Relationships`, `Timeline`, `Source records`. Read the existing section components for their exact heading texts, and adjust the expected strings to match them without renaming anything. Also assert that no heading matches `/risk|exception|impact|investigation/i` (FR-032), and that no `svg` or canvas graph is rendered (FR-031).
- [x] T042 [US3] Add a test to `EntityDetailPage.test.tsx` that a failing `/blockers` request shows the Blockers section's error while Identity, Dependencies and Relationships still render (plan KDN 8: one failing section must not blank the page). If this fails, fix the components so each section handles its own query state.
- [x] T043 [US3] Add a test to `apps/api/test/tracing.e2e-spec.ts` that tracing is read-only:
  1. count `audit_entries`, `entities`, `relationships` and `state_observations`;
  2. call blockers and both dependency directions 5 times each, as ANALYST, OPS_MANAGER and ADMIN (all must return 200);
  3. assert all four counts are unchanged (FR-023, FR-024).

**Checkpoint**: standard gate. Then walk quickstart steps 6 and 8, and check the callout at 1366×768 in the browser (FR-028).

---

## Phase 6: Polish and cross-cutting

- [ ] T044 Create `apps/api/test/perf-tracing.e2e-spec.ts` exactly per research R11:
  - wrap it in `describePerf`, as `perf-graph.e2e-spec.ts` does;
  - deterministic ids via `md5('perf-' || g)::uuid`;
  - 50,000 entities and the R1–R4 relationship sets (150,000 rows), plus one `imports` row;
  - ADMIN login;
  - 1 warm-up and 20 timed runs per measurement;
  - p95 assertions: blockers(g=0) under 1,000 ms, with the 6-hop-path-ending-at-g=6 check and the no-RELATES_TO check; downstream(g=6), downstream(g=7) and upstream(g=0), each under 2,000 ms;
  - `console.log` of the timings.

  Run `RUN_PERF=1 pnpm --filter api test:e2e -- perf-tracing` locally, and write the measured p95s into the table in `specs/003-dependency-tracing/quickstart.md` § Performance. If a budget is missed, stop and report the numbers in `questions.md`. Do not add caching or change the algorithms on your own.
- [ ] T045 Cross-check against the spec.
  - For every FR-001 to FR-034 and SC-001 to SC-007, name the test or code that covers it, and write any gap to `questions.md`.
  - Run `grep -rn "WITH RECURSIVE" apps/` to confirm it appears only in `prisma-graph.repository.ts` and the T009 smoke test.
  - Run `grep -rn "localeCompare" apps/api/src/graph apps/api/src/tracing` and confirm it finds nothing.
- [ ] T046 Walk the whole of `quickstart.md` by hand and tick each step. Fix any step that doesn't behave as written, in the code. The quickstart may only be edited to correct factual errors.
- [ ] T047 Final gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`. Confirm:
  - no `TODO`s, dead code, `not implemented` stubs or new dependencies (`git diff main -- '**/package.json'` shows no changes);
  - `questions.md` has every open question resolved or explicitly deferred.

---

## Dependencies

- **Phase order**: Phase 1 → Phase 2 → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3) → Phase 6.
- **Within Phase 2**:
  - T002 → T003;
  - T004–T007 need T002 (and T004 needs T008's types);
  - T008 needs T002;
  - T009 needs T008 to compile;
  - T010–T012 need T002 and T008.
- **US1**:
  - T013 → T014 → T015;
  - T016 → T017;
  - T018 needs T011, T015 and T016;
  - T019 → T020 → T021 → T022;
  - for the web, T023–T025 can start once T002 is built, then T026 → T027 → T028.
- **US2**: needs Phase 2. It reuses `PathView`, `HopEvidence` and `TracingController` from US1, so do it after US1.
  - T029 → T030;
  - T031 needs T013 and T029;
  - T032 → T033 → T034 → T035 → T036;
  - for the web, T037 → T038 → T039 → T040.
- **US3**: needs US1 and US2, because it tests the assembled page.

## Parallel examples

- **Phase 2**: T005, T006 and T007 (after T004), and then T010, T011 and T012 at the same time.
- **US1**: T023, T024 and T025 (web) alongside the backend tasks T013–T018.
- **US2**: T037 (web params) alongside T029–T032.

## Implementation strategy

- **MVP**: Phases 1–3. "What is blocking this?" works end to end, with the explanation on the Entity 360 page. Fixtures F1–F4 prove the core §39 promise: tracing from the Shipment reaches the missing Budget code.
- **Increment 2**: Phase 4 adds upstream and downstream tracing. Increment 3 (Phase 5) is the assembly and the guarantees. Phase 6 is performance and the final checks.
- **Review points** for the orchestrator:
  - after T009: the SQL shape is confirmed on Postgres;
  - after T020: the seed fixtures pass, which validates the hand-derived numbers;
  - after T031: the property test shows the algorithms match brute force;
  - after T044: the performance numbers.
