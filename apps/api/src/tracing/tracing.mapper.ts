import {
  STATE_CLASSIFICATION,
  type CycleClosingHopDto,
  type HopAssertionDto,
  type HopDto,
  type PathDto,
  type TracedEntityDto,
} from '@opsgraph/shared';
import type {
  CycleClosingHop,
  GraphEntityRef,
  HopAssertion,
  TraversalHop,
  TraversalPath,
} from '../graph/graph.repository';
import type { EntityStateEvidence } from './state-evidence.reader';

export type EvidenceMap = ReadonlyMap<string, EntityStateEvidence>;

function evidenceFor(evidenceMap: EvidenceMap, entityId: string): EntityStateEvidence {
  const evidence = evidenceMap.get(entityId);
  if (evidence === undefined) {
    throw new Error(`tracing invariant: no state evidence loaded for entity ${entityId}`);
  }
  return evidence;
}

export function toTracedEntityDto(ref: GraphEntityRef, evidence: EntityStateEvidence): TracedEntityDto {
  return {
    id: ref.id,
    type: ref.type,
    displayName: ref.displayName,
    currentState: ref.currentState,
    state: {
      classification: STATE_CLASSIFICATION[ref.currentState],
      observation: evidence.observation,
      latestBySource: evidence.latestBySource,
    },
  };
}

function toAssertionDto(assertion: HopAssertion): HopAssertionDto {
  return {
    relationshipId: assertion.relationshipId,
    origin: assertion.origin,
    confidence: assertion.confidence,
    basis: assertion.basis,
    sourceSystem: assertion.sourceSystem,
    sourceId: assertion.sourceId,
    observedAt: assertion.observedAt.toISOString(),
    importId: assertion.importId,
  };
}

export function toHopDto(hop: TraversalHop, evidenceMap: EvidenceMap): HopDto {
  return {
    key: hop.key,
    relationshipType: hop.relationshipType,
    fromEntityId: hop.fromEntityId,
    toEntityId: hop.toEntityId,
    traversal: hop.traversal,
    effectiveOrigin: hop.effectiveOrigin,
    effectiveConfidence: hop.effectiveConfidence,
    assertions: hop.assertions.map(toAssertionDto),
    entity: toTracedEntityDto(hop.target, evidenceFor(evidenceMap, hop.target.id)),
  };
}

export function toPathDto(path: TraversalPath, evidenceMap: EvidenceMap): PathDto {
  return {
    hops: path.hops.map((hop) => toHopDto(hop, evidenceMap)),
    length: path.hops.length,
    weakestConfidence: path.weakestConfidence,
    nonSourceHops: path.nonSourceHops,
    continuesBeyondDepth: path.continuesBeyondDepth,
  };
}

export function toCycleClosingHopDto(hop: CycleClosingHop): CycleClosingHopDto {
  return {
    key: hop.key,
    relationshipType: hop.relationshipType,
    fromEntityId: hop.fromEntityId,
    toEntityId: hop.toEntityId,
    relationshipIds: [...hop.relationshipIds],
  };
}

/** The start entity plus every hop target, unique, in first-seen order. */
export function collectEntityIds(paths: readonly TraversalPath[], startId: string): string[] {
  const seen = new Set<string>([startId]);
  for (const path of paths) {
    for (const hop of path.hops) {
      seen.add(hop.target.id);
    }
  }
  return [...seen];
}
