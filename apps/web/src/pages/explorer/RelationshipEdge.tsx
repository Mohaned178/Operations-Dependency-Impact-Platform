import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { memo } from 'react';
import { edgeStyle } from './edge-style';
import type { RelationshipFlowEdge } from './flow-types';

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
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
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
