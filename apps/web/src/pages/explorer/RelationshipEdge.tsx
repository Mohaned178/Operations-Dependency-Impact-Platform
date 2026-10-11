import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  type EdgeProps,
} from '@xyflow/react';
import { memo } from 'react';
import { edgeStyle } from './edge-style';
import type { RelationshipFlowEdge } from './flow-types';

/** Distance in px between parallel edges of the same node pair. */
const PARALLEL_SPREAD = 14;

export const RelationshipEdge = memo(function RelationshipEdge({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps<RelationshipFlowEdge>) {
  if (data === undefined) {
    return null;
  }
  const visual = edgeStyle(data.edge, data.emphasis, selected === true);
  // React Flow's bezier ignores curvature when the target lies ahead of the source, so parallel
  // edges would be drawn on top of each other. Spread them sideways as well (spec edge case:
  // parallel relationships are each drawn and separately selectable).
  const spread = PARALLEL_SPREAD * data.parallelIndex;
  const sameSide = sourcePosition === targetPosition;
  const shiftX = sameSide ? (sourcePosition === Position.Right ? spread : -spread) : 0;
  const shiftY = sameSide ? 0 : spread;
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sourceX + shiftX,
    sourceY: sourceY + shiftY,
    sourcePosition,
    targetX: targetX + shiftX,
    targetY: targetY + shiftY,
    targetPosition,
    curvature: 0.25 + 0.2 * data.parallelIndex,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={16}
        style={{
          stroke: visual.stroke,
          strokeWidth: visual.strokeWidth,
          strokeDasharray: visual.strokeDasharray,
          opacity: visual.opacity,
        }}
      />
      {visual.showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded border border-slate-300 bg-white px-1 text-[10px] leading-4 text-slate-700"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              opacity: visual.opacity,
            }}
          >
            {visual.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
