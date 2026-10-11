import { TRACING_LIMITS, type ImpactListSelector, type ImpactResponse } from '@opsgraph/shared';
import { useSearchParams } from 'react-router';
import { ExposureFigures } from './ExposureFigures';
import { ImpactList } from './ImpactList';
import { parseImpactParams, writeImpactParams } from './impact-params';
import { summaryCountFor } from './impact-labels';
import { ImpactTable } from './ImpactTable';
import { useImpact } from './useImpact';

const DEPTHS = Array.from(
  { length: TRACING_LIMITS.maxDepth - TRACING_LIMITS.minDepth + 1 },
  (_, index) => index + TRACING_LIMITS.minDepth,
);

export interface ImpactSectionProps {
  entityId: string;
}

export function ImpactSection({ entityId }: ImpactSectionProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseImpactParams(searchParams);
  const query = useImpact(entityId, params.depth);

  const update = (next: Parameters<typeof writeImpactParams>[1]) => {
    setSearchParams(writeImpactParams(searchParams, next), { replace: true });
  };

  return (
    <section id="impact" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Impact</h2>

      {query.isPending ? <p>Loading…</p> : null}
      {query.isError ? <p role="alert">Unable to load impact.</p> : null}
      {query.isSuccess ? (
        <ImpactContent
          entityId={entityId}
          data={query.data}
          depth={params.depth}
          list={params.list}
          updating={query.isPlaceholderData}
          onDepth={(depth) => update({ depth })}
          onOpen={(selector) => update({ list: selector })}
          onClose={() => update({ list: null })}
        />
      ) : null}
    </section>
  );
}

interface ImpactContentProps {
  entityId: string;
  data: ImpactResponse;
  depth: number;
  list: ImpactListSelector | null;
  updating: boolean;
  onDepth: (depth: number) => void;
  onOpen: (selector: ImpactListSelector) => void;
  onClose: () => void;
}

function ImpactContent({
  entityId,
  data,
  depth,
  list,
  updating,
  onDepth,
  onOpen,
  onClose,
}: ImpactContentProps) {
  // Spec FR-028: when nothing is affected, the section is one line naming the depth.
  if (data.countedTotal === 0) {
    const line = data.summary.find((entry) => entry.startsWith('Nothing is affected')) ?? data.summary.join(' ');
    return <p>{line}</p>;
  }

  const [headline, ...rest] = data.summary;

  return (
    <>
      <div className="flex flex-col gap-1">
        <p>
          <strong>{headline}</strong>
        </p>
        {rest.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm">
        Depth
        <select
          value={depth}
          onChange={(event) => onDepth(Number(event.target.value))}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {DEPTHS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {updating ? <span className="text-slate-500">Updating…</span> : null}
      </label>

      <ImpactTable categories={data.categories} onOpen={onOpen} />
      <ExposureFigures exposure={data.exposure} notCounted={data.notCounted} onOpen={onOpen} />

      {/* While the summary is the previous depth's placeholder, its counts do not match the new
          depth's list, so the list waits for the new summary. */}
      {list !== null && !updating ? (
        <ImpactList
          key={JSON.stringify(list)}
          entityId={entityId}
          depth={depth}
          selector={list}
          summaryCount={summaryCountFor(list, data)}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}
