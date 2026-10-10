import { useQuery } from '@tanstack/react-query';
import { EntityListResponseSchema } from '@opsgraph/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api-client';
import { StateBadge } from '../entities/StateBadge';

const SEARCH_DEBOUNCE_MS = 300;
const RESULT_LIMIT = 20;

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

/** ui.md §16: entry point of the explorer. Searches entities; never renders a graph. */
export function ExplorerPickerPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const query = debouncedSearch.trim();

  const entitiesQuery = useQuery({
    queryKey: ['entities', 'explorer-picker', query],
    queryFn: () => {
      const params = new URLSearchParams({ q: query, limit: String(RESULT_LIMIT) });
      return apiFetch(`/entities?${params.toString()}`, { schema: EntityListResponseSchema });
    },
    enabled: query !== '',
  });

  const entities = entitiesQuery.data?.items ?? [];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Graph Explorer</h1>
      <p className="text-sm text-slate-600">
        Choose an entity to explore its neighborhood. The explorer never shows the whole graph.
      </p>

      <label className="flex max-w-md flex-col gap-1 text-sm">
        Search entities
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

      {query !== '' && entitiesQuery.isError ? (
        <p role="alert" className="text-sm text-red-700">
          Could not search entities.
        </p>
      ) : null}

      {query !== '' && entitiesQuery.isSuccess && entities.length === 0 ? (
        <p className="text-sm text-slate-600">No entities match “{query}”.</p>
      ) : null}

      {entities.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {entities.map((entity) => (
            <li key={entity.id}>
              <Link
                to={`/graph/${entity.id}`}
                className="flex items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
              >
                <span className="text-xs uppercase tracking-wide text-slate-500">{entity.type}</span>
                <span className="text-sm font-medium text-slate-900">{entity.displayName}</span>
                <StateBadge state={entity.currentState} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
