import type { Confidence, RelationshipOrigin, TraceableRelationshipType } from '@opsgraph/shared';
import type { HopAssertion } from '../graph.repository';

/** One relationship row from research R3 step 2, already parsed. */
export interface EdgeRow {
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

/** One grouped hop candidate (research R4). */
export interface TraversalEdge {
  key: string;
  type: TraceableRelationshipType;
  fromEntityId: string;
  toEntityId: string;
  /** Walk start of this hop. */
  sourceId: string;
  /** Walk end of this hop. */
  targetId: string;
  traversal: 'FORWARD' | 'REVERSE';
  effectiveOrigin: RelationshipOrigin;
  effectiveConfidence: Confidence;
  nonSource: boolean;
  assertions: HopAssertion[];
}

/** Ids only; the repository converts it to a TraversalPath. */
export interface InternalPath {
  /** [startId, ..., last]; length = edges.length + 1. */
  entityIds: string[];
  edges: TraversalEdge[];
  weakestConfidence: Confidence;
  nonSourceHops: number;
  continuesBeyondDepth: boolean;
  endsInCycle: boolean;
}

/** Blocker traces always use 'UPSTREAM'. */
export type WalkDirection = 'UPSTREAM' | 'DOWNSTREAM';
