import { MarkerType, type EdgeMarker } from '@xyflow/react';
import type { GraphEdgeDto } from '@opsgraph/shared';
import type { Emphasis } from './flow-types';

export interface EdgeVisual {
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string | undefined;
  opacity: number;
  marker: EdgeMarker | undefined;
  showLabel: boolean;
  label: string;
}

const COLOR_SELECTED = '#2563eb';
const COLOR_HIGHLIGHTED = '#dc2626';
const COLOR_RELATES_TO = '#94a3b8';
const COLOR_DEFAULT = '#64748b';

function strokeFor(edge: GraphEdgeDto, emphasis: Emphasis, selected: boolean): string {
  if (selected) {
    return COLOR_SELECTED;
  }
  if (emphasis === 'highlighted') {
    return COLOR_HIGHLIGHTED;
  }
  if (edge.relationshipType === 'RELATES_TO') {
    return COLOR_RELATES_TO;
  }
  return COLOR_DEFAULT;
}

function dasharrayFor(origin: GraphEdgeDto['effectiveOrigin']): string | undefined {
  switch (origin) {
    case 'SOURCE':
      return undefined;
    case 'INFERRED':
      return '8 4';
    case 'MANUAL':
      return '2 4';
  }
}

function baseWidthFor(confidence: GraphEdgeDto['effectiveConfidence']): number {
  switch (confidence) {
    case 'HIGH':
      return 2.5;
    case 'MEDIUM':
      return 1.75;
    case 'LOW':
      return 1;
  }
}

function originLabelFor(origin: GraphEdgeDto['effectiveOrigin']): string {
  switch (origin) {
    case 'SOURCE':
      return 'Source';
    case 'INFERRED':
      return 'Inferred';
    case 'MANUAL':
      return 'Manual';
  }
}

/** ui.md §6: encodes origin (dash), confidence (width), emphasis and selection. */
export function edgeStyle(edge: GraphEdgeDto, emphasis: Emphasis, selected: boolean): EdgeVisual {
  const stroke = strokeFor(edge, emphasis, selected);
  const emphasized = selected || emphasis === 'highlighted';
  const strokeWidth = baseWidthFor(edge.effectiveConfidence) + (emphasized ? 1 : 0);

  let opacity = 1;
  if (emphasis === 'dimmed') {
    opacity = 0.15;
  } else if (edge.effectiveConfidence === 'LOW') {
    opacity = 0.7;
  }

  const marker: EdgeMarker | undefined =
    edge.relationshipType === 'RELATES_TO'
      ? undefined
      : { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke };

  const showLabel = selected || edge.effectiveOrigin !== 'SOURCE';

  const originLabel = `${originLabelFor(edge.effectiveOrigin)} · ${edge.effectiveConfidence}`;
  const label = selected ? `${edge.relationshipType} · ${originLabel}` : originLabel;

  return {
    stroke,
    strokeWidth,
    strokeDasharray: dasharrayFor(edge.effectiveOrigin),
    opacity,
    marker,
    showLabel,
    label,
  };
}
