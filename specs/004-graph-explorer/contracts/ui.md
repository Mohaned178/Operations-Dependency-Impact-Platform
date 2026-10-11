# UI Contract: Graph Explorer

This document fixes every React Flow type, the layout algorithm, the visual encoding and the component tree. **Do not substitute other node/edge types, layout libraries, colors or class names.** If something here is impossible, write the question in `specs/004-graph-explorer/questions.md` and stop.

## 1. Dependency and imports

- Add `"@xyflow/react": "^12.12.0"` to `apps/web/package.json` `dependencies`. Nothing else.
- Import the stylesheet **once**, in `GraphCanvas.tsx`: `import '@xyflow/react/dist/style.css';`
- Import from `@xyflow/react` only: `ReactFlow`, `ReactFlowProvider`, `Background`, `BackgroundVariant`, `Controls`, `Handle`, `Position`, `BaseEdge`, `EdgeLabelRenderer`, `getBezierPath`, `MarkerType`, `useReactFlow`, and the types `Node`, `Edge`, `NodeProps`, `EdgeProps`, `NodeTypes`, `EdgeTypes`, `EdgeMarker`.
- Not used: `MiniMap`, `Panel`, `NodeToolbar`, `useNodesState`, `useEdgesState`, `applyNodeChanges`, any layout package (research R2).

## 2. Files (`apps/web/src/pages/explorer/`)

| File | Kind | Purpose |
|---|---|---|
| `explorer-params.ts` (+ `.test.ts`) | pure | parse/validate URL ↔ `ExplorerUrlParams`; write params with defaults omitted; build the API query string |
| `layout.ts` (+ test) | pure | §4 |
| `edge-style.ts` (+ test) | pure | §6 |
| `emphasis.ts` (+ test) | pure | §7 |
| `to-flow.ts` (+ test) | pure | §5: response + layout + emphasis + selection → React Flow nodes/edges |
| `describe-view.ts` (+ test) | pure | §10 header and omitted-count text |
| `flow-types.ts` | types | §3 |
| `explorer-actions.ts` | context | `ExplorerActionsContext` (§3) |
| `useNeighborhood.ts` | hook | research R11 |
| `useBlocks.ts` | hook | research R11 |
| `EntityNode.tsx` (+ test) | component | §8 |
| `RelationshipEdge.tsx` (+ test) | component | §6 |
| `GraphCanvas.tsx` | component | §9 |
| `GraphLegend.tsx` | component | §6 legend |
| `ExplorerToolbar.tsx` (+ test) | component | §11 |
| `ExplorerSummary.tsx` | component | §10 |
| `ExplorerList.tsx` (+ test) | component | §12 |
| `BlockerHighlightPanel.tsx` (+ test) | component | §13 |
| `NodeDetailsPanel.tsx` (+ test) | component | §14 |
| `EdgeDetailsPanel.tsx` (+ test) | component | §14 |
| `ExplorerPage.tsx` (+ test) | page | §15 |
| `ExplorerPickerPage.tsx` (+ test) | page | §16 |

Reuse from `apps/web/src/pages/entities/`: `StateBadge` (+ `stateLabel`), `OriginBadge`, `ExplanationSentence` (+ `linkTargets`), `HopEvidence`, `useBlockers`. Do not copy them.

## 3. React Flow types (`flow-types.ts`) — exact

```ts
import type { Edge, Node } from '@xyflow/react';
import type { GraphEdgeDto, NeighborhoodNodeDto } from '@opsgraph/shared';

export type Emphasis = 'normal' | 'highlighted' | 'dimmed';
export type BlockerRole = 'none' | 'direct' | 'deepest' | 'direct-and-deepest';

// `type`, not `interface`: React Flow 12 requires data to be assignable to Record<string, unknown>.
export type EntityNodeData = {
  entity: NeighborhoodNodeDto;
  isFocus: boolean;
  isConnector: boolean;        // reasons is exactly ['CONNECTOR']
  hasConflict: boolean;        // §8
  emphasis: Emphasis;
  blockerRole: BlockerRole;
  canExpand: boolean;          // !isFocus
};
export type EntityFlowNode = Node<EntityNodeData, 'entity'>;

export type RelationshipEdgeData = {
  edge: GraphEdgeDto;
  emphasis: Emphasis;
  /** 0 for the first edge between an unordered node pair (by key), 1 for the second, ... */
  parallelIndex: number;
};
export type RelationshipFlowEdge = Edge<RelationshipEdgeData, 'relationship'>;

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 76;
export const ROW_GAP = 100;      // vertical distance between node centers in a column
export const COLUMN_GAP = 360;   // horizontal distance between column centers
```

`explorer-actions.ts`:

```ts
export type ExplorerActions = { toggleExpand: (entityId: string) => void };
export const ExplorerActionsContext = createContext<ExplorerActions | null>(null);
export function useExplorerActions(): ExplorerActions; // throws if null
```

`GraphCanvas.tsx` declares, at **module level** (never inside a component, or React Flow re-mounts every node on each render):

```ts
const nodeTypes = { entity: EntityNode } satisfies NodeTypes;
const edgeTypes = { relationship: RelationshipEdge } satisfies EdgeTypes;
```

`EntityNode` and `RelationshipEdge` are wrapped in `memo`.

## 4. Layout (`layout.ts`) — exact algorithm

```ts
export interface LayoutResult {
  layer: Map<string, number>;                     // signed column index per node id
  center: Map<string, { x: number; y: number }>;  // node center in flow coordinates
}
export function stepBetween(edge: GraphEdgeDto, fromId: string): -1 | 0 | 1;
export function layoutNeighborhood(response: NeighborhoodResponse): LayoutResult;
```

`stepBetween(edge, fromId)`:
- `RELATES_TO` → `0`;
- `dependentId = DEPENDENCY_DIRECTION[edge.relationshipType] === 'FROM_DEPENDS_ON_TO' ? edge.fromEntityId : edge.toEntityId`;
- moving from the dependent to the depended-on (`fromId === dependentId`) → `-1` (upstream, left); otherwise `+1` (downstream, right).

`layoutNeighborhood(response)`:
1. `edgeByKey` from `response.edges`.
2. **Layers**, iterating `response.nodes` in order (parents always come first, contracts/api.md §3): focus → `0`; any other node → `layer(parentId) + stepBetween(edgeByKey.get(viaEdgeKey), parentId)`.
3. **Tree order**: children lists per `parentId`, in `response.nodes` order. Iterative depth-first pre-order from the focus; `treeIndex` = visit order (focus = 0).
4. **Columns**: group node ids by layer; sort each column by `treeIndex`.
5. **Positions** (centers): `x = layer * COLUMN_GAP`.
   - Column 0: focus at `y = 0`; the other column-0 nodes in order at `y = (i + 1) * ROW_GAP` (`i` = 0-based index among them).
   - Every other column with `n` nodes: `y = (i - (n - 1) / 2) * ROW_GAP`.
6. Pure and deterministic: same response → identical result (unit test: run twice, deep-equal; and N1-shaped fixture snapshot of layers).

## 5. Mapping to React Flow (`to-flow.ts`)

```ts
export function toFlow(input: {
  response: NeighborhoodResponse;
  layout: LayoutResult;
  emphasis: EmphasisResult;            // §7
  selection: Selection;                // data-model §4
}): { nodes: EntityFlowNode[]; edges: RelationshipFlowEdge[] };
```

Node (one per `response.nodes`, same order):

```ts
{
  id: entity.id,
  type: 'entity',
  position: { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 },
  width: NODE_WIDTH, height: NODE_HEIGHT,
  data: { ...EntityNodeData },
  selected: selection?.kind === 'node' && selection.id === entity.id,
  draggable: false, connectable: false, deletable: false, selectable: true,
  ariaLabel: `${entity.type} ${entity.displayName}, ${stateLabel(entity.currentState)}`,
}
```

Edge (one per `response.edges`, same order):

```ts
{
  id: edge.key,
  type: 'relationship',
  source: edge.fromEntityId, target: edge.toEntityId,     // as recorded, never inverted
  sourceHandle, targetHandle,                              // rule below
  data: { edge, emphasis, parallelIndex },
  selected: selection?.kind === 'edge' && selection.key === edge.key,
  markerEnd: edgeStyle(...).marker,                        // §6
  deletable: false, focusable: true, selectable: true,
  interactionWidth: 16,
  ariaLabel: `${fromName} ${edge.relationshipType} ${toName}, ${edge.effectiveOrigin} ${edge.effectiveConfidence}`,
}
```

Handle rule (`L = layout.layer`): `L(from) < L(to)` → `'out-right'` / `'in-left'`; `L(from) > L(to)` → `'out-left'` / `'in-right'`; equal → `'out-right'` / `'in-right'`.

`parallelIndex`: group edges by the unordered pair `{from, to}`; within a group, sort by `key` (code-unit order); index in that order.

## 6. Edge encoding (`edge-style.ts`, `RelationshipEdge.tsx`, `GraphLegend.tsx`)

```ts
export interface EdgeVisual {
  stroke: string; strokeWidth: number; strokeDasharray: string | undefined; opacity: number;
  marker: EdgeMarker | undefined; showLabel: boolean; label: string;
}
export function edgeStyle(edge: GraphEdgeDto, emphasis: Emphasis, selected: boolean): EdgeVisual;
```

| Property | Rule (first match wins where several apply) |
|---|---|
| `stroke` | selected `#2563eb` · highlighted `#dc2626` · RELATES_TO `#94a3b8` · otherwise `#64748b` |
| `strokeDasharray` | SOURCE `undefined` · INFERRED `'8 4'` · MANUAL `'2 4'` |
| `strokeWidth` | HIGH `2.5` · MEDIUM `1.75` · LOW `1`; plus `1` when selected or highlighted |
| `opacity` | dimmed `0.15` · LOW `0.7` · otherwise `1` |
| `marker` | RELATES_TO `undefined` · otherwise `{ type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke }` |
| `showLabel` | `selected` or `effectiveOrigin !== 'SOURCE'` |
| `label` | selected: `` `${relationshipType} · ${Origin} · ${confidence}` `` · otherwise `` `${Origin} · ${confidence}` `` where Origin is `Source` / `Inferred` / `Manual` |

`RelationshipEdge` (`memo`, `EdgeProps<RelationshipFlowEdge>`):
1. `[path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.25 + 0.2 * data.parallelIndex })`.
2. `<BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={16} style={{ stroke, strokeWidth, strokeDasharray, opacity }} />`.
3. When `showLabel`: `<EdgeLabelRenderer><div className="nodrag nopan absolute rounded border border-slate-300 bg-white px-1 text-[10px] leading-4 text-slate-700" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all', opacity }}>{label}</div></EdgeLabelRenderer>`.

`GraphLegend` (absolute, bottom-left of the canvas, `text-xs`): a 40×10 SVG sample line per row using `edgeStyle` output: "Source (solid)", "Inferred (dashed)", "Manual (dotted)", "High / Medium / Low confidence (thicker → thinner)", "Relates to (grey, no arrow)", "Blocking path (red)", and node samples "Focus", "Connector", "Conflict", "State unknown", "Direct blocker", "Deepest blocker".

## 7. Emphasis (`emphasis.ts`)

```ts
export interface EmphasisResult {
  nodes: Map<string, Emphasis>; edges: Map<string, Emphasis>; blockerRole: Map<string, BlockerRole>;
}
export function computeEmphasis(input: {
  response: NeighborhoodResponse; selection: Selection; focusMode: boolean; selectedPathIndex: number | null;
}): EmphasisResult;
```

1. Everything `'normal'`; every `blockerRole` `'none'`.
2. If `response.blockers` has ≥ 1 path:
   - `paths = selectedPathIndex === null ? all paths : [paths[selectedPathIndex]]`;
   - nodes on those paths (hop entities) → `'highlighted'`; the focus stays `'normal'`; every other node → `'dimmed'`;
   - edges whose key is a hop key of those paths → `'highlighted'`; every other edge → `'dimmed'`;
   - `blockerRole` from `directBlockers` and `deepestBlockers` (all paths, regardless of `selectedPathIndex`).
3. If `focusMode` and `selection?.kind === 'node'`: `keepEdges` = edges with the selected node at either end; `keepNodes` = selected node + other ends of `keepEdges`. Nodes/edges outside the keep sets → `'dimmed'`; nodes/edges inside currently `'dimmed'` → `'normal'` (highlighted stays highlighted).

## 8. `EntityNode.tsx`

`memo(function EntityNode({ data, selected }: NodeProps<EntityFlowNode>))`. Markup, top to bottom:

```tsx
<div className={cls}>  {/* cls from the table below */}
  <Handle type="target" position={Position.Left}  id="in-left"   isConnectable={false} className={HANDLE} />
  <Handle type="source" position={Position.Left}  id="out-left"  isConnectable={false} className={HANDLE} />
  <Handle type="target" position={Position.Right} id="in-right"  isConnectable={false} className={HANDLE} />
  <Handle type="source" position={Position.Right} id="out-right" isConnectable={false} className={HANDLE} />
  <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500">{entity.type}{isFocus ? ' · Focus' : ''}</p>
  <p className="truncate text-sm font-medium text-slate-900">{entity.displayName}</p>
  <div className="mt-1 flex items-center gap-1 overflow-hidden">
    <StateBadge state={entity.currentState} />
    {chips}
  </div>
  {canExpand ? <button type="button" className="nodrag nopan absolute bottom-1 right-1 h-5 w-5 rounded border border-slate-300 bg-white text-xs leading-none" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entity.displayName}`} onClick={(e) => { e.stopPropagation(); toggleExpand(entity.id); }}>{expanded ? '−' : '+'}</button> : null}
</div>
```

`HANDLE = '!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent'`.

`cls` = `'relative h-[76px] w-[240px] rounded-md border bg-white px-3 py-2 text-left shadow-sm'` plus, in order:

| Condition | Add |
|---|---|
| `isFocus` | `border-2 border-blue-600 ring-4 ring-blue-100` |
| `selected && !isFocus` | `ring-2 ring-blue-500` |
| `selected && isFocus` | replace `ring-blue-100` with `ring-blue-300` |
| `isConnector` | `border-dashed bg-slate-50 opacity-70` |
| `emphasis === 'highlighted'` | `border-2 border-red-600` |
| `emphasis === 'dimmed'` | `opacity-20` (overrides connector opacity) |
| otherwise | `border-slate-300` |

Chips (`text-[10px] rounded px-1`), in this order, each only when its condition holds:
1. `hasConflict` → `Conflict` (`bg-amber-100 text-amber-800`, `title="Sources disagree on this entity's state"`). `hasConflict = new Set(entity.state.latestBySource.map((o) => o.state)).size > 1`.
2. `currentState === 'UNKNOWN'` → `State unknown` (`border border-slate-400 text-slate-600`).
3. `blockerRole` direct / direct-and-deepest → `Direct blocker` (`border border-red-600 text-red-700`).
4. `blockerRole` deepest / direct-and-deepest → `Deepest blocker` (`bg-red-600 text-white`).
5. `isConnector` → `Connector` (`bg-slate-200 text-slate-700`).

## 9. `GraphCanvas.tsx`

Props: `{ nodes, edges, onSelectNode(id), onSelectEdge(key), onClearSelection(), centerOn: { id: string; nonce: number } | null, centers: LayoutResult['center'] }`. Rendered inside `<ReactFlowProvider>` by `ExplorerPage`.

```tsx
<div className="relative h-full min-h-[480px] w-full" data-testid="graph-canvas">
  <ReactFlow
    nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    onNodeClick={(_, n) => onSelectNode(n.id)}
    onEdgeClick={(_, e) => onSelectEdge(e.id)}
    onPaneClick={onClearSelection}
    nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
    elementsSelectable nodesFocusable edgesFocusable
    deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
    onlyRenderVisibleElements
    fitView fitViewOptions={{ padding: 0.15 }}
    minZoom={0.1} maxZoom={2}
  >
    <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
    <Controls showInteractive={false} />   {/* zoom in/out + "fit view" = reset view (FR-014) */}
  </ReactFlow>
  <GraphLegend />
</div>
```

- Nodes/edges are fully controlled from props; no `onNodesChange`/`onEdgesChange`.
- `centerOn` effect: when it changes and `centers.get(id)` exists, `setCenter(c.x, c.y, { zoom: getZoom(), duration: 200 })` via `useReactFlow()`. Used only when selection comes from the list.
- `fitView` runs on mount only. `ExplorerPage` remounts the canvas when focus or settings change (§15), so refit happens then and **not** on expand/collapse.

## 10. Header text (`describe-view.ts`, `ExplorerSummary.tsx`)

```ts
export function describeView(r: NeighborhoodResponse, settings: ExplorerUrlParams): { title: string; filters: string | null; omitted: string | null; empty: string | null };
```

- `title`: `` `${focusName} — ${dirLabel}, ${depth} ${depth === 1 ? 'step' : 'steps'}: ${n} ${n === 1 ? 'entity' : 'entities'}, ${m} ${m === 1 ? 'relationship' : 'relationships'}` `` with `dirLabel` = `all directions` / `upstream only` / `downstream only`.
- `filters`: `null` when both URL lists are empty; else parts joined by ` · `: `` `Entity types: ${types.join(', ')}` ``, `` `Relationship types: ${rels.join(', ')}` `` (from `settings`, not the resolved query).
- `omitted` (FR-013): `null` when `omitted === 0`; lower bound → `` `Showing ${n} of more than ${n + omitted} entities — refine filters, reduce the step limit, or choose a direction.` ``; else `` `Showing ${n} of ${n + omitted} entities — ${omitted} more. Refine filters, reduce the step limit, or choose a direction.` ``
- `empty`: when `n === 1`: `` `${focusName} has no relationships matching the current settings.` `` plus `' Try removing filters.'` when `filters !== null`.
- `ExplorerSummary` renders `title` as `<h1 class="text-lg font-semibold">`, then `filters`, then `Loaded ${formatTimestamp(computedAt)}` with a `Refresh` button (refetch), then `omitted` in `role="status"` amber box, then `empty`.

## 11. `ExplorerToolbar.tsx`

All controls write the URL through `writeExplorerParams(current, partial)` with `setSearchParams(next, { replace: true })`. Defaults are omitted from the URL (`direction=all`, `depth=2`, empty lists, `blockers=false`).

| Control | Element | Notes |
|---|---|---|
| Direction | `role="radiogroup"` of 3 `<button role="radio" aria-checked>`: All directions / Upstream only / Downstream only | switching to upstream/downstream removes `RELATES_TO` from `relationshipTypes` |
| Steps | `<label>Steps <select>` options 1–4 | |
| Entity types | `<details>` with `<summary>Entity types (k)</summary>` and 12 checkboxes in `EntityTypeSchema.options` order + `Clear` button | empty = all |
| Relationship types | same pattern; options = all 12 for `all`, `TRACEABLE_RELATIONSHIP_TYPES` otherwise | empty = all |
| Highlight blockers | `<label><input type="checkbox">Highlight blockers</label>` | writes `blockers=true` or removes it |

## 12. `ExplorerList.tsx` (FR-018, FR-026)

Props: `{ response, selection, emphasis, onSelectNode(id, from: 'list'), onSelectEdge(key, from: 'list'), onToggleExpand(id), onToggleFocusMode(), focusMode, onExploreFrom(id) }`.

- `<section aria-label="Entities and relationships">`, scrollable (`overflow-y-auto`).
- **Entities**, grouped, in `response.nodes` order within each group: `Focus`; `1 step`, `2 steps`, … (by `distance`); `Added by blocking path` (`distance === null` and reasons include `BLOCKING_PATH`); `Added by expansion` (other `distance === null`). Group header `<h3>` with count.
- Each entity row is a `<li>` with a full-width `<button>` (Tab-reachable, `aria-pressed` = selected) showing: type, display name, `StateBadge`, the same chips as §8, and reasons as plain text (`Neighborhood`, `Connector`, `Expansion`, `Blocking path`). Dimmed rows get `opacity-50`.
- Under the **selected** row only: `Expand`/`Collapse` (not for focus), `Focus mode on/off`, `Explore from here` (not for focus), `Open Entity 360` (`<Link to={`/entities/${id}`}>`).
- **Relationships**: one `<button>` per edge: `` `${fromName} ${relationshipType} ${toName}` `` + `<OriginBadge>`; order: by index of `from` in `response.nodes`, then `relationshipType`, then index of `to`.
- Every node and edge in the canvas appears exactly once here (unit test: ids in list = ids in `toFlow` output).

## 13. `BlockerHighlightPanel.tsx` (FR-021, FR-022)

Shown above `ExplorerList` when `response.blockers !== null`.
- The `summary` string.
- `Show all paths` button (sets `selectedPathIndex = null`), then one `<li>` per path: `Path ${i + 1}` button (`aria-pressed`), then each explanation sentence through `<ExplanationSentence sentence targets={linkTargets(blockers.start, path)} />`, then labels exactly as in Entity 360's `BlockersSection`: non-SOURCE hops, `Possible blocker (state unknown)`, `Part of a dependency cycle`, `Deepest blocker found within depth N`, truncation.
- When `paths.length === 0`, only the summary (it already names the searched depth).

## 14. Side panels (FR-023, FR-024, FR-025)

Rendered as `<aside className="absolute right-0 top-0 z-10 h-full w-[360px] overflow-y-auto border-l bg-white p-4 shadow-lg">` inside the canvas container, with a `Close` button (clears selection).

`NodeDetailsPanel({ node, onExploreFrom })` sections, in order:
1. Type, display name, identifier (`node.id`).
2. **State**: `StateBadge`; `Reported by ${observation.sourceSystem} · ${formatTimestamp(observation.observedAt)}`; when sources disagree, a list of every `latestBySource` entry (source, state, time).
3. **Blocked by**: `useBlockers(node.id)` → `directBlockers`, each linked entity name + `StateBadge` + `Possible blocker` label when `possible`. None → `No blockers found within ${query.depth} steps.`
4. **Blocks**: if `node.state.classification === 'SATISFIED'` → `${state} — not blocking anything.`; else `useBlocks(node.id)` → each item: linked entity name, `StateBadge`, `OriginBadge` of `item.path.hops[0]`. None → `Nothing depends on it through REQUIRES, DEPENDS_ON or BLOCKS.`
5. **Evidence**: `GET /entities/:id/source-records?limit=10` (key `['entities', id, 'source-records', 'first10']`): source system, source id, observed time; then `See all on Entity 360`.
6. Actions: `Open Entity 360` link, `Explore from here` button (hidden for focus).

`EdgeDetailsPanel({ edge, nodesById })`: recorded sentence `` `${fromName} ${relationshipType} ${toName}` `` (both names linked), `OriginBadge` of the effective values, then each assertion: origin, confidence, basis (when present), source system, source id, observed time, import id.

Links in panels and the list go to `/entities/:id` (Entity 360); a secondary `Explore` link goes to `/graph/:id?<current settings>`.

## 15. `ExplorerPage.tsx` and routing

Routes (in `router.tsx`, replacing the `graph` `ComingSoonPage` entry):

```ts
{ path: 'graph', element: <ExplorerPickerPage /> },
{ path: 'graph/:id', element: <ExplorerPage /> },
```

`ExplorerPage`:
1. Reads `:id`; validates `searchParams` with `parseExplorerParams` (`ExplorerUrlParamsSchema.safeParse` over `{ direction, depth, relationshipTypes, entityTypes, blockers }` taken from the URL, absent → `undefined`). On failure: `<div role="alert">` listing each issue as `` `${path}: ${message}` `` and a `Reset settings` link to `/graph/:id`. Never fixes values silently.
2. Renders `<ExplorerView key={`${id}?${canonicalSearch}`} … />` so expansions, selection, focus mode and path selection reset when focus or settings change (data-model §4). `canonicalSearch` = `writeExplorerParams(new URLSearchParams(), params).toString()`.
3. `ExplorerView` layout (≥ 1024 px): `<div className="grid h-[calc(100vh-8rem)] grid-cols-[1fr_380px] gap-4">`: left = `ExplorerSummary` + `ExplorerToolbar` + canvas container (canvas, side panel overlay); right = `BlockerHighlightPanel` + `ExplorerList`. Below 1024 px: single column, list under the canvas. The list is never hidden (FR-026).
4. Data: `useNeighborhood(id, params, expand)`; while pending the first time: `Loading…`; 404 → `Entity not found.` + link to `/entities`; other errors → `role="alert"` message. With `keepPreviousData`, an expand/collapse refetch keeps the old graph and shows a small `Updating…` text.
5. `layout = useMemo(layoutNeighborhood)`, `emphasis = useMemo(computeEmphasis)`, `flow = useMemo(toFlow)`.
6. `ignoredExpansions` non-empty → remove them from `expand` state.
7. Selection that is not in the current response → treated as `null`.
8. **Explore from here** = `navigate(`/graph/${id}?${canonicalSearch}`)` (push; browser back returns, FR-003).
9. `ExplorerActionsContext.Provider value={{ toggleExpand }}` wraps the canvas; `toggleExpand(id)` appends `id` to `expand` or removes it.

`EntityDetailPage` header gains `<Link to={`/graph/${entity.id}`}>Open in Graph Explorer</Link>` after `BlockerCallout`.

## 16. `ExplorerPickerPage.tsx`

`<h1>Graph Explorer</h1>`, the sentence `Choose an entity to explore its neighborhood. The explorer never shows the whole graph.`, a search input (debounced 300 ms, min 1 char) using `GET /api/entities?q=<text>&limit=20` with `EntityListResponseSchema`, and results as links to `/graph/:id` showing type, name and `StateBadge`. No graph is rendered on this page.

## 17. jsdom shims (`apps/web/src/test-setup.ts`, append)

```ts
class ResizeObserverStub {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void { this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver); }
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}
globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { get() { return Number.parseFloat((this as HTMLElement).style.height) || 1; } },
  offsetWidth: { get() { return Number.parseFloat((this as HTMLElement).style.width) || 1; } },
});
(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
```

Component tests that render React Flow wrap in `<ReactFlowProvider>` and give the container a fixed size (`style={{ width: 800, height: 600 }}`).
