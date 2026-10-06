# Research: Dependency Tracing & Entity 360

Every Technical Context item is resolved below. Each decision is final for the implementer: **do not substitute alternatives**. If a decision turns out to be unworkable (for example Postgres rejects a query shape), stop and write the problem in `questions.md`, with the exact error output.

The decisions in `specs/001-foundation-platform/research.md` and `specs/002-operational-graph-model/research.md` still apply unless this file overrides them.

---

## R1. Module layout

- **Decision**:
  - **`graph` module (existing)**: owns all traversal.
    - `GraphRepository` gains two methods, `traceDependencies` and `traceBlockers` (R3).
    - The pure path algorithms live in `apps/api/src/graph/traversal/` and are called **only** by `PrismaGraphRepository`.
  - **`tracing` module (new, `apps/api/src/tracing/`)**: the HTTP layer and presentation logic.
    - `TracingController` (2 routes).
    - `TracingService`: filters, pagination, blocker classification, explanation text, DTO mapping.
    - `StateEvidenceReader`: the current and per-source state observations for a set of entity ids.
    - Pure helpers: `explanation.ts` and `tracing.mapper.ts`.

  `GraphModule` already exports `GRAPH_REPOSITORY`. `TracingModule` imports `GraphModule` and `PrismaModule`.
- **Rationale**: CLAUDE.md lists `tracing` as a bounded context and requires traversal to go only through `GraphRepository`. Keeping the SQL and path algorithms in `graph`, and the wording and paging in `tracing`, means the "no traversal elsewhere" rule can be checked by grepping for `WITH RECURSIVE`.
- **Alternatives**:
  - everything in `graph`: rejected, because the module becomes a grab-bag and explanation text has nothing to do with storage;
  - traversal in `tracing`: rejected, because it violates the constitution's technical constraint.

## R2. Dependency direction and state classification are shared constants

- **Decision**: add `packages/shared/src/tracing.ts`, holding the vocabularies used by both the API and the web.
  - **`DEPENDENCY_DIRECTION`**: a `Record<TraceableRelationshipType, 'FROM_DEPENDS_ON_TO' | 'TO_DEPENDS_ON_FROM'>`, exactly spec FR-002:
    - **`FROM_DEPENDS_ON_TO`**: REQUIRES, DEPENDS_ON, FULFILLED_BY, SUPPLIED_BY, CONTAINS.
    - **`TO_DEPENDS_ON_FROM`**: BLOCKS, PLACED, HAS, GOVERNS, DEFINES, GENERATES.
  - **`TRACEABLE_RELATIONSHIP_TYPES`**: all 11 types except RELATES_TO, in `RelationshipTypeSchema` order.
  - **`BLOCKER_RELATIONSHIP_TYPES`**: `['REQUIRES', 'DEPENDS_ON', 'BLOCKS']`.
  - **`STATE_CLASSIFICATION`**: `Record<OperationalState, 'SATISFIED' | 'UNSATISFIED' | 'INDETERMINATE'>`, exactly spec FR-006:
    - **SATISFIED**: ACTIVE, COMPLETED, AT_RISK.
    - **INDETERMINATE**: UNKNOWN.
    - **UNSATISFIED**: everything else.
  - **`SATISFIED_STATES`**: derived from `STATE_CLASSIFICATION`.
  - **`TRACING_LIMITS`**: `{ defaultDepth: 6, minDepth: 1, maxDepth: 10, maxReachedEntities: 10_000, maxBlockingPaths: 100, maxEnumeratedPaths: 1_000, maxCycleClosingHops: 100 }`.
- **Rationale**: one table drives the SQL parameters, the pure algorithms, the explanation text and the web labels, so they cannot drift apart. `Record<…>` typing makes the compiler reject a missing type or state.

## R3. Traversal = one recursive CTE for reachability, plus pure in-memory path selection

This is the central decision. Read it fully before writing any traversal code.

- **Decision**: each trace runs in three steps, all inside `PrismaGraphRepository`.

  1. **Reachability (recursive CTE, one query).** Compute the set of entities reachable from the start entity within `maxDepth + 1` hops, with each entity's **minimum depth**, following only the allowed relationship types in the traversal direction. The recursion's rows are `(entity_id, depth)` combined with `UNION`, not `UNION ALL`. Postgres therefore discards any row equal to one already produced, and a cycle cannot multiply rows: there are at most `entities × (maxDepth + 2)` rows. The final select takes `min(depth)` per entity and joins `entities` for type, display name and current state. Blocker traces add one condition: a non-start entity is admitted only if its current state is **not** in `SATISFIED_STATES`. Traversal therefore never passes through a satisfied entity.

  2. **Subgraph edges (one plain query).** Load every relationship of the allowed types whose `from_entity_id` and `to_entity_id` are both in the reachable set. This includes every assertion row, because one `(from, type, to)` may be asserted by several sources (002 FR-013).

  3. **Path selection (pure TypeScript, no I/O).**
     - **Upstream/downstream**: `selectCanonicalPaths` (R5) picks one best path per reached entity.
     - **Blockers**: `enumerateBlockingPaths` (R6) lists every maximal simple blocking path.

     Both enforce the depth limit and the **path-level cycle guard**: an entity is never added to a path that already contains it.

- **The exact SQL of step 1** (upstream/downstream; the blocker variant adds the marked lines):

  ```sql
  WITH RECURSIVE walk(entity_id, depth) AS (
    SELECT ${startId}::uuid, 0
    UNION
    SELECT step.next_id, w.depth + 1
    FROM walk w
    CROSS JOIN LATERAL (
      SELECT r.to_entity_id AS next_id
      FROM relationships r
      WHERE r.from_entity_id = w.entity_id
        AND r.type = ANY(${followFromTypes}::"RelationshipType"[])
      UNION ALL
      SELECT r.from_entity_id AS next_id
      FROM relationships r
      WHERE r.to_entity_id = w.entity_id
        AND r.type = ANY(${followToTypes}::"RelationshipType"[])
    ) step
    -- blocker variant only:
    JOIN entities n ON n.id = step.next_id
    WHERE w.depth < ${maxDepth + 1}
    -- blocker variant only:
      AND n.current_state <> ALL(${satisfiedStates}::"OperationalState"[])
  )
  SELECT e.id::text AS id, e.type::text AS type, e.display_name AS display_name,
         e.current_state::text AS current_state, m.depth AS depth
  FROM (SELECT entity_id, min(depth)::int AS depth FROM walk GROUP BY entity_id) m
  JOIN entities e ON e.id = m.entity_id
  ```

  - **`followFromTypes`** are the types for which the walk moves `from → to` when the current entity is the `from` end.
  - **`followToTypes`** are the types for which the walk moves `to → from` when the current entity is the `to` end.

  They come from `DEPENDENCY_DIRECTION`, intersected with the requested types:

  | Trace | `followFromTypes` (current = from, next = to) | `followToTypes` (current = to, next = from) |
  |---|---|---|
  | UPSTREAM (dependent → depended-on) | types with `FROM_DEPENDS_ON_TO` | types with `TO_DEPENDS_ON_FROM` |
  | DOWNSTREAM (depended-on → dependent) | types with `TO_DEPENDS_ON_FROM` | types with `FROM_DEPENDS_ON_TO` |
  | BLOCKERS (always upstream) | REQUIRES, DEPENDS_ON (∩ filter) | BLOCKS (∩ filter) |

  Pass empty arrays as `[]`. `= ANY('{}')` is simply false.

- **The exact SQL of step 2**:

  ```sql
  SELECT r.id::text AS id, r.type::text AS type,
         r.from_entity_id::text AS from_entity_id, r.to_entity_id::text AS to_entity_id,
         r.origin::text AS origin, r.confidence::text AS confidence, r.basis AS basis,
         r.source_system AS source_system, r.source_id AS source_id,
         r.observed_at AS observed_at, r.import_id::text AS import_id
  FROM relationships r
  WHERE r.from_entity_id = ANY(${ids}::uuid[])
    AND r.to_entity_id = ANY(${ids}::uuid[])
    AND r.type = ANY(${allowedTypes}::"RelationshipType"[])
  ```

  `allowedTypes` is `followFromTypes ∪ followToTypes`. Do not add `ORDER BY`: all ordering happens in TypeScript (R7).

- **Why not enumerate paths in SQL**:
  - Carrying a path array in the CTE and using `NOT next = ANY(path)` as the cycle guard enumerates every simple path. That is exponential around hubs: one warehouse with 1,000 orders at depth 6 already produces millions of rows.
  - Choosing the *best* path per entity under FR-016 (weakest-hop confidence first) is not a shortest-path problem SQL can express cheaply.
  - The reachable-set CTE is bounded by `entities × depth`. The path work runs on an in-memory subgraph that is at most 10,000 entities (R8).
- **Cycle guard (constitution technical constraint)**: there are three layers, and each must stay:
  - the depth bound in the CTE `WHERE`;
  - `UNION` de-duplication of `(entity_id, depth)`;
  - the path-level rule that no entity repeats, enforced in R5 and R6 and asserted by unit tests.
- **Risk to verify first**: the `CROSS JOIN LATERAL ( … UNION ALL … )` inside the recursive term. Postgres allows this, because the recursive name `walk` appears exactly once, in the outer `FROM`. The **first** repository task is an e2e test that runs this query on a 3-node cycle. If Postgres rejects the shape, use this exact fallback and record it in `questions.md`:

  ```sql
  SELECT CASE WHEN r.from_entity_id = w.entity_id THEN r.to_entity_id ELSE r.from_entity_id END, w.depth + 1
  FROM walk w
  JOIN relationships r
    ON (r.from_entity_id = w.entity_id AND r.type = ANY(${followFromTypes}::"RelationshipType"[]))
    OR (r.to_entity_id = w.entity_id AND r.type = ANY(${followToTypes}::"RelationshipType"[]))
  ```

- **Indexes**: the existing `relationships(from_entity_id, type)` and `relationships(to_entity_id, type)` indexes serve both sides of the lateral step. **No migration** is needed in this feature.
- **Casting**: cast arrays to the Postgres enum types (`::"RelationshipType"[]`, `::"OperationalState"[]`). Comparing `r.type::text` would stop the planner from using the `(…, type)` index columns.

## R4. Hops group assertions; effective origin and confidence

- **Decision**: the pure function `buildTraversalEdges(rows, direction)` in `traversal/traversal-edges.ts` turns step-2 rows into `TraversalEdge`s.
  - **Grouping**: rows are grouped by `(type, fromEntityId, toEntityId)`. Each group is **one hop candidate**.
  - **`traversal`**: `'FORWARD'` when the walk moves `from → to`, otherwise `'REVERSE'`. `sourceId` and `targetId` are the walk's start and end of the hop:
    - FORWARD: `sourceId = from`, `targetId = to`;
    - REVERSE: `sourceId = to`, `targetId = from`.
  - **`effectiveOrigin`**: `SOURCE` if any assertion is SOURCE; else `MANUAL` if any is MANUAL; else `INFERRED` (spec FR-012).
  - **`effectiveConfidence`**: the highest confidence among assertions whose origin equals `effectiveOrigin`. Order: HIGH > MEDIUM > LOW.
  - **`assertions`**: sorted by:
    1. origin rank (SOURCE, MANUAL, INFERRED);
    2. confidence rank (HIGH, MEDIUM, LOW);
    3. `observedAt` descending;
    4. `relationshipId` ascending.
  - **`key`**: the smallest `relationshipId` in the group, by code-unit comparison. It is used for tie-breaks (FR-016 rule 4) and React keys.
  - **`nonSource`**: `effectiveOrigin !== 'SOURCE'`.
- **Rationale**:
  - One SOURCE assertion makes the link a sourced fact. If a weaker assertion of the same link were treated as the effective one, it would understate the evidence.
  - Taking confidence only from the winning origin stops a HIGH *inferred* assertion from upgrading a LOW *manual* one. That would be presenting inference as fact.

## R5. Canonical path per reached entity (upstream/downstream)

- **Decision**: `selectCanonicalPaths(startId, edges, maxDepth): Map<entityId, InternalPath>` in `traversal/canonical-paths.ts`. It is pure and deterministic, and implements FR-016 exactly as follows.

  ```text
  for threshold in [HIGH, MEDIUM, LOW]:                  // rule 1: higher weakest-hop confidence first
    usable = edges with effectiveConfidence rank >= threshold rank
    best[0] = { startId: label(nonSource = 0, entityIds = [startId], hopKeys = []) }
    for d in 1..maxDepth:                                  // layered DP over exact hop count
      best[d] = {}
      for each (u, labelU) in best[d-1]:
        for each edge e in usable with e.sourceId == u:
          if e.targetId == startId: continue               // never re-enter the start
          candidate = labelU + e    // nonSource += e.nonSource ? 1 : 0; push targetId; push e.key
          if best[d][e.targetId] is unset or compareLabels(candidate, best[d][e.targetId]) < 0:
            best[d][e.targetId] = candidate
    for each entity v not yet assigned a canonical path:
      choose, over all d where best[d][v] exists, the label minimising (nonSource, d, entityIds, hopKeys)
      // rules 2, 3, 4
      assign it, with weakestConfidence = threshold
  ```

  - **`compareLabels`** (same length d): `nonSource` ascending, then `entityIds` compared element by element, then `hopKeys` compared element by element. Compare strings by code unit (`a < b`), **never** with `localeCompare`.
  - **Why the result is always a simple path**: a walk that repeats an entity has a shortcut with fewer hops and no more non-SOURCE hops. The shortcut is strictly better under rules 2 and 3, so it is never the minimum over all `d`. Do not rely on this silently: after selection, **assert** that each chosen path has no repeated entity, and throw `Error('traversal invariant: repeated entity')` if it does. The randomized test in R10 proves it never throws.
  - **Distance**: the reached entity's `distance` is its `min(depth)` from the CTE (FR-014). It can be smaller than the canonical path's length. For example, PAY-88213 upstream of SHP-77120 has distance 1, but its canonical path has 2 hops, because the 1-hop path is MANUAL / MEDIUM.
  - **`continuesBeyondDepth`**: true when `path.length === maxDepth` and the last entity has at least one usable edge (any confidence) to an entity that is not on the path.
  - **Cycle-closing hops** (FR-010): an edge `u → v` is cycle-closing when both hold:
    - `u` is the start entity or has a canonical path of length `< maxDepth`;
    - `v` is the start entity or is on `u`'s canonical path.

    Collect these as unique groups, sort them by `(sourceId, type, targetId)` and return the first `maxCycleClosingHops`, along with the total count.
- **Complexity**: O(3 × maxDepth × |edges|). That is about 2 million edge relaxations at the 10,000-entity cap with 3 edges per entity and depth 10.
- **Alternatives**:
  - enumerate all simple paths and sort: exponential;
  - Dijkstra on a composite weight: the bottleneck rule (rule 1) is not additive;
  - shortest path only: violates FR-016 and Story 2 scenario 3.

## R6. Blocking paths (blockers)

- **Decision**: `enumerateBlockingPaths(startId, edges, maxDepth, maxEnumerated)` in `traversal/blocking-paths.ts`. It is a pure, deterministic depth-first search over the blocker subgraph. Every non-start entity in that subgraph is unsatisfied or indeterminate, because the CTE only admits those.

  ```text
  adjacency[u] = edges with sourceId == u, sorted by (targetId, key) ascending   // code-unit order
  dfs(path):                                   // path = [startId, ...]; hops = edges taken
    u = last(path)
    candidates = adjacency[u] where targetId not in path
    skipped    = adjacency[u] where targetId in path      // record each in cycleClosing (unique by key)
    if candidates is empty or hops.length == maxDepth:
      if path has >= 1 hop:
        emit(path,
             continuesBeyondDepth = hops.length == maxDepth and candidates.length > 0,
             endsInCycle          = candidates.length == 0 and skipped.length > 0)
      return
    for e in candidates: dfs(path + e)       // stop the whole search once maxEnumerated paths are emitted
  ```

  - **Emitted paths are maximal**: they end only where the chain ends, where a cycle closes, or at the depth limit.
  - **`enumerationCapped`**: true when the search stopped because it reached `maxEnumerated` (1,000).
  - The repository returns the emitted paths sorted by `comparePaths` (R7).
  - The service:
    - applies the entity-type filter (keep a path if any **non-start** entity on it has a selected type);
    - keeps the first `maxBlockingPaths` (100);
    - sets `truncation.pathLimit = enumerationCapped || keptCount > 100`.
- **Blocker lists** (FR-008, FR-015), computed in the service from the kept (filtered, top-100) paths:
  - **Direct blockers**: the distinct first-hop entities.
  - **Deepest blockers**: the distinct last entities.
  - **Order**: each blocker is placed by the **first** (highest-ranked) path in which it appears in that role. Its `pathLength` is that path's length to the blocker: the hop index + 1 for a direct blocker, or the path's length for a deepest blocker.
  - **Flags**, for deepest blockers, taken from that same first path:
    - `continuesBeyondDepth`;
    - `inCycle` (the path's `endsInCycle`);
    - `possible`, which is true when the entity's state is UNKNOWN.

  An entity can be both a direct and a deepest blocker, for example on a 1-hop path.
- **Why DFS is cheap here**: every leaf of the DFS tree is an emitted path, so the work is bounded by `maxEnumerated × maxDepth × degree`.
- **Ranking caveat**: when more than 1,000 paths exist, the top 100 are the best of the first 1,000 found in deterministic DFS order, not of all paths. The result is still deterministic and is flagged `pathLimit: true`. This is accepted; record it in the code comment above `maxEnumeratedPaths`.

## R7. Determinism (FR-016, FR-017)

- **Decision**:
  - **`comparePaths(a, b)`** in `traversal/path-order.ts` applies:
    1. `weakestConfidence` rank (HIGH first);
    2. `nonSourceHops` ascending;
    3. `hops.length` ascending;
    4. the sequence of entity ids along the path, compared element by element;
    5. the sequence of hop `key`s, compared element by element.
  - **Reached entities** are ordered by `distance` ascending, then `type`, then `displayName`, then `id`, all compared by code unit.
  - **All sorting happens in TypeScript.** SQL `ORDER BY` uses the database collation, which can differ from JS ordering, so the traversal queries have no `ORDER BY` at all.
  - **`computedAt`** is the only field that may differ between identical calls. It is `new Date().toISOString()`, taken once per request in the service.
  - **Query echo**: `relationshipTypes` is echoed back de-duplicated and in `RelationshipTypeSchema.options` order, not in request order. `entityTypes` is treated the same way, using `EntityTypeSchema.options` order.
- **Rationale**: SC-005 asks for 100 identical runs. The ids are random UUIDs, so the tie-breaks depend on them, but always the same way for the same data.

## R8. Limits and truncation

- **Decision**:
  - **Exploration limit (upstream/downstream)**: if more than 10,000 non-start entities have `depth ≤ maxDepth`:
    - keep the first 10,000, sorted by `(depth, type, displayName, id)`;
    - run step 2 and step 3 on the start entity plus those only;
    - set `truncation.explorationLimit = true`.

    The same limit and flag apply to blocker traces.
  - **Depth limit**:
    - upstream/downstream: `truncation.depthLimit` is true when any entity has `depth === maxDepth + 1`, meaning more entities exist beyond the depth;
    - blockers: it is true when any kept path has `continuesBeyondDepth`.

    Entities with `depth === maxDepth + 1` are **never** returned as results.
  - **Path limit**: see R6.
  - **Pagination** (upstream/downstream only): `PageQuerySchema` semantics, with `limit` defaulting to 50 and capped at 200.
    - The cursor is `encodeCursor({ distance, type, displayName, id })` of the last item.
    - The next page starts at the first item that sorts strictly after the cursor under the R7 order.
    - Each page recomputes the trace, because results are not stored (spec assumption).
  - **Blockers are not paginated.** At most 100 paths are returned.
- **Accepted risk**: the reachability CTE itself has no row cap. In a densely connected 50,000-entity graph at depth 10, it can produce up to about 550,000 `(entity, depth)` rows, which is slow but bounded. The performance test (R11) uses a realistic topology at the default depth. Do **not** add `LIMIT` inside the CTE: the rows cut off would depend on the query plan, which breaks determinism.

## R9. Explanation text is pure, template-based TypeScript

- **Decision**: `apps/api/src/tracing/explanation.ts` exports two functions:
  - `explainBlockingPath(start, path): string[]`, which returns one sentence per hop;
  - `summarizeBlockers(start, deepestBlockers, maxDepth): string`.

  The exact templates are in `contracts/api.md` § Explanation text. There is no AI component and no randomness. The output depends only on the DTO data passed in.
- **Rationale**: FR-018 and FR-019, and constitution Principle III. Templates are trivial to unit-test against exact expected strings.
- **Alternatives**: building the text in the web app was rejected, because the API must return the explanation (FR-018) and a later investigations feature will reuse it server-side.

## R10. Testing strategy

- **Pure unit tests (Jest, `apps/api/src/graph/traversal/*.spec.ts`)**:
  - **`traversal-edges.spec.ts`**:
    - grouping;
    - FORWARD and REVERSE for every type in `DEPENDENCY_DIRECTION` in both trace directions;
    - effective origin and confidence, covering all of these combinations: SOURCE+MANUAL, MANUAL+INFERRED with HIGH INFERRED and LOW MANUAL, INFERRED only;
    - assertion order;
    - key = smallest id.
  - **`canonical-paths.spec.ts`**:
    - depth 1, 6 and 10;
    - the weakest-hop rule beating the shorter path (the SHP-77120 → PAY case);
    - each tie-break rule in isolation;
    - a 2-node cycle, a 3-node cycle, and a self-cycle back to the start;
    - `continuesBeyondDepth`;
    - cycle-closing hops.
  - **`blocking-paths.spec.ts`**:
    - maximal paths only;
    - `endsInCycle`;
    - `continuesBeyondDepth` at depth limit;
    - `maxEnumerated` capping;
    - deterministic DFS order.
  - **`path-order.spec.ts`**: each comparator rule.
  - **`traversal-property.spec.ts` (SC-007)**: an inline seeded PRNG (mulberry32, about 6 lines, **no dependency**) generates 1,000 random graphs, each with 2 to 9 entities and 0 to 20 edges, including cycles and parallel edges, with random origins and confidences. For each graph, and for depths 1 to 4, it checks:
    - **termination and validity**: both algorithms terminate, every path length is ≤ depth, and no entity repeats in any path;
    - **canonical paths match brute force**: the brute force enumerates every simple path up to the depth with a plain DFS, sorts them with `comparePaths`, and takes the first path per target. `selectCanonicalPaths` must return exactly that path;
    - **blocking paths match brute force**: brute force over the same graph treated as a blocker subgraph gives the same set of maximal paths.
- **Pure unit tests (Jest, `apps/api/src/tracing/*.spec.ts`)**: `explanation.spec.ts` checks exact strings, including:
  - the four sentences for SHP-77120 path A and the three for path B;
  - the summary strings;
  - an indeterminate entity, a satisfied start, an AT_RISK start, an INFERRED hop and a MANUAL hop;
  - a null basis.
- **E2E (Jest + supertest, `apps/api/test/`)**:
  - **`tracing-seed.e2e-spec.ts`**: every acceptance scenario of spec Stories 1 and 2 against `SeedService.seedScenario39()`, plus the 100-run determinism checks (SC-005) and the provenance completeness check (SC-006).
  - **`tracing.e2e-spec.ts`**: small imported graphs for:
    - cycles;
    - depth 1, 6 and 10;
    - every validation error;
    - 404 and 401;
    - UNKNOWN state;
    - multiple assertions;
    - the entity-type filter;
    - pagination.
  - **`graph-repository.e2e-spec.ts`**: extended with the CTE smoke test on a 3-node cycle (the R3 risk check).
  - **`authz-matrix.e2e-spec.ts`**: two new AUTHENTICATED probes.
- **Web (Vitest + Testing Library)**:
  - `BlockersSection.test.tsx`;
  - `BlockerCallout.test.tsx`;
  - `DependenciesSection.test.tsx`;
  - `PathView.test.tsx`;
  - `HopEvidence.test.tsx`;
  - an updated `EntityDetailPage.test.tsx` covering section order and the callout.
- **Shared (Vitest)**: `tracing.spec.ts`, covering:
  - the query schemas (comma lists, de-duplication, RELATES_TO rejection, blocker-type restriction, depth bounds);
  - `DEPENDENCY_DIRECTION` covering exactly the 11 traceable types;
  - `STATE_CLASSIFICATION`.

## R11. Performance verification

- **Decision**: add `apps/api/test/perf-tracing.e2e-spec.ts`. Like `perf-graph`, it runs only with `RUN_PERF=1`. It builds the graph with raw SQL `generate_series`, so its timings are deterministic and fast to set up.

  **Entities: 50,000.** For `g = 0..49999`, set `chain = g / 10` (integer division) and `pos = g % 10`.
  - **`type` by `pos`**: `[Shipment, Order, Payment, Approval, BudgetRequirement, Contract, Customer, Warehouse, Product, Supplier]`.
  - **`display_name`**: `'Perf ' || type || ' ' || g`.
  - **`current_state`**:
    - chain 0: `pos` 0 to 6 are `DELAYED, BLOCKED, PENDING, BLOCKED, WAITING, PENDING, MISSING`; `pos` 7 to 9 are `ACTIVE`;
    - other chains: `PENDING` when `pos <= 2 OR chain % 7 = 0`, else `ACTIVE`.

  Insert entities with deterministic ids: `md5('perf-' || g)::uuid`. Tests can then address `g` directly.

  **Relationships: 150,000.** All are SOURCE, with one `imports` row as in `perf-graph`.
  - **R1, 45,000 rows**: within each chain, `pos p DEPENDS_ON pos p+1`, for p = 0 to 8. HIGH.
  - **R2, 50,000 rows**: every entity REQUIRES the entity at the same `pos` in chain `(chain + 1) % 5000`. MEDIUM.
  - **R3, 50,000 rows**: entity `g` RELATES_TO entity `(g + 7919) % 50000`, which is noise that traversal must ignore. Skip the 0 self-pairs. There are none, because 7919 is not a multiple of 50,000.
  - **R4, 5,000 rows**: every Shipment (pos 0) FULFILLED_BY Warehouse `g = (chain % 50) * 10 + 7`, giving 50 hub warehouses with 100 shipments each. HIGH.

  **Measurements**: each is taken 20 times after 1 warm-up, and asserts the p95, through HTTP as Admin.
  - **SC-003**: `GET /entities/{g=0}/blockers` (default depth) has p95 < 1,000 ms. Also assert:
    - a path of exactly 6 hops exists whose last entity is `g = 6` (state MISSING);
    - the response contains no RELATES_TO hop.
  - **SC-004**: p95 < 2,000 ms for each of:
    - `GET /entities/{g=6}/dependencies?direction=downstream`;
    - `GET /entities/{g=7}/dependencies?direction=downstream` (a hub warehouse);
    - `GET /entities/{g=0}/dependencies?direction=upstream`.

  Log the timings with `console.log`, as `perf-graph` does. Record the measured numbers in `quickstart.md` § Performance after the first run.
- **Rationale**: the chain gives exactly the "6 hops deep" blocker the success criterion names. R2 makes blocker traversal fan out across chains, R3 proves that RELATES_TO is ignored, and R4 adds hubs.

## R12. Web: Entity 360 assembly

- **Decision**: extend the existing `EntityDetailPage` at the same route, `/entities/:id` (FR-026). There is no new route.
  - **Header**: under the title and state badge, add a **`BlockerCallout`**. It uses the same query as `BlockersSection` (query key `['entities', id, 'blockers']`), so the request is made only once. When at least one path exists, it shows the summary sentence and the first-ranked path's sentences, with a link `See all blocking paths` that jumps to `#blockers`. It satisfies FR-028 (visible without scrolling at 1366×768) without reordering the FR-027 sections. While loading, and when there are no blockers, it renders nothing.
  - **Sections, in order (FR-027)**:
    1. `IdentitySection`
    2. `CurrentStateSection`
    3. `BlockersSection` (`id="blockers"`)
    4. `DependenciesSection`
    5. `RelationshipsSection`
    6. `TimelineSection`
    7. `SourceRecordsSection`
  - **`BlockersSection`**:
    - With no blockers, it shows a single line: the summary sentence, which already says "No blockers found within N steps."
    - Otherwise it shows the summary, then one card per path, highest ranked first. Each card has:
      - a heading `Path 1`, `Path 2`, …;
      - badges for any non-SOURCE hop (`OriginBadge`), `Possible blocker (state unknown)`, `Ends in a cycle` and `Continues beyond depth N`;
      - the sentences as a list;
      - a `PathView`.
    - Below the cards: the direct-blocker and deepest-blocker lists, as links, and the truncation notices.
  - **`DependenciesSection`**:
    - **Tabs**: `Upstream — what this depends on` and `Downstream — what depends on this`.
    - **Controls**:
      - a depth `<select>` with options 1 to 10, default 6;
      - a relationship-type checkbox group with the 11 traceable types (all checked means no filter);
      - an entity-type checkbox group with the 12 types (none checked means no filter).
    - **List**: one row per reached entity, showing:
      - a link to the entity;
      - its type and `StateBadge`;
      - `N steps` (its distance), plus `· path shown: M steps` when the canonical path length differs;
      - a `<details>` with `PathView`.
    - **Footer**: `Load more` (`useInfiniteQuery`), `Showing X of Y`, and the truncation and cycle notices.
    - **URL state** (FR-030), using `useSearchParams` from `react-router`:
      - `dep=upstream|downstream`, default `upstream`;
      - `depth`, written only when it is not 6;
      - `rel` and `types`, as comma lists, written only when non-empty.

      Changing a control replaces the search params (`{ replace: true }`). The section reads its state only from the URL. Opening a copied link therefore reproduces the view.
  - **`PathView`**: an ordered list of hops. Each hop shows:
    - the relationship as recorded: `‹from name› TYPE ‹to name›`, using names from the path. For a REVERSE hop, the recorded `from` is the hop's target, so the text still reads `Payment PAY-88213 BLOCKS Shipment SHP-77120 (consolidated)`;
    - an arrow `↑` (upstream) or `↓` (downstream);
    - `OriginBadge` with the effective origin and confidence;
    - the reached entity's `StateBadge`;
    - a `<details>` labelled `Evidence` containing `HopEvidence`.
  - **`HopEvidence`**: every assertion (origin badge, basis, `sourceSystem · sourceId · observedAt`), then `State: X — reported by ‹sourceSystem› at ‹time›` (or `No state observation`), then `Sources disagree:` with one line per source when `latestBySource` is non-empty.
  - **No graph diagram** (FR-031). **No** risk, exception, impact or investigation sections (FR-032).
- **Rationale**: the page reuses every 002 section unchanged. The callout gets the most relevant answer above the fold (§45 "relevant context first") without breaking the section order the spec requires.

## R13. Dependencies added by this feature

- **None.** The api, web and shared packages need no new runtime or dev dependencies. The PRNG for the property test is inline. The tabs and checkboxes are plain elements styled with Tailwind.
