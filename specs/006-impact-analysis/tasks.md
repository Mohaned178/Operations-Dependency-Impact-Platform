# Tasks: Impact Analysis

**Input**: `specs/006-impact-analysis/`:
- plan.md, spec.md, research.md, data-model.md;
- contracts/api.md, seed-scenario-40.md, quickstart.md.

**Tests**: REQUIRED.
- Constitution V requires a zod schema and e2e tests for every endpoint.
- Spec FR-031 to FR-033 list the required coverage.
- SC-002 and SC-005 to SC-008 are verified by tests.

## Rules for the implementer (read first)

1. **Order**: do tasks **in ID order** within a phase. `[P]` tasks touch different files and may be done in any order.
2. **Re-read before each task**: the section the task references:
   - research.md (R#);
   - data-model.md (§#);
   - contracts/api.md (§ name, fixture I#);
   - seed-scenario-40.md;
   - plan.md "Key Design Notes" (KDN #).

   **Do not invent alternatives.** The strings and values in contracts/api.md § Summary text and § Acceptance fixtures, and the rows in seed-scenario-40.md, are exact. Assert them literally.
3. **Forbidden**:
   - new dependencies;
   - `any`, `TODO`s, and non-null `!` (use `.at()` with a check and throw an invariant `Error`);
   - `localeCompare` (compare strings only with `compareCodeUnits` from `apps/api/src/graph/traversal/path-order.ts`);
   - `WITH RECURSIVE` or any multi-hop relationship query outside `apps/api/src/graph/prisma-graph.repository.ts`;
   - calling `new Date()` or `Date.now()` in `apps/api/src/impact/analysis/` or `apps/api/src/graph/traversal/`;
   - `Number(...)`, `parseFloat`, `toFixed` or `toLocaleString` on money amounts (KDN 5).
4. **No changes to earlier features' behavior**:
   - do not change `reachableEntities`, `selectCanonicalPaths`, `enumerateBlockingPaths`, `comparePaths`, `STATE_CLASSIFICATION`, `DEPENDENCY_DIRECTION`, any 003 response shape, or any §39 seed row (KDN 2);
   - every existing test must pass **unchanged**, except the additions named in T003.
5. **Checkpoints**: after each **phase**, run its **Checkpoint**. Fix every failure, tick the boxes, and commit with Conventional Commits (`feat(impact): …`, `feat(graph): …`, `test(impact): …`, `feat(web): …`), one commit per task or small group of tasks.
6. **Questions**: if anything is ambiguous, contradicts an acceptance fixture, or Postgres rejects a query, stop. Write the question, with the exact error output, to `specs/006-impact-analysis/questions.md`.
7. **Shared builds**: rebuild shared after every change to `packages/shared`: `pnpm --filter @opsgraph/shared build`.

**Standard gate** (used by the checkpoints): `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`

---

## Phase 1: Setup

- [x] T001 On branch `006-impact-analysis`, confirm the baseline is green before any change. With `docker compose up -d db` running, run the standard gate plus `pnpm build`. If anything fails, stop and record it in `specs/006-impact-analysis/questions.md`. Do not fix 003 code in this feature. The untracked `specs/004-graph-explorer/` folder is unrelated: do not touch or commit it.

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: the PurchaseOrder vocabulary, the shared impact contract, the impact traversal in the repository, and every pure impact module. All of them are needed by more than one story.

### Vocabulary (research R10, data-model §1a/§1b/§2)

- [ ] T002 Create `packages/shared/src/money.ts`:
  - move `AMOUNT_PATTERN` and `CURRENCY_PATTERN` out of `packages/shared/src/imports.ts` into it, as exports;
  - add `AmountStringSchema`, `CurrencyCodeSchema` and `MoneyDtoSchema` (`MoneyDto` type), exactly as in data-model §1b;
  - make `imports.ts` import the two patterns from `./money`, with no behavior change;
  - add `export * from './money';` to `packages/shared/src/index.ts`.

  Create `packages/shared/src/money.spec.ts` (Vitest). It covers:
  - accepted amounts: `'0'`, `'12480.00'`, `'1.2345'`;
  - rejected amounts: `'01'`, `'1.23456'`, `'-1'`, `'1e3'`;
  - currency `'usd'` is rejected.
- [ ] T003 In `packages/shared/src/graph.ts`:
  - append `'PurchaseOrder'` as the **last** option of `EntityTypeSchema`;
  - set `RELATIONSHIP_RULES.CONTAINS` to `{ from: ['Order','PurchaseOrder'], to: ['Product'] }`;
  - set `RELATIONSHIP_RULES.SUPPLIED_BY` to `{ from: ['Product','PurchaseOrder'], to: ['Supplier'] }`.

  `MONETARY_ENTITY_TYPES` stays unchanged.

  In `packages/shared/src/graph.spec.ts`, add cases:
  - `PurchaseOrder` parses;
  - PurchaseOrder CONTAINS Product and PurchaseOrder SUPPLIED_BY Supplier are allowed;
  - Product CONTAINS Product and PurchaseOrder SUPPLIED_BY Product are refused.

  Rebuild shared.
- [ ] T004 In `apps/api/prisma/schema.prisma`, append `PurchaseOrder` to `enum EntityType`.
  1. Run `pnpm --filter api prisma migrate dev --create-only --name purchase_order_entity_type`.
  2. Check that the generated `migration.sql` contains only `ALTER TYPE "EntityType" ADD VALUE 'PurchaseOrder';` (with Prisma's comment).
  3. Apply it with `pnpm --filter api prisma migrate dev`.
- [ ] T005 [P] In `apps/api/src/ingestion/seed/scenario-39.ts`, add `PurchaseOrder: 'ERP'` to `PRIMARY_SYSTEM`. No row may change; `scenario-39.spec.ts` must pass unchanged.

  In `docs/import-format.md`:
  - add `PurchaseOrder` to the entity `type` list;
  - change the CONTAINS row's `from` to `Order, PurchaseOrder` and the SUPPLIED_BY row's `from` to `Product, PurchaseOrder`.

### Shared impact contract (data-model §1c, contracts/api.md)

- [ ] T006 Create `packages/shared/src/impact.ts`:
  - **Constants**, exactly as in data-model §1c: `ImpactStateClassSchema`, `IMPACT_STATE_CLASS`, `IMPAIRED_STATES`, `TERMINAL_STATES`, `IMPACT_HEADLINE_TYPES`, `IMPACT_NOUNS`, `impactCategoryLabel` and `IMPACT_LIMITS`. `impactCategoryLabel` returns the plural with its first letter upper-cased, for example `'Customer orders'`, `'SLA commitments'`, `'Purchase orders'`.
  - **Query schemas** from contracts/api.md: `ImpactQuerySchema`, `ImpactCategoryBucketSchema`, `ImpactExposureBucketSchema`, `ImpactListSelectorSchema` and `ImpactListQuerySchema`.
    - Implement the `superRefine` rules and the error messages listed there.
    - The `transform` outputs `{ depth, cursor, limit, selector }`.
    - For `notCounted` without `type`, the selector has `type: null`.
  - **Response schemas**: every schema in contracts/api.md § Response schemas, from `ImpactClassificationSchema` through `ImpactItemDetailResponseSchema`.

  Import `TraceDepthSchema`, `TracedEntityDtoSchema`, `PathDtoSchema` and `CycleClosingHopDtoSchema` from `./tracing`, `PageQuerySchema` from `./common`, the money schemas from `./money`, and base schemas from `./graph`. Export an inferred type for every schema. Add `export * from './impact';` to `index.ts`, then rebuild shared.
- [ ] T007 Create `packages/shared/src/impact.spec.ts` (Vitest). It covers:
  - **`IMPACT_STATE_CLASS`**: every `OperationalState` has exactly the class in research R3;
  - **derived lists**: `IMPAIRED_STATES` has 8 entries and `TERMINAL_STATES` is `['COMPLETED','CANCELLED']`;
  - **`IMPACT_NOUNS`**: covers every `EntityType`;
  - **`impactCategoryLabel('Order')`** returns `'Customer orders'`;
  - **`ImpactListQuerySchema`**: every row of contracts/api.md § Validation and access that concerns the query, each giving the stated path and message;
  - **valid selectors**: `list=valueUnknown` gives `{ list: 'valueUnknown' }`, and `list=notCounted` gives `{ list: 'notCounted', type: null }`;
  - **defaults**: `depth` defaults to 6 and `limit` to 50;
  - **`ImpactResponseSchema`**: rejects a response with fewer than 6 categories.

### Traversal (research R2/R4, data-model §3d)

- [ ] T008 Create `apps/api/src/graph/traversal/impact-paths.ts` with `impactEdges`, `computeImpactSelections`, `sourcedReach` and `enumerateImpactPaths`. Follow the signatures and pseudo-code in data-model §3d exactly.
  - Import `IMPACT_STATE_CLASS` from `@opsgraph/shared`.
  - Reuse `selectCanonicalPaths` (`./canonical-paths`), `comparePaths` and `compareCodeUnits` (`./path-order`), and the `TraversalEdge`/`InternalPath` types (`./types`).
  - The `weakestConfidence` and `nonSourceHops` of an enumerated path are computed as in `blocking-paths.ts` `weakestOf`. Make a local copy; do not export a new helper from `blocking-paths.ts`.
- [ ] T009 Create `apps/api/src/graph/traversal/impact-paths.spec.ts` (Jest, pure). Build small `TraversalEdge[]` fixtures with a local helper modeled on the existing `canonical-paths.spec.ts` helpers, and cover:
  1. **Terminal stop**: in S→T(COMPLETED)→X, T is in `canonical` and X is not reachable. Add S→Y→X, and X is reached through Y.
  2. **Live**:
     - with S impaired and S→A(BLOCKED)→B(WAITING), both A and B are live;
     - with S→A(ACTIVE)→B(WAITING), B is not live;
     - with S ACTIVE, `live` is empty;
     - a node in state UNKNOWN is never live;
     - AT_RISK and SUSPENDED are live.
  3. **Shortest vs canonical**: S→B through a 1-hop MANUAL/MEDIUM edge, and S→A→B through 2 HIGH SOURCE edges. Then `canonical(B)` has 2 hops and `shortest(B)` has 1 hop.
  4. **`sourcedReach`**: X reached only through an INFERRED edge is absent; Y with one all-SOURCE path is present; the depth bound is respected.
  5. **`enumerateImpactPaths`**:
     - a diamond S→A→C, S→B→C gives 2 paths, sorted;
     - with `maxPaths = 2`, a graph with 3 paths gives `found.length = 2` and `morePaths = true`;
     - `budget = 1` sets `morePaths = true`;
     - a two-node cycle A↔B terminates, and no path repeats an entity;
     - the depth bound is respected;
     - the start and an unknown target return `{ found: [], morePaths: false }`.
  6. **Start handling**: edges into the start are dropped, and the start is never in any map.
- [ ] T010 Create `apps/api/src/graph/traversal/impact-property.spec.ts` (Jest). Generate at least 1,000 random graphs with a seeded PRNG, written inline as a small LCG; do not add a dependency. Each graph has 2 to 9 nodes, random states, random edges with random origin and confidence, cycles, diamonds and parallel edges, and a random `maxDepth` from 1 to 4.

  A **brute force** enumerates every simple path from the start within `maxDepth`, never expanding a terminal non-start node and never re-entering the start. Assert that `computeImpactSelections` and `enumerateImpactPaths` agree with it:
  - the reached set;
  - min distance;
  - `live.has(v)` ⇔ some brute path to v is all-impaired, with an impaired start;
  - `sourced.has(v)` ⇔ some brute path to v is all-SOURCE;
  - `canonical(v)` equals the `comparePaths`-minimum brute path;
  - `shortest(v)` equals the `comparePaths`-minimum among the brute paths of length = distance;
  - with large caps, `enumerateImpactPaths(v).found` equals the sorted brute paths to v;
  - no path exceeds `maxDepth` or repeats an entity (SC-007).

  If a mismatch shows that `selectCanonicalPaths` is not optimal on some subgraph, **stop and write it to questions.md** with the seed. Do not change `selectCanonicalPaths`.

### Repository (research R2/R5, data-model §3a–§3c, §3e)

- [ ] T011 In `apps/api/src/graph/graph.repository.ts`, add `ImpactTraceQuery`, `ImpactReachedEntity`, `ImpactPathSet`, `ImpactTrace`, `AttributionQuery`, `CustomerAttribution`, and the two `GraphRepository` methods `traceImpact` and `findAttributedCustomers`, exactly as in data-model §3a.
- [ ] T012 In `apps/api/src/graph/prisma-graph.repository.ts`:
  - **`impactReachable`** (private): the SQL in data-model §3b, with the post-processing copied from `reachableEntities` (KDN 3);
  - **`traceImpact`**: data-model §3c. Map every `InternalPath` through the existing `toTraversalPath`. `paths()` maps `enumerateImpactPaths` results the same way;
  - **`findAttributedCustomers`**: data-model §3e, using the SQL as given. Load the customer and contract refs with one `SELECT … FROM entities WHERE id = ANY(...)`. Group the assertions with `buildTraversalEdges(rows, 'UPSTREAM')` and assemble the 1-hop or 2-hop `link` paths. Keep the best path per (attributed, customer) pair with `comparePaths`, then sort by (attributedEntityId, customer.id). Empty inputs return `[]` without querying.
- [ ] T013 Extend `apps/api/test/graph-repository.e2e-spec.ts` with a `traceImpact` block and a `findAttributedCustomers` block. Import small graphs through the existing test import helpers. Cover:
  - **null start**: an unknown start returns `null`;
  - **terminal**: a COMPLETED order is reached but not expanded;
  - **depth**: `maxDepth` is respected and `depthLimitReached` is set;
  - **live and sourced**: `livePath` and `sourcedReach` match a hand-built graph;
  - **paths**: `paths()` returns sorted paths;
  - **exploration limit**: `explorationLimitReached` is set when more than 10,000 entities are reached. Build them with a raw-SQL `generate_series` fan-out, as `perf-tracing` does, but small: 10,001 Orders `DEPENDS_ON` one start;
  - **attribution through PLACED**: 1-hop link;
  - **attribution through DEFINES + HAS**: 2-hop link, with the Contract as the middle hop;
  - **multiple customers**: an order placed by 2 customers gives 2 rows;
  - **empty input**: no query is run.

### Pure impact modules (data-model §4b, research R6/R7/R9)

- [ ] T014 [P] Create `apps/api/src/impact/analysis/types.ts`, with the `Affected` and `Classification` types from data-model §4b plus `ExposureResult`, `ExposureFigure` and `ExposureShare`, mirroring `ExposureFigureDtoSchema` with `bigint` amounts.

  Create `apps/api/src/impact/analysis/money.ts`, with `parseAmount`, `formatAmount`, `formatMoneyText` and `compareUnits` (research R6, KDN 5).

  Create `money.spec.ts`:
  - `parseAmount('12480.00') === 124800000n`;
  - `parseAmount('0.0001') === 1n`;
  - `formatAmount(124800000n) === '12480.00'`;
  - `formatAmount(123450n) === '12.345'`;
  - `formatAmount(0n) === '0.00'`;
  - `formatMoneyText(840000000n,'USD') === '84,000.00 USD'`;
  - `formatMoneyText(8750000n,'USD') === '875.00 USD'`;
  - a 13-digit amount groups correctly.
- [ ] T015 [P] Create `apps/api/src/impact/analysis/classify.ts` (`classifyReached`), following the data-model §4b rules. Its `classify.spec.ts` covers:
  - terminal entities become NOT_COUNTED with reason TERMINAL;
  - CURRENT takes `primaryPath` from `livePath`;
  - POTENTIAL takes the canonical path;
  - DIRECT/INDIRECT come from distance;
  - `shortestPath` is null when it equals the primary path by hop keys;
  - flags: `stateUnknown`, `otherCause` (an impaired potential entity) and `inferredOnly` (only for counted entities).
- [ ] T016 [P] Create `apps/api/src/impact/analysis/customers.ts` (`mergeCustomers`, data-model §4b). Its `customers.spec.ts` covers:
  - an attributed-only customer has distance null, INDIRECT and no path;
  - a customer is CURRENT if any of its attributions is current;
  - a customer is inferredOnly only when all of its attributions are;
  - a customer equal to the start is dropped;
  - a downstream-reached customer is merged and keeps its distance;
  - attributions of NOT_COUNTED entities are ignored;
  - the attribution order is CURRENT first, then type, displayName, id.
- [ ] T017 [P] Create `apps/api/src/impact/analysis/exposure.ts` (`computeExposure`, data-model §4b, research R6). Its `exposure.spec.ts` covers:
  - each order is counted once;
  - the start is excluded, and `startOwnValue` is reported for Order, Payment and Invoice starts;
  - NOT_COUNTED orders are excluded;
  - value-unknown orders are counted in `valueUnknownCount`;
  - totals are per currency (USD and EUR kept separate);
  - the inferredOnly shares;
  - a disagreement: OMS 100.00 USD against ERP 120.00 USD gives `range` low 100.00 and high 120.00 and `disagreementOrderCount = 1`;
  - a source in another currency sets `currencyMismatch` and stays out of the range;
  - the per-customer exposure map.
- [ ] T018 [P] Create `apps/api/src/impact/analysis/categories.ts` (`buildCategories` and `notCountedSummary`, contracts/api.md `ImpactCategoryDto` field rules). Its `categories.spec.ts` covers:
  - the 6 headline categories are always present, in order, even when 0;
  - other types follow only when non-zero, sorted by type name;
  - `inferredOnly` and `stateUnknown` cover counted entities only;
  - `notCounted.byType` is sorted by type name.
- [ ] T019 Create `apps/api/src/impact/analysis/lists.ts` with:
  - `selectList(affected, exposure, selector)`;
  - `compareForList(selector)`, per research R7;
  - `paginate(items, cursor, limit, keyOf)`: base64url JSON `{ k: (string|number)[] }`, with bigint amounts as decimal strings. A malformed cursor throws `Errors.validation([{ path: 'cursor', message: 'Invalid cursor' }])`, reusing `common/pagination/cursor.ts` helpers where they fit.

  Its `lists.spec.ts` covers:
  - every selector kind and bucket gives the members defined in contracts/api.md § Field rules ("List `total`");
  - orders are sorted by value descending, with value-unknown last;
  - customers are sorted by highest single-currency exposure;
  - other entities are sorted CURRENT, POTENTIAL, NOT_COUNTED, then distance with null last, then name, then id;
  - pagination is stable across pages;
  - a cursor after the last item gives an empty page.
- [ ] T020 Create `apps/api/src/impact/analysis/summary.ts` (`buildSummary`), implementing contracts/api.md § Summary text lines 1 to 12, with the stated conditions and order. Its `summary.spec.ts` covers:
  - the exact text of fixtures **I1, I6, I8, I9, I10, I12 (line 1), I13 (last line) and I14**, from hand-built inputs;
  - singular and plural forms;
  - several currencies joined with " and ";
  - lines 6, 8, 9 and 12 in isolation;
  - line 10 is not emitted when `countedTotal = 0`;
  - "Nothing is currently affected." for an impaired start with only potential impact.

**Checkpoint (Phase 2)**: run the standard gate. All existing tests pass unchanged. The new unit tests pass, including the property test. Then commit.

---

## Phase 3: User Story 1 — "What is affected if Supplier X is unavailable?" (P1) 🎯 MVP

**Goal**: the §40 seed exists, and `GET /api/entities/:id/impact` returns the Story 1 numbers, exposure and summary for Fabrikam Components.

**Independent test**: seed both datasets, then call `GET /api/entities/<Fabrikam>/impact` as a manager. The response must equal fixture I1. 100 repeated calls must be identical, excluding `computedAt` (I5).

### Seed (research R11, seed-scenario-40.md)

- [ ] T021 [US1] Create `apps/api/src/ingestion/seed/scenario-40.ts`, exporting `buildScenario40Document()` that produces **exactly** the rows of seed-scenario-40.md, in its order: 47 entities, 97 relationships and 9 events. Use the conventions section for primary systems, relationship `sourceId`s and `observedAt`s. Model it on `scenario-39.ts` helpers, with typed fixture arrays and small builder functions.
- [ ] T022 [US1] Create `apps/api/src/ingestion/seed/scenario-40.spec.ts`, implementing seed-scenario-40.md § Required tests, item 1:
  - every row passes its shared row schema;
  - the counts are 47, 97 and 9;
  - every relationship satisfies `RELATIONSHIP_RULES`;
  - no entity key is shared with `buildScenario39Document()`;
  - a **test-only walk** over the document reproduces the "Expected impact" table:
    - per-category counts;
    - current and potential sets;
    - inferred-only sets, computed through all-SOURCE reachability;
    - not-counted entities;
    - the never-reached controls;
    - customer attribution;
    - the bigint sums 51,250.00, 32,750.00, 84,000.00 and 2,400.00;
    - the per-customer exposure;
    - the path counts SO-20401 = 3, SO-20402 = 5, SO-20404 = 6, SO-20408 = 3 and SO-20411 = 1.

  The walk is test code over the document only (FR-031). It must not import anything from `apps/api/src/graph`.
- [ ] T023 [US1] In `apps/api/src/ingestion/seed/seed.service.ts`, add `seedScenario40()`. Mirror `seedScenario39()`: `fileName: 'scenario-40.json'`, and the error message names "§40". In `apps/api/prisma/seed.ts`, call it after `seedScenario39()` and log `§40 scenario seeded` or `§40 scenario already present`.

  In `apps/api/test/seed.e2e-spec.ts`, add the seed-scenario-40.md § Required tests item 2 block:
  - 47 more entities and 97 more relationships;
  - a second run creates no new rows or audit entries;
  - provenance is non-null on every row;
  - seeding 40 then 39 gives the same counts as 39 then 40.

  Existing blocks stay unchanged.

### API: summary (data-model §4a/§4c, contracts/api.md)

- [ ] T024 [US1] In `apps/api/src/tracing/tracing.module.ts`, add `exports: [StateEvidenceReader]`.

  Create `apps/api/src/impact/order-value.reader.ts` (`OrderValueReader`, data-model §4a, both SQL statements as given). Empty input returns an empty map with no query. Invalid strings are dropped (current becomes `null`).
- [ ] T025 [US1] Create `apps/api/src/impact/impact.mapper.ts`, with pure mapping functions:
  - **`toCategoryDtos`, `toExposureDto`, `toNotCountedDto`**: format bigint amounts with `formatAmount`;
  - **`toAffectedEntityDto(affected, opts)`**:
    - `weakest` is computed per contracts/api.md § Field rules;
    - `value`: `disagreement` and `currencyMismatch` per research R6;
    - attribution previews: the first 5;
    - paths go through `toPathDto` and `toTracedEntityDto` from `apps/api/src/tracing/tracing.mapper.ts`.
- [ ] T026 [US1] Create `apps/api/src/impact/impact.service.ts` with the private `analyze()` and the public `summary()`, exactly as in data-model §4c. `computedAt` is read once. A missing start gives `Errors.notFound('Entity')`. Evidence is loaded for the start only. `summary` comes from `buildSummary`, and `countedTotal` counts every counted entity, customers included.
- [ ] T027 [US1] Create `apps/api/src/impact/impact.controller.ts`, with `@Controller('entities')` and `@Get(':id/impact')`: `ParseUUIDPipe` on `id`, then `ZodValidationPipe(ImpactQuerySchema)`, then `ImpactService.summary`.

  Create `apps/api/src/impact/impact.module.ts`, importing `GraphModule`, `TracingModule` and `PrismaModule`, providing `ImpactService` and `OrderValueReader`. Register `ImpactModule` in `apps/api/src/app.module.ts`.
- [ ] T028 [US1] Create `apps/api/test/impact-seed.e2e-spec.ts`. In `beforeAll`, run `resetDb`, `seedScenario39()`, `seedScenario40()`, and create a manager user. Resolve entity ids by display name. Add:
  - **Fixture I1**: assert the full categories table, exposure, not-counted summary, `countedTotal`, `startClass`, `startOwnValue`, limits and the **exact** 6 summary lines;
  - **Fixture I5** (summary part): 100 consecutive calls are deep-equal after deleting `computedAt`.

**Checkpoint (US1)**: run the standard gate, then `pnpm --filter api prisma db seed` twice; the second run creates nothing. Then commit.

---

## Phase 4: User Story 2 — Drill down from any number (P1)

**Goal**: every number opens its exact entity list with paths. The detail endpoint shows all paths and attributions.

**Independent test**: for Fabrikam, open every non-zero cell and exposure figure. Each list's `total` equals its number. Exposure lists add up to `sum`. Every item's path starts at Fabrikam and ends at the item.

- [ ] T029 [US2] In `apps/api/src/impact/impact.service.ts`, add `list()` (data-model §4c):
  1. Run `selectList`, `compareForList` and `paginate`.
  2. Call `trace.paths(pageIds)` for non-customer items.
  3. Make **one** `StateEvidenceReader.load` call over the start, every hop target of every primary, shortest and attribution-preview link path on the page (KDN 8).
  4. Set `sum` for exposure lists. A currency with no figure gives `total 0`, `items []` and `sum '0.00'`.
  5. Map with `toAffectedEntityDto`.
- [ ] T030 [US2] In `apps/api/src/impact/impact.service.ts`, add `item()` (data-model §4c):
  - a target not in `affected` gives `Errors.notFound('Affected entity')`;
  - `alternativePaths` per contracts/api.md § Field rules: found plus shortest, minus primary, top 20 by `comparePaths`;
  - customer attributions: up to 200, each with the attributed entity's `primaryPath` and its `link`;
  - one evidence load.
- [ ] T031 [US2] In `apps/api/src/impact/impact.controller.ts`, add:
  - `@Get(':id/impact/items')`, with `ZodValidationPipe(ImpactListQuerySchema)`;
  - `@Get(':id/impact/items/:targetId')`, with `ParseUUIDPipe` on both ids and `ImpactQuerySchema`.

  Declare the `items/:targetId` route after `items`.
- [ ] T032 [US2] Extend `apps/api/test/impact-seed.e2e-spec.ts` with:
  - **Fixtures I2, I3 and I4**, asserted literally: item order, classifications, distances, path counts, `shortestPath` null for SO-20401, the flags, `weakest`, attribution counts and link hop counts, the not-counted list, the SO-20404 detail with 5 alternatives, and **404** for every control entity and for the start;
  - **Fixture I5** (list part): each I2 list is identical across 100 calls.
- [ ] T033 [US2] Extend `apps/api/test/impact-seed.e2e-spec.ts` with a **list invariants** test (KDN 7). For Fabrikam, Payment PAY-88213 and Warehouse WH-EAST-02, loop over **every** non-zero category cell (each bucket), every exposure figure share (`total`, `current`, `potential`, `inferredOnly`), `valueUnknown` and `notCounted`. Fetch every page with `limit=7`, so pagination is exercised. Assert:
  - the concatenated length equals the summary number;
  - there are no duplicate ids;
  - every non-customer item's `primaryPath` starts with a hop whose `fromEntityId` or `toEntityId` is the start and ends at the item;
  - exposure lists' bigint sum of `value.current.amount` equals `sum` and the summary figure;
  - for each category, the union of Current and Potential, and of Direct and Indirect, equals Total, with each pair disjoint (spec Story 2, scenario 1).

**Checkpoint (US2)**: run the standard gate, then commit.

---

## Phase 5: User Story 3 — Impact for any entity on the §39 reference scenario (P2)

**Goal**: correct direct/indirect and current/potential classification for different starting entities, plus every edge case on built graphs.

**Independent test**: fixtures I6 to I14 pass against the seeded §39 scenario.

- [ ] T034 [US3] Extend `apps/api/test/impact-seed.e2e-spec.ts` with fixtures **I6** (Payment PAY-88213), **I7** (Budget code), **I8** (Order #18492) and **I9** (Warehouse WH-EAST-02). Assert the categories, exposure, `startOwnValue`, summary lines, the I6 shipment's DIRECT classification with its 2-hop primary path and 1-hop shortest path, the 16 orders' `pathCount = 2`, and I9's 22 `otherCause` flags. The flags are collected through the lists API.
- [ ] T035 [US3] Extend `apps/api/test/impact-seed.e2e-spec.ts` with fixtures **I10** (WH-WEST-01, not counted), **I11** (Northwind Steel), **I12** (Contoso Metals, all inferred), **I13** (Northwind Steel at depth 3, lower bounds) and **I14** (Invoice INV-55120, nothing affected).
- [ ] T036 [US3] Create `apps/api/test/impact.e2e-spec.ts`, importing small graphs through the import API per test (follow `tracing.e2e-spec.ts` conventions). Cover:
  - **UNKNOWN start**: everything is potential, and the summary says "has an unknown state";
  - **UNKNOWN in a chain**: it is counted as potential with `stateUnknown`, and it breaks the live chain;
  - **CANCELLED in a chain**: it is not counted, and nothing behind it is reached;
  - **a 2-node cycle**: the analysis terminates and lists its cycle-closing hops;
  - **depth 1 and depth 10**;
  - **two currencies (USD and EUR)**: separate figures, and the summary joins them with " and ";
  - **a value disagreement**: the same order imported from OMS at 100.00 and from ERP at 120.00 gives a range and summary line 9;
  - **a customer downstream through DEPENDS_ON**: it is merged with attribution;
  - **an analyzed Customer**: it is not counted as its own customer.

  Then the validation table in contracts/api.md § Validation and access: every row is asserted, including 404 on all 3 routes and 400 for a malformed `targetId`.

  Finally, assert that no route writes an audit row: compare the `audit_entries` count before and after.
- [ ] T037 [US3] In `apps/api/test/authz-matrix.e2e-spec.ts`, add 3 `AUTHENTICATED` probes: `GET /api/entities/:id/impact`, `GET /api/entities/:id/impact/items?list=valueUnknown` and `GET /api/entities/:id/impact/items/:targetId`. Use the same id-placeholder approach as the existing tracing probes.

**Checkpoint (US3)**: run the standard gate, then commit.

---

## Phase 6: User Story 4 — Impact on the Entity 360 page (P2)

**Goal**: the Impact section between Blockers and Dependencies, with a clickable table, exposure, in-place lists, row detail and URL state.

**Independent test**: spec Story 4, scenarios 1 to 6, via component tests and the quickstart §3 manual walk-through.

- [ ] T038 [P] [US4] Create `apps/web/src/pages/entities/impact/impact-params.ts` and `impact-params.test.ts` (research R13):
  - **Functions**: `parseImpactParams(sp) → { depth, list: ImpactListSelector | null }`, and `writeImpactParams(current, next)`.
  - **URL keys**: `idepth` and `ilist`.
  - **`ilist` forms**: `category.<Type>.<bucket>`, `exposure.<CUR>.<bucket>`, `valueUnknown`, `notCounted` and `notCounted.<Type>`.
  - **Behavior**:
    - invalid values fall back to the default (6) or null;
    - defaults are omitted from the URL;
    - unrelated params (`dep`, `depth`, `rel`, `types`) are kept;
    - provide a `toImpactListQueryString(depth, selector, cursor?, limit=50)` helper.

  The tests cover a round trip for every selector form, invalid input, and preserving the Dependencies params.
- [ ] T039 [P] [US4] Create the hooks `useImpact.ts`, `useImpactList.ts` and `useImpactItem.ts` in `apps/web/src/pages/entities/impact/`. Use the query keys in research R13 and parse every response through `apiFetch` with its shared schema. `useImpactList` uses `useInfiniteQuery` with `nextCursor`. `useImpactItem` is enabled only while a row is expanded.

  Create `impact-test-data.ts`, holding response fixtures shaped like I1, I2 (current orders) and I14, parsed through the shared schemas at module load.
- [ ] T040 [P] [US4] Create `ImpactTable.tsx` (+ `.test.tsx`):
  - **Table**: an HTML `<table>` with a caption. Columns in order: Category, Current, Potential, Total, Direct, Indirect, Only inferred, State unknown.
  - **Rows**: one per category, using `label`.
  - **Buttons**: every non-zero number is a `<button>` with an accessible name like `"6 customer orders, current"`, calling `onOpen(selector)`. Zero is plain text.

  The tests cover rendering I1, opening a cell, and plain zeros.
- [ ] T041 [P] [US4] Create `ExposureFigures.tsx` (+ `.test.tsx`):
  - **Per currency**: total, current and potential as buttons (`exposure.<CUR>.<bucket>`), using `formatMoney` from `apps/web/src/lib/format.ts`;
  - **Inferred-only share**: a button when non-zero;
  - **Range**: when present, "between X and Y";
  - **Left-out notes**: value-unknown (a button for `valueUnknown`) and not-counted (a button for `notCounted`).

  The tests cover I1 and a fixture with a range and value-unknown orders.
- [ ] T042 [P] [US4] Create `AffectedEntityRow.tsx` and `AffectedEntityDetail.tsx` (+ tests):
  - **Row**:
    - a link to the entity's Entity 360 page (`/entities/:id`) and its `StateBadge`;
    - a classification badge (text "Current", "Potential" or "Not counted (completed or cancelled)");
    - distance ("2 steps", or "via attribution" when null), and value for orders;
    - flag badges: "Only inferred links (INFERRED / LOW)" using `weakest`, "State unknown", "Impaired for another reason";
    - path count ("3 paths", "21+ paths" when `morePaths`);
    - the primary path through the existing `PathView`, the shortest path labeled "Shortest path" when present, and attribution previews for customers;
    - an expand button.
  - **Detail**: loaded through `useImpactItem`. It renders alternative paths and all attributions, each with its link path and primary path. It has its own loading and error state.
- [ ] T043 [US4] Create `ImpactList.tsx` (+ `.test.tsx`):
  - a heading from the selector, for example "Customer orders — current (6)";
  - rows, and "Load more" while `nextCursor` is set;
  - for exposure lists, a total row equal to `sum`;
  - a close button that clears `ilist`;
  - the **data-changed notice** (research R13) when `total` differs from the summary number for the same selector, with a Refresh button that invalidates `['entities', id, 'impact']`.

  The tests cover rendering I2, load more, and the data-changed notice.
- [ ] T044 [US4] Create `ImpactSection.tsx` (+ `.test.tsx`), as a `<section id="impact">` with heading "Impact":
  - the summary lines, the first one bold;
  - a depth `<select>` (1–10) bound to `idepth`;
  - `ImpactTable`, `ExposureFigures`, and `ImpactList` when `ilist` is set;
  - when `countedTotal === 0`, **only** a single line with the summary text, for example "Nothing is affected within 6 steps." (spec FR-028);
  - its own loading and error states, which never throw to the page;
  - entity names in the summary are not linked (they are plain sentences), but every list row links.

  The tests cover I1 rendering, the I14 single line, depth change updating the URL, opening a cell setting `ilist`, and the error state.
- [ ] T045 [US4] In `apps/web/src/pages/entities/EntityDetailPage.tsx`, render `<ImpactSection entityId={entity.id} />` between `<BlockersSection>` and `<DependenciesSection>` (KDN 12). In `EntityDetailPage.test.tsx`, assert that the Blockers, Impact and Dependencies headings appear in that order, and that a failing impact query still renders the other sections.

**Checkpoint (US4)**: run the standard gate. Then walk through quickstart.md §3 steps 1 to 8 by hand with `pnpm dev`. Then commit.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T046 Create `apps/api/test/perf-impact.e2e-spec.ts` (`RUN_PERF=1` only). Generate the research R12 dataset with `generate_series` and deterministic ids `md5('perf-impact-' || g)::uuid`:
  - **entities**: 50 blocks of 1,000;
  - **relationships**: all listed in R12, plus 50,000 RELATES_TO noise; assert at least 150,000 relationships;
  - **hub supplier**: block 0's supplier also supplies blocks 1–3's products;
  - **states**: about 30% of POs and orders impaired.

  Assert that the hub's summary has `countedTotal >= 2000`. Then measure p95 over 20 runs, after 1 warm-up, for:
  - `GET /impact` (< 2,000 ms);
  - `GET /impact/items?list=category&type=Order&bucket=total` first page (< 2,000 ms);
  - `GET /impact/items?list=exposure&currency=USD&bucket=total` first page (< 2,000 ms).

  Log the timings in the `perf-tracing` format.
- [ ] T047 Run `RUN_PERF=1 pnpm --filter api test:e2e -- perf-impact` and record the p95 values in `specs/006-impact-analysis/quickstart.md` §5. If a budget is missed, profile first and write the findings to `questions.md` before optimizing. Follow the research R12 escape hatch, and never add a cache.
- [ ] T048 Run the final gate: the standard gate, `pnpm build`, and `pnpm --filter api prisma migrate reset --force && pnpm --filter api prisma db seed` (both scenarios load). Check the Definition of Done in CLAUDE.md:
  - no TODOs, dead code or unused exports;
  - every new endpoint has a shared schema and an e2e test;
  - no audit rows from impact routes.

  Tick all boxes in this file and commit.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2**: Phase 2 blocks everything.
  - Inside Phase 2: T002 → T003 → T004 → T005; T006 → T007; T008 → T009 → T010; T011 → T012 → T013. T014 to T018 are `[P]` once T006 is done. T019 and T020 come after T014 to T018.
- **US1 (Phase 3)** depends on Phase 2.
  - T021 → T022 → T023 (seed);
  - T024 → T025 → T026 → T027 → T028 (API).

  The seed and API chains may run in parallel, but T028 needs both.
- **US2 (Phase 4)** depends on US1: it reuses `analyze()`, the mapper, the controller and the seed.
- **US3 (Phase 5)** depends on US1. Its e2e fixtures I6 to I14 also use the list API (T034 flags), so it should run after US2.
- **US4 (Phase 6)** depends on the US1 and US2 endpoints. It is independent of US3.
- **Polish (Phase 7)** depends on all stories.

### Parallel opportunities

- **Phase 2**: T005 alongside T006/T007. T014, T015, T016, T017 and T018 together, since they are separate files with pure code. The traversal chain (T008–T010) alongside the pure impact modules (T014–T020).
- **Phase 3**: the seed chain (T021–T023) alongside the API chain (T024–T027).
- **Phase 6**: T038, T039, T040, T041 and T042 together. Then T043 → T044 → T045.

### Parallel example (Phase 6)

```text
T038 impact-params.ts        T040 ImpactTable.tsx
T039 hooks + test data       T041 ExposureFigures.tsx
                             T042 AffectedEntityRow/Detail.tsx
→ then T043 ImpactList → T044 ImpactSection → T045 EntityDetailPage wiring
```

## Implementation Strategy

1. **MVP** (Phases 1 to 3): the vocabulary, the traversal, the pure modules, the §40 seed and the summary endpoint. This alone answers "What is affected if Fabrikam Components is unavailable?" with exact numbers through the API (fixture I1).
2. **Explainability** (Phase 4): every number becomes drillable, which Constitution III requires before release.
3. **Breadth** (Phase 5): proves the rules on §39 and on edge-case graphs.
4. **UI** (Phase 6): the Entity 360 section.
5. **Performance and final gate** (Phase 7).

Stop at any checkpoint for review. Each phase leaves the main branch green.
