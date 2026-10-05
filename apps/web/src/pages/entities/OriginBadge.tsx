import type { Confidence, RelationshipOrigin } from '@opsgraph/shared';

const ORIGIN_LABELS: Record<RelationshipOrigin, string> = {
  SOURCE: 'Source',
  INFERRED: 'Inferred',
  MANUAL: 'Manual',
};

const ORIGIN_CLASSES: Record<RelationshipOrigin, string> = {
  SOURCE: 'border-solid border-slate-300 bg-white text-slate-700',
  INFERRED: 'border-dashed border-amber-400 bg-amber-50 text-amber-800',
  MANUAL: 'border-dotted border-violet-400 bg-violet-50 text-violet-800',
};

export interface OriginBadgeProps {
  origin: RelationshipOrigin;
  confidence: Confidence;
}

export function OriginBadge({ origin, confidence }: OriginBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${ORIGIN_CLASSES[origin]}`}
    >
      {ORIGIN_LABELS[origin]} · {confidence}
    </span>
  );
}
