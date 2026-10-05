import { useInfiniteQuery } from '@tanstack/react-query';
import { StateHistoryResponseSchema, type EntityDetailDto } from '@opsgraph/shared';
import { apiFetch } from '../../lib/api-client';
import { formatTimestamp } from '../../lib/format';
import { StateBadge } from './StateBadge';

const PAGE_LIMIT = 50;

export interface CurrentStateSectionProps {
  entity: EntityDetailDto;
}

export function CurrentStateSection({ entity }: CurrentStateSectionProps) {
  const historyQuery = useInfiniteQuery({
    queryKey: ['entities', entity.id, 'states'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      return apiFetch(`/entities/${entity.id}/states?${params.toString()}`, {
        schema: StateHistoryResponseSchema,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const history = historyQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const current = entity.currentStateObservation;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Current state</h2>

      {current === null ? (
        <p>No state observed</p>
      ) : (
        <p className="flex items-center gap-2 text-sm">
          <StateBadge state={current.state} />
          <span>
            from {current.sourceSystem} · {formatTimestamp(current.observedAt)}
          </span>
          {current.sourceStatus === null ? null : (
            <span className="text-slate-500">source status: {current.sourceStatus}</span>
          )}
        </p>
      )}

      <h3 className="text-sm font-semibold">By source</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {entity.latestStateBySource.map((observation) => (
          <li key={observation.id} className="flex items-center gap-2">
            <span className="w-32 truncate text-slate-500">{observation.sourceSystem}</span>
            <StateBadge state={observation.state} />
            <span className="text-slate-500">{formatTimestamp(observation.observedAt)}</span>
          </li>
        ))}
      </ul>

      <h3 className="text-sm font-semibold">History</h3>
      {historyQuery.isPending ? <p>Loading…</p> : null}
      {historyQuery.isError ? (
        <p role="alert">Unable to load the state history.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {history.map((observation) => (
            <li key={observation.id} className="flex items-center gap-2">
              <StateBadge state={observation.state} />
              <span className="text-slate-500">
                {observation.sourceSystem} · {formatTimestamp(observation.observedAt)}
              </span>
              {observation.sourceStatus === null ? null : (
                <span className="text-slate-500">source status: {observation.sourceStatus}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {historyQuery.hasNextPage ? (
        <button
          type="button"
          onClick={() => {
            void historyQuery.fetchNextPage();
          }}
          disabled={historyQuery.isFetchingNextPage}
          className="self-start rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
