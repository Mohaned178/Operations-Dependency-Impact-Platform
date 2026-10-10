import {
  CONFIDENCE_RANK,
  NodeReasonSchema,
  type EntityType,
  type NodeReason,
} from '@opsgraph/shared';
import type {
  GraphEntityRef,
  NeighborhoodReached,
  NeighborhoodTrace,
} from '../graph/graph.repository';
import { compareCodeUnits } from '../graph/traversal/path-order';

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
  /** Empty = every type matches. */
  entityTypes: readonly EntityType[];
  /** Rank order; empty when blockers are off. */
  blockerPaths: readonly ComposeBlockerPath[];
  /** Every hop entity of blockerPaths. */
  blockerEntities: ReadonlyMap<string, GraphEntityRef>;
  /** Request order. */
  expansions: readonly ComposeExpansion[];
  maxVisible: number;
}

export interface ComposedNode {
  entity: GraphEntityRef;
  distance: number | null;
  /** NodeReasonSchema option order. */
  reasons: NodeReason[];
  parentId: string | null;
  viaEdgeKey: string | null;
  expanded: boolean;
}

export interface ComposeOutput {
  /** Priority order, focus first, length <= maxVisible. */
  visible: ComposedNode[];
  omitted: number;
  omittedIsLowerBound: boolean;
  appliedExpansions: string[];
  ignoredExpansions: string[];
  blockerEdgeKeys: Set<string>;
}

function basePriority(a: NeighborhoodReached, b: NeighborhoodReached): number {
  return (
    a.distance - b.distance ||
    CONFIDENCE_RANK[b.weakestConfidence] - CONFIDENCE_RANK[a.weakestConfidence] ||
    a.nonSourceHops - b.nonSourceHops ||
    compareCodeUnits(a.entity.type, b.entity.type) ||
    compareCodeUnits(a.entity.displayName, b.entity.displayName) ||
    compareCodeUnits(a.entity.id, b.entity.id)
  );
}

/**
 * Contract api.md §3: the visible set of an explorer view, in priority order. Pure and
 * deterministic: the focus, then blocking paths, then the base neighborhood (with connectors),
 * then expansions, cut at `maxVisible`.
 */
export function composeNeighborhood(input: ComposeInput): ComposeOutput {
  const { focus, base, entityTypes, blockerPaths, blockerEntities, expansions, maxVisible } = input;
  const matches = (entity: GraphEntityRef): boolean =>
    entityTypes.length === 0 || entityTypes.includes(entity.type);

  const baseById = new Map<string, NeighborhoodReached>(
    base.reached.map((reached) => [reached.entity.id, reached]),
  );

  const list = new Map<string, ComposedNode>();
  const position = new Map<string, number>();
  const add = (
    entity: GraphEntityRef,
    reason: NodeReason,
    parentId: string | null,
    viaEdgeKey: string | null,
  ): void => {
    const existing = list.get(entity.id);
    if (existing !== undefined) {
      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
      return;
    }
    position.set(entity.id, list.size);
    list.set(entity.id, {
      entity,
      distance: entity.id === focus.id ? 0 : (baseById.get(entity.id)?.distance ?? null),
      reasons: [reason],
      parentId,
      viaEdgeKey,
      expanded: false,
    });
  };

  // 1. The focus.
  add(focus, 'FOCUS', null, null);

  // 2. Blocking paths, in rank order.
  for (const path of blockerPaths) {
    path.entityIds.forEach((entityId, i) => {
      const entity = blockerEntities.get(entityId);
      const edgeKey = path.edgeKeys[i];
      if (entity === undefined || edgeKey === undefined) {
        throw new Error(`explorer invariant: blocker hop ${entityId} has no entity or edge`);
      }
      add(entity, 'BLOCKING_PATH', i === 0 ? focus.id : (path.entityIds[i - 1] ?? focus.id), edgeKey);
    });
  }

  // 3. The base neighborhood, connectors first on each path.
  for (const reached of [...base.reached].sort(basePriority)) {
    if (!matches(reached.entity)) {
      continue;
    }
    for (let k = 1; k <= reached.pathEntityIds.length - 2; k += 1) {
      const intermediateId = reached.pathEntityIds[k];
      const parentId = reached.pathEntityIds[k - 1];
      const edgeKey = reached.pathEdgeKeys[k - 1];
      const intermediate = intermediateId === undefined ? undefined : baseById.get(intermediateId);
      if (intermediate === undefined || parentId === undefined || edgeKey === undefined) {
        throw new Error(`explorer invariant: path of ${reached.entity.id} is not in the trace`);
      }
      add(
        intermediate.entity,
        matches(intermediate.entity) ? 'NEIGHBORHOOD' : 'CONNECTOR',
        parentId,
        edgeKey,
      );
    }
    const parentId = reached.pathEntityIds.at(-2);
    const edgeKey = reached.pathEdgeKeys.at(-1);
    if (parentId === undefined || edgeKey === undefined) {
      throw new Error(`explorer invariant: ${reached.entity.id} has no path edge`);
    }
    add(reached.entity, 'NEIGHBORHOOD', parentId, edgeKey);
  }

  // 4. Expansions, in request order.
  const appliedExpansions: string[] = [];
  const ignoredExpansions: string[] = [];
  let expansionLimitReached = false;
  for (const { expandedId, trace } of expansions) {
    const index = position.get(expandedId);
    if (trace === null || index === undefined || index >= maxVisible) {
      ignoredExpansions.push(expandedId);
      continue;
    }
    appliedExpansions.push(expandedId);
    expansionLimitReached = expansionLimitReached || trace.explorationLimitReached;
    for (const reached of [...trace.reached].sort(basePriority)) {
      if (!matches(reached.entity) || reached.entity.id === focus.id) {
        continue;
      }
      const edgeKey = reached.pathEdgeKeys[0];
      if (edgeKey === undefined) {
        throw new Error(`explorer invariant: expansion of ${expandedId} has no path edge`);
      }
      add(reached.entity, 'EXPANSION', expandedId, edgeKey);
    }
  }

  // 5. Cut and finish.
  const reasonOrder = NodeReasonSchema.options;
  const visible = [...list.values()].slice(0, maxVisible).map((node) => ({
    ...node,
    reasons: [...node.reasons].sort((a, b) => reasonOrder.indexOf(a) - reasonOrder.indexOf(b)),
    expanded: appliedExpansions.includes(node.entity.id),
  }));

  return {
    visible,
    omitted: list.size - visible.length,
    omittedIsLowerBound: base.explorationLimitReached || expansionLimitReached,
    appliedExpansions,
    ignoredExpansions,
    blockerEdgeKeys: new Set(blockerPaths.flatMap((path) => path.edgeKeys)),
  };
}
