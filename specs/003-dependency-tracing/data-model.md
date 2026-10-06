# Data Model: Dependency Tracing & Entity 360

**No database changes.** This feature adds no tables, columns, enums, indexes or migrations. It reads the 002 tables `entities`, `relationships` and `state_observations`, and writes nothing. That makes tracing read-only, with no audit entries (spec FR-024).

This document defines:
1. the shared constants (`packages/shared/src/tracing.ts`);
2. the internal traversal types (`apps/api/src/graph/graph.repository.ts` and `apps/api/src/graph/traversal/types.ts`);
3. how the internal types map to the response DTOs (defined in `contracts/api.md`).

---

## 1. Shared constants (`packages/shared/src/tracing.ts`)

```ts
export const TraceableRelationshipTypeSchema = RelationshipTypeSchema.exclude(['RELATES_TO']);
export type TraceableRelationshipType = z.infer<typeof TraceableRelationshipTypeSchema>;

export const BlockerRelationshipTypeSchema = z.enum(['REQUIRES', 'DEPENDS_ON', 'BLOCKS']);
export type BlockerRelationshipType = z.infer<typeof BlockerRelationshipTypeSchema>;

export const TRACEABLE_RELATIONSHIP_TYPES = TraceableRelationshipTypeSchema.options; // 11, schema order
export const BLOCKER_RELATIONSHIP_TYPES = BlockerRelationshipTypeSchema.options;     // 3

export type DependencyDirection = 'FROM_DEPENDS_ON_TO' | 'TO_DEPENDS_ON_FROM';
export const DEPENDENCY_DIRECTION: Record<TraceableRelationshipType, DependencyDirection> = {
  REQUIRES: 'FROM_DEPENDS_ON_TO',
  DEPENDS_ON: 'FROM_DEPENDS_ON_TO',
  FULFILLED_BY: 'FROM_DEPENDS_ON_TO',
  SUPPLIED_BY: 'FROM_DEPENDS_ON_TO',
  CONTAINS: 'FROM_DEPENDS_ON_TO',
  BLOCKS: 'TO_DEPENDS_ON_FROM',
  PLACED: 'TO_DEPENDS_ON_FROM',
  HAS: 'TO_DEPENDS_ON_FROM',
  GOVERNS: 'TO_DEPENDS_ON_FROM',
  DEFINES: 'TO_DEPENDS_ON_FROM',
  GENERATES: 'TO_DEPENDS_ON_FROM',
};

export const StateClassificationSchema = z.enum(['SATISFIED', 'UNSATISFIED', 'INDETERMINATE']);
export type StateClassification = z.infer<typeof StateClassificationSchema>;
export const STATE_CLASSIFICATION: Record<OperationalState, StateClassification> = {
  ACTIVE: 'SATISFIED', COMPLETED: 'SATISFIED', AT_RISK: 'SATISFIED',
  PENDING: 'UNSATISFIED', WAITING: 'UNSATISFIED', BLOCKED: 'UNSATISFIED', MISSING: 'UNSATISFIED',
  DELAYED: 'UNSATISFIED', FAILED: 'UNSATISFIED', CANCELLED: 'UNSATISFIED', SUSPENDED: 'UNSATISFIED',
  UNKNOWN: 'INDETERMINATE',
};
export const SATISFIED_STATES: readonly OperationalState[] =
  OperationalStateSchema.options.filter((s) => STATE_CLASSIFICATION[s] === 'SATISFIED');

export const TRACING_LIMITS = {
  defaultDepth: 6,
  minDepth: 1,
  maxDepth: 10,
  maxReachedEntities: 10_000,
  maxBlockingPaths: 100,
  maxEnumeratedPaths: 1_000,
  maxCycleClosingHops: 100,
} as const;

export const CONFIDENCE_RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
export const ORIGIN_RANK: Record<RelationshipOrigin, number> = { SOURCE: 3, MANUAL: 2, INFERRED: 1 };
```

`tracing.ts` imports `RelationshipTypeSchema`, `OperationalStateSchema` and the related types from `./graph`. Add `export * from './tracing';` to `packages/shared/src/index.ts`.

---

## 2. Internal traversal types

### 2a. `GraphRepository` additions (`apps/api/src/graph/graph.repository.ts`)

Keep the existing `findNeighbors` and `countNeighbors` unchanged. Add:

```ts
export type TraceDirection = 'UPSTREAM' | 'DOWNSTREAM';

export interface GraphEntityRef {
  id: string;
  type: EntityType;
  displayName: string;
  currentState: OperationalState;
}

export interface HopAssertion {
  relationshipId: string;
  origin: RelationshipOrigin;
  confidence: Confidence;
  basis: string | null;
  sourceSystem: string;
  sourceId: string;
  observedAt: Date;
  importId: string;
}

export interface TraversalHop {
  key: string;                     // smallest relationshipId in the group (research R4)
  relationshipType: TraceableRelationshipType;
  fromEntityId: string;            // as recorded
  toEntityId: string;              // as recorded
  traversal: 'FORWARD' | 'REVERSE';
  effectiveOrigin: RelationshipOrigin;
  effectiveConfidence: Confidence;
  assertions: HopAssertion[];      // sorted (research R4)
  target: GraphEntityRef;          // the entity this hop reaches
}

export interface TraversalPath {
  hops: TraversalHop[];            // length >= 1
  weakestConfidence: Confidence;
  nonSourceHops: number;
  continuesBeyondDepth: boolean;
  endsInCycle: boolean;            // always false for canonical (upstream/downstream) paths
}

export interface CycleClosingHop {
  key: string;
  relationshipType: TraceableRelationshipType;
  fromEntityId: string;
  toEntityId: string;
  relationshipIds: string[];       // every assertion id, ascending
}

export interface DependencyTraceQuery {
  startId: string;
  direction: TraceDirection;
  maxDepth: number;                                        // already validated 1..10
  relationshipTypes: readonly TraceableRelationshipType[]; // non-empty; defaults applied by the service
}

export interface ReachedEntity {
  entity: GraphEntityRef;
  distance: number;                // min hops (CTE min(depth)), 1..maxDepth
  path: TraversalPath;             // canonical path (research R5)
}

export interface DependencyTrace {
  start: GraphEntityRef;
  reached: ReachedEntity[];        // ALL reached (≤ 10,000), sorted by (distance, type, displayName, id)
  depthLimitReached: boolean;
  explorationLimitReached: boolean;
  cycleClosingHops: CycleClosingHop[]; // ≤ maxCycleClosingHops, sorted
  cycleClosingHopCount: number;
}

export interface BlockerTraceQuery {
  startId: string;
  maxDepth: number;
  relationshipTypes: readonly BlockerRelationshipType[];   // non-empty
}

export interface BlockerTrace {
  start: GraphEntityRef;
  paths: TraversalPath[];          // every emitted path (≤ 1,000), sorted by comparePaths
  enumerationCapped: boolean;
  explorationLimitReached: boolean;
  cycleClosingHops: CycleClosingHop[];
  cycleClosingHopCount: number;
}

export interface GraphRepository {
  findNeighbors(query: NeighborQuery): Promise<NeighborPage>;
  countNeighbors(entityId: string): Promise<number>;
  /** Returns null when the start entity does not exist. */
  traceDependencies(query: DependencyTraceQuery): Promise<DependencyTrace | null>;
  /** Returns null when the start entity does not exist. */
  traceBlockers(query: BlockerTraceQuery): Promise<BlockerTrace | null>;
}
```

### 2b. Pure-algorithm types (`apps/api/src/graph/traversal/types.ts`)

The pure functions work on ids and plain edges. They never see Prisma types.

```ts
export interface EdgeRow {             // one row from research R3 step 2, already parsed
  id: string;
  type: TraceableRelationshipType;
  fromEntityId: string;
  toEntityId: string;
  origin: RelationshipOrigin;
  confidence: Confidence;
  basis: string | null;
  sourceSystem: string;
  sourceId: string;
  observedAt: Date;
  importId: string;
}

export interface TraversalEdge {       // one grouped hop candidate (research R4)
  key: string;
  type: TraceableRelationshipType;
  fromEntityId: string;
  toEntityId: string;
  sourceId: string;                    // walk start of this hop
  targetId: string;                    // walk end of this hop
  traversal: 'FORWARD' | 'REVERSE';
  effectiveOrigin: RelationshipOrigin;
  effectiveConfidence: Confidence;
  nonSource: boolean;
  assertions: HopAssertion[];
}

export interface InternalPath {        // ids only; the repository converts it to TraversalPath
  entityIds: string[];                 // [startId, ..., last]; length = edges.length + 1
  edges: TraversalEdge[];
  weakestConfidence: Confidence;
  nonSourceHops: number;
  continuesBeyondDepth: boolean;
  endsInCycle: boolean;
}

export type WalkDirection = 'UPSTREAM' | 'DOWNSTREAM';  // blockers always use 'UPSTREAM'
```

Pure function signatures, one file each, each with a `*.spec.ts` next to it:

```ts
// traversal-edges.ts
export function buildTraversalEdges(rows: readonly EdgeRow[], direction: WalkDirection): TraversalEdge[];
// path-order.ts
export function compareCodeUnits(a: string, b: string): number;          // -1 | 0 | 1, never localeCompare
export function compareIdSequences(a: readonly string[], b: readonly string[]): number;
export function comparePaths(a: InternalPath, b: InternalPath): number;  // research R7
// canonical-paths.ts
export interface CanonicalPathsResult {
  paths: Map<string, InternalPath>;                // keyed by reached entity id; never contains startId
  cycleClosing: TraversalEdge[];                   // all, unsorted; the repository sorts and caps
}
export function selectCanonicalPaths(startId: string, edges: readonly TraversalEdge[], maxDepth: number): CanonicalPathsResult;
// blocking-paths.ts
export interface BlockingPathsResult {
  paths: InternalPath[];                           // sorted by comparePaths
  enumerationCapped: boolean;
  cycleClosing: TraversalEdge[];
}
export function enumerateBlockingPaths(startId: string, edges: readonly TraversalEdge[], maxDepth: number, maxEnumerated: number): BlockingPathsResult;
```

**Edge direction for blockers**: blocker traces call `buildTraversalEdges(rows, 'UPSTREAM')`. REQUIRES and DEPENDS_ON become FORWARD, and BLOCKS becomes REVERSE.

---

## 3. Mapping internal types → response DTOs (in `TracingService` / `tracing.mapper.ts`)

| Internal | DTO (`contracts/api.md`) | Rule |
|---|---|---|
| `GraphEntityRef` + state rows | `TracedEntityDto` | `state.classification = STATE_CLASSIFICATION[currentState]`. `state.observation` = the latest state observation by `(observed_at DESC, seq DESC)`, or `null` when the entity has none. `state.latestBySource` = one observation per source system, sorted by `sourceSystem` (code unit), **only when** those observations contain at least 2 distinct `state` values; otherwise `[]`. |
| `HopAssertion` | `HopAssertionDto` | `observedAt.toISOString()`. |
| `TraversalHop` | `HopDto` | `entity` = the `TracedEntityDto` of `target`. |
| `TraversalPath` | `PathDto` / `BlockingPathDto` | `length = hops.length`. A blocking path adds `explanation` (research R9). |
| `CycleClosingHop` | `CycleClosingHopDto` | Copied as is. |

**State evidence loading** (`StateEvidenceReader.load(entityIds)`) runs exactly **two** queries. It is raw SQL in `apps/api/src/tracing/state-evidence.reader.ts`. This is not traversal: it reads `state_observations` only.

```sql
-- current observation per entity
SELECT DISTINCT ON (entity_id) id::text, entity_id::text, state::text, source_status, source_system,
       source_id, observed_at, received_at, import_id::text
FROM state_observations WHERE entity_id = ANY(${ids}::uuid[])
ORDER BY entity_id, observed_at DESC, seq DESC;

-- latest per (entity, source system)
SELECT DISTINCT ON (entity_id, source_system) <same columns>
FROM state_observations WHERE entity_id = ANY(${ids}::uuid[])
ORDER BY entity_id, source_system, observed_at DESC, seq DESC;
```

It returns `Map<entityId, { observation: StateObservationDto | null; latestBySource: StateObservationDto[] }>`, applying the "only when they disagree" rule above. **Only call it for the entities that appear in the response.** For a dependencies page, that is the start entity plus every entity on the paths of the page's items, at most 50 × 10 + 1. For blockers, it is the start entity plus every entity on the kept paths.

---

## 4. Validation rules (summary; schemas are in `contracts/api.md`)

| Input | Rule | Error |
|---|---|---|
| `:id` | UUID | 400 `VALIDATION_FAILED` (existing `ParseUUIDPipe` behaviour) |
| `:id` | exists | 404 `NOT_FOUND` "Entity not found" |
| `depth` | whole number 1–10. Default 6. | 400, `details[0].path = "depth"` |
| `direction` | `upstream` or `downstream`. Required. | 400, `path = "direction"` |
| `relationshipTypes` (dependencies) | comma list of the 11 traceable types. RELATES_TO and unknown values are rejected. Duplicates are removed. Empty or absent means all 11. | 400, `path = "relationshipTypes.<index>"`, and the message lists the allowed values |
| `relationshipTypes` (blockers) | comma list of REQUIRES, DEPENDS_ON, BLOCKS. Empty or absent means all 3. | 400, as above |
| `entityTypes` | comma list of the 12 entity types. Empty or absent means no filter. | 400, `path = "entityTypes.<index>"` |
| `limit`, `cursor` (dependencies only) | `PageQuerySchema` | as in 002 |
