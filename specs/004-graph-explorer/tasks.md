# Tasks: Graph Explorer

**Input**: `specs/004-graph-explorer/` (plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/ui.md, quickstart.md)
**Tests**: REQUIRED. Constitution V requires an e2e test for every endpoint and traversal tests for cycles and depth limits. Spec FR-033 and FR-034 list the rest. SC-002 and SC-005 to SC-008 are verified by tests.

## Rules for the implementer (read first)

1. Do tasks **in ID order** within a phase. `[P]` tasks touch different files and may be done in any order.
2. Before each task, re-read the section it references: research (R#), data-model.md (§#), contracts/api.md (api §#), contracts/ui.md (ui §#), or plan.md "Key Design Notes" (KDN #). **Do not invent alternatives.** The fixtures N1–N10 and G1–G3 in api §5 are exact: assert them literally.
3. **Only one new dependency: `@xyflow/react@^12.12.0` in `apps/web`.** No layout library (no dagre, elkjs, d3-*). No migrations, no `any`, no `TODO`s, no non-null `!` on traversal data. Compare strings only with `compareCodeUnits`, never `localeCompare`.
4. `WITH RECURSIVE` and every `relationships` query may appear **only** in `apps/api/src/graph/prisma-graph.repository.ts`.
5. React Flow: exactly one node type (`'entity'`) and one edge type (`'relationship'`), with the data types of ui §3. `nodeTypes`/`edgeTypes` are module-level constants. No `useNodesState`/`useEdgesState`.
6. After each **phase**, run its **Checkpoint**. Fix every failure, tick the boxes, and commit with Conventional Commits (`feat(explorer): …`, `refactor(graph): …`, `test(explorer): …`), one commit per task or small group of tasks.
7. If anything is ambiguous, contradicts a fixture, or a library API differs from ui.md, stop and write the question, with the exact error output, to `specs/004-graph-explorer/questions.md`. If a hand-derived fixture count in api §5 disagrees with what the seed produces, **do not change the code to match**: record both numbers in `questions.md` and stop.
8. Rebuild shared after every change to `packages/shared`: `pnpm --filter @opsgraph/shared build`.

**Standard gate** (used by the checkpoints): `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`

---

## Phase 1: Setup

- [ ] T001 On branch `004-graph-explorer`, confirm the baseline is green before any change: `docker compose up -d db`, then the standard gate plus `pnpm build`. If anything fails, stop and record it in `specs/004-graph-explorer/questions.md`. Do not fix feature 003 code here.
- [ ] T002 Add the dependency: `pnpm --filter web add @xyflow/react@^12.12.0`. Append the jsdom shims of ui §17 to `apps/web/src/test-setup.ts` exactly as written. Run `pnpm --filter web test` and `pnpm --filter web typecheck`: both must still pass.

**Checkpoint**: standard gate green; `git diff main -- '**/package.json'` shows only `@xyflow/react` added to `apps/web/package.json`.

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: shared schemas, the traversal refactor and `ALL` walk, the repository methods, and the complete `neighborhood` endpoint. Every story uses this endpoint; stories differ in which fixtures they prove and which UI they add.

### Shared (`packages/shared/src`)

- [ ] T003 In `packages/shared/src/tracing.ts`, change `function commaList` to `export function commaList` (nothing else). Create `packages/shared/src/explorer.ts` with exactly the code in data-model.md §1 (`EXPLORER_LIMITS`, `NeighborhoodDirectionSchema`, `ExplorerUrlParamsSchema`, `NeighborhoodQuerySchema`, `NodeReasonSchema`, `NeighborhoodNodeDtoSchema`, `GraphEdgeDtoSchema`, `NeighborhoodResponseSchema` and their types). Add `export * from './explorer';` to `packages/shared/src/index.ts`. Rebuild shared.
- [ ] T004 Create `packages/shared/src/explorer.spec.ts` (Vitest). Cover every row of the data-model §1 validation table:
  - defaults: `{}` parses to `direction 'all'`, `depth 2`, empty lists, `expand []`, `blockers false`;
  - `depth` `"0"`, `"5"`, `"2.5"`, `"abc"` rejected; `"4"` accepted;
  - `relationshipTypes: "RELATES_TO"` accepted with `direction=all`, rejected with `upstream` and `downstream` (issue path `['relationshipTypes']`);
  - `entityTypes: "Shipment,Order,Order"` → `['Order','Shipment']`;
  - `expand: "<b>,<a>,<b>"` → `[b, a]` (first-occurrence order); a non-UUID item rejected; 51 distinct UUIDs rejected, 50 accepted;
  - `blockers: "true"` → `true`, `"yes"` rejected;
  - `ExplorerUrlParamsSchema` has no `expand` key in its output;
  - `NeighborhoodResponseSchema` rejects `nodes: []` and 201 nodes.

### Traversal refactor and the `ALL` walk (`apps/api/src/graph/traversal/`)

- [ ] T005 Make the relationship type generic as in data-model §2 "Internal traversal type widening": `EdgeRow<T>`, `TraversalEdge<T>`, `InternalPath<T>` in `types.ts` (default `TraceableRelationshipType`), and `selectCanonicalPaths<T extends RelationshipType>` with `CanonicalPathsResult<T>` in `canonical-paths.ts`. **No behavior change.** Every existing spec in this folder must pass unchanged.
- [ ] T006 Create `apps/api/src/graph/traversal/edge-groups.ts` with `EdgeGroup<T>` and `groupEdgeRows<T>` (data-model §2): move the grouping, assertion sorting, effective origin/confidence and key logic out of `traversal-edges.ts` without changing it. Rewrite `buildTraversalEdges` to call `groupEdgeRows`; its output must be identical (existing `traversal-edges.spec.ts` passes unchanged). Create `edge-groups.spec.ts`: grouping by `(type, from, to)`, key = smallest relationship id, effective origin SOURCE > MANUAL > INFERRED, effective confidence = highest within the effective origin, assertion order, output sorted by key, and a RELATES_TO row grouped like any other.
- [ ] T007 In `edge-groups.ts`, add `buildUndirectedTraversalEdges` (data-model §2): two `TraversalEdge`s per group with the same key, FORWARD (`sourceId = from`, `targetId = to`) then REVERSE, sorted by `(key, FORWARD before REVERSE)`, `nonSource = effectiveOrigin !== 'SOURCE'`. Extend `edge-groups.spec.ts`: both orientations, ordering, and that `selectCanonicalPaths` over these edges reaches entities through relationships in either direction.
- [ ] T008 Extend `apps/api/src/graph/traversal/traversal-property.spec.ts` with an `ALL`-walk block over 1,000 generated graphs (reuse the file's generator and seeded random; include RELATES_TO and cycles). For each graph, a random start and `maxDepth` 1–4, run `selectCanonicalPaths(start, buildUndirectedTraversalEdges(groupEdgeRows(rows)), maxDepth)` and assert: it terminates; no path repeats an entity; every path has ≤ `maxDepth` edges; the reached set and each path's length are compatible with an independent undirected BFS oracle (reached set = BFS set within `maxDepth`; each path length ≥ BFS distance); each consecutive pair in `entityIds` is joined by the edge at that index.

### Repository (`apps/api/src/graph/`)

- [ ] T009 In `graph.repository.ts`, add `NeighborhoodWalk`, `NeighborhoodTraceQuery`, `NeighborhoodReached` (with `pathEntityIds` **and** `pathEdgeKeys`, no `viaEdgeKey`), `NeighborhoodTrace`, `RelationshipGroup` (data-model §2) and the two `GraphRepository` methods `traceNeighborhood` and `findRelationshipsAmong`.
- [ ] T010 In `prisma-graph.repository.ts`:
  - widen `reachableEntities` and `loadEdgeRows` type parameters to `readonly RelationshipType[]`; add the `probeBeyondDepth` option exactly as api §4; `traceDependencies` and `traceBlockers` pass `true`;
  - implement `traceNeighborhood` following api §4 steps 1–7 exactly (assert no RELATES_TO for UPSTREAM/DOWNSTREAM; throw otherwise);
  - implement `findRelationshipsAmong` per api §4 (empty input → `[]` without a query).
- [ ] T011 Extend `apps/api/test/graph-repository.e2e-spec.ts` (seeded scenario):
  - `traceNeighborhood` UPSTREAM/DOWNSTREAM at depths 1–4 from Order #18492 and the Budget code: reached ids and distances equal `traceDependencies` with the same direction, depth and types;
  - `ALL` depth 2 from Order #18492: 31 reached (fixture N1 minus focus), each `pathEntityIds[0]` is the start, `pathEdgeKeys.length === pathEntityIds.length - 1`;
  - nonexistent start → `null`;
  - `findRelationshipsAmong` over the N1 ids with all 12 types → 60 groups sorted by key; with `[]` ids → `[]`;
  - the full existing e2e suite still passes (no change to tracing results).

### Composition, service and endpoint (`apps/api/src/tracing/`)

- [ ] T012 [P] In `tracing.mapper.ts`, add `toGraphEdgeDto(group: RelationshipGroup): GraphEdgeDto` (copy fields; `observedAt` → ISO). Add a case to `tracing.mapper.spec.ts`.
- [ ] T013 [P] Create `compose-neighborhood.ts` with the types of data-model §3 (including `blockerEntities`) and `composeNeighborhood` implementing api §3 steps 1–7 **exactly**, including `basePriority`.
- [ ] T014 Create `compose-neighborhood.spec.ts` with hand-built `NeighborhoodTrace` inputs. Cover:
  - focus only (empty base) → 1 node, reasons `['FOCUS']`, distance 0, parent null;
  - base order follows `basePriority`, including the confidence and non-SOURCE tie-breaks;
  - entity-type filter: connectors added before the matching entity, in path order, with reason `CONNECTOR`; a matching intermediate gets `NEIGHBORHOOD`; non-matching entities on no listed path are not candidates (not counted in `omitted`);
  - blocker paths come right after the focus, in rank order, with parents along the path; a blocker entity also in the base gets both reasons, in `NodeReasonSchema` order, and keeps its base `distance`; a blocker-only entity has `distance` null;
  - expansions: applied in request order, `EXPANSION` reason, parent = expanded id, `viaEdgeKey = pathEdgeKeys[0]`; ignored when the trace is null or the expanded id is beyond the first `maxVisible` entries; the focus never gets `EXPANSION`; `expanded` flag set;
  - cap: `maxVisible` 5 with 9 candidates → 5 visible, `omitted` 4; `omittedIsLowerBound` from base or an applied expansion;
  - **property**: over 200 random inputs, every visible non-focus node's `parentId` appears earlier in `visible`, and the result is identical when computed twice.
- [ ] T015 Create `neighborhood.service.ts` (`@Injectable`, injects `GRAPH_REPOSITORY`, `TracingService`, `StateEvidenceReader`) implementing api §2 steps 1–11 exactly. Register it in `tracing.module.ts` providers. Add the `@Get(':id/neighborhood')` handler to `tracing.controller.ts` exactly as api §1.
- [ ] T016 Create `neighborhood.service.spec.ts` (Jest, repository and `TracingService` mocked):
  - `expand` containing the focus → `VALIDATION_FAILED` with path `expand`, before any repository call;
  - default `relationshipTypes`: 12 types for `all`, the 11 traceable for `upstream`;
  - `traceNeighborhood` returning null → `NOT_FOUND`;
  - `blockers=false` → `TracingService.blockers` not called, `blockers: null`;
  - expansions traced sequentially in request order with `maxDepth 1`;
  - edge filtering: a group of a type outside `types` is kept only when its key is a blocker hop key;
  - the step-10 invariant throws when a `viaEdgeKey` is missing from the kept edges.
- [ ] T017 Create `apps/api/test/explorer.e2e-spec.ts` following `tracing.e2e-spec.ts` conventions. Cover: 200 for a seeded entity, response parsed with `NeighborhoodResponseSchema`; 401 without a token; 404 for an unknown UUID; 400 for a malformed id; fixture **G2** (cycle) and **G3** (multi-assertion) from api §5, inserting their data through the same helpers the tracing e2e tests use. If `authz-matrix.e2e-spec.ts` lists the tracing routes, add `GET /api/entities/:id/neighborhood` with every role allowed.

**Checkpoint**: standard gate green. `grep -rn "WITH RECURSIVE" apps/` lists only `prisma-graph.repository.ts` and the existing smoke test.

---

## Phase 3: User Story 1 — See an entity's neighborhood as a graph and as a list (P1) 🎯 MVP

**Goal**: open the explorer on one entity, see its 2-step neighborhood as a graph and a matching list, select nodes and relationships, read their details.
**Independent test**: seed, sign in, open Order #18492 in the explorer; check spec US1 scenarios 1–8 and fixtures N1, N3, N9, N10.

### Backend fixtures

- [ ] T018 [US1] Create `apps/api/test/explorer-seed.e2e-spec.ts` (seeded, ADMIN login, look up ids by display name as `tracing-seed.e2e-spec.ts` does). Assert fixtures **N1**, **N3**, **N9** and **N10** of api §5 literally: node counts per distance, the named entities per distance, edge counts, the INFERRED/LOW and MANUAL/MEDIUM edges, the Order #18492 per-source states, reasons, every validation case.

### Web pure modules (`apps/web/src/pages/explorer/`)

- [ ] T019 [P] [US1] Create `explorer-params.ts` + `explorer-params.test.ts` (research R10, ui §15 step 1):
  - `parseExplorerParams(sp: URLSearchParams): { ok: true; params: ExplorerUrlParams } | { ok: false; issues: string[] }` using `ExplorerUrlParamsSchema.safeParse` on `{ direction, depth, relationshipTypes, entityTypes, blockers }` (absent → `undefined`); issues formatted `` `${path}: ${message}` ``;
  - `writeExplorerParams(current, partial): URLSearchParams` that omits defaults (`direction=all`, `depth=2`, empty lists, `blockers=false`) and keeps unrelated params;
  - `toNeighborhoodQueryString(params, expand: string[]): string` with lists comma-joined and only when non-empty, `expand` in given order;
  - tests: round trip, defaults omitted, invalid values produce issues (never fallback), RELATES_TO with upstream is an issue.
- [ ] T020 [P] [US1] Create `layout.ts` + `layout.test.ts` exactly per ui §4. Tests: `stepBetween` for every relationship type in both directions (RELATES_TO → 0); a small hand-built response where upstream nodes get negative layers, downstream positive, a sibling (shipment → other order) layer 0 below the focus; tree-order row sorting; column centering; focus at (0, 0); identical output on two runs.
- [ ] T021 [P] [US1] Create `edge-style.ts` + `edge-style.test.ts` exactly per ui §6 table: every origin, confidence, emphasis and selected combination, RELATES_TO stroke and no marker, labels.
- [ ] T022 [P] [US1] Create `emphasis.ts` + `emphasis.test.ts` implementing **all three** rules of ui §7 (blocker and focus-mode inputs are wired later, but the function is complete now). Tests: no blockers + no focus mode → all normal; blocker paths highlight/dim with the focus normal; `selectedPathIndex` restricts highlighting but not `blockerRole`; focus mode dims outside the selected node's closed neighborhood and restores dimmed neighbors to normal; focus mode ignored for an edge selection.
- [ ] T023 [P] [US1] Create `describe-view.ts` + `describe-view.test.ts` exactly per ui §10, including singular/plural, filters text, both omitted messages and the empty message.
- [ ] T024 [P] [US1] Create `flow-types.ts` exactly as ui §3 (types and the four constants; not the actions context yet).
- [ ] T025 [US1] Create `to-flow.ts` + `to-flow.test.ts` per ui §5: node and edge objects field by field, handle rule for `<`, `>` and `=` layers, `parallelIndex` grouping by unordered pair sorted by key, `selected` from the selection, `ariaLabel`s, `markerEnd` from `edgeStyle`. Set `canExpand: false` for every node in this phase (expansion arrives in T043).

### Web components

- [ ] T026 [P] [US1] Create `EntityNode.tsx` + `EntityNode.test.tsx` per ui §8, **without** the expand button (added in T043). Test inside a minimal `<ReactFlowProvider><ReactFlow nodes=[…] nodeTypes=…>` with a fixed-size container: focus, selected, connector, highlighted, dimmed classes; chips and their order (Conflict, State unknown, Direct blocker, Deepest blocker, Connector).
- [ ] T027 [P] [US1] Create `RelationshipEdge.tsx` + `RelationshipEdge.test.tsx` per ui §6: `BaseEdge` style from `edgeStyle`, curvature from `parallelIndex`, label only when `showLabel`.
- [ ] T028 [P] [US1] Create `GraphLegend.tsx` per ui §6 (SVG samples rendered with `edgeStyle` output, node samples).
- [ ] T029 [US1] Create `GraphCanvas.tsx` exactly per ui §9: module-level `nodeTypes`/`edgeTypes`, the listed `<ReactFlow>` props, `Background`, `Controls showInteractive={false}`, `GraphLegend`, the `centerOn` effect with `useReactFlow().setCenter`.
- [ ] T030 [P] [US1] Create `useNeighborhood.ts` (key `['entities', id, 'neighborhood', params, expand]`, `placeholderData: keepPreviousData`, parsed with `NeighborhoodResponseSchema`) and `useBlocks.ts` (research R11 URL, parsed with `DependenciesResponseSchema`).
- [ ] T031 [P] [US1] Create `ExplorerSummary.tsx` per ui §10 (title, filters, loaded time + `Refresh`, omitted `role="status"`, empty message).
- [ ] T032 [US1] Create `ExplorerList.tsx` + `ExplorerList.test.tsx` per ui §12 **with only** row selection and the `Open Entity 360` action for the selected row (Expand/Collapse, Focus mode and Explore from here are added in Phase 5). Tests: groups and counts for an N1-shaped fixture; relationship order; `aria-pressed`; keyboard (Tab to a row, Enter selects); **the set of node ids and edge keys in the list equals the set in `toFlow` output** (SC-005).
- [ ] T033 [US1] Create `NodeDetailsPanel.tsx` and `EdgeDetailsPanel.tsx` + tests per ui §14 (without `Explore from here`; added in T046). Mock `apiFetch`. Tests: state with source and time; disagreeing sources listed; Blocked by from `/blockers`; Blocks hidden-as-text for a SATISFIED entity and listed with `OriginBadge` otherwise; evidence first 10 records; relationship panel lists every assertion with basis.
- [ ] T034 [US1] Create `ExplorerToolbar.tsx` + test with **only** the Steps `<select>` (1–4) for now, writing the URL through `writeExplorerParams` with `replace: true`.
- [ ] T035 [US1] Create `ExplorerPage.tsx` + `ExplorerPage.test.tsx` per ui §15 steps 1–5 and 7 (no blockers panel, no expand, no explore-from-here yet): URL validation alert with `Reset settings`; keyed `ExplorerView`; grid layout with canvas left and list right; loading, 404 and error states; selection from graph or list highlights both and opens the matching panel; list selection sets `centerOn`; `Close` clears selection. Mock `apiFetch` with an N1-shaped response.
- [ ] T036 [US1] Create `ExplorerPickerPage.tsx` + test per ui §16. In `apps/web/src/router.tsx`, replace the `graph` `ComingSoonPage` route with `graph` → `ExplorerPickerPage` and add `graph/:id` → `ExplorerPage`. In `apps/web/src/pages/entities/EntityDetailPage.tsx`, add the `Open in Graph Explorer` link after `BlockerCallout`; extend `EntityDetailPage.test.tsx` to assert its `href`.

**Checkpoint**: standard gate green. Manually: quickstart steps 1–2 and selecting a node and an edge work in the browser.

---

## Phase 4: User Story 2 — Highlight what is blocking the focus entity (P1)

**Goal**: turn on blocker highlighting; see feature 003's paths on the graph and the same explanation text beside it.
**Independent test**: open Shipment SHP-77120 and Order #18492, turn on highlighting, compare with fixtures N2, N4 and with feature 003's `/blockers` output.

- [ ] T037 [US2] Extend `apps/api/test/explorer-seed.e2e-spec.ts` with fixtures **N2** and **N4** of api §5 (including deep-equality of `blockers` with `GET /blockers` minus `computedAt`), and a determinism test: 100 consecutive N4 calls produce identical bodies once `computedAt` and `blockers.computedAt` are removed (SC-008).
- [ ] T038 [P] [US2] Add the `Highlight blockers` checkbox to `ExplorerToolbar.tsx` (ui §11): checked → `blockers=true`, unchecked → param removed. Extend its test.
- [ ] T039 [P] [US2] Create `BlockerHighlightPanel.tsx` + test per ui §13, reusing `ExplanationSentence`/`linkTargets` and the label texts used by `pages/entities/BlockersSection.tsx` (import shared helpers if they exist; do not duplicate strings that are already exported). Tests: summary; `Path n` buttons with `aria-pressed`; `Show all paths`; labels for MANUAL hop, unknown state, cycle, depth limit, truncation; no-blocker case shows only the summary.
- [ ] T040 [US2] Wire blockers into `ExplorerPage.tsx`: `selectedPathIndex` state (reset by the keyed remount), `BlockerHighlightPanel` above `ExplorerList` when `response.blockers !== null`, pass `selectedPathIndex` to `computeEmphasis`. Extend `ExplorerPage.test.tsx` with an N4-shaped response: the Budget code node shows `Deepest blocker`, off-path nodes have `opacity-20`, selecting `Path 2` highlights only that path's edges, the list groups the Budget code under `Added by blocking path`.

**Checkpoint**: standard gate green. Manually: quickstart steps 3–5.

---

## Phase 5: User Story 3 — Narrow the view: filters, direction, expand, collapse, focus (P2)

**Goal**: direction and type filters, connectors, expand/collapse, focus mode, Explore from here, shareable links.
**Independent test**: open the Budget code, apply each control; compare with fixtures N5–N8 and spec US3 scenarios 1–8.

- [ ] T041 [US3] Extend `apps/api/test/explorer-seed.e2e-spec.ts` with fixtures **N5**, **N6** (exact node order and parents), **N7** (equality with `/dependencies?direction=upstream&depth=2`) and **N8** (expansion, ignored expansion, focus in `expand` → 400).
- [ ] T042 [P] [US3] Add to `ExplorerToolbar.tsx` the Direction radiogroup, Entity types and Relationship types `<details>` checklists per ui §11 (relationship options depend on direction; switching to upstream/downstream removes RELATES_TO). Extend its test: each control writes the expected URL; defaults omitted.
- [ ] T043 [P] [US3] Create `explorer-actions.ts` exactly as ui §3. Add the expand/collapse button to `EntityNode.tsx` per ui §8 (calls `useExplorerActions().toggleExpand`, `stopPropagation`, `nodrag nopan`, aria-label). In `to-flow.ts` set `canExpand = !isFocus`. Update both tests.
- [ ] T044 [US3] In `ExplorerPage.tsx`: `expand` state (ui §15 steps 6 and 9), `ExplorerActionsContext.Provider`, `Updating…` text while a refetch with previous data is shown. In `ExplorerList.tsx`, add `Expand`/`Collapse` for the selected non-focus row. Extend tests: expanding sends `expand=<id>` in request order; collapsing removes it; `ignoredExpansions` are dropped from state; changing a setting resets `expand` (remount).
- [ ] T045 [US3] Focus mode: `focusMode` state in `ExplorerPage.tsx` (off when selection becomes null or an edge), `Focus mode on/off` action for the selected row in `ExplorerList.tsx`, passed to `computeEmphasis`. Extend tests: nodes outside the selected node's neighbors get `opacity-20` and stay rendered.
- [ ] T046 [US3] Explore from here: action in `ExplorerList.tsx` (selected non-focus row) and in `NodeDetailsPanel.tsx` (non-focus), calling `navigate(`/graph/${id}?${canonicalSearch}`)` (push). Extend tests with a `MemoryRouter`: the new focus loads with the same settings, and history back returns to the previous focus.
- [ ] T047 [US3] Shareable state test in `ExplorerPage.test.tsx`: rendering `/graph/<id>?direction=downstream&depth=4&entityTypes=Order,Shipment&blockers=true` requests exactly those settings from the API and shows them in the toolbar and the summary; an invalid URL (`depth=9`) shows the validation alert and makes no API request.

**Checkpoint**: standard gate green. Manually: quickstart steps 6–8.

---

## Phase 6: User Story 4 — Large neighborhoods stay usable (P2)

**Goal**: never more than 200 visible entities, a clear "N more" message, smooth interaction.
**Independent test**: fixture G1 and the 50k performance dataset.

- [ ] T048 [US4] Extend `apps/api/test/explorer.e2e-spec.ts` with fixture **G1** (hub with 500 neighbors → 200 nodes, `omitted` 301, `omittedIsLowerBound` false) and an expansion request on it whose results do not fit (still 200 nodes, `omitted` grows).
- [ ] T049 [US4] Extend `ExplorerPage.test.tsx` with a 200-node response with `omitted: 4112`: the `role="status"` message reads exactly `Showing 200 of 4312 entities — 4112 more. Refine filters, reduce the step limit, or choose a direction.`; with `omittedIsLowerBound: true` it uses the lower-bound wording of ui §10; graph and list both contain 200 entities.
- [ ] T050 [US4] Create `apps/api/test/perf-explorer.e2e-spec.ts`, wrapped in `describePerf` like `perf-tracing.e2e-spec.ts` and reusing its dataset builder (50,000 entities, 150,000 relationships). Measure, with 1 warm-up and 20 timed runs each: default neighborhood for 20 entities including the highest-degree one, p95 < 2,000 ms; the same plus one `expand`, p95 < 1,000 ms over the base call's time; `all&depth=4` from the highest-degree entity, logged only (research R13). Run `RUN_PERF=1 pnpm --filter api test:e2e -- perf-explorer` and write the p95s into the quickstart.md timings table. If a budget is missed, stop and report the numbers in `questions.md`; do not add caching or change algorithms.
- [ ] T051 [US4] Manual SC-004 check (quickstart step 9) on the perf dataset at 200 nodes; record browser, machine and observations in the quickstart.md table. If interaction is not under 100 ms, record it in `questions.md` with a Performance-panel screenshot description.

**Checkpoint**: standard gate green; perf numbers recorded.

---

## Phase 7: Polish and cross-cutting

- [ ] T052 Cross-check against the spec: for every FR-001 to FR-034 and SC-001 to SC-008, name the test or code that covers it in `specs/004-graph-explorer/questions.md` under "Coverage", and list any gap. Run and confirm:
  - `grep -rn "WITH RECURSIVE" apps/` → only `prisma-graph.repository.ts` and the existing smoke test;
  - `grep -rn "localeCompare" apps/api/src apps/web/src/pages/explorer` → nothing new;
  - `grep -rnE "dagre|elkjs|d3-" apps/web/package.json` → nothing;
  - `grep -rn "nodeTypes\s*=" apps/web/src` → only the module-level constant in `GraphCanvas.tsx`;
  - no risk, impact or history controls in `pages/explorer/` (FR-032).
- [ ] T053 Walk the whole of `quickstart.md` by hand and tick each step. Fix behavior that doesn't match, in the code. Edit the quickstart only to correct factual errors.
- [ ] T054 Final gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`. Confirm: no `TODO`s, dead code or stubs; `git diff main -- '**/package.json'` shows only `@xyflow/react` in `apps/web`; every question in `questions.md` is resolved or explicitly deferred.

---

## Dependencies

- **Phase order**: 1 → 2 → 3 (US1) → 4 (US2) → 5 (US3) → 6 (US4) → 7.
- **Within Phase 2**: T003 → T004; T005 → T006 → T007 → T008; T009 → T010 → T011 (T010 needs T005–T007); T012 and T013 need T003 and T009; T014 needs T013; T015 needs T012–T013; T016 needs T015; T017 needs T015.
- **US1**: T018 needs Phase 2. Web: T019–T024 in parallel once shared is built; T025 needs T020–T022 and T024; T026–T028 need T024; T029 needs T026–T028; T032 needs T025; T035 needs T019, T025, T029–T034; T036 needs T035.
- **US2**: needs US1 (page, toolbar, emphasis). T037 is independent of the web tasks. T040 needs T038 and T039.
- **US3**: needs US1. T043 → T044; T045 and T046 need T044's page state; T047 needs T042.
- **US4**: needs US1. T048 is backend-only and could run right after Phase 2. T050 needs the perf dataset builder from feature 003.

## Parallel examples

- **Phase 2**: T012 and T013 together, after T009.
- **US1**: T019, T020, T021, T022, T023 and T024 at the same time; then T026, T027, T028, T030 and T031 together; T018 (backend fixtures) alongside all web tasks.
- **US2**: T037 (e2e) alongside T038 and T039.
- **US3**: T041 (e2e) alongside T042 and T043.

## Implementation strategy

- **MVP**: Phases 1–3. The explorer opens on any entity, shows a bounded neighborhood as graph + list, and explains each node and relationship with provenance. Fixture N1 proves the neighborhood against the §39 seed.
- **Increment 2** (Phase 4): blocker highlighting, the core "why is this stuck?" view.
- **Increment 3** (Phase 5): filters, direction, expansion, focus mode, sharing.
- **Increment 4** (Phase 6): scale guarantees and performance; Phase 7 final checks.
- **Review points** for the orchestrator:
  - after T005–T006: the traversal refactor changed no existing result;
  - after T011 and T018: the hand-derived fixture counts (N1 = 32/60, N3 = 35/86) match the seed;
  - after T014: the compose parent-earlier property holds;
  - after T035: first look at the UI against ui.md;
  - after T050: performance numbers.
