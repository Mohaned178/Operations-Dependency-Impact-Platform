# Implementation Plan: Graph Explorer

**Branch**: `004-graph-explorer` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/004-graph-explorer/spec.md`

## Summary

The Graph Explorer shows one focus entity's bounded neighborhood as a graph **and** a synchronized textual list, with blocker-path highlighting from feature 003.

1. **One new endpoint**, `GET /api/entities/:id/neighborhood`, returns the complete view: ≤ 200 nodes in priority order (each with its parent and connecting edge), the relationships among them, the omitted count, and optionally the embedded feature-003 `BlockersResponse`. Expand/collapse = the client sends `expand=<ids>` and the server recomputes. (research R3, R4)
2. **Traversal stays in `GraphRepository`**: `traceNeighborhood` reuses the existing recursive CTE and canonical-path code, adding an undirected (`ALL`) walk; `findRelationshipsAmong` loads edges among the visible set. Upstream/downstream walks are identical to feature 003, so results match it exactly. (research R5)
3. **Composition is one pure function**, `composeNeighborhood`, which applies priority, connectors, expansions and the 200 cap deterministically. (contracts/api.md §3)
4. **Web**: `@xyflow/react` 12 with exactly one custom node type (`entity`) and one custom edge type (`relationship`), a hand-written deterministic signed-column layout (no layout library), and pure modules for layout, styling, emphasis and text. (contracts/ui.md)

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node ≥ 22
**Primary Dependencies**: existing NestJS + Prisma (api), React 19 + Vite 6 + TanStack Query 5 + React Router 7 + Tailwind 4 (web), zod 3 (shared). **New**: `@xyflow/react@^12.12.0` in `apps/web` only.
**Storage**: PostgreSQL 16; no schema change, no migration.
**Testing**: Vitest (shared, web), Jest + Supertest (api unit and e2e). No Playwright.
**Target Platform**: modern desktop browsers, laptop screens ≥ 1366×768.
**Project Type**: web application (pnpm monorepo: `apps/api`, `apps/web`, `packages/shared`).
**Performance Goals**: default neighborhood p95 < 2 s and one expansion p95 < 1 s on the 50k-entity dataset (SC-003); pan/zoom/select < 100 ms at 200 nodes (SC-004).
**Constraints**: ≤ 200 visible nodes; depth 1–4; ≤ 50 expansions; 10,000-entity exploration limit; deterministic output and layout (SC-008); read-only.
**Scale/Scope**: 1 endpoint, ~6 api source files touched/added, ~22 web files, 1 shared module.

No open NEEDS CLARIFICATION items: all resolved in research.md.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Source Traceability | Every node carries feature 003's state evidence (`observation`, `latestBySource`); every edge carries every assertion with source system, source id, observed time and import id. The side panel shows source records. | ✅ |
| II. Fact vs Inference | Edges carry effective origin and confidence, encoded visually (solid/dashed/dotted, width, opacity) **and** as text (labels, list, panel). Conflicting source states are flagged on nodes and listed in the panel. | ✅ |
| III. Explainability & Determinism | Blocker highlighting embeds feature 003's paths and explanation text unchanged. Neighborhood order, cap and layout are pure, deterministic functions with tie-breaks down to ids; repeated calls are tested identical. No scores. | ✅ |
| IV. Auditability | Read-only feature: no mutations, so no audit rows (spec FR-031). | ✅ |
| V. Test-Gated Changes | New endpoint has zod schemas in `packages/shared` and e2e tests (success, 401, 400, 404). New traversal (`ALL` walk) has a cycle/depth property test over 1,000 generated graphs. | ✅ |
| VI. MVP Scope Discipline | Answers "why is this blocked / what is it connected to" (§65). Risk/impact highlighting and history inspection are excluded (FR-032). One new dependency, listed here. The small generic widening of traversal types is justified in Complexity Tracking. | ✅ |
| Tech constraint: traversal only in `GraphRepository`, max depth + cycle guard | `traceNeighborhood` reuses the bounded CTE (`UNION` on `(entity, depth)` + depth bound); `findRelationshipsAmong` also lives in the repository. No SQL elsewhere. | ✅ |
| Tech constraint: new runtime deps listed | `@xyflow/react@^12.12.0` (web). | ✅ |

**Post-design re-check**: unchanged, all ✅.

## Project Structure

### Documentation (this feature)

```text
specs/004-graph-explorer/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R13 decisions
├── data-model.md        # shared schemas, repository and compose types, client state
├── quickstart.md
├── contracts/
│   ├── api.md           # endpoint, service steps, compose algorithm, fixtures, test inventory
│   └── ui.md            # React Flow types, layout, encoding, components
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (new and changed files only)

```text
packages/shared/src/
├── explorer.ts                         # NEW: EXPLORER_LIMITS, query/url/response schemas
├── explorer.spec.ts                    # NEW
├── tracing.ts                          # CHANGE: export commaList
└── index.ts                            # CHANGE: export * from './explorer'

apps/api/src/graph/
├── graph.repository.ts                 # CHANGE: Neighborhood* types, RelationshipGroup, 2 methods
├── prisma-graph.repository.ts          # CHANGE: traceNeighborhood, findRelationshipsAmong,
│                                       #         reachableEntities(probeBeyondDepth, RelationshipType[])
└── traversal/
    ├── types.ts                        # CHANGE: generic relationship type param (default Traceable)
    ├── edge-groups.ts                  # NEW: groupEdgeRows, buildUndirectedTraversalEdges
    ├── edge-groups.spec.ts             # NEW
    ├── traversal-edges.ts              # CHANGE: use groupEdgeRows; output unchanged
    ├── canonical-paths.ts              # CHANGE: generic only; behavior unchanged
    └── traversal-property.spec.ts      # CHANGE: add ALL-walk property block

apps/api/src/tracing/
├── compose-neighborhood.ts             # NEW (pure)
├── compose-neighborhood.spec.ts        # NEW
├── neighborhood.service.ts             # NEW
├── neighborhood.service.spec.ts        # NEW (repository mocked: steps 2, 3, 8, 10 of contracts/api.md §2)
├── tracing.mapper.ts                   # CHANGE: toGraphEdgeDto
├── tracing.controller.ts               # CHANGE: GET :id/neighborhood
└── tracing.module.ts                   # CHANGE: provide NeighborhoodService

apps/api/test/
├── graph-repository.e2e-spec.ts        # CHANGE
├── explorer.e2e-spec.ts                # NEW
├── explorer-seed.e2e-spec.ts           # NEW
├── perf-explorer.e2e-spec.ts           # NEW (RUN_PERF=1)
└── authz-matrix.e2e-spec.ts            # CHANGE if it enumerates tracing routes

apps/web/
├── package.json                        # CHANGE: @xyflow/react
└── src/
    ├── router.tsx                      # CHANGE: graph, graph/:id
    ├── test-setup.ts                   # CHANGE: React Flow jsdom shims (ui.md §17)
    ├── pages/entities/EntityDetailPage.tsx   # CHANGE: "Open in Graph Explorer" link
    └── pages/explorer/                 # NEW: every file in contracts/ui.md §2
```

**Structure Decision**: no new Nest module. The neighborhood is graph reasoning built on tracing, so `NeighborhoodService` lives in `TracingModule` next to `TracingService`, which it calls directly. Web code goes in a new `pages/explorer/` folder and reuses `pages/entities/` components.

## Key Design Notes (for the implementer)

1. **Build order.** Do not start a step before the previous step's tests pass.
   1. **Shared**: `explorer.ts` + `explorer.spec.ts`; export `commaList`. Rebuild shared.
   2. **Traversal refactor (no behavior change)**: generic `types.ts`, `edge-groups.ts` (`groupEdgeRows` first), rewrite `buildTraversalEdges` on top of it, generic `selectCanonicalPaths`. **All existing traversal specs must pass unchanged** before going on.
   3. `buildUndirectedTraversalEdges` + spec; extend `traversal-property.spec.ts` with the `ALL` walk.
   4. **Repository**: `reachableEntities` option `probeBeyondDepth` (existing callers pass `true`), `traceNeighborhood`, `findRelationshipsAmong` (contracts/api.md §4). Repository e2e tests. The full existing e2e suite must still pass.
   5. **`compose-neighborhood.ts`** + spec (contracts/api.md §3).
   6. **`NeighborhoodService`**, `toGraphEdgeDto`, controller route, module wiring, service spec.
   7. **E2E**: `explorer.e2e-spec.ts`, `explorer-seed.e2e-spec.ts` (fixtures N1–N10, G1–G3).
   8. **Web pure modules**, each with tests, in this order: `explorer-params`, `layout`, `edge-style`, `emphasis`, `to-flow`, `describe-view`.
   9. **Web components**: add `@xyflow/react`, jsdom shims, `flow-types`, `explorer-actions`, `EntityNode`, `RelationshipEdge`, `GraphLegend`, `GraphCanvas`, `ExplorerSummary`, `ExplorerToolbar`, `ExplorerList`, `BlockerHighlightPanel`, `NodeDetailsPanel`, `EdgeDetailsPanel`, hooks, `ExplorerPage`, `ExplorerPickerPage`, router, Entity 360 link.
   10. **Performance**: `perf-explorer.e2e-spec.ts`, manual SC-004 check, timings in quickstart.md.
2. **Exactly one** new endpoint. Do not add `/expand`, `/subgraph` or any other route; do not change `/neighbors`, `/dependencies` or `/blockers`.
3. **Exactly one** React Flow node type (`'entity'`) and one edge type (`'relationship'`), with the data types in contracts/ui.md §3. Focus, connector, blocker and dimmed are **data flags**, not separate node types.
4. **No layout library.** Implement `layoutNeighborhood` exactly as contracts/ui.md §4. Do not add dagre, elkjs, d3-* or any force simulation. Nodes are not draggable.
5. **Determinism pitfalls**:
   - Sort with `compareCodeUnits` (from `graph/traversal/path-order.ts`), never `localeCompare`.
   - Expansions are traced **sequentially in request order**; do not reorder them.
   - `expand` keeps first-occurrence order (do not use `commaList`, which re-sorts).
   - Edge `key` must use the same rule as feature 003 hops (smallest relationship id of the group), so blocker hop keys match neighborhood edge keys.
   - `reasons` sorted by `NodeReasonSchema.options` order.
6. **Do not duplicate feature 003 logic** in the web app: blocker paths, summaries and explanations come from `response.blockers`; the side panel's *Blocked by* uses `useBlockers`; *Blocks* uses `/dependencies`.
7. **Graph and list from the same data**: both render from `response.nodes` / `response.edges`. Never filter one without the other. Dimming is not hiding.
8. **URL validation**: the explorer shows validation errors for bad URLs; it does **not** reuse feature 003's fallback-to-default `parseTracingParams`.
9. **Do not**:
   - add risk, impact or history controls, even disabled (FR-032);
   - persist explorer views or write any data;
   - use `useNodesState`/`useEdgesState` or let React Flow own node state;
   - define `nodeTypes`/`edgeTypes` inside a component;
   - render the graph without the list next to it (or below it on narrow screens).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Generic relationship-type parameter on `EdgeRow` / `TraversalEdge` / `InternalPath` / `selectCanonicalPaths` | The `all` walk must include RELATES_TO, which the current `TraceableRelationshipType`-only types exclude. The default type argument keeps every existing caller unchanged. | Duplicating canonical-path selection for `RelationshipType` would fork tested ranking code; casting RELATES_TO into `TraceableRelationshipType` would be a type lie. |
| Server-side view composition (expansions recomputed on the server) | Edges among all visible nodes and the 200-cap priority can only be correct with the whole visible set in hand. | Client-side merging of separate responses misses edges between expansion nodes and other visible nodes and duplicates cap logic in the browser (research R3). |
