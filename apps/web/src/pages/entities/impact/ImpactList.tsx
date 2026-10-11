import { useQueryClient } from '@tanstack/react-query';
import type { ImpactListSelector } from '@opsgraph/shared';
import { formatMoney } from '../../../lib/format';
import { AffectedEntityRow } from './AffectedEntityRow';
import { selectorTitle } from './impact-labels';
import { useImpactList } from './useImpactList';

export interface ImpactListProps {
  /** The analyzed entity. */
  entityId: string;
  depth: number;
  selector: ImpactListSelector;
  /** The number in the summary that opened this list; a different list total means stale data. */
  summaryCount: number;
  onClose: () => void;
}

export function ImpactList({ entityId, depth, selector, summaryCount, onClose }: ImpactListProps) {
  const queryClient = useQueryClient();
  const query = useImpactList(entityId, depth, selector);

  const pages = query.data?.pages ?? [];
  const first = pages.at(0);
  const items = pages.flatMap((page) => page.items);
  const title = selectorTitle(selector);

  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded border bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{first === undefined ? title : `${title} (${first.total})`}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          Close list
        </button>
      </div>

      {query.isPending ? <p>Loading…</p> : null}
      {query.isError ? <p role="alert">Unable to load this list.</p> : null}

      {first !== undefined && first.total !== summaryCount ? (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          The data has changed since the summary was computed.
          <button
            type="button"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['entities', entityId, 'impact'] });
            }}
            className="rounded border border-slate-300 px-2 py-1"
          >
            Refresh
          </button>
        </p>
      ) : null}

      {first !== undefined && items.length === 0 ? <p>Nothing to list.</p> : null}

      {first !== undefined && items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <AffectedEntityRow key={item.entity.id} item={item} start={first.start} depth={depth} />
            ))}
          </ul>

          {first.sum !== null ? (
            <p className="text-sm font-semibold">
              {`Total: ${formatMoney(first.sum.amount, first.sum.currency)}`}
            </p>
          ) : null}

          <p className="text-sm text-slate-600">{`Showing ${items.length} of ${first.total}`}</p>

          {query.hasNextPage ? (
            <button
              type="button"
              onClick={() => {
                void query.fetchNextPage();
              }}
              disabled={query.isFetchingNextPage}
              className="self-start rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
            >
              Load more
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
