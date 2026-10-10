import type { GraphEdgeDto, NeighborhoodResponse } from '@opsgraph/shared';
import { stateLabel } from '../entities/StateBadge';
import { edgeStyle } from './edge-style';
import type { EmphasisResult } from './emphasis';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type EntityFlowNode,
  type RelationshipFlowEdge,
  type Selection,
} from './flow-types';
import type { LayoutResult } from './layout';
import { hasConflict, isConnectorOnly } from './NodeChips';
import { compareCodeUnits } from './text-order';

export interface ToFlowInput {
  response: NeighborhoodResponse;
  layout: LayoutResult;
  emphasis: EmphasisResult;
  selection: Selection;
}

/** 0 for the first edge between an unordered node pair (by key), 1 for the second, ... */
function parallelIndexes(edges: readonly GraphEdgeDto[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  for (const edge of edges) {
    const pair = [edge.fromEntityId, edge.toEntityId].sort(compareCodeUnits).join('|');
    const keys = groups.get(pair);
    if (keys === undefined) {
      groups.set(pair, [edge.key]);
    } else {
      keys.push(edge.key);
    }
  }
  const index = new Map<string, number>();
  for (const keys of groups.values()) {
    keys.sort(compareCodeUnits).forEach((key, i) => index.set(key, i));
  }
  return index;
}

function handlesFor(
  fromLayer: number,
  toLayer: number,
): { sourceHandle: string; targetHandle: string } {
  if (fromLayer < toLayer) {
    return { sourceHandle: 'out-right', targetHandle: 'in-left' };
  }
  if (fromLayer > toLayer) {
    return { sourceHandle: 'out-left', targetHandle: 'in-right' };
  }
  return { sourceHandle: 'out-right', targetHandle: 'in-right' };
}

/** Contract ui.md §5: the response, layout, emphasis and selection as React Flow nodes and edges. */
export function toFlow(input: ToFlowInput): {
  nodes: EntityFlowNode[];
  edges: RelationshipFlowEdge[];
} {
  const { response, layout, emphasis, selection } = input;
  const nodesById = new Map(response.nodes.map((n) => [n.id, n]));

  const nodes = response.nodes.map((entity): EntityFlowNode => {
    const center = layout.center.get(entity.id);
    if (center === undefined) {
      throw new Error(`explorer flow: node ${entity.id} has no layout position`);
    }
    return {
      id: entity.id,
      type: 'entity',
      position: { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        entity,
        isFocus: entity.id === response.focusId,
        isConnector: isConnectorOnly(entity),
        hasConflict: hasConflict(entity),
        emphasis: emphasis.nodes.get(entity.id) ?? 'normal',
        blockerRole: emphasis.blockerRole.get(entity.id) ?? 'none',
        canExpand: false,
      },
      selected: selection?.kind === 'node' && selection.id === entity.id,
      draggable: false,
      connectable: false,
      deletable: false,
      selectable: true,
      ariaLabel: `${entity.type} ${entity.displayName}, ${stateLabel(entity.currentState)}`,
    };
  });

  const parallel = parallelIndexes(response.edges);
  const edges = response.edges.map((edge): RelationshipFlowEdge => {
    const edgeEmphasis = emphasis.edges.get(edge.key) ?? 'normal';
    const selected = selection?.kind === 'edge' && selection.key === edge.key;
    const fromName = nodesById.get(edge.fromEntityId)?.displayName ?? edge.fromEntityId;
    const toName = nodesById.get(edge.toEntityId)?.displayName ?? edge.toEntityId;
    return {
      id: edge.key,
      type: 'relationship',
      source: edge.fromEntityId,
      target: edge.toEntityId,
      ...handlesFor(
        layout.layer.get(edge.fromEntityId) ?? 0,
        layout.layer.get(edge.toEntityId) ?? 0,
      ),
      data: { edge, emphasis: edgeEmphasis, parallelIndex: parallel.get(edge.key) ?? 0 },
      selected,
      markerEnd: edgeStyle(edge, edgeEmphasis, selected).marker,
      deletable: false,
      focusable: true,
      selectable: true,
      interactionWidth: 16,
      ariaLabel: `${fromName} ${edge.relationshipType} ${toName}, ${edge.effectiveOrigin} ${edge.effectiveConfidence}`,
    };
  });

  return { nodes, edges };
}
