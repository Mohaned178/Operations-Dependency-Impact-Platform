import {
  TRACING_LIMITS,
  type BlockersResponse,
  type BlockingPathDto,
  type Confidence,
} from '@opsgraph/shared';
import { OriginBadge } from './OriginBadge';

const BADGE_CLASSES = 'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium';

interface NonSourceBadge {
  origin: 'INFERRED' | 'MANUAL';
  confidence: Confidence;
}

/** One badge per distinct (origin, confidence) among the hops that are not sourced facts. */
function nonSourceBadges(path: BlockingPathDto): NonSourceBadge[] {
  const seen = new Map<string, NonSourceBadge>();
  for (const hop of path.hops) {
    if (hop.effectiveOrigin !== 'SOURCE') {
      seen.set(`${hop.effectiveOrigin}/${hop.effectiveConfidence}`, {
        origin: hop.effectiveOrigin,
        confidence: hop.effectiveConfidence,
      });
    }
  }
  return [...seen.values()];
}

export interface PathLabelsProps {
  path: BlockingPathDto;
  /** The depth the blockers were searched to (`BlockersResponse.query.depth`). */
  depth: number;
}

/** The labels of a blocking path (spec FR-022): non-SOURCE hops, cycle, depth cut, unknown state. */
export function PathLabels({ path, depth }: PathLabelsProps) {
  const lastEntity = path.hops.at(-1)?.entity;
  return (
    <>
      {nonSourceBadges(path).map((badge) => (
        <OriginBadge
          key={`${badge.origin}/${badge.confidence}`}
          origin={badge.origin}
          confidence={badge.confidence}
        />
      ))}
      {path.endsInCycle ? (
        <span className={`${BADGE_CLASSES} border-slate-300 bg-slate-50 text-slate-700`}>
          Ends in a cycle
        </span>
      ) : null}
      {path.continuesBeyondDepth ? (
        <span className={`${BADGE_CLASSES} border-slate-300 bg-slate-50 text-slate-700`}>
          {`Continues beyond depth ${depth}`}
        </span>
      ) : null}
      {lastEntity?.currentState === 'UNKNOWN' ? (
        <span className={`${BADGE_CLASSES} border-slate-300 bg-slate-50 text-slate-700`}>
          Possible blocker (state unknown)
        </span>
      ) : null}
    </>
  );
}

/** The truncation and cycle notices that follow a blockers result. */
export function TruncationNotes({ data }: { data: BlockersResponse }) {
  return (
    <>
      {data.truncation.pathLimit ? (
        <p className="text-sm text-slate-600">
          {`Showing the first ${TRACING_LIMITS.maxBlockingPaths} blocking paths.`}
        </p>
      ) : null}
      {data.truncation.depthLimit ? (
        <p className="text-sm text-slate-600">
          {`Some chains continue beyond depth ${data.query.depth}.`}
        </p>
      ) : null}
      {data.truncation.explorationLimit ? (
        <p className="text-sm text-slate-600">
          {`Exploration stopped after ${TRACING_LIMITS.maxReachedEntities.toLocaleString('en-US')} entities, so this list is partial.`}
        </p>
      ) : null}
      {data.cycleClosingHopCount > 0 ? (
        <p className="text-sm text-slate-600">
          {`${data.cycleClosingHopCount} ${data.cycleClosingHopCount === 1 ? 'relationship closes' : 'relationships close'} a dependency cycle and ${data.cycleClosingHopCount === 1 ? 'was' : 'were'} not followed.`}
        </p>
      ) : null}
    </>
  );
}
