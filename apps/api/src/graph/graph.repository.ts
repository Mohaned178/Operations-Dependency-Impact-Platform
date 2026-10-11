import type {
  BlockerRelationshipType,
  Confidence,
  EntityType,
  JsonValue,
  OperationalState,
  RelationshipOrigin,
  RelationshipType,
  TraceableRelationshipType,
} from '@opsgraph/shared';

export const GRAPH_REPOSITORY = Symbol('GRAPH_REPOSITORY');

export type NeighborDirection = 'OUT' | 'IN' | 'BOTH';

export interface NeighborQuery {
  entityId: string;
  direction: NeighborDirection;
  relationshipTypes?: readonly RelationshipType[];
  neighborTypes?: readonly EntityType[];
  cursor?: string;
  limit: number;
}

export interface NeighborRelationship {
  id: string;
  type: RelationshipType;
  direction: 'OUT' | 'IN';
  origin: RelationshipOrigin;
  confidence: Confidence;
  basis: string | null;
  sourceSystem: string;
  sourceId: string;
  observedAt: Date;
  importId: string;
}

export interface NeighborEntity {
  id: string;
  type: EntityType;
  displayName: string;
  currentState: OperationalState;
}

export interface NeighborRow {
  relationship: NeighborRelationship;
  neighbor: NeighborEntity;
}

export interface NeighborPage {
  items: NeighborRow[];
  nextCursor: string | null;
}

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
  /** Smallest relationshipId in the group (research R4). */
  key: string;
  relationshipType: TraceableRelationshipType;
  /** As recorded. */
  fromEntityId: string;
  /** As recorded. */
  toEntityId: string;
  traversal: 'FORWARD' | 'REVERSE';
  effectiveOrigin: RelationshipOrigin;
  effectiveConfidence: Confidence;
  assertions: HopAssertion[];
  /** The entity this hop reaches. */
  target: GraphEntityRef;
}

export interface TraversalPath {
  /** Length >= 1. */
  hops: TraversalHop[];
  weakestConfidence: Confidence;
  nonSourceHops: number;
  continuesBeyondDepth: boolean;
  /** Always false for canonical (upstream/downstream) paths. */
  endsInCycle: boolean;
}

export interface CycleClosingHop {
  key: string;
  relationshipType: TraceableRelationshipType;
  fromEntityId: string;
  toEntityId: string;
  /** Every assertion id, ascending. */
  relationshipIds: string[];
}

export interface DependencyTraceQuery {
  startId: string;
  direction: TraceDirection;
  /** Already validated 1..10. */
  maxDepth: number;
  /** Non-empty; defaults are applied by the service. */
  relationshipTypes: readonly TraceableRelationshipType[];
}

export interface ReachedEntity {
  entity: GraphEntityRef;
  /** Minimum hops (CTE min(depth)), 1..maxDepth. */
  distance: number;
  /** Canonical path (research R5). */
  path: TraversalPath;
}

export interface DependencyTrace {
  start: GraphEntityRef;
  /** All reached entities (at most 10,000), sorted by (distance, type, displayName, id). */
  reached: ReachedEntity[];
  depthLimitReached: boolean;
  explorationLimitReached: boolean;
  /** At most maxCycleClosingHops, sorted. */
  cycleClosingHops: CycleClosingHop[];
  cycleClosingHopCount: number;
}

export interface BlockerTraceQuery {
  startId: string;
  maxDepth: number;
  /** Non-empty. */
  relationshipTypes: readonly BlockerRelationshipType[];
}

export interface BlockerTrace {
  start: GraphEntityRef;
  /** Every emitted path (at most 1,000), sorted by comparePaths. */
  paths: TraversalPath[];
  enumerationCapped: boolean;
  explorationLimitReached: boolean;
  cycleClosingHops: CycleClosingHop[];
  cycleClosingHopCount: number;
}

export interface IncomingRelationshipRow {
  /** Direction is always 'IN'. */
  relationship: NeighborRelationship;
  /** The relationship's `to` end: one of the requested entity ids. */
  targetEntityId: string;
  /** The `from` end, with its attributes (needed for requirement-source evidence). */
  source: GraphEntityRef & { attributes: Record<string, JsonValue> };
}

export type NeighborhoodWalk = 'ALL' | 'UPSTREAM' | 'DOWNSTREAM';

export interface NeighborhoodTraceQuery {
  startId: string;
  walk: NeighborhoodWalk;
  /** Already validated 1..4 (expansions use 1). */
  maxDepth: number;
  /** Non-empty. Never contains RELATES_TO unless walk is 'ALL' (the service guarantees it). */
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

/** One (type, from, to) group of relationship assertions, as recorded. */
export interface RelationshipGroup {
  /** Smallest relationship id of the group (same rule as TraversalHop.key). */
  key: string;
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
  effectiveOrigin: RelationshipOrigin;
  effectiveConfidence: Confidence;
  assertions: HopAssertion[];
}

export interface ImpactTraceQuery {
  startId: string;
  /** Already validated 1..10. */
  maxDepth: number;
}

export interface ImpactReachedEntity {
  entity: GraphEntityRef;
  /** CTE min depth over non-terminal expansion, 1..maxDepth. */
  distance: number;
  /** Best-ranked path over all filtered edges (research R2 `canonical`). */
  canonicalPath: TraversalPath;
  /** Best-ranked live path, or null when no live path reaches it (research R2 `live`). */
  livePath: TraversalPath | null;
  /** Best-ranked path among those of length `distance` (research R2 `shortest`). */
  shortestPath: TraversalPath;
  /** True when at least one path within maxDepth consists only of SOURCE hops. */
  sourcedReach: boolean;
}

export interface ImpactPathSet {
  /** At most IMPACT_LIMITS.maxEnumeratedPaths, sorted by comparePaths. */
  found: TraversalPath[];
  /** True when enumeration stopped on the path cap or the search budget. */
  morePaths: boolean;
}

export interface ImpactTrace {
  start: GraphEntityRef;
  /** Within maxDepth, start excluded, terminal entities included; sorted by (distance, type, displayName, id). At most 10,000. */
  reached: ImpactReachedEntity[];
  depthLimitReached: boolean;
  explorationLimitReached: boolean;
  cycleClosingHops: CycleClosingHop[];
  cycleClosingHopCount: number;
  /** Research R4. Pure and in memory: no SQL. Unknown ids map to { found: [], morePaths: false }. */
  paths(targetIds: readonly string[]): Map<string, ImpactPathSet>;
}

export interface AttributionQuery {
  orderIds: readonly string[];
  slaIds: readonly string[];
}

export interface CustomerAttribution {
  /** The Order or SLA that is attributed. */
  attributedEntityId: string;
  customer: GraphEntityRef;
  /** UPSTREAM path from the attributed entity to the customer: 1 hop (PLACED) or 2 hops (DEFINES, HAS). */
  link: TraversalPath;
}

export interface GraphRepository {
  findNeighbors(query: NeighborQuery): Promise<NeighborPage>;
  countNeighbors(entityId: string): Promise<number>;
  /**
   * One hop, no recursion: every relationship of the given types whose `to` end is in entityIds.
   * Returns [] for an empty id list or type list without querying.
   */
  findIncomingRelationships(
    entityIds: readonly string[],
    types: readonly RelationshipType[],
  ): Promise<IncomingRelationshipRow[]>;
  /** Returns null when the start entity does not exist. */
  traceDependencies(query: DependencyTraceQuery): Promise<DependencyTrace | null>;
  /** Returns null when the start entity does not exist. */
  traceBlockers(query: BlockerTraceQuery): Promise<BlockerTrace | null>;
  /** Returns null when the start entity does not exist. */
  traceNeighborhood(query: NeighborhoodTraceQuery): Promise<NeighborhoodTrace | null>;
  /** Every relationship group whose two ends are both in `entityIds` and whose type is in `types`. */
  findRelationshipsAmong(
    entityIds: readonly string[],
    types: readonly RelationshipType[],
  ): Promise<RelationshipGroup[]>;
  /** Returns null when the start entity does not exist. */
  traceImpact(query: ImpactTraceQuery): Promise<ImpactTrace | null>;
  /** Fixed-shape attribution lookup (research R5). Sorted by (attributedEntityId, customer.id). Empty input returns [] without querying. */
  findAttributedCustomers(query: AttributionQuery): Promise<CustomerAttribution[]>;
}
