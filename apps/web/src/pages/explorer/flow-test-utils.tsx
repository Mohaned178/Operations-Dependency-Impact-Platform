import type { NeighborhoodResponse } from '@opsgraph/shared';
import { ReactFlow, ReactFlowProvider, type NodeTypes, type EdgeTypes } from '@xyflow/react';
import { render } from '@testing-library/react';
import { computeEmphasis } from './emphasis';
import { ExplorerActionsContext, type ExplorerActions } from './explorer-actions';
import { EntityNode } from './EntityNode';
import type { EntityFlowNode, RelationshipFlowEdge, Selection } from './flow-types';
import { layoutNeighborhood } from './layout';
import { RelationshipEdge } from './RelationshipEdge';
import { toFlow } from './to-flow';

const nodeTypes = { entity: EntityNode } satisfies NodeTypes;
const edgeTypes = { relationship: RelationshipEdge } satisfies EdgeTypes;

export function flowFor(
  response: NeighborhoodResponse,
  options: { selection?: Selection; focusMode?: boolean; selectedPathIndex?: number | null } = {},
): { nodes: EntityFlowNode[]; edges: RelationshipFlowEdge[] } {
  const selection = options.selection ?? null;
  return toFlow({
    response,
    layout: layoutNeighborhood(response),
    emphasis: computeEmphasis({
      response,
      selection,
      focusMode: options.focusMode ?? false,
      selectedPathIndex: options.selectedPathIndex ?? null,
    }),
    selection,
  });
}

/** Renders nodes and edges in a minimal React Flow with a fixed-size container (ui.md §17). */
export function renderFlow(
  nodes: EntityFlowNode[],
  edges: RelationshipFlowEdge[] = [],
  actions: ExplorerActions = { toggleExpand: () => undefined },
) {
  return render(
    <ExplorerActionsContext.Provider value={actions}>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView />
        </ReactFlowProvider>
      </div>
    </ExplorerActionsContext.Provider>,
  );
}
