import { DEPENDENCY_DIRECTION, type GraphEdgeDto, type NeighborhoodResponse } from '@opsgraph/shared';
import { COLUMN_GAP, ROW_GAP } from './flow-types';

export interface LayoutResult {
  /** Signed column index per node id. */
  layer: Map<string, number>;
  /** Node center in flow coordinates. */
  center: Map<string, { x: number; y: number }>;
}

/**
 * The column step of moving along `edge` away from `fromId`: -1 towards what the dependent relies
 * on (upstream, left), +1 towards the dependent (downstream, right), 0 for undirected context.
 */
export function stepBetween(edge: GraphEdgeDto, fromId: string): -1 | 0 | 1 {
  if (edge.relationshipType === 'RELATES_TO') {
    return 0;
  }
  const dependentId =
    DEPENDENCY_DIRECTION[edge.relationshipType] === 'FROM_DEPENDS_ON_TO'
      ? edge.fromEntityId
      : edge.toEntityId;
  return fromId === dependentId ? -1 : 1;
}

/** Signed-column layout (research R2): synchronous, pure and deterministic. */
export function layoutNeighborhood(response: NeighborhoodResponse): LayoutResult {
  const edgeByKey = new Map(response.edges.map((edge) => [edge.key, edge]));

  // 2. Layers. Parents always come before their children in response.nodes.
  const layer = new Map<string, number>();
  for (const node of response.nodes) {
    if (node.id === response.focusId) {
      layer.set(node.id, 0);
      continue;
    }
    const parentLayer = node.parentId === null ? undefined : layer.get(node.parentId);
    const edge = node.viaEdgeKey === null ? undefined : edgeByKey.get(node.viaEdgeKey);
    if (node.parentId === null || parentLayer === undefined || edge === undefined) {
      throw new Error(`explorer layout: node ${node.id} has no placed parent or parent edge`);
    }
    layer.set(node.id, parentLayer + stepBetween(edge, node.parentId));
  }

  // 3. Tree order: iterative depth-first pre-order from the focus.
  const children = new Map<string, string[]>();
  for (const node of response.nodes) {
    if (node.parentId !== null) {
      const list = children.get(node.parentId);
      if (list === undefined) {
        children.set(node.parentId, [node.id]);
      } else {
        list.push(node.id);
      }
    }
  }
  const treeIndex = new Map<string, number>();
  const stack: string[] = [response.focusId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      break;
    }
    treeIndex.set(current, treeIndex.size);
    const kids = children.get(current) ?? [];
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i];
      if (kid !== undefined) {
        stack.push(kid);
      }
    }
  }

  // 4. Columns, each sorted by tree order.
  const columns = new Map<number, string[]>();
  for (const node of response.nodes) {
    const column = layer.get(node.id) ?? 0;
    const list = columns.get(column);
    if (list === undefined) {
      columns.set(column, [node.id]);
    } else {
      list.push(node.id);
    }
  }

  // 5. Positions.
  const center = new Map<string, { x: number; y: number }>();
  for (const [column, ids] of columns) {
    ids.sort((a, b) => (treeIndex.get(a) ?? 0) - (treeIndex.get(b) ?? 0));
    const x = column * COLUMN_GAP;
    if (column === 0) {
      let below = 0;
      for (const nodeId of ids) {
        if (nodeId === response.focusId) {
          center.set(nodeId, { x, y: 0 });
        } else {
          below += 1;
          center.set(nodeId, { x, y: below * ROW_GAP });
        }
      }
    } else {
      ids.forEach((nodeId, i) => {
        center.set(nodeId, { x, y: (i - (ids.length - 1) / 2) * ROW_GAP });
      });
    }
  }

  return { layer, center };
}
