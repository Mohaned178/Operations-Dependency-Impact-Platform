import type { GraphEdgeDto } from '@opsgraph/shared';
import { type EdgeVisual, edgeStyle } from './edge-style';

type EdgeOrigin = GraphEdgeDto['effectiveOrigin'];
type EdgeConfidence = GraphEdgeDto['effectiveConfidence'];

function sampleEdge(
  origin: EdgeOrigin,
  confidence: EdgeConfidence,
  relationshipType: GraphEdgeDto['relationshipType'] = 'REQUIRES',
): GraphEdgeDto {
  return {
    key: 'legend',
    relationshipType,
    fromEntityId: 'legend-from',
    toEntityId: 'legend-to',
    effectiveOrigin: origin,
    effectiveConfidence: confidence,
    assertions: [],
  };
}

function LineSample({ visual }: { visual: EdgeVisual }) {
  return (
    <svg width={40} height={10} aria-hidden="true" className="shrink-0">
      <line
        x1={0}
        y1={5}
        x2={40}
        y2={5}
        stroke={visual.stroke}
        strokeWidth={visual.strokeWidth}
        strokeDasharray={visual.strokeDasharray}
        opacity={visual.opacity}
      />
    </svg>
  );
}

const SOURCE_STYLE = edgeStyle(sampleEdge('SOURCE', 'HIGH'), 'normal', false);
const INFERRED_STYLE = edgeStyle(sampleEdge('INFERRED', 'HIGH'), 'normal', false);
const MANUAL_STYLE = edgeStyle(sampleEdge('MANUAL', 'HIGH'), 'normal', false);
const CONFIDENCE_STYLES = [
  edgeStyle(sampleEdge('SOURCE', 'HIGH'), 'normal', false),
  edgeStyle(sampleEdge('SOURCE', 'MEDIUM'), 'normal', false),
  edgeStyle(sampleEdge('SOURCE', 'LOW'), 'normal', false),
];
const RELATES_TO_STYLE = edgeStyle(
  sampleEdge('SOURCE', 'HIGH', 'RELATES_TO'),
  'normal',
  false,
);
const BLOCKING_STYLE = edgeStyle(sampleEdge('SOURCE', 'HIGH'), 'highlighted', false);

const NODE_CHIPS: Array<{ label: string; className: string }> = [
  { label: 'Focus', className: 'border-2 border-blue-600 text-slate-900' },
  { label: 'Connector', className: 'bg-slate-200 text-slate-700' },
  { label: 'Conflict', className: 'bg-amber-100 text-amber-800' },
  { label: 'State unknown', className: 'border border-slate-400 text-slate-600' },
  { label: 'Direct blocker', className: 'border border-red-600 text-red-700' },
  { label: 'Deepest blocker', className: 'bg-red-600 text-white' },
];

/** ui.md §6: legend for edge encoding and node chips, bottom-left of the canvas. */
export function GraphLegend() {
  return (
    <section
      aria-label="Legend"
      className="absolute bottom-2 left-2 z-10 flex flex-col gap-2 rounded border border-slate-300 bg-white p-2 text-xs text-slate-700 shadow-sm"
    >
      <ul className="flex flex-col gap-1">
        <li className="flex items-center gap-2">
          <LineSample visual={SOURCE_STYLE} />
          <span>Source (solid)</span>
        </li>
        <li className="flex items-center gap-2">
          <LineSample visual={INFERRED_STYLE} />
          <span>Inferred (dashed)</span>
        </li>
        <li className="flex items-center gap-2">
          <LineSample visual={MANUAL_STYLE} />
          <span>Manual (dotted)</span>
        </li>
        <li className="flex items-center gap-2">
          {CONFIDENCE_STYLES.map((visual, index) => (
            <LineSample key={index} visual={visual} />
          ))}
          <span>High / Medium / Low confidence (thicker → thinner)</span>
        </li>
        <li className="flex items-center gap-2">
          <LineSample visual={RELATES_TO_STYLE} />
          <span>Relates to (grey, no arrow)</span>
        </li>
        <li className="flex items-center gap-2">
          <LineSample visual={BLOCKING_STYLE} />
          <span>Blocking path (red)</span>
        </li>
      </ul>
      <ul className="flex flex-wrap gap-1">
        {NODE_CHIPS.map((chip) => (
          <li key={chip.label} className={`rounded px-1 text-[10px] ${chip.className}`}>
            {chip.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
