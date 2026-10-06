import {
  CONFIDENCE_RANK,
  DEPENDENCY_DIRECTION,
  ORIGIN_RANK,
  type Confidence,
  type RelationshipOrigin,
} from '@opsgraph/shared';
import type { HopAssertion } from '../graph.repository';
import { compareCodeUnits } from './path-order';
import type { EdgeRow, TraversalEdge, WalkDirection } from './types';

function toAssertion(row: EdgeRow): HopAssertion {
  return {
    relationshipId: row.id,
    origin: row.origin,
    confidence: row.confidence,
    basis: row.basis,
    sourceSystem: row.sourceSystem,
    sourceId: row.sourceId,
    observedAt: row.observedAt,
    importId: row.importId,
  };
}

function compareAssertions(a: HopAssertion, b: HopAssertion): number {
  return (
    ORIGIN_RANK[b.origin] - ORIGIN_RANK[a.origin] ||
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
    b.observedAt.getTime() - a.observedAt.getTime() ||
    compareCodeUnits(a.relationshipId, b.relationshipId)
  );
}

function effectiveOf(assertions: readonly HopAssertion[]): {
  origin: RelationshipOrigin;
  confidence: Confidence;
} {
  const [first] = assertions;
  if (first === undefined) {
    throw new Error('traversal invariant: hop without assertions');
  }
  // Sorted by origin rank first, so the first assertion carries the effective origin and, within
  // that origin, the highest confidence.
  return { origin: first.origin, confidence: first.confidence };
}

/**
 * Research R4: groups relationship rows by (type, from, to) into hop candidates and works out
 * the walk direction, the effective origin and confidence, and the assertion order.
 */
export function buildTraversalEdges(
  rows: readonly EdgeRow[],
  direction: WalkDirection,
): TraversalEdge[] {
  const groups = new Map<string, EdgeRow[]>();
  for (const row of rows) {
    const groupKey = JSON.stringify([row.type, row.fromEntityId, row.toEntityId]);
    const group = groups.get(groupKey);
    if (group === undefined) {
      groups.set(groupKey, [row]);
    } else {
      group.push(row);
    }
  }

  const edges: TraversalEdge[] = [];
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined) {
      continue;
    }
    const assertions = group.map(toAssertion).sort(compareAssertions);
    const effective = effectiveOf(assertions);
    const key = assertions
      .map((assertion) => assertion.relationshipId)
      .reduce((smallest, id) => (compareCodeUnits(id, smallest) < 0 ? id : smallest));

    const dependentIsFrom = DEPENDENCY_DIRECTION[first.type] === 'FROM_DEPENDS_ON_TO';
    const traversal = (direction === 'UPSTREAM') === dependentIsFrom ? 'FORWARD' : 'REVERSE';

    edges.push({
      key,
      type: first.type,
      fromEntityId: first.fromEntityId,
      toEntityId: first.toEntityId,
      sourceId: traversal === 'FORWARD' ? first.fromEntityId : first.toEntityId,
      targetId: traversal === 'FORWARD' ? first.toEntityId : first.fromEntityId,
      traversal,
      effectiveOrigin: effective.origin,
      effectiveConfidence: effective.confidence,
      nonSource: effective.origin !== 'SOURCE',
      assertions,
    });
  }

  return edges.sort((a, b) => compareCodeUnits(a.key, b.key));
}
