# API Contract: Graph Explorer

Conventions are inherited from features 001–003: base path `/api`, `Authorization: Bearer` on every route, no role restrictions (every signed-in role passes), the `ErrorResponseSchema` envelope, `x-request-id`, `mustChangePassword` gating, UTC ISO-8601 timestamps.

**Schemas**: `packages/shared/src/explorer.ts` (data-model.md §1). Every response is parsed with `NeighborhoodResponseSchema` in the e2e tests and in the web app's `apiFetch`.

No new error codes.

---

## 1. Routes

| Method | Path | Roles | Success | Errors |
|---|---|---|---|---|
| GET | `/api/entities/:id/neighborhood` | all signed-in | 200 `NeighborhoodResponse` | 400 `VALIDATION_FAILED`, 401, 404 `NOT_FOUND` |

Served by the existing `TracingController` (`@Controller('entities')`):

```ts
@Get(':id/neighborhood')
neighborhood(
  @Param('id', ParseUUIDPipe) id: string,
  @Query(new ZodValidationPipe(NeighborhoodQuerySchema)) query: NeighborhoodQuery,
): Promise<NeighborhoodResponse> {
  return this.neighborhood.neighborhood(id, query);
}
```

`NeighborhoodService` is a new provider in `TracingModule`. The route writes no data and no audit entries.

Reused unchanged by the web app (no server change): `GET /api/entities/:id`, `GET /api/entities/:id/blockers`, `GET /api/entities/:id/dependencies`, `GET /api/entities/:id/source-records`, `GET /api/entities?q=` (picker).

### Query parameters

| Param | Format | Default |
|---|---|---|
| `direction` | `all` \| `upstream` \| `downstream` | `all` |
| `depth` | integer 1..4 | `2` |
| `relationshipTypes` | comma list of `RelationshipType` | all types allowed by `direction` |
| `entityTypes` | comma list of `EntityType` | none (all types match) |
| `expand` | comma list of entity UUIDs, ≤ 50 after de-duplication, never the focus | none |
| `blockers` | `true` \| `false` | `false` |

---

## 2. `NeighborhoodService.neighborhood(id, query)`: exact steps

1. `computedAt = new Date().toISOString()`.
2. If `query.expand.includes(id)`, throw `Errors.validation([{ path: 'expand', message: 'expand must not include the focus entity' }])`.
3. `walk = { all: 'ALL', upstream: 'UPSTREAM', downstream: 'DOWNSTREAM' }[query.direction]`.
   `types = query.relationshipTypes.length > 0 ? query.relationshipTypes : (walk === 'ALL' ? RelationshipTypeSchema.options : TRACEABLE_RELATIONSHIP_TYPES)`.
4. `base = await graph.traceNeighborhood({ startId: id, walk, maxDepth: query.depth, relationshipTypes: types })`. `null` → `Errors.notFound('Entity')`.
5. `blockers = query.blockers ? await tracing.blockers(id, { depth: TRACING_LIMITS.defaultDepth, relationshipTypes: [], entityTypes: [] }) : null`.
6. For each id in `query.expand`, **in order, sequentially** (`for … of` + `await`): `trace = await graph.traceNeighborhood({ startId: expandedId, walk, maxDepth: 1, relationshipTypes: types })`.
7. `composed = composeNeighborhood({ focus: base.start, base, entityTypes: query.entityTypes, blockerPaths, expansions, maxVisible: EXPLORER_LIMITS.maxVisibleNodes })` where `blockerPaths = blockers?.paths.map((p) => ({ entityIds: p.hops.map((h) => h.entity.id), edgeKeys: p.hops.map((h) => h.key) })) ?? []`. Entity refs for blocker-only nodes: build a `Map<string, GraphEntityRef>` from every hop's `entity` and pass it in (add a `blockerEntities: ReadonlyMap<string, GraphEntityRef>` field to `ComposeInput`).
8. `visibleIds = composed.visible.map((n) => n.entity.id)`.
   `edgeTypes = RelationshipTypeSchema.options.filter((t) => types.includes(t) || (blockers !== null && BLOCKER_RELATIONSHIP_TYPES.includes(t)))`.
   `groups = await graph.findRelationshipsAmong(visibleIds, edgeTypes)`.
   Keep `g` iff `types.includes(g.type) || composed.blockerEdgeKeys.has(g.key)`.
9. `evidence = await evidenceReader.load(visibleIds)`; each node → `{ ...toTracedEntityDto(n.entity, evidenceFor(evidence, n.entity.id)), distance, reasons, parentId, viaEdgeKey, expanded }`.
10. **Invariant**: every non-focus node's `viaEdgeKey` is the key of a kept edge whose ends are `{parentId, node id}`. Otherwise throw `new Error('explorer invariant: …')` (500). Unit-test that it never fires on the fixtures.
11. Return:
    ```ts
    {
      query: { entityId: id, direction: query.direction, depth: query.depth, relationshipTypes: types,
               entityTypes: query.entityTypes, expand: query.expand, blockers: query.blockers },
      computedAt, focusId: id, nodes, edges /* sorted by key, compareCodeUnits */,
      totals: { visible: nodes.length, omitted: composed.omitted, omittedIsLowerBound: composed.omittedIsLowerBound },
      ignoredExpansions: composed.ignoredExpansions,
      blockers,
    }
    ```

Edge DTO mapping (`toGraphEdgeDto` in `tracing.mapper.ts`): copy fields; `assertions[].observedAt` → ISO string.

---

## 3. `composeNeighborhood(input)`: exact algorithm

`basePriority(a, b)` for `NeighborhoodReached`:
`a.distance - b.distance || CONFIDENCE_RANK[b.weakestConfidence] - CONFIDENCE_RANK[a.weakestConfidence] || a.nonSourceHops - b.nonSourceHops || compareCodeUnits(a.entity.type, b.entity.type) || compareCodeUnits(a.entity.displayName, b.entity.displayName) || compareCodeUnits(a.entity.id, b.entity.id)`.

`matches(e) = entityTypes.length === 0 || entityTypes.includes(e.type)`.

Keep an insertion-ordered `Map<string, ComposedNode>` called `list`. `add(entity, reason, parentId, viaEdgeKey)`:
- if `entity.id` is already in `list`: add `reason` to its reasons (no duplicates); change nothing else;
- else append `{ entity, reasons: [reason], parentId, viaEdgeKey, distance: entity.id === focus.id ? 0 : baseById.get(entity.id)?.distance ?? null, expanded: false }`.

Steps:
1. `add(focus, 'FOCUS', null, null)`.
2. For each blocker path in rank order, for `i` in hop order: `add(blockerEntities.get(entityIds[i]), 'BLOCKING_PATH', i === 0 ? focus.id : entityIds[i - 1], edgeKeys[i])`.
3. `sortedBase = [...base.reached].sort(basePriority)`. For each `r` in `sortedBase` with `matches(r.entity)`:
   - for `k = 1 .. r.pathEntityIds.length - 2` (the path's intermediate entities, in path order): `p = baseById.get(r.pathEntityIds[k])`; `add(p.entity, matches(p.entity) ? 'NEIGHBORHOOD' : 'CONNECTOR', r.pathEntityIds[k - 1], r.pathEdgeKeys[k - 1])`;
   - then `add(r.entity, 'NEIGHBORHOOD', r.pathEntityIds.at(-2), r.pathEdgeKeys.at(-1))`.
4. For each expansion in request order:
   - **ignored** (push to `ignoredExpansions`) if `trace === null`, or `expandedId` is not among the first `maxVisible` entries of `list` at this moment;
   - otherwise **applied** (push to `appliedExpansions`): for each `r` in `[...trace.reached].sort(basePriority)` with `matches(r.entity)` and `r.entity.id !== focus.id`: `add(r.entity, 'EXPANSION', expandedId, r.pathEdgeKeys[0])`.
5. `visible = first maxVisible entries of list`; set `expanded = appliedExpansions.includes(id)` on each; sort each node's `reasons` by `NodeReasonSchema.options` order.
6. `omitted = list.size - visible.length`. `omittedIsLowerBound = base.explorationLimitReached || applied expansions' traces.some((t) => t.explorationLimitReached)`.
7. `blockerEdgeKeys = new Set(all blockerPaths' edgeKeys)`.

**Property (unit-tested)**: for every visible non-focus node, its `parentId` appears earlier in `visible`.

---

## 4. Repository: `traceNeighborhood` and `findRelationshipsAmong`

`traceNeighborhood(q)`:
1. `{ followFromTypes, followToTypes } = q.walk === 'ALL' ? { followFromTypes: q.relationshipTypes, followToTypes: q.relationshipTypes } : walkTypes(q.walk, q.relationshipTypes as TraceableRelationshipType[])`. (The cast is safe: the service never passes RELATES_TO for UPSTREAM/DOWNSTREAM; assert it and throw otherwise.)
2. `reachable = reachableEntities({ startId, maxDepth, followFromTypes, followToTypes, blockersOnly: false, probeBeyondDepth: false })`; `null` → return `null`.
3. `rows = loadEdgeRows(reachable.entities.keys(), [...new Set([...followFromTypes, ...followToTypes])])`.
4. `edges = q.walk === 'ALL' ? buildUndirectedTraversalEdges(groupEdgeRows(rows)) : buildTraversalEdges(rows, q.walk)`.
5. `{ paths } = selectCanonicalPaths(start.id, edges, q.maxDepth)`; ignore `cycleClosing`.
6. For each `row` in `reachable.within` (already sorted, capped): `path = paths.get(row.entity.id)` (missing → invariant error) → `{ entity, distance: row.depth, pathEntityIds: path.entityIds, pathEdgeKeys: path.edges.map((e) => e.key), weakestConfidence: path.weakestConfidence, nonSourceHops: path.nonSourceHops }`.
7. Return `{ start, reached, explorationLimitReached }`.

`reachableEntities` change: new option `probeBeyondDepth: boolean`. SQL bound is `${options.probeBeyondDepth ? maxDepth + 1 : maxDepth}`; `traceDependencies`/`traceBlockers` pass `true` (unchanged behavior). Param types widen to `readonly RelationshipType[]`.

`findRelationshipsAmong(ids, types)`: if `ids.length === 0 || types.length === 0` return `[]` without querying; else `groupEdgeRows(await this.loadEdgeRows(ids, types))` mapped to `RelationshipGroup`.

---

## 5. Acceptance fixtures (seeded §39 scenario)

Entity names are display names from `specs/002-operational-graph-model/seed-scenario.md`. "Affected orders" = Order #18492 and Orders #18493–#18496, #18501–#18505, #18511–#18514, #18521–#18523. "The 16 orders" = the affected orders except #18492. "SLAs" = the 4 delivery SLAs.

### N1. Order #18492, defaults (`all`, depth 2)
- 32 nodes: distance 0: 1 · distance 1: 7 · distance 2: 24.
- Distance 1: Acme Corp, Contract CON-3982, Industrial Pallet Racking Kit, Invoice INV-55120, Payment PAY-88213, Shipment SHP-77120 (consolidated), East Distribution Center 02.
- Distance 2: the 16 orders, the 4 SLAs, Budget code for Order #18492, Finance approval APR-2291, Northwind Steel, Contoso Metals.
- 60 edges. `omitted` 0. Every node's reasons: focus `['FOCUS']`, others `['NEIGHBORHOOD']`. `blockers` null.
- The edge `Product PRD-5521 SUPPLIED_BY Contoso Metals` has `effectiveOrigin` INFERRED, `effectiveConfidence` LOW. The edge `PAY-88213 BLOCKS SHP-77120` is MANUAL / MEDIUM.
- Order #18492 node: `state.latestBySource` has OMS BLOCKED and ERP PENDING.

### N2. Order #18492, `blockers=true`
- Same 32 nodes and 60 edges as N1.
- `nodes[1..3]` = Payment PAY-88213, Finance approval APR-2291, Budget code for Order #18492, each with reasons `['BLOCKING_PATH', 'NEIGHBORHOOD']`.
- Budget code: `distance` 2, `parentId` = APR-2291, `viaEdgeKey` = key of `APR-2291 REQUIRES BR-18492`.
- `blockers` deep-equals `GET /entities/<18492>/blockers` except `computedAt`.

### N3. Shipment SHP-77120, defaults
- 35 nodes: distance 1: 23 (Order #18492, the 16 orders, East Distribution Center 02, the 4 SLAs, Payment PAY-88213) · distance 2: 11 (the 4 customers, the 4 contracts, Industrial Pallet Racking Kit, Invoice INV-55120, Finance approval APR-2291).
- 86 edges.

### N4. Shipment SHP-77120, `blockers=true`
- 36 nodes: N3's plus Budget code for Order #18492 with reasons `['BLOCKING_PATH']`, `distance` null, `parentId` APR-2291.
- `nodes[1..4]` = Order #18492, Payment PAY-88213, Finance approval APR-2291, Budget code for Order #18492 (the first-ranked path).
- 88 edges (N3's plus `APR-2291 REQUIRES BR-18492` and `CON-3982 DEFINES BR-18492`).
- `blockers.paths.length` 2, identical to `GET /blockers` for the shipment.

### N5. Budget code, `direction=downstream&depth=4`
- 26 nodes: distances 0:1, 1:1, 2:1, 3:2, 4:21. The non-focus set equals `GET /dependencies?direction=downstream&depth=4` reached set, with equal distances.

### N6. Budget code, `direction=downstream&depth=4&entityTypes=Order,Shipment`
- 21 nodes, in this exact order: Budget code (FOCUS), Finance approval APR-2291 (CONNECTOR), Payment PAY-88213 (CONNECTOR), Order #18492, Shipment SHP-77120 (consolidated), then the 16 orders sorted by display name.
- Shipment's `parentId` is Order #18492 (canonical path is the 4-hop all-SOURCE path, not the MANUAL BLOCKS hop). Each of the 16 orders has `parentId` = the shipment.
- 21 edges.

### N7. Order #18492, `direction=upstream` (depth 2)
- 9 nodes: Acme Corp, Contract CON-3982, Payment PAY-88213, East Distribution Center 02, Industrial Pallet Racking Kit (distance 1); Finance approval APR-2291, Northwind Steel, Contoso Metals (distance 2). Equals `GET /dependencies?direction=upstream&depth=2`.
- 9 edges.

### N8. Expansion
- Order #18492, `direction=upstream&depth=1` → 6 nodes.
- Same with `expand=<PRD-5521>,<PAY-88213>` → 9 nodes, ending with Northwind Steel, Contoso Metals (reasons `['EXPANSION']`, parent PRD-5521), then Finance approval APR-2291 (parent PAY-88213). Both expanded nodes have `expanded: true`.
- With `expand=<random uuid>` → 6 nodes, `ignoredExpansions` = that uuid.
- With `expand=<18492's own id>` → 400, detail path `expand`.

### N9. Relationship-type filter
- Order #18492, `depth=1&relationshipTypes=REQUIRES` → 2 nodes (order, payment), 1 edge.

### N10. Validation
- `direction=upstream&relationshipTypes=RELATES_TO` → 400, path `relationshipTypes`.
- `depth=0`, `depth=5`, `depth=2.5` → 400, path `depth`.
- `entityTypes=Foo` → 400. `blockers=yes` → 400. 51 distinct uuids in `expand` → 400.
- Unknown entity id → 404. No token → 401.

### Generated-data fixtures (e2e, inserted by the test)
- **G1 cap**: one hub with 500 neighbors (any relationship type) → `all&depth=1` from the hub: 200 nodes, `omitted` 301, `omittedIsLowerBound` false.
- **G2 cycle**: A REQUIRES B, B REQUIRES A, both PENDING → `all&depth=4` from A: 2 nodes, 2 edges; terminates.
- **G3 multi-assertion**: the same (type, from, to) asserted by SOURCE/LOW and INFERRED/HIGH → one edge, `effectiveOrigin` SOURCE, `effectiveConfidence` LOW, 2 assertions.

---

## 6. Test inventory

| File | Covers |
|---|---|
| `packages/shared/src/explorer.spec.ts` | every row of the validation table (data-model §1), defaults, `expand` order and de-duplication |
| `apps/api/src/graph/traversal/edge-groups.spec.ts` | grouping, key rule, effective origin/confidence, undirected edges FORWARD+REVERSE |
| `apps/api/src/graph/traversal/traversal-property.spec.ts` (extend) | 1,000 generated graphs, `ALL` walk: terminates, no repeated entity, every reached entity has a path, distance = undirected BFS distance from an independent oracle |
| `apps/api/src/tracing/compose-neighborhood.spec.ts` | each step of §3, the parent-earlier property, connectors, cap and omitted count, lower bound, ignored expansions, reasons order |
| `apps/api/test/graph-repository.e2e-spec.ts` (extend) | `traceNeighborhood` for each walk; `findRelationshipsAmong` |
| `apps/api/test/explorer.e2e-spec.ts` (new) | 200 / 401 / 400 / 404, G1–G3 |
| `apps/api/test/explorer-seed.e2e-spec.ts` (new) | N1–N10; 100 repeated N4 calls identical except `computedAt` (and `blockers.computedAt`) |
| `apps/api/test/perf-explorer.e2e-spec.ts` (new, `RUN_PERF=1`) | p95 < 2 s for defaults on 20 entities of the 50k dataset incl. the highest-degree one; p95 < 1 s for one added expansion |
| `apps/api/test/authz-matrix.e2e-spec.ts` | add the route if the file lists tracing routes |
