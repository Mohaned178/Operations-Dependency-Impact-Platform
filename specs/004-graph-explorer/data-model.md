# Data Model: Graph Explorer

No database changes. No Prisma migration. Everything below is either a shared zod schema (`packages/shared/src/explorer.ts`), an internal API type, or client state.

## 1. Shared constants and schemas (`packages/shared/src/explorer.ts`)

Export it from `packages/shared/src/index.ts` (`export * from './explorer';`). In `tracing.ts`, change `function commaList` to `export function commaList` (no other change to it).

```ts
import { z } from 'zod';
import {
  ConfidenceSchema, EntityTypeSchema, RelationshipOriginSchema, RelationshipTypeSchema,
} from './graph';
import {
  BlockersResponseSchema, HopAssertionDtoSchema, TracedEntityDtoSchema, commaList,
} from './tracing';

export const EXPLORER_LIMITS = {
  defaultDepth: 2,
  minDepth: 1,
  maxDepth: 4,
  maxVisibleNodes: 200,
  maxExpansions: 50,
} as const;

export const NeighborhoodDirectionSchema = z.enum(['all', 'upstream', 'downstream']);
export type NeighborhoodDirection = z.infer<typeof NeighborhoodDirectionSchema>;

/** "a,b,,a" → ["a","b"]: trimmed, empties dropped, de-duplicated, FIRST-OCCURRENCE order kept. */
const ExpandListSchema = z
  .string()
  .optional()
  .transform((raw) => (raw ?? '').split(',').map((v) => v.trim()).filter((v) => v !== ''))
  .pipe(z.array(z.string().uuid()))
  .transform((ids) => [...new Set(ids)])
  .pipe(z.array(z.string().uuid()).max(EXPLORER_LIMITS.maxExpansions));

const BooleanFlagSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const explorerSettingsShape = {
  direction: NeighborhoodDirectionSchema.default('all'),
  depth: z.coerce.number().int()
    .min(EXPLORER_LIMITS.minDepth).max(EXPLORER_LIMITS.maxDepth)
    .default(EXPLORER_LIMITS.defaultDepth),
  relationshipTypes: commaList(RelationshipTypeSchema),
  entityTypes: commaList(EntityTypeSchema),
  blockers: BooleanFlagSchema,
};

function relatesToOnlyWithAll(
  value: { direction: NeighborhoodDirection; relationshipTypes: readonly string[] },
  ctx: z.RefinementCtx,
): void {
  if (value.direction !== 'all' && value.relationshipTypes.includes('RELATES_TO')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['relationshipTypes'],
      message: 'RELATES_TO is only allowed when direction is all',
    });
  }
}

/** Page URL (/graph/:id?...). Same names and formats as the API, without expand. */
export const ExplorerUrlParamsSchema = z.object(explorerSettingsShape).superRefine(relatesToOnlyWithAll);
export type ExplorerUrlParams = z.infer<typeof ExplorerUrlParamsSchema>;

/** GET /api/entities/:id/neighborhood query. */
export const NeighborhoodQuerySchema = z
  .object({ ...explorerSettingsShape, expand: ExpandListSchema })
  .superRefine(relatesToOnlyWithAll);
export type NeighborhoodQuery = z.infer<typeof NeighborhoodQuerySchema>;

export const NodeReasonSchema = z.enum([
  'FOCUS', 'BLOCKING_PATH', 'NEIGHBORHOOD', 'CONNECTOR', 'EXPANSION',
]);
export type NodeReason = z.infer<typeof NodeReasonSchema>;

export const NeighborhoodNodeDtoSchema = TracedEntityDtoSchema.extend({
  /** 0 for the focus; base CTE distance for base candidates; null otherwise (research R9). */
  distance: z.number().int().min(0).nullable(),
  /** Every group that listed this node, in NodeReasonSchema option order. */
  reasons: z.array(NodeReasonSchema).min(1),
  /** Null only for the focus. */
  parentId: z.string().uuid().nullable(),
  /** Key of the edge parent—this node; null only for the focus. Always present in `edges`. */
  viaEdgeKey: z.string().uuid().nullable(),
  /** This node's id is in query.expand (applied). */
  expanded: z.boolean(),
});
export type NeighborhoodNodeDto = z.infer<typeof NeighborhoodNodeDtoSchema>;

export const GraphEdgeDtoSchema = z.object({
  /** Smallest relationship id of the (type, from, to) group: same rule as HopDto.key. */
  key: z.string().uuid(),
  relationshipType: RelationshipTypeSchema,
  /** As recorded. */
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  effectiveOrigin: RelationshipOriginSchema,
  effectiveConfidence: ConfidenceSchema,
  /** Same order as HopDto.assertions (origin rank, confidence, observedAt desc, id). */
  assertions: z.array(HopAssertionDtoSchema).min(1),
});
export type GraphEdgeDto = z.infer<typeof GraphEdgeDtoSchema>;

export const NeighborhoodResponseSchema = z.object({
  query: z.object({
    entityId: z.string().uuid(),
    direction: NeighborhoodDirectionSchema,
    depth: z.number().int(),
    /** Resolved: the defaults when the request gave none. Never empty. */
    relationshipTypes: z.array(RelationshipTypeSchema).min(1),
    entityTypes: z.array(EntityTypeSchema),
    /** As requested (deduplicated, request order). */
    expand: z.array(z.string().uuid()),
    blockers: z.boolean(),
  }),
  computedAt: z.string().datetime(),
  focusId: z.string().uuid(),
  /** Priority order (research R6). nodes[0] is the focus. Length 1..200. */
  nodes: z.array(NeighborhoodNodeDtoSchema).min(1).max(EXPLORER_LIMITS.maxVisibleNodes),
  /** Sorted by key (code-unit order). */
  edges: z.array(GraphEdgeDtoSchema),
  totals: z.object({
    visible: z.number().int().min(1),
    /** Candidates not shown because of the 200 cap. */
    omitted: z.number().int().min(0),
    /** True when the 10,000 exploration limit was hit: omitted is then a lower bound. */
    omittedIsLowerBound: z.boolean(),
  }),
  /** Expand ids that were not applied (unknown entity, or not visible when processed). Request order. */
  ignoredExpansions: z.array(z.string().uuid()),
  /** Feature 003 BlockersResponse, unchanged; null when query.blockers is false. */
  blockers: BlockersResponseSchema.nullable(),
});
export type NeighborhoodResponse = z.infer<typeof NeighborhoodResponseSchema>;
```

Resolved `relationshipTypes` defaults: `all` → every `RelationshipTypeSchema` option (12, including RELATES_TO); `upstream`/`downstream` → `TRACEABLE_RELATIONSHIP_TYPES` (11). `commaList` already returns schema-option order.

### Validation rules (all → 400 `VALIDATION_FAILED`, field = `path`)

| Field | Rule |
|---|---|
| `direction` | one of `all`, `upstream`, `downstream` |
| `depth` | integer 1..4 |
| `relationshipTypes` | each a `RelationshipType`; RELATES_TO only with `direction=all` |
| `entityTypes` | each an `EntityType` |
| `expand` | each a UUID; ≤ 50 after de-duplication; must not contain the focus id (checked in the service: `Errors.validation([{ path: 'expand', message: 'expand must not include the focus entity' }])`) |
| `blockers` | `true` or `false` |

## 2. Repository types (`apps/api/src/graph/graph.repository.ts`, additions)

```ts
export type NeighborhoodWalk = 'ALL' | 'UPSTREAM' | 'DOWNSTREAM';

export interface NeighborhoodTraceQuery {
  startId: string;
  walk: NeighborhoodWalk;
  /** Already validated 1..4 (expansions use 1). */
  maxDepth: number;
  /** Non-empty. Never contains RELATES_TO unless walk is 'ALL' (service guarantees). */
  relationshipTypes: readonly RelationshipType[];
}

export interface NeighborhoodReached {
  entity: GraphEntityRef;
  /** CTE minimum depth, 1..maxDepth. */
  distance: number;
  /** Canonical path ids: [startId, ..., entity.id]. */
  pathEntityIds: string[];
  /** Canonical path edge keys; pathEdgeKeys[i] connects pathEntityIds[i] and pathEntityIds[i + 1]. */
  pathEdgeKeys: string[];
  weakestConfidence: Confidence;
  nonSourceHops: number;
}

export interface NeighborhoodTrace {
  start: GraphEntityRef;
  /** At most 10,000; sorted (distance, type, displayName, id) like DependencyTrace.reached. */
  reached: NeighborhoodReached[];
  explorationLimitReached: boolean;
}

export interface RelationshipGroup {
  key: string;
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
  effectiveOrigin: RelationshipOrigin;
  effectiveConfidence: Confidence;
  assertions: HopAssertion[];
}

// GraphRepository gains:
//   traceNeighborhood(query: NeighborhoodTraceQuery): Promise<NeighborhoodTrace | null>;
//   findRelationshipsAmong(entityIds: readonly string[], types: readonly RelationshipType[]): Promise<RelationshipGroup[]>;
```

### Internal traversal type widening (`apps/api/src/graph/traversal/types.ts`)

Make the relationship type a generic parameter with the current type as default, so existing code compiles unchanged:

```ts
export interface EdgeRow<T extends RelationshipType = TraceableRelationshipType> { ...; type: T; ... }
export interface TraversalEdge<T extends RelationshipType = TraceableRelationshipType> { ...; type: T; ... }
export interface InternalPath<T extends RelationshipType = TraceableRelationshipType> { ...; edges: TraversalEdge<T>[]; ... }
```

`selectCanonicalPaths` becomes `selectCanonicalPaths<T extends RelationshipType>(startId, edges: readonly TraversalEdge<T>[], maxDepth): CanonicalPathsResult<T>` with `CanonicalPathsResult<T>` generic the same way. No behavior change.

New module `apps/api/src/graph/traversal/edge-groups.ts`:

```ts
/** Research R4 of feature 003, extracted from buildTraversalEdges: group by (type, from, to),
 *  sort assertions, pick effective origin/confidence, key = smallest relationship id.
 *  Returned sorted by key (compareCodeUnits). */
export function groupEdgeRows<T extends RelationshipType>(rows: readonly EdgeRow<T>[]): EdgeGroup<T>[];

export interface EdgeGroup<T extends RelationshipType> {
  key: string; type: T; fromEntityId: string; toEntityId: string;
  effectiveOrigin: RelationshipOrigin; effectiveConfidence: Confidence;
  assertions: HopAssertion[];
}

/** 'ALL' walks: two TraversalEdges per group, same key:
 *  FORWARD (sourceId = from, targetId = to) and REVERSE (sourceId = to, targetId = from).
 *  Sorted by (key, traversal) with FORWARD before REVERSE. */
export function buildUndirectedTraversalEdges<T extends RelationshipType>(
  groups: readonly EdgeGroup<T>[],
): TraversalEdge<T>[];
```

`buildTraversalEdges` is rewritten to call `groupEdgeRows` and keep its exact current output (its existing spec must pass unchanged).

## 3. Composition types (`apps/api/src/tracing/compose-neighborhood.ts`, pure)

```ts
export interface ComposeBlockerPath {
  /** Hop target ids in hop order (focus excluded). */
  entityIds: string[];
  /** Hop keys in hop order; edgeKeys[i] connects (i === 0 ? focus : entityIds[i-1]) to entityIds[i]. */
  edgeKeys: string[];
}

export interface ComposeExpansion {
  expandedId: string;
  /** null when the expanded entity does not exist. */
  trace: NeighborhoodTrace | null;
}

export interface ComposeInput {
  focus: GraphEntityRef;
  base: NeighborhoodTrace;
  entityTypes: readonly EntityType[];       // empty = all match
  blockerPaths: readonly ComposeBlockerPath[]; // rank order; empty when blockers off
  blockerEntities: ReadonlyMap<string, GraphEntityRef>; // every hop entity of blockerPaths
  expansions: readonly ComposeExpansion[];   // request order
  maxVisible: number;                        // EXPLORER_LIMITS.maxVisibleNodes
}

export interface ComposedNode {
  entity: GraphEntityRef;
  distance: number | null;
  reasons: NodeReason[];        // NodeReasonSchema option order
  parentId: string | null;
  viaEdgeKey: string | null;
  expanded: boolean;
}

export interface ComposeOutput {
  visible: ComposedNode[];      // priority order, focus first, length <= maxVisible
  omitted: number;
  omittedIsLowerBound: boolean;
  appliedExpansions: string[];
  ignoredExpansions: string[];
  blockerEdgeKeys: Set<string>;
}

export function composeNeighborhood(input: ComposeInput): ComposeOutput;
```

Entity refs for blocker-only nodes come from `BlockersResponse.paths[].hops[].entity` (map `TracedEntityDto` → `GraphEntityRef` by `{ id, type, displayName, currentState }`). Algorithm: contracts/api.md §3.

## 4. Client state (`ExplorerPage`, not persisted)

| State | Type | Source | Reset when |
|---|---|---|---|
| settings | `ExplorerUrlParams` | URL search params (validated) | — |
| focusId | `string` | route param `:id` | — |
| expand | `string[]` (order of expansion) | `useState` | focusId or any setting changes |
| selection | `{ kind: 'node'; id: string } \| { kind: 'edge'; key: string } \| null` | `useState` | focusId changes; selected id no longer in response |
| focusMode | `boolean` | `useState` | selection becomes null or an edge |
| selectedPathIndex | `number \| null` (null = all paths) | `useState` | blockers toggled or focusId changes |

## 5. Entities touched

None created or modified. The explorer is read-only (spec FR-031): no audit rows, no writes.
