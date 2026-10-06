import { useInfiniteQuery } from '@tanstack/react-query';
import {
  DependenciesResponseSchema,
  EntityTypeSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  TRACING_LIMITS,
  type EntityType,
  type TraceableRelationshipType,
} from '@opsgraph/shared';
import { Link, useSearchParams } from 'react-router';
import { apiFetch } from '../../lib/api-client';
import { PathView } from './PathView';
import { StateBadge } from './StateBadge';
import { parseTracingParams, toDependenciesQueryString, writeTracingParams } from './tracing-params';

const ENTITY_TYPES = EntityTypeSchema.options;

function steps(count: number): string {
  return `${count} step${count === 1 ? '' : 's'}`;
}

export interface DependenciesSectionProps {
  entityId: string;
}

export function DependenciesSection({ entityId }: DependenciesSectionProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseTracingParams(searchParams);

  const relChecked = (type: TraceableRelationshipType): boolean =>
    params.rel.length === 0 || params.rel.includes(type);

  const update = (next: Parameters<typeof writeTracingParams>[1]) => {
    setSearchParams(writeTracingParams(searchParams, next), { replace: true });
  };

  const toggleRel = (type: TraceableRelationshipType) => {
    const all = [...TRACEABLE_RELATIONSHIP_TYPES];
    const current = params.rel.length === 0 ? all : params.rel;
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    const normalized =
      next.length === all.length ? ([] as TraceableRelationshipType[]) : (
        [...TRACEABLE_RELATIONSHIP_TYPES].filter((t) => next.includes(t))
      );
    update({ rel: normalized });
  };

  const toggleType = (type: EntityType) => {
    const next = params.types.includes(type)
      ? params.types.filter((t) => t !== type)
      : [...params.types, type];
    update({ types: [...ENTITY_TYPES].filter((t) => next.includes(t)) });
  };

  const queryKey = [
    'entities',
    entityId,
    'dependencies',
    params.dep,
    params.depth,
    params.rel.join(','),
    params.types.join(','),
  ];

  const dependenciesQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      apiFetch(`/entities/${entityId}/dependencies${toDependenciesQueryString(params, pageParam, 50)}`, {
        schema: DependenciesResponseSchema,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const pages = dependenciesQuery.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const first = pages.at(0);
  const totalReached = first?.totalReached ?? 0;
  const start = first?.start;
  const truncation = first?.truncation;
  const cycleClosingHopCount = first?.cycleClosingHopCount ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Dependencies</h2>

      <div className="flex gap-2" role="group" aria-label="Direction">
        <button
          type="button"
          aria-pressed={params.dep === 'upstream'}
          onClick={() => update({ dep: 'upstream' })}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Upstream — what this depends on
        </button>
        <button
          type="button"
          aria-pressed={params.dep === 'downstream'}
          onClick={() => update({ dep: 'downstream' })}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Downstream — what depends on this
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        Depth
        <select
          value={params.depth}
          onChange={(event) => update({ depth: Number(event.target.value) })}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((depth) => (
            <option key={depth} value={depth}>
              {depth}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-semibold">Relationship types</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {TRACEABLE_RELATIONSHIP_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1">
              <input type="checkbox" checked={relChecked(type)} onChange={() => toggleRel(type)} />
              {type}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-semibold">Entity types</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {ENTITY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={params.types.includes(type)}
                onChange={() => toggleType(type)}
              />
              {type}
            </label>
          ))}
        </div>
      </fieldset>

      {dependenciesQuery.isPending ? <p>Loading…</p> : null}
      {dependenciesQuery.isError ? <p role="alert">Unable to load dependencies.</p> : null}
      {dependenciesQuery.isSuccess && items.length === 0 ? (
        <p>{`Nothing found within ${params.depth} steps.`}</p>
      ) : null}

      {dependenciesQuery.isSuccess && items.length > 0 && start !== undefined ? (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.entity.id} className="rounded border bg-white p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Link to={`/entities/${item.entity.id}`} className="font-medium underline">
                    {item.entity.displayName}
                  </Link>
                  <span className="text-slate-500">{item.entity.type}</span>
                  <StateBadge state={item.entity.currentState} />
                  <span className="text-slate-500">
                    {steps(item.distance)}
                    {item.path.length !== item.distance
                      ? ` · path shown: ${steps(item.path.length)}`
                      : null}
                  </span>
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-slate-600">Path</summary>
                  <PathView start={start} path={item.path} direction={params.dep} />
                </details>
              </li>
            ))}
          </ul>

          <p className="text-sm text-slate-600">{`Showing ${items.length} of ${totalReached}`}</p>

          {dependenciesQuery.hasNextPage ? (
            <button
              type="button"
              onClick={() => {
                void dependenciesQuery.fetchNextPage();
              }}
              disabled={dependenciesQuery.isFetchingNextPage}
              className="self-start rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
            >
              Load more
            </button>
          ) : null}

          {truncation?.depthLimit === true ? (
            <p className="text-sm text-slate-600">{`More entities exist beyond depth ${params.depth}.`}</p>
          ) : null}
          {truncation?.explorationLimit === true ? (
            <p className="text-sm text-slate-600">
              {`Exploration stopped after ${TRACING_LIMITS.maxReachedEntities.toLocaleString('en-US')} entities, so this list is partial.`}
            </p>
          ) : null}
          {cycleClosingHopCount > 0 ? (
            <p className="text-sm text-slate-600">
              {`${cycleClosingHopCount} ${cycleClosingHopCount === 1 ? 'relationship closes' : 'relationships close'} a dependency cycle and ${cycleClosingHopCount === 1 ? 'was' : 'were'} not followed.`}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
