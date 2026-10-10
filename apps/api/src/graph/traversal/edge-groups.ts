import {
  CONFIDENCE_RANK,
  ORIGIN_RANK,
  type Confidence,
  type RelationshipOrigin,
  type RelationshipType,
} from '@opsgraph/shared';
import type { HopAssertion } from '../graph.repository';
import { compareCodeUnits } from './path-order';
import type { EdgeRow, TraversalEdge } from './types';

/** One (type, from, to) group of relationship rows: a single hop candidate before walk direction. */
export interface EdgeGroup<T extends RelationshipType> {
  /** Smallest relationship id of the group. */
  key: string;
  type: T;
  fromEntityId: string;
  toEntityId: string;
  effectiveOrigin: RelationshipOrigin;
  effectiveConfidence: Confidence;
  assertions: HopAssertion[];
}

function toAssertion<T extends RelationshipType>(row: EdgeRow<T>): HopAssertion {
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
 * Research R4 of feature 003: groups relationship rows by (type, from, to), sorts each group's
 * assertions, picks the effective origin and confidence, and keys the group by its smallest
 * relationship id. Returned sorted by key (code-unit order).
 */
export function groupEdgeRows<T extends RelationshipType>(
  rows: readonly EdgeRow<T>[],
): EdgeGroup<T>[] {
  const groups = new Map<string, EdgeRow<T>[]>();
  for (const row of rows) {
    const groupKey = JSON.stringify([row.type, row.fromEntityId, row.toEntityId]);
    const group = groups.get(groupKey);
    if (group === undefined) {
      groups.set(groupKey, [row]);
    } else {
      group.push(row);
    }
  }

  const result: EdgeGroup<T>[] = [];
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

    result.push({
      key,
      type: first.type,
      fromEntityId: first.fromEntityId,
      toEntityId: first.toEntityId,
      effectiveOrigin: effective.origin,
      effectiveConfidence: effective.confidence,
      assertions,
    });
  }

  return result.sort((a, b) => compareCodeUnits(a.key, b.key));
}

/**
 * 'ALL' walks: two traversal edges per group with the same key, FORWARD (from → to) then REVERSE
 * (to → from). Sorted by (key, FORWARD before REVERSE).
 */
export function buildUndirectedTraversalEdges<T extends RelationshipType>(
  groups: readonly EdgeGroup<T>[],
): TraversalEdge<T>[] {
  const edges: TraversalEdge<T>[] = [];
  for (const group of groups) {
    for (const traversal of ['FORWARD', 'REVERSE'] as const) {
      const forward = traversal === 'FORWARD';
      edges.push({
        key: group.key,
        type: group.type,
        fromEntityId: group.fromEntityId,
        toEntityId: group.toEntityId,
        sourceId: forward ? group.fromEntityId : group.toEntityId,
        targetId: forward ? group.toEntityId : group.fromEntityId,
        traversal,
        effectiveOrigin: group.effectiveOrigin,
        effectiveConfidence: group.effectiveConfidence,
        nonSource: group.effectiveOrigin !== 'SOURCE',
        assertions: group.assertions,
      });
    }
  }
  return edges.sort(
    (a, b) =>
      compareCodeUnits(a.key, b.key) ||
      (a.traversal === b.traversal ? 0 : a.traversal === 'FORWARD' ? -1 : 1),
  );
}
