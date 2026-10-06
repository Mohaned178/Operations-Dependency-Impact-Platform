# API Contract: Dependency Tracing & Entity 360

These conventions are inherited from features 001 and 002:
- base path `/api`;
- `Authorization: Bearer` on every route; there are no role restrictions, so every signed-in role passes;
- the error envelope `ErrorResponseSchema`;
- `x-request-id`;
- `mustChangePassword` gating;
- UTC ISO-8601 timestamps;
- opaque base64url cursors.

**Schemas**: every schema below MUST be exported from `@opsgraph/shared` (`packages/shared/src/tracing.ts`) together with its inferred type. Every response is parsed with its schema in the e2e tests and in the web app's `apiFetch`.

No new error codes are introduced.

---

## Routes

| Method | Path | Roles | Success | Errors |
|---|---|---|---|---|
| GET | `/api/entities/:id/dependencies` | all signed-in | 200 `DependenciesResponse` | 400 `VALIDATION_FAILED`, 401, 404 `NOT_FOUND` |
| GET | `/api/entities/:id/blockers` | all signed-in | 200 `BlockersResponse` | 400 `VALIDATION_FAILED`, 401, 404 `NOT_FOUND` |

Both routes are served by `TracingController` (`@Controller('entities')`) in `apps/api/src/tracing/`. Each handler:
1. validates `:id` with `ParseUUIDPipe` and the query with `ZodValidationPipe(<Schema>)`;
2. calls `TracingService`;
3. returns the DTO.

Neither route writes data or audit entries.

---

## Query schemas

```ts
/** "A,B,,A" → ["A","B"] in schema option order; undefined or "" → []. Each item validated against `item`. */
function commaList<T extends [string, ...string[]]>(item: z.ZodEnum<T>) {
  return z
    .string()
    .optional()
    .transform((raw) => (raw ?? '').split(',').map((v) => v.trim()).filter((v) => v !== ''))
    .pipe(z.array(item))
    .transform((values) => item.options.filter((option) => values.includes(option)));
}

export const TraceDepthSchema = z.coerce
  .number()
  .int()
  .min(TRACING_LIMITS.minDepth)
  .max(TRACING_LIMITS.maxDepth)
  .default(TRACING_LIMITS.defaultDepth);

export const TraceDirectionParamSchema = z.enum(['upstream', 'downstream']);

export const DependenciesQuerySchema = PageQuerySchema.extend({
  direction: TraceDirectionParamSchema,
  depth: TraceDepthSchema,
  relationshipTypes: commaList(TraceableRelationshipTypeSchema),
  entityTypes: commaList(EntityTypeSchema),
});
export type DependenciesQuery = z.infer<typeof DependenciesQuerySchema>;

export const BlockersQuerySchema = z.object({
  depth: TraceDepthSchema,
  relationshipTypes: commaList(BlockerRelationshipTypeSchema),
  entityTypes: commaList(EntityTypeSchema),
});
export type BlockersQuery = z.infer<typeof BlockersQuerySchema>;
```

- An empty `relationshipTypes` (`[]`) means "all allowed types for this query", and the service replaces it with `TRACEABLE_RELATIONSHIP_TYPES` or `BLOCKER_RELATIONSHIP_TYPES`.
- An empty `entityTypes` means "no entity-type filter".
- The echo in the response (`query`) shows the **effective** relationship types (never empty) and the entity types as given (possibly empty).
- A repeated query parameter (`?depth=1&depth=2`) arrives as an array. `z.string()` rejects it with 400. That is intended.

**Validation examples** (each one gets an e2e test):

| Request | Status | `details[0].path` |
|---|---|---|
| `/dependencies` (no direction) | 400 | `direction` |
| `/dependencies?direction=sideways` | 400 | `direction` |
| `/blockers?depth=0` | 400 | `depth` |
| `/blockers?depth=11` | 400 | `depth` |
| `/blockers?depth=2.5` | 400 | `depth` |
| `/blockers?depth=abc` | 400 | `depth` |
| `/dependencies?direction=upstream&relationshipTypes=REQUIRES,RELATES_TO` | 400 | `relationshipTypes.1` |
| `/blockers?relationshipTypes=FULFILLED_BY` | 400 | `relationshipTypes.0` |
| `/blockers?entityTypes=Order,Truck` | 400 | `entityTypes.1` |
| `/entities/not-a-uuid/blockers` | 400 | (existing ParseUUIDPipe behaviour) |
| `/entities/<missing uuid>/blockers` | 404 `NOT_FOUND` | — |

---

## Response schemas

```ts
export const EntityStateEvidenceDtoSchema = z.object({
  classification: StateClassificationSchema,
  observation: StateObservationDtoSchema.nullable(),   // latest by (observedAt, seq); null if none
  latestBySource: z.array(StateObservationDtoSchema),  // [] unless ≥2 sources disagree (data-model §3)
});

export const TracedEntityDtoSchema = EntityRefDtoSchema.extend({   // id, type, displayName, currentState
  state: EntityStateEvidenceDtoSchema,
});
export type TracedEntityDto = z.infer<typeof TracedEntityDtoSchema>;

export const HopAssertionDtoSchema = z.object({
  relationshipId: z.string().uuid(),
  origin: RelationshipOriginSchema,
  confidence: ConfidenceSchema,
  basis: z.string().nullable(),
  sourceSystem: z.string(),
  sourceId: z.string(),
  observedAt: z.string().datetime(),
  importId: z.string().uuid(),
});

export const HopDtoSchema = z.object({
  key: z.string().uuid(),
  relationshipType: TraceableRelationshipTypeSchema,
  fromEntityId: z.string().uuid(),             // as recorded
  toEntityId: z.string().uuid(),               // as recorded
  traversal: z.enum(['FORWARD', 'REVERSE']),   // FORWARD: this hop moves from → to
  effectiveOrigin: RelationshipOriginSchema,
  effectiveConfidence: ConfidenceSchema,
  assertions: z.array(HopAssertionDtoSchema).min(1),
  entity: TracedEntityDtoSchema,               // the entity this hop reaches
});
export type HopDto = z.infer<typeof HopDtoSchema>;

export const PathDtoSchema = z.object({
  hops: z.array(HopDtoSchema).min(1),
  length: z.number().int().min(1),
  weakestConfidence: ConfidenceSchema,
  nonSourceHops: z.number().int().min(0),
  continuesBeyondDepth: z.boolean(),
});
export type PathDto = z.infer<typeof PathDtoSchema>;

export const BlockingPathDtoSchema = PathDtoSchema.extend({
  endsInCycle: z.boolean(),
  explanation: z.array(z.string()).min(1),     // one sentence per hop
});
export type BlockingPathDto = z.infer<typeof BlockingPathDtoSchema>;

export const TraceQueryEchoSchema = z.object({
  entityId: z.string().uuid(),
  kind: z.enum(['upstream', 'downstream', 'blockers']),
  depth: z.number().int(),
  relationshipTypes: z.array(TraceableRelationshipTypeSchema).min(1),
  entityTypes: z.array(EntityTypeSchema),
});

export const TruncationDtoSchema = z.object({
  depthLimit: z.boolean(),
  explorationLimit: z.boolean(),
  pathLimit: z.boolean(),                      // always false for dependencies
});

export const CycleClosingHopDtoSchema = z.object({
  key: z.string().uuid(),
  relationshipType: TraceableRelationshipTypeSchema,
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  relationshipIds: z.array(z.string().uuid()).min(1),
});

export const DependencyItemDtoSchema = z.object({
  entity: TracedEntityDtoSchema,
  distance: z.number().int().min(1),
  path: PathDtoSchema,
});

export const DependenciesResponseSchema = z.object({
  query: TraceQueryEchoSchema,
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  truncation: TruncationDtoSchema,
  totalReached: z.number().int().min(0),       // after the entity-type filter
  items: z.array(DependencyItemDtoSchema),
  nextCursor: z.string().nullable(),
  cycleClosingHops: z.array(CycleClosingHopDtoSchema),
  cycleClosingHopCount: z.number().int().min(0),
});
export type DependenciesResponse = z.infer<typeof DependenciesResponseSchema>;

export const BlockerDtoSchema = z.object({
  entity: TracedEntityDtoSchema,
  pathLength: z.number().int().min(1),         // research R6
  possible: z.boolean(),                       // state UNKNOWN
  continuesBeyondDepth: z.boolean(),           // false for direct blockers
  inCycle: z.boolean(),                        // false for direct blockers
});

export const BlockersResponseSchema = z.object({
  query: TraceQueryEchoSchema,
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  truncation: TruncationDtoSchema,
  summary: z.string(),
  totalPaths: z.number().int().min(0),         // paths after the entity-type filter, before the top-100 cut
  paths: z.array(BlockingPathDtoSchema),       // ≤ 100, ranked
  directBlockers: z.array(BlockerDtoSchema),
  deepestBlockers: z.array(BlockerDtoSchema),
  cycleClosingHops: z.array(CycleClosingHopDtoSchema),
  cycleClosingHopCount: z.number().int().min(0),
});
export type BlockersResponse = z.infer<typeof BlockersResponseSchema>;
```

**Dependencies pagination**: `items` is one page of the reached entities, filtered by `entityTypes` and ordered by research R7. `nextCursor` is `null` on the last page. `start`, `truncation`, `totalReached` and the cycle fields are repeated on every page.

---

## Explanation text (research R9)

All functions live in `apps/api/src/tracing/explanation.ts` and are pure. Notation:
- `name(E)` = `E.displayName`;
- `STATE(E)` = `E.currentState`, exactly as the enum value (for example `PENDING`);
- `label(E)` = `E.currentState.toLowerCase().replaceAll('_', ' ')` (for example `at risk`);
- `conf(h)` = `h.effectiveConfidence.toLowerCase()`;
- `steps(n)` = `` `${n} step${n === 1 ? '' : 's'}` ``.

### One sentence per hop: `explainBlockingPath(start, path): string[]`

For hop `i`, `X` is the entity before the hop (`start` for `i = 0`, otherwise `hops[i-1].entity`), and `Y` is `hops[i].entity`.

**Subject clause `S(X, isStart)`**:

| Classification of X | Clause |
|---|---|
| UNSATISFIED | `` `${name(X)} is ${label(X)} because` `` |
| SATISFIED and `X.currentState === 'AT_RISK'` (start only) | `` `${name(X)} is at risk because` `` |
| SATISFIED, any other state (start only) | `` `${name(X)} is ${label(X)}, but` `` |
| INDETERMINATE | `` `${name(X)} has an unknown state, and` `` |

**Object clause `O(Y)`** (Y is never SATISFIED in a blocking path):

| Classification of Y | Clause |
|---|---|
| UNSATISFIED | `` `which is ${STATE(Y)}` `` |
| INDETERMINATE | `'whose state is unknown'` |

**Qualifier `Q(h)`**:
- empty when `h.effectiveOrigin === 'SOURCE'`;
- otherwise `` ` (${kind}, ${conf(h)} confidence${basis})` ``, where:
  - `kind` is `inferred` for INFERRED and `manually recorded` for MANUAL;
  - `basis` is `` `: "${b}"` `` with `b` = the `basis` of the first assertion whose `origin === h.effectiveOrigin` (assertions are already sorted), or empty when that basis is `null`.

**Sentence**:

| Hop | Template |
|---|---|
| FORWARD, REQUIRES | `` `${S} it requires ${name(Y)}${Q}, ${O}.` `` |
| FORWARD, DEPENDS_ON | `` `${S} it depends on ${name(Y)}${Q}, ${O}.` `` |
| REVERSE, BLOCKS | `` `${S} ${name(Y)}, ${O}, blocks it${Q}.` `` |
| anything else | throw `Error('explainBlockingPath: unsupported hop')` (unreachable) |

### Summary: `summarizeBlockers(start, deepestBlockers, depth): string`

```text
head  = `${name(start)} is ${STATE(start)}.`
k     = deepestBlockers.length
if k == 0: return `${head} No blockers found within ${steps(depth)}.`
b     = deepestBlockers[0]
s     = b.possible ? 'state unknown, possible blocker' : STATE(b.entity)
count = k == 1 ? '1 deepest blocker' : `${k} deepest blockers`
if b.continuesBeyondDepth:
  body = k == 1
    ? `${count} found within ${steps(depth)}: ${name(b.entity)} (${s}), ${steps(b.pathLength)} away; the chain continues beyond the depth limit.`
    : `${count} found within ${steps(depth)}; highest ranked: ${name(b.entity)} (${s}), ${steps(b.pathLength)} away; the chain continues beyond the depth limit.`
else:
  body = k == 1
    ? `${count}: ${name(b.entity)} (${s}), ${steps(b.pathLength)} away.`
    : `${count}; highest ranked: ${name(b.entity)} (${s}), ${steps(b.pathLength)} away.`
tail  = b.inCycle ? ' It is part of a dependency cycle.' : ''
return `${head} ${body}${tail}`
```

---

## Acceptance fixtures (seeded §39 scenario)

Entities are named by their seed key (`type / sourceSystem / sourceId`, see `specs/002-operational-graph-model/seed-scenario.md`) and display name. These are the exact expected results. `tracing-seed.e2e-spec.ts` asserts every line of this section.

**Key → display name**:
- `Shipment/TMS/SHP-77120` = "Shipment SHP-77120 (consolidated)"
- `Order/OMS/18492` = "Order #18492"
- `Payment/Payments/PAY-88213` = "Payment PAY-88213"
- `Approval/FinanceApprovals/APR-2291` = "Finance approval APR-2291"
- `BudgetRequirement/FinanceApprovals/BR-18492` = "Budget code for Order #18492"
- `SLA/ContractMgmt/SLA-3982-DEL` = "Acme Corp delivery SLA"
- `Warehouse/WMS/WH-EAST-02` = "East Distribution Center 02"

### F1. Blockers of Shipment SHP-77120 (default depth)

- `paths.length = 2`, `totalPaths = 2`, and every `truncation` flag is false.
- **`paths[0]`**:
  - **Hops**: SHP-77120 → 18492 (DEPENDS_ON, FORWARD) → PAY-88213 (REQUIRES, FORWARD) → APR-2291 (REQUIRES, FORWARD) → BR-18492 (REQUIRES, FORWARD).
  - **Path values**: `length 4`, `weakestConfidence HIGH`, `nonSourceHops 0`.
  - **`explanation`**:
    1. `Shipment SHP-77120 (consolidated) is delayed because it depends on Order #18492, which is BLOCKED.`
    2. `Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.`
    3. `Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.`
    4. `Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.`
- **`paths[1]`**:
  - **Hops**: SHP-77120 → PAY-88213 (BLOCKS, REVERSE, `fromEntityId` = PAY-88213, `toEntityId` = SHP-77120, MANUAL / MEDIUM) → APR-2291 → BR-18492.
  - **Path values**: `length 3`, `weakestConfidence MEDIUM`, `nonSourceHops 1`.
  - **`explanation[0]`**: `Shipment SHP-77120 (consolidated) is delayed because Payment PAY-88213, which is PENDING, blocks it (manually recorded, medium confidence: "Recorded by ops analyst: carrier will not book the consolidated load until payment clears").`
- **`directBlockers`**:
  - Order #18492, `pathLength 1`;
  - Payment PAY-88213, `pathLength 1`.
- **`deepestBlockers`**: exactly one entry, Budget code for Order #18492:
  - `pathLength 4`;
  - `possible false`, `continuesBeyondDepth false`, `inCycle false`.
- **`summary`**: `Shipment SHP-77120 (consolidated) is DELAYED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 4 steps away.`
- **Evidence on the 18492 hop**: `entity.state.observation.sourceSystem = "OMS"`, and `latestBySource` has 2 entries, `ERP` PENDING and `OMS` BLOCKED, in that order.

### F2. Blockers of Order #18492

- **Paths**: exactly 1 path: 18492 → PAY-88213 → APR-2291 → BR-18492.
- **`explanation[0]`**: `Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.`
- **Blockers**:
  - `directBlockers` = [Payment PAY-88213];
  - `deepestBlockers` = [Budget code for Order #18492, `pathLength 3`].
- **`summary`**: `Order #18492 is BLOCKED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 3 steps away.`

### F3. Blockers of Acme Corp delivery SLA

- **Paths**: 2 paths. Both have `weakestConfidence` MEDIUM, so rule 2 decides the order.
  - `paths[0]`: SLA → SHP-77120 (DEPENDS_ON, INFERRED / MEDIUM) → 18492 → PAY → APR → BR. `length 5`, `nonSourceHops 1`.
  - `paths[1]`: SLA → SHP-77120 → PAY (BLOCKS) → APR → BR. `length 4`, `nonSourceHops 2`.
- **`paths[0].explanation[0]`**: `Acme Corp delivery SLA is at risk because it depends on Shipment SHP-77120 (consolidated) (inferred, medium confidence: "SLA measures on-time delivery of the customer's orders on this shipment"), which is DELAYED.`
- **`summary`**: `Acme Corp delivery SLA is AT_RISK. 1 deepest blocker: Budget code for Order #18492 (MISSING), 5 steps away.`

### F4. Blockers of Warehouse WH-EAST-02

- `paths = []`, `directBlockers = []`, `deepestBlockers = []`.
- **`summary`**: `East Distribution Center 02 is ACTIVE. No blockers found within 6 steps.`

### F5. Downstream of BR-18492 (default depth, no filters)

- **`totalReached = 25`**:
  - the 17 affected orders: 18492 and 18493–18496, 18501–18505, 18511–18514, 18521–18523;
  - the 4 SLAs;
  - PAY-88213, APR-2291, SHP-77120 and INV-55120.
- **Not reached**: Orders 18530, 18531 and 18532.
- **Distances**:
  - APR 1, PAY 2;
  - 18492 3, SHP-77120 3 (through BLOCKS);
  - INV-55120 4, each of the 16 other orders 4, each SLA 4.
- **Canonical path of SHP-77120**: BR → APR → PAY → 18492 → SHP (4 hops, all SOURCE / HIGH). It is preferred over the 3-hop MANUAL path.
- `truncation.depthLimit = false`: nothing is reachable at depth 7.

### F6. Downstream of BR-18492 with `relationshipTypes=REQUIRES,DEPENDS_ON`

- **`totalReached = 24`**: F5 minus INV-55120.
- **SHP-77120**: distance 4.
- `query.relationshipTypes = ["REQUIRES","DEPENDS_ON"]`.

### F7. Downstream of BR-18492 with `entityTypes=Order`

- `totalReached = 17`. Every item has type Order.
- **Path of Order 18493**:
  - 5 hops: BR → APR → PAY → 18492 → SHP → 18493;
  - every intermediate entity is present in `path.hops`, so the non-Order entities in between are still shown.

### F8. Upstream of Order #18492 (default depth)

- **`totalReached = 9`**:
  - Acme Corp (1), Contract CON-3982 (1), Industrial Pallet Racking Kit (1), Payment PAY-88213 (1), East Distribution Center 02 (1);
  - Finance approval APR-2291 (2), Northwind Steel (2), Contoso Metals (2);
  - Budget code for Order #18492 (3).
- **Contoso Metals**: its path's last hop is SUPPLIED_BY with `effectiveOrigin INFERRED`, `effectiveConfidence LOW`, and `path.weakestConfidence LOW`.

### F9. Upstream of Shipment SHP-77120 (default depth)

- **`totalReached = 10`**: Order #18492 plus the 9 entities of F8.
- **Payment PAY-88213**:
  - `distance 1`;
  - `path.length 2` (SHP → 18492 → PAY, both SOURCE / HIGH).
- **Budget code**:
  - `distance 3`;
  - `path.length 4`.

### F10. Depth

- **Blockers of SLA-3982-DEL with `depth=3`**: exactly 2 paths, both `length 3` and both `continuesBeyondDepth = true`. `truncation.depthLimit = true`.
  - `paths[0]`: SLA → SHP-77120 → 18492 → PAY-88213. Weakest MEDIUM, `nonSourceHops 1`.
  - `paths[1]`: SLA → SHP-77120 → PAY-88213 (BLOCKS) → APR-2291. Weakest MEDIUM, `nonSourceHops 2`.
  - `directBlockers` = [Shipment SHP-77120 (consolidated), `pathLength 1`].
  - `deepestBlockers` = [Payment PAY-88213 (`pathLength 3`, `continuesBeyondDepth true`), Finance approval APR-2291 (`pathLength 3`, `continuesBeyondDepth true`)].
  - **`summary`**: `Acme Corp delivery SLA is AT_RISK. 2 deepest blockers found within 3 steps; highest ranked: Payment PAY-88213 (PENDING), 3 steps away; the chain continues beyond the depth limit.`
- **Downstream of BR-18492 with `depth=2`**: `totalReached = 2` (APR-2291 at distance 1, PAY-88213 at distance 2), and `truncation.depthLimit = true`.
- **Blockers of Shipment SHP-77120 with `depth=10`**: identical to F1 except `query.depth = 10` and the summary is unchanged. That proves the maximum depth is accepted.
