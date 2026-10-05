import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  AUDIT_ACTIONS,
  AuditListResponseSchema,
  UserListResponseSchema,
  type AuditEntryDto,
} from '@opsgraph/shared';
import { Fragment, useState } from 'react';
import { apiFetch } from '../../lib/api-client';

const PAGE_LIMIT = 50;

function actorLabel(entry: AuditEntryDto): string {
  return entry.actorEmail ?? entry.actorType;
}

function targetLabel(entry: AuditEntryDto): string {
  if (!entry.targetType && !entry.targetId) {
    return '—';
  }
  return [entry.targetType, entry.targetId].filter(Boolean).join(':');
}

export function AuditPage() {
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users', 'audit-filter-options'],
    queryFn: () => apiFetch('/users?limit=200', { schema: UserListResponseSchema }),
  });

  const auditQuery = useInfiniteQuery({
    queryKey: ['audit', { actorId, action, targetType, targetId, from, to }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (actorId) {
        params.set('actorId', actorId);
      }
      if (action) {
        params.set('action', action);
      }
      if (targetType) {
        params.set('targetType', targetType);
      }
      if (targetId) {
        params.set('targetId', targetId);
      }
      if (from) {
        params.set('from', new Date(from).toISOString());
      }
      if (to) {
        params.set('to', new Date(to).toISOString());
      }
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      return apiFetch(`/audit?${params.toString()}`, { schema: AuditListResponseSchema });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const entries = auditQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const actors = usersQuery.data?.items ?? [];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Audit trail</h1>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Actor
          <select
            value={actorId}
            onChange={(event) => {
              setActorId(event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All actors</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Action
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All actions</option>
            {Object.values(AUDIT_ACTIONS).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Target type
          <input
            type="text"
            value={targetType}
            onChange={(event) => {
              setTargetType(event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Target id
          <input
            type="text"
            value={targetId}
            onChange={(event) => {
              setTargetId(event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
      </div>

      {auditQuery.isPending ? <p>Loading…</p> : null}
      {auditQuery.isError ? <p role="alert">Unable to load the audit trail.</p> : null}

      <table className="w-full border-collapse bg-white text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Actor</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">Target</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Fragment key={entry.id}>
              <tr className="border-b align-top">
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(entry.occurredAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{actorLabel(entry)}</td>
                <td className="px-3 py-2">{entry.action}</td>
                <td className="px-3 py-2">{targetLabel(entry)}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId(expandedId === entry.id ? null : entry.id);
                    }}
                    className="rounded border border-slate-300 px-3 py-1"
                  >
                    {expandedId === entry.id ? 'Hide' : 'Details'}
                  </button>
                </td>
              </tr>
              {expandedId === entry.id ? (
                <tr className="border-b">
                  <td colSpan={5} className="px-3 py-2">
                    <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-xs">
                      {JSON.stringify(
                        {
                          before: entry.before,
                          after: entry.after,
                          metadata: entry.metadata,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>

      {auditQuery.hasNextPage ? (
        <button
          type="button"
          onClick={() => {
            void auditQuery.fetchNextPage();
          }}
          disabled={auditQuery.isFetchingNextPage}
          className="self-start rounded border border-slate-300 px-3 py-2 disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
