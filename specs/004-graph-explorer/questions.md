# Questions: Graph Explorer (004)

## Notes for the orchestrator (no action blocks the implementer)

1. **T001 baseline.** The baseline gate could not run before the first change (Docker was not running when the session started). T001 was ticked after Phase 2 instead: the full gate (`pnpm lint`, `pnpm typecheck`, `pnpm test`, the whole api e2e suite, `pnpm build`) is green with Phase 2 in place, so no earlier failure was hiding.
2. **ui.md §17 shim differs by one expression.** `observe(target)` in `ResizeObserverStub` is written `this.cb([...], this as unknown as ResizeObserver)` in ui.md §17. ESLint (`no-unnecessary-type-assertion`) rejects it, so `apps/web/src/test-setup.ts` uses `this.cb([...], this)`. Suggest correcting ui.md §17.
3. **Backend fixtures pulled forward.** T018, T037, T041 and T048 are backend-only and were done right after Phase 2, because they validate `composeNeighborhood` and the service against the real seed. N1 (32/60), N3 (35/86) and N2, N4 to N8 and G1 match the hand-derived figures exactly.
4. **Validation paths for list items.** A bad list item is reported with an indexed path (`entityTypes.0`, `expand.0`). The "expand contains the focus" error uses path `expand`, as in api §2 step 2.
5. **ui.md §17 `ResizeObserverStub` lacks `contentRect`.** With `@xyflow/system` 0.0.83 the pan/zoom resize callback reads `entries[0].contentRect.width`, so the shim as written throws `Cannot read properties of undefined (reading 'width')` in every component test that renders `<ReactFlow>`. `apps/web/src/test-setup.ts` now passes `contentRect: target.getBoundingClientRect()` in the entry. Suggest correcting ui.md §17 (this and note 2).
6. **jsdom has no layout, so `onlyRenderVisibleElements` hides nodes.** `ExplorerPage.test.tsx` mocks `ReactFlow` with `onlyRenderVisibleElements={false}` (test-only) so graph-node assertions can see every node. Production `GraphCanvas` keeps the prop, as ui.md §9 requires. Component tests that click graph nodes use `fireEvent.click`, because `userEvent.click` fires a `mousedown` with no `view` and d3-zoom throws.
7. **Parallel edges overlap under ui.md §6.** `getBezierPath` ignores `curvature` unless the target lies behind the source, and for same-layer nodes (Right/Right handles) the endpoints share an x, so `curvature: 0.25 + 0.2 * parallelIndex` changes nothing: a second relationship between the same pair is drawn exactly over the first. `RelationshipEdge` keeps the contract's curvature and also shifts the endpoints of edge `n` by `14 * n` px (sideways for same-side handles, vertically otherwise). Suggest amending ui.md §6.
8. **Controls vs legend.** ui.md §9 (`<Controls />`, default bottom-left) and §6 (legend bottom-left) overlap, hiding zoom/fit. `GraphCanvas` places `<Controls position="top-left">`.
9. **Narrow screens.** Below `lg` the canvas container has an explicit `h-[480px]` (React Flow needs a definite parent height); from `lg` it is `flex-1` as in ui.md §15.
10. **Failed refresh keeps the view.** If a refetch fails while data is on screen, `ExplorerPage` keeps the graph and list and shows an inline alert instead of replacing the page with the error state (ui.md §15 step 4 does not say).
11. **Test helper node types.** `flow-test-utils.tsx` declares its own module-level `nodeTypes`/`edgeTypes` for component tests, so T052's `grep -rn "nodeTypes\s*=" apps/web/src` lists it besides `GraphCanvas.tsx`.
12. **Blocker label texts (T039).** ui.md §13 says to use the labels "exactly as in Entity 360's `BlockersSection`" but lists different texts (`Part of a dependency cycle`, `Deepest blocker found within depth N`) than that component renders (`Ends in a cycle`, `Continues beyond depth N`). To honour "the same labels as feature 003" (spec US2 scenario 6), the path labels and truncation notes were extracted from `BlockersSection` into `pages/entities/PathLabels.tsx` and are used by both `BlockersSection` and `BlockerHighlightPanel`, so they cannot drift. The rendered texts are therefore those of Entity 360. Suggest correcting the strings in ui.md §13.
13. **Toolbar outside the keyed view (ui.md §15 steps 2-3).** With the toolbar inside the keyed `ExplorerView`, every setting change unmounted it: the open `<details>` checklist closed, keyboard focus dropped to `<body>` and the page flashed "Loading…" without a toolbar. `ExplorerPage` now renders `ExplorerToolbar` above the keyed view (full width, above the summary); the view still remounts on focus or settings change so expansions, selection, focus mode and path selection reset as specified.
14. **Failed expand/collapse.** Each expand set is a new query key, and TanStack Query only uses placeholder data while a query is pending, so a failed expand request would have left no data and replaced the page with the error state. The view keeps the last good response, rolls `expand` back to the last request that worked and shows the inline "Could not refresh the view" alert. Expansions are capped at `EXPLORER_LIMITS.maxExpansions` (50) client-side with a status message, so the API's 400 for a 51st cannot be provoked, and toggling is ignored while a request is in flight.
15. **Accessibility.** The direction radiogroup follows the ARIA radio pattern (roving `tabIndex`, arrow keys move and check, wrapping). The two `Clear` buttons are named `Clear entity types` / `Clear relationship types`. The list's focus-mode button is named by its action (`Focus mode on` / `Focus mode off`) and carries no `aria-pressed`, so it is not announced twice.

## Coverage (T052)

Files are under `apps/web/src/pages/explorer/` (web), `apps/api/src` and `apps/api/test` (api), `packages/shared/src` (shared). "seed" = `explorer-seed.e2e-spec.ts`, "e2e" = `explorer.e2e-spec.ts`, "page" = `ExplorerPage.test.tsx`.

| Requirement | Covered by |
|---|---|
| FR-001 one focus, never the whole graph | route is per entity (e2e 404/400); `ExplorerPickerPage.test` (no graph on the picker); `neighborhood.service.ts` has no unanchored query |
| FR-002 entry points | `EntityDetailPage.test` (Open in Graph Explorer href); router `graph` → picker (`ExplorerPickerPage.test`); page "Explore from here" tests |
| FR-003 settings in the URL, history | `explorer-params.test`; page "shareable state" (3 tests); `ExplorerToolbar.test` "replaces the history entry"; page "Back returns to the previous focus" |
| FR-004 neighborhood, depth 1-4, rejects outside | `explorer.spec` (depth); e2e + seed N10 (0, 5, 2.5); seed N1 (depth 2), N8 (depth 1), N5 (depth 4); `graph-repository.e2e` depths 1-4 |
| FR-005 directions, match feature 003, no RELATES_TO | `graph-repository.e2e` (4 walks × depth 1-4 equal `traceDependencies`); seed N5, N7; repository refuses RELATES_TO; N10 |
| FR-006 relationship-type filter | seed N9; `neighborhood.service.spec`; toolbar tests |
| FR-007 entity-type filter, connectors | `compose-neighborhood.spec`; seed N6 (exact order and parents); `EntityNode.test` connector |
| FR-008 once per entity, with distance | seed N1/N3 distance counts; e2e G2 (cycle); `traversal-property.spec` (ALL walk); `compose` property |
| FR-009 node content, markers, not colour alone | `EntityNode.test` (type, state text, chips); `NodeChips` shared with the list; seed N1 per-source states |
| FR-010 origin/confidence style, legend, text | `edge-style.test` (all combinations); `RelationshipEdge.test`; `GraphLegend.test`; list and panels show `OriginBadge` text; seed N1 (INFERRED/LOW, MANUAL/MEDIUM) |
| FR-011 layout, deterministic | `layout.test` (layers, columns, determinism) |
| FR-012 cap 200 and priority | `compose` spec (cap, order); e2e G1; page "large neighborhoods" |
| FR-013 left-out message, lower bound | `describe-view.test`; `ExplorerSummary.test`; page "large neighborhoods" (exact sentence, lower bound) |
| FR-014 zoom, pan, reset | React Flow canvas props asserted in `GraphCanvas.test` (Zoom In, Zoom Out, Fit View, no lock). Smoothness is manual (T051/T053) |
| FR-015 select in graph or list, both highlight | page tests (list→graph, graph→list, edge from list and from graph, Close) |
| FR-016 expand/collapse | page "expand and collapse" (order, collapse, ignored, reset, list, failure rollback); `expansion.test` (the 50-expansion cap); `compose` spec; seed N8 |
| FR-017 focus mode | `emphasis.test` rule 3; page "focus mode" (3 tests) |
| FR-018 every action from the list, keyboard | `ExplorerList.test` (actions, Tab + Enter); the list offers select, expand/collapse, focus mode, Explore from here, Open Entity 360 |
| FR-019 highlight blockers | seed N2/N4; `emphasis.test`; page "blocker highlighting" |
| FR-020 blocker entities added, removed when off | `compose` spec (BLOCKING_PATH, null distance); seed N4 (extra node), N2 vs N1 |
| FR-021 single path | `BlockerHighlightPanel.test`; page "Path 2" test |
| FR-022 summary, explanations, labels | `BlockerHighlightPanel.test`; shared `PathLabels` used by Entity 360 too |
| FR-023 node panel | `NodeDetailsPanel.test` |
| FR-024 relationship panel | `EdgeDetailsPanel.test` |
| FR-025 entities in panels selectable, link to Entity 360 | **Partly.** Every entity named in the panels, the list and explanation sentences links to Entity 360 and has an `Explore` (re-center) link (`NodeDetailsPanel.test`, `EdgeDetailsPanel.test`, `ExplanationSentence`). Names in the side panels do not select the node in place on the canvas. Gap, deferred: no product need was stated; say if in-place selection is wanted. |
| FR-026 list always with the graph | page tests (region present with the canvas); `ExplorerList.test` (groups, fields, relationships); SC-005 tests |
| FR-027 header | `describe-view.test`; `ExplorerSummary.test` (counts, filters, load time, omitted) |
| FR-028 only the repository traverses | grep: `WITH RECURSIVE` only in `prisma-graph.repository.ts` (+ the existing smoke e2e) |
| FR-029 deterministic content and order | seed N4 100-call identity; `compose` property (identical twice) |
| FR-030 roles, 401/404/400 | e2e (401, 404, 400s); `authz-matrix.e2e-spec` (every role) |
| FR-031 read-only, no audit | e2e "writes no audit entries and changes no data" (audit, entity, relationship and observation counts unchanged) |
| FR-032 no risk/impact/history | grep of `pages/explorer`: no such controls (the only match is the word "history" in a toolbar test about URL history) |
| FR-033 shared schemas, e2e | `explorer.spec`; `explorer-seed`/`explorer` e2e for success, 401, 400, 404 |
| FR-034 test list | acceptance scenarios (page + seed), upstream/downstream agreement (`graph-repository.e2e`, N5/N7), depth 1/2/4 (above), filters, expand/collapse, 200 cap, cycles (G2), parallel edges (`to-flow.test`, `RelationshipEdge.test`), multi-source edges (G3), determinism |
| SC-001 under 30 s | manual (quickstart steps 1-5) |
| SC-002 acceptance scenarios, blockers match 003 | seed N1-N10; N2/N4 deep-equal `/blockers` |
| SC-003 p95 < 2 s / < 1 s | `perf-explorer`: 26 ms default, +13 ms expansion on 50k entities (quickstart table) |
| SC-004 interaction < 100 ms at 200 nodes | **Open**: manual (T051), no browser tool was available |
| SC-005 list = graph | `ExplorerList.test` fixed cases + 150 generated graphs; page tests; 200-node page test |
| SC-006 origin style and text on 100% of edges | `edge-style.test` (every combination); generated-graph test asserts every list row carries the confidence text; `OriginBadge` text in list and panels |
| SC-007 never more than 200 | `NeighborhoodResponseSchema` max 200 (`explorer.spec`); e2e G1; `compose` property (random inputs, small caps) |
| SC-008 100 identical loads | seed N4 determinism; `layout.test` determinism |

**Gaps left open:** SC-004 and the browser-only parts of FR-014 smoothness and SC-001 (manual, quickstart); FR-025 in-place selection from panel names (deferred, see above).

**Live check of the quickstart API smoke (T053):** the built api was started against the dev database and queried over HTTP: Order #18492 returned `{"n":32,"e":60,"omitted":0}` (N1); `blockers=true` listed `Payment PAY-88213`, `Finance approval APR-2291`, `Budget code for Order #18492` (N2); Shipment SHP-77120 with blockers returned 36 nodes, 88 edges and 2 paths (N4); no token gave 401; `depth=5` gave 400 naming `depth`.

## Code review of the branch (`/code-review high main`)

Fixed: (1) upper-case UUIDs in the path or in `expand` are now lower-cased up front in `NeighborhoodService` (they caused a 500 from the step-10 invariant and silently ignored expansions); (2) the node panel's *Blocks* list says `Showing N of M dependents` with a link to Entity 360 when the 200-row page is partial, and takes its relationship types from `BLOCKER_RELATIONSHIP_TYPES`; (3) a failed expand/collapse that is rolled back now tells the user; (4) layout, emphasis and flow are separate memos (ui.md §15.5), so a selection change no longer re-runs the layout.

Deliberately left as is, with the reason:
- *Sequential expansion traces*: tasks.md rule 5 / plan KDN 5 require sequential, request-order tracing; measured cost of one expansion is +13 ms on 50k entities.
- *Blocker paths can fill the 200 cap*: this is the priority order of FR-012 (focus, then blocking paths, then the neighborhood), and the omitted notice reports what was left out.
- *Global jsdom shims in `test-setup.ts`*: ui.md §17 says to append them there.
- *`loadEdgeRows` generic instead of `isTraceableRow` filters*, *evidence loaded twice for blocker hop entities*, *node `data` objects not referentially stable*, *`probeBeyondDepth` flag shape*: optimisations or style choices with no wrong result; revisit if the T051 browser check finds interaction lag at 200 nodes.
