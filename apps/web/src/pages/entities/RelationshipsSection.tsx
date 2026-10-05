import { useInfiniteQuery } from '@tanstack/react-query';
import {
  NeighborListResponseSchema,
  type NeighborDto,
  type RelationshipType,
} from '@opsgraph/shared';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api-client';
import { formatTimestamp } from '../../lib/format';
import { OriginBadge } from './OriginBadge';

const PAGE_LIMIT = 50;

export interface RelationshipsSectionProps {
  entityId: string;
}

export function RelationshipsSection({ entityId }: RelationshipsSectionProps) {
  const neighborsQuery = useInfiniteQuery({
    queryKey: ['entities', entityId, 'neighbors'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      return apiFetch(`/entities/${entityId}/neighbors?${params.toString()}`, {
        schema: NeighborListResponseSchema,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const neighbors = neighborsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const groups = new Map<RelationshipType, NeighborDto[]>();
  for (const neighbor of neighbors) {
    const group = groups.get(neighbor.relationship.type);
    if (group === undefined) {
      groups.set(neighbor.relationship.type, [neighbor]);
    } else {
      group.push(neighbor);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Relationships</h2>

      {neighborsQuery.isPending ? <p>Loading…</p> : null}
      {neighborsQuery.isError ? <p role="alert">Unable to load relationships.</p> : null}
      {neighborsQuery.isSuccess && neighbors.length === 0 ? (
        <p className="text-sm text-slate-500">No relationships</p>
      ) : null}

      {[...groups.entries()].map(([type, items]) => (
        <div key={type} className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{type}</h3>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.relationship.id} className="rounded border bg-white p-3 text-sm">
                <p className="flex items-center gap-2">
                  <span className="text-slate-500">
                    {item.relationship.direction === 'OUT' ? '→' : '←'}
                  </span>
                  <Link to={`/entities/${item.neighbor.id}`} className="font-medium underline">
                    {item.neighbor.displayName}
                  </Link>
                  <OriginBadge
                    origin={item.relationship.origin}
                    confidence={item.relationship.confidence}
                  />
                </p>
                {item.relationship.basis === null ? null : (
                  <p className="text-slate-600">{item.relationship.basis}</p>
                )}
                <p className="text-slate-500">
                  {item.relationship.sourceSystem} · {formatTimestamp(item.relationship.observedAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {neighborsQuery.hasNextPage ? (
        <button
          type="button"
          onClick={() => {
            void neighborsQuery.fetchNextPage();
          }}
          disabled={neighborsQuery.isFetchingNextPage}
          className="self-start rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
