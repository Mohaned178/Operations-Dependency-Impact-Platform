import type {
  Confidence,
  EntityType,
  OperationalState,
  RelationshipOrigin,
  RelationshipType,
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

export interface GraphRepository {
  findNeighbors(query: NeighborQuery): Promise<NeighborPage>;
  countNeighbors(entityId: string): Promise<number>;
}
