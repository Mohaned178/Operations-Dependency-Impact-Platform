import type { BlockerDto, BlockersResponse } from '@opsgraph/shared';
import { Link } from 'react-router';
import { ExplanationSentence, linkTargets } from './ExplanationSentence';
import { PathLabels, TruncationNotes } from './PathLabels';
import { PathView } from './PathView';
import { StateBadge } from './StateBadge';
import { useBlockers } from './useBlockers';

function steps(count: number): string {
  return `${count} step${count === 1 ? '' : 's'}`;
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
            <PathLabels path={path} depth={data.query.depth} />
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

      <TruncationNotes data={data} />
    </>
  );
}
