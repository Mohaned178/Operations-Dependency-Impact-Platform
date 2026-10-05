import { useInfiniteQuery } from '@tanstack/react-query';
import { TimelineResponseSchema, type TimelineItemDto } from '@opsgraph/shared';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api-client';
import { formatTimestamp } from '../../lib/format';
import { StateBadge } from './StateBadge';

const PAGE_LIMIT = 50;

export interface TimelineSectionProps {
  entityId: string;
}

function TimelineRow({ item }: { item: TimelineItemDto }) {
  if (item.kind === 'STATE') {
    return (
      <li className="rounded border border-sky-200 bg-sky-50 p-3 text-sm">
        <p className="flex items-center gap-2">
          <StateBadge state={item.state} />
          <span className="font-medium">State change</span>
          {item.sourceStatus === null ? null : (
            <span className="text-slate-500">source status: {item.sourceStatus}</span>
          )}
        </p>
        <p className="text-slate-500">
          {item.sourceSystem} · {formatTimestamp(item.observedAt)}
        </p>
      </li>
    );
  }

  return (
    <li className="rounded border bg-white p-3 text-sm">
      <p className="flex items-center gap-2">
        <span className="font-medium">{item.eventType}</span>
        <span className="text-slate-500">{item.role === 'SUBJECT' ? 'Subject' : 'Related'}</span>
      </p>
      {item.description === null ? null : <p className="text-slate-600">{item.description}</p>}
      <p className="flex flex-wrap gap-x-2">
        {item.entities.map((link) => (
          <Link
            key={link.entity.id}
            to={`/entities/${link.entity.id}`}
            className="text-slate-700 underline"
          >
            {link.entity.displayName}
          </Link>
        ))}
      </p>
      <p className="text-slate-500">
        {item.sourceSystem} · {formatTimestamp(item.observedAt)}
      </p>
    </li>
  );
}

export function TimelineSection({ entityId }: TimelineSectionProps) {
  const timelineQuery = useInfiniteQuery({
    queryKey: ['entities', entityId, 'timeline'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      return apiFetch(`/entities/${entityId}/timeline?${params.toString()}`, {
        schema: TimelineResponseSchema,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const items = timelineQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Timeline</h2>

      {timelineQuery.isPending ? <p>Loading…</p> : null}
      {timelineQuery.isError ? <p role="alert">Unable to load the timeline.</p> : null}
      {timelineQuery.isSuccess && items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing recorded yet</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <TimelineRow key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </ul>

      {timelineQuery.hasNextPage ? (
        <button
          type="button"
          onClick={() => {
            void timelineQuery.fetchNextPage();
          }}
          disabled={timelineQuery.isFetchingNextPage}
          className="self-start rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
