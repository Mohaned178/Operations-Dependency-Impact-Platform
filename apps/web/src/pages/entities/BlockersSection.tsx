import {
  TRACING_LIMITS,
  type BlockerDto,
  type BlockersResponse,
  type BlockingPathDto,
  type Confidence,
} from '@opsgraph/shared';
import { Link } from 'react-router';
import { ExplanationSentence, linkTargets } from './ExplanationSentence';
import { OriginBadge } from './OriginBadge';
import { PathView } from './PathView';
import { StateBadge } from './StateBadge';
import { useBlockers } from './useBlockers';

const BADGE_CLASSES = 'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium';

function steps(count: number): string {
  return `${count} step${count === 1 ? '' : 's'}`;
}

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

function BlockerList({ title, blockers }: { title: string; blockers: readonly BlockerDto[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {blockers.map((blocker) => (
          <li key={blocker.entity.id} className="flex flex-wrap items-center gap-2">
            <Link to={`/entities/${blocker.entity.id}`} className="font-medium underline">
              {blocker.entity.displayName}
            </Link>
            <StateBadge state={blocker.entity.currentState} />
            <span className="text-slate-500">{steps(blocker.pathLength)} away</span>
            {blocker.possible ? (
              <span className="text-slate-500">state unknown, possible blocker</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BlockersSectionProps {
  entityId: string;
}

export function BlockersSection({ entityId }: BlockersSectionProps) {
  const blockersQuery = useBlockers(entityId);

  return (
    <section id="blockers" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Blockers</h2>

      {blockersQuery.isPending ? <p>Loading…</p> : null}
      {blockersQuery.isError ? <p role="alert">Unable to load blockers.</p> : null}
      {blockersQuery.isSuccess ? <BlockersContent data={blockersQuery.data} /> : null}
    </section>
  );
}

function BlockersContent({ data }: { data: BlockersResponse }) {
  if (data.paths.length === 0) {
    return <p>{data.summary}</p>;
  }

  const lastEntity = (path: BlockingPathDto) => path.hops.at(-1)?.entity;

  return (
    <>
      <p>{data.summary}</p>

      {data.paths.map((path, index) => (
        <article
          key={path.hops.map((hop) => hop.key).join('/')}
          className="flex flex-col gap-2 rounded border bg-white p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{`Path ${index + 1}`}</h3>
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
                {`Continues beyond depth ${data.query.depth}`}
              </span>
            ) : null}
            {lastEntity(path)?.currentState === 'UNKNOWN' ? (
              <span className={`${BADGE_CLASSES} border-slate-300 bg-slate-50 text-slate-700`}>
                Possible blocker (state unknown)
              </span>
            ) : null}
          </div>

          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            {path.explanation.map((sentence) => (
              <li key={sentence}>
                <ExplanationSentence sentence={sentence} targets={linkTargets(data.start, path)} />
              </li>
            ))}
          </ol>

          <PathView start={data.start} path={path} direction="upstream" />
        </article>
      ))}

      <BlockerList title="Direct blockers" blockers={data.directBlockers} />
      <BlockerList title="Deepest blockers" blockers={data.deepestBlockers} />

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
