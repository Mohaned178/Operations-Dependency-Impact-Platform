import type { Edge, Node } from '@xyflow/react';
import type { GraphEdgeDto, NeighborhoodNodeDto } from '@opsgraph/shared';

export type Emphasis = 'normal' | 'highlighted' | 'dimmed';
export type BlockerRole = 'none' | 'direct' | 'deepest' | 'direct-and-deepest';

// `type`, not `interface`: React Flow 12 requires data to be assignable to Record<string, unknown>.
export type EntityNodeData = {
  entity: NeighborhoodNodeDto;
  isFocus: boolean;
  /** reasons is exactly ['CONNECTOR'] */
  isConnector: boolean;
  hasConflict: boolean;
  emphasis: Emphasis;
  blockerRole: BlockerRole;
  /** !isFocus */
  canExpand: boolean;
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
/** Vertical distance between node centers in a column. */
export const ROW_GAP = 100;
/** Horizontal distance between column centers. */
export const COLUMN_GAP = 360;

/** Selection state of the explorer page (data-model §4). */
export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; key: string } | null;
