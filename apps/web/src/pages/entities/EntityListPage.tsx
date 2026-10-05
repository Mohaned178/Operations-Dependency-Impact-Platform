import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  EntityListResponseSchema,
  EntityTypeSchema,
  OperationalStateSchema,
  SourceSystemListResponseSchema,
} from '@opsgraph/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { apiFetch } from '../../lib/api-client';
import { formatTimestamp } from '../../lib/format';
import { StateBadge, stateLabel } from './StateBadge';

const PAGE_LIMIT = 50;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [value, delayMs]);

  return debounced;
}

export function EntityListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = searchParams.get('type') ?? '';
  const state = searchParams.get('state') ?? '';
  const sourceSystem = searchParams.get('sourceSystem') ?? '';
  const q = searchParams.get('q') ?? '';

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    setSearch(q);
  }, [q]);

  useEffect(() => {
    if (debouncedSearch === q) {
      return;
    }
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (debouncedSearch) {
          next.set('q', debouncedSearch);
        } else {
          next.delete('q');
        }
        return next;
      },
      { replace: true },
    );
  }, [debouncedSearch, q, setSearchParams]);

  const updateFilter = (name: string, value: string): void => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) {
          next.set(name, value);
        } else {
          next.delete(name);
        }
        return next;
      },
      { replace: true },
    );
  };

  const sourceSystemsQuery = useQuery({
    queryKey: ['source-systems'],
    queryFn: () => apiFetch('/source-systems', { schema: SourceSystemListResponseSchema }),
  });

  const entitiesQuery = useInfiniteQuery({
    queryKey: ['entities', { type, state, sourceSystem, q }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (type) {
        params.set('type', type);
      }
      if (state) {
        params.set('state', state);
      }
      if (sourceSystem) {
        params.set('sourceSystem', sourceSystem);
      }
      if (q) {
        params.set('q', q);
      }
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      return apiFetch(`/entities?${params.toString()}`, { schema: EntityListResponseSchema });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const entities = entitiesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const sourceSystems = sourceSystemsQuery.data?.items ?? [];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Entities</h1>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Name or source id"
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            value={type}
            onChange={(event) => {
              updateFilter('type', event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All types</option>
            {EntityTypeSchema.options.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          State
          <select
            value={state}
            onChange={(event) => {
              updateFilter('state', event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All states</option>
            {OperationalStateSchema.options.map((value) => (
              <option key={value} value={value}>
                {stateLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Source system
          <select
            value={sourceSystem}
            onChange={(event) => {
              updateFilter('sourceSystem', event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All source systems</option>
            {sourceSystems.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {entitiesQuery.isPending ? <p>Loading…</p> : null}
      {entitiesQuery.isError ? <p role="alert">Unable to load entities.</p> : null}

      {entitiesQuery.isSuccess && entities.length === 0 ? (
        <p>No entities match these filters</p>
      ) : null}

      {entities.length > 0 ? (
        <table className="w-full border-collapse bg-white text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Source systems</th>
              <th className="px-3 py-2">Primary identifier</th>
              <th className="px-3 py-2">Last observed</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id} className="border-b">
                <td className="px-3 py-2">
                  <Link to={`/entities/${entity.id}`} className="text-slate-800 underline">
                    {entity.displayName}
                  </Link>
                </td>
                <td className="px-3 py-2">{entity.type}</td>
                <td className="px-3 py-2">
                  <StateBadge state={entity.currentState} />
                </td>
                <td className="px-3 py-2">{entity.sourceSystems.join(', ')}</td>
                <td className="px-3 py-2">
                  {entity.primaryIdentifier.sourceSystem} · {entity.primaryIdentifier.sourceId}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatTimestamp(entity.lastObservedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {entitiesQuery.hasNextPage ? (
        <button
          type="button"
          onClick={() => {
            void entitiesQuery.fetchNextPage();
          }}
          disabled={entitiesQuery.isFetchingNextPage}
          className="self-start rounded border border-slate-300 px-3 py-2 disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
