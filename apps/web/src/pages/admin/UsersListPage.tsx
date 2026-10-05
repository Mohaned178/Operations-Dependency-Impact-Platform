import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ROLE_LABELS,
  UserListResponseSchema,
  type Role,
  type UserStatus,
} from '@opsgraph/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api-client';

const PAGE_LIMIT = 20;

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

export function UsersListPage() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const usersQuery = useInfiniteQuery({
    queryKey: ['users', { q: debouncedSearch, role, status }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (debouncedSearch) {
        params.set('q', debouncedSearch);
      }
      if (role) {
        params.set('role', role);
      }
      if (status) {
        params.set('status', status);
      }
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      return apiFetch(`/users?${params.toString()}`, { schema: UserListResponseSchema });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const users = usersQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Link to="/admin/users/new" className="rounded bg-slate-800 px-3 py-2 text-white">
          New user
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Email or name"
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Role
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as Role | '');
            }}
            className="rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All roles</option>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as UserStatus | '');
            }}
            className="rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DEACTIVATED">Deactivated</option>
          </select>
        </label>
      </div>

      {usersQuery.isPending ? <p>Loading…</p> : null}
      {usersQuery.isError ? <p role="alert">Unable to load users.</p> : null}

      <table className="w-full border-collapse bg-white text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b">
              <td className="px-3 py-2">
                <Link to={`/admin/users/${user.id}`} className="text-slate-800 underline">
                  {user.displayName}
                </Link>
              </td>
              <td className="px-3 py-2">{user.email}</td>
              <td className="px-3 py-2">{ROLE_LABELS[user.role]}</td>
              <td className="px-3 py-2">{user.status}</td>
              <td className="px-3 py-2">{new Date(user.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {usersQuery.hasNextPage ? (
        <button
          type="button"
          onClick={() => {
            void usersQuery.fetchNextPage();
          }}
          disabled={usersQuery.isFetchingNextPage}
          className="self-start rounded border border-slate-300 px-3 py-2 disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
