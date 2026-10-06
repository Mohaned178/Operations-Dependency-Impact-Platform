import type {
  BlockerRelationshipType,
  Confidence,
  EntityType,
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

export interface GraphRepository {
  findNeighbors(query: NeighborQuery): Promise<NeighborPage>;
  countNeighbors(entityId: string): Promise<number>;
  /** Returns null when the start entity does not exist. */
  traceDependencies(query: DependencyTraceQuery): Promise<DependencyTrace | null>;
  /** Returns null when the start entity does not exist. */
  traceBlockers(query: BlockerTraceQuery): Promise<BlockerTrace | null>;
}
