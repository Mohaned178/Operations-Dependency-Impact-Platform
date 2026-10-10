import '@xyflow/react/dist/style.css';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { EntityNode } from './EntityNode';
import type { EntityFlowNode, RelationshipFlowEdge } from './flow-types';
import { GraphLegend } from './GraphLegend';
import type { LayoutResult } from './layout';
import { RelationshipEdge } from './RelationshipEdge';

// Module level: declaring these inside a component would re-mount every node on each render.
const nodeTypes = { entity: EntityNode } satisfies NodeTypes;
const edgeTypes = { relationship: RelationshipEdge } satisfies EdgeTypes;

export interface GraphCanvasProps {
  nodes: EntityFlowNode[];
  edges: RelationshipFlowEdge[];
  onSelectNode: (id: string) => void;
  onSelectEdge: (key: string) => void;
  onClearSelection: () => void;
  /** Set when a selection comes from the list: the canvas pans to that node. */
  centerOn: { id: string; nonce: number } | null;
  centers: LayoutResult['center'];
}

/** Contract ui.md §9. Rendered inside a ReactFlowProvider by ExplorerPage. */
export function GraphCanvas({
  nodes,
  edges,
  onSelectNode,
  onSelectEdge,
  onClearSelection,
  centerOn,
  centers,
}: GraphCanvasProps) {
  const { setCenter, getZoom } = useReactFlow();
  const handledNonce = useRef<number | null>(null);

  useEffect(() => {
    if (centerOn === null || handledNonce.current === centerOn.nonce) {
      return;
    }
    const center = centers.get(centerOn.id);
    if (center === undefined) {
      return;
    }
    handledNonce.current = centerOn.nonce;
    void setCenter(center.x, center.y, { zoom: getZoom(), duration: 200 });
  }, [centerOn, centers, setCenter, getZoom]);

  return (
    <div className="relative h-full min-h-[480px] w-full" data-testid="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          onSelectNode(node.id);
        }}
        onEdgeClick={(_, edge) => {
          onSelectEdge(edge.id);
        }}
        onPaneClick={onClearSelection}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        nodesFocusable
        edgesFocusable
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        onlyRenderVisibleElements
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <GraphLegend />
    </div>
  );
}
