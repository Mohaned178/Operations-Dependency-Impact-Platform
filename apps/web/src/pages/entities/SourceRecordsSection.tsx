import { useInfiniteQuery } from '@tanstack/react-query';
import { SourceRecordListResponseSchema } from '@opsgraph/shared';
import { apiFetch } from '../../lib/api-client';
import { formatTimestamp } from '../../lib/format';

const PAGE_LIMIT = 50;

export interface SourceRecordsSectionProps {
  entityId: string;
}

export function SourceRecordsSection({ entityId }: SourceRecordsSectionProps) {
  const recordsQuery = useInfiniteQuery({
    queryKey: ['entities', entityId, 'source-records'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      return apiFetch(`/entities/${entityId}/source-records?${params.toString()}`, {
        schema: SourceRecordListResponseSchema,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const records = recordsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Source records</h2>

      {recordsQuery.isPending ? <p>Loading…</p> : null}
      {recordsQuery.isError ? <p role="alert">Unable to load the source records.</p> : null}
      {recordsQuery.isSuccess && records.length === 0 ? (
        <p className="text-sm text-slate-500">No source records</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {records.map((record) => (
          <li key={record.id} className="rounded border bg-white p-3 text-sm">
            <p className="font-medium">
              {record.sourceSystem} · {record.sourceId}
            </p>
            <p className="text-slate-500">
              {record.kind} · observed {formatTimestamp(record.observedAt)} · received{' '}
              {formatTimestamp(record.receivedAt)}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-slate-600">Raw payload</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-3 text-xs">
                {JSON.stringify(record.rawPayload, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ul>

      {recordsQuery.hasNextPage ? (
        <button
          type="button"
          onClick={() => {
            void recordsQuery.fetchNextPage();
          }}
          disabled={recordsQuery.isFetchingNextPage}
          className="self-start rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
