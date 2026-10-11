# Research: Graph Explorer

All decisions below are binding for the implementer. Where a decision says "exactly", do not substitute an alternative.

## R1. Graph rendering library

- **Decision**: `@xyflow/react` **^12.12.0** (React Flow 12), added to `apps/web` `dependencies`. This is the **only** new runtime dependency of this feature.
- **Rationale**: `CLAUDE.md` already names React Flow for the graph explorer. v12 supports React 19, custom node and edge types with typed `data`, fixed node `width`/`height` (so layout and `fitView` do not wait for DOM measurement), `onlyRenderVisibleElements`, and `ariaLabel` on nodes and edges.
- **Alternatives rejected**: Cytoscape.js (canvas; custom React content per node is awkward, harder to test), Sigma.js (WebGL, built for far larger graphs than our 200-node cap), raw SVG/D3 (we would rebuild pan/zoom/selection by hand).

## R2. Layout: no layout library

- **Decision**: a hand-written, pure, deterministic **signed-column layout** in `apps/web/src/pages/explorer/layout.ts` (algorithm in contracts/ui.md §4). Do **not** add `dagre`, `@dagrejs/dagre`, `elkjs`, `d3-force`, `d3-hierarchy` or any other layout package.
- **Rationale**:
  - Spec FR-011 fixes the layout semantics: focus in the center column, depended-on (upstream) entities to the left, dependents (downstream) to the right, ordered by steps. Dagre ranks by longest path along edge direction and would not keep the focus in the center or put siblings (two orders on the same shipment) beside each other. ELK can be configured to approximate it but is a 1.4 MB worker dependency with asynchronous layout, which complicates the determinism requirement (SC-008) and tests.
  - The server already gives every node a `parentId` and `viaEdgeKey` (its canonical-path predecessor). With that, a column per signed dependency step and a tree-order row sort is ~120 lines, synchronous, and trivially unit-testable.
  - At 200 nodes there is no performance reason for a library.
- **Alternatives rejected**: dagre (wrong rank semantics), elkjs (async, heavy), force-directed (non-deterministic arrangement, violates SC-008).

## R3. Where the visible set is computed: server-side composition

- **Decision**: one new endpoint, `GET /api/entities/:id/neighborhood`, returns the **complete view**: visible nodes (≤ 200, priority order), the relationships among them, the omitted count, and, when requested, the embedded feature-003 blocker result. Expansions are sent as `expand=<id>,<id>` and the server recomputes the whole view. Collapse = the client drops the id from `expand` and refetches.
- **Rationale**:
  - The relationships among visible nodes depend on the whole visible set. Composing on the client from separate responses would miss edges between an expansion node and other visible nodes.
  - Cap, priority, connector and "visible for another reason" rules (FR-007, FR-012, FR-016, FR-020) become one pure, deterministic, unit-testable server function (`composeNeighborhood`), plus e2e fixtures. The client only lays out and styles.
  - Graph and list render from the same response, so SC-005 (graph = list) holds by construction.
- **Alternatives rejected**: client-side merge of `/neighbors` pages (missing edges, cap logic duplicated in the browser); a separate `/expand` endpoint (same missing-edge problem).

## R4. Blocker highlighting reuses feature 003's service

- **Decision**: when `blockers=true`, `NeighborhoodService` calls the existing `TracingService.blockers(focusId, { depth: TRACING_LIMITS.defaultDepth, relationshipTypes: [], entityTypes: [] })` and embeds the returned `BlockersResponse` unchanged in `NeighborhoodResponse.blockers`. Path entities feed the composition.
- **Rationale**: FR-019/FR-022 require exactly feature 003's paths, ranking, summary and explanation text. Embedding the same DTO guarantees the highlighted paths and the visible nodes come from one computation. The web app renders the explanation with the existing `ExplanationSentence` component.
- **Alternative rejected**: the browser calling `/blockers` separately and merging: two computations that could disagree if data changes between them, and the merge would again miss edges.

## R5. Neighborhood traversal inside `GraphRepository`

- **Decision**: add `traceNeighborhood(query)` and `findRelationshipsAmong(ids, types)` to `GraphRepository`. `traceNeighborhood` reuses the private `reachableEntities` CTE and `loadEdgeRows`, both widened from `TraceableRelationshipType` to `RelationshipType`:
  - **upstream / downstream**: identical walk to `traceDependencies` (`walkTypes` + `buildTraversalEdges`), so reached sets and distances match feature 003 exactly (spec FR-005).
  - **all**: the CTE gets `followFromTypes = followToTypes = types`, which walks every relationship both ways. Canonical paths use `buildUndirectedTraversalEdges`, which emits each relationship group twice (FORWARD from→to, REVERSE to→from) with the same `key`.
- **Cycle guard / depth bound**: unchanged CTE (`UNION` on `(entity_id, depth)` plus `w.depth < bound`), so it terminates on any data. A new `probeBeyondDepth: false` option makes the bound `maxDepth` instead of `maxDepth + 1` (the neighborhood never reports "continues beyond depth").
- **Canonical paths with undirected edges**: `selectCanonicalPaths` is reused unchanged in behavior. A path that revisits an entity always contains a strictly shorter prefix-path to the same entity with no more non-SOURCE hops and no weaker confidence, so it never wins the ranking. The existing "repeated entity" invariant throw stays and is exercised by a property test over generated graphs (contracts/api.md §6).
- **`findRelationshipsAmong`** is a set lookup (one hop, no recursion), but it reads relationships, so it lives in the repository too (constitution: traversal and relationship SQL only in `GraphRepository`).

## R6. Priority order and the 200 cap (spec FR-012)

- **Decision**: the server builds one ordered, de-duplicated candidate list and keeps its first 200 entries (global prefix):
  1. the focus;
  2. blocker paths in rank order, each path's hop entities in hop order;
  3. base neighborhood candidates in **base priority order** `(distance asc, weakestConfidence desc, nonSourceHops asc, type, displayName, id)`, each matching entity preceded by those of its canonical-path entities that are not yet listed (connectors, only when an entity-type filter is active);
  4. expansions in request order; each expansion's matching depth-1 neighbors in base priority order.
- **Why a global prefix is enough**: every node's parent (canonical-path predecessor, blocker-path predecessor, or expanded node) is always earlier in the list, so any prefix is connected to the focus. No node is ever shown without its connection.
- `omitted = candidates − visible`. `omittedIsLowerBound` is true when the base trace or any applied expansion hit the 10,000 exploration limit.

## R7. Entity-type filter and connectors (spec FR-007)

- **Decision**: matching = type in `entityTypes` (or no filter). Non-matching entities on the canonical path of a **listed** matching entity become `CONNECTOR` candidates. Non-matching entities on no such path are not candidates at all (not counted in `omitted`). Expansions add matching depth-1 neighbors only (they are adjacent to the expanded node, so no connectors). Blocker-path entities ignore the entity-type filter (spec FR-019: "no extra filters").

## R8. Edges returned

- **Decision**: `edges` = every relationship group among visible nodes whose type is in the resolved `relationshipTypes`, **plus** every blocker-path hop group (by key) when blockers are on, even if its type is filtered out. One edge per `(type, from, to)` group, with effective origin/confidence and all assertions (same grouping and key rule as feature 003 research R4, so blocker hop keys and neighborhood edge keys are identical).
- Each node's `viaEdgeKey` edge is always in `edges` (both ends visible, type followed or a blocker hop).

## R9. Distance for nodes outside the base neighborhood

- **Decision**: `distance` is the base CTE distance when the node is a base candidate (or 0 for the focus), otherwise `null`. The list groups `null`-distance nodes under "Added by blocking path" / "Added by expansion". Layout uses parent chains, not `distance`.

## R10. URL state and validation (spec FR-003, edge case "invalid settings")

- **Decision**: page URL `/graph/:id?direction=&depth=&relationshipTypes=&entityTypes=&blockers=` with exactly the API's parameter names and value formats; defaults are omitted from the URL. The page validates the URL with the **same** shared `ExplorerUrlParamsSchema` (the API query schema without `expand`). On failure it shows the validation issues and a "Reset settings" link; it never silently fixes them. This differs on purpose from feature 003's `parseTracingParams`, which falls back to defaults.
- Expansions, selection, selected blocker path and focus mode are React state only (spec Assumptions).

## R11. Data fetching on the client

- **Decision**: TanStack Query.
  - `useNeighborhood(id, params, expand)`: key `['entities', id, 'neighborhood', params, expand]`, `placeholderData: keepPreviousData` so expand/collapse does not blank the canvas.
  - Side panel: reuse key `['entities', id]` (detail), `useBlockers(id)` (existing hook, key `['entities', id, 'blockers']`), `['entities', id, 'source-records']` (same fetch as `SourceRecordsSection`), and new `useBlocks(id)` = `GET /entities/:id/dependencies?direction=downstream&depth=1&relationshipTypes=REQUIRES,DEPENDS_ON,BLOCKS&limit=200`.

## R12. Testing React Flow in jsdom

- **Decision**: all logic lives in pure modules (`explorer-params`, `layout`, `to-flow`, `emphasis`, `edge-style`, `describe-view`) with Vitest unit tests. Component tests render `ExplorerList`, the panels, `EntityNode` and `RelationshipEdge` directly (wrapped in `ReactFlowProvider`, nodes/edges rendered through a minimal `<ReactFlow>`), with the jsdom shims from contracts/ui.md §9 added to `apps/web/src/test-setup.ts`. No Playwright in this feature (CLAUDE.md: "Playwright later").

## R13. Performance

- Default neighborhood (all, depth 2) on the 50k perf dataset: one CTE bounded at depth 2, an edge load over ≤ 10,000 ids, canonical paths in memory, one `findRelationshipsAmong` over ≤ 200 ids, one evidence load over ≤ 200 ids. Target p95 < 2 s (SC-003). Each expansion adds one depth-1 trace; `expand` is capped at 50 ids.
- **Risk**: `all` at depth 4 from a hub can walk most of the 50k graph. It stays correct (exploration limit, lower-bound count) but may exceed 2 s. SC-003 only binds the default settings; the perf test records depth-4 timing for information and fails only on the default case.
- Client: `onlyRenderVisibleElements`, module-level `nodeTypes`/`edgeTypes`, `memo` on custom node/edge, fixed node size, no dragging. Target: interactions under 100 ms at 200 nodes (SC-004), checked manually per quickstart.md.
