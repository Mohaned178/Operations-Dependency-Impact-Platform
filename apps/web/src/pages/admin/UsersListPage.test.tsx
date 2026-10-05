import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PublicUser } from '@opsgraph/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersListPage } from './UsersListPage';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

const users: PublicUser[] = [
  {
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    email: 'ada@opsgraph.local',
    displayName: 'Ada Analyst',
    role: 'ANALYST',
    status: 'ACTIVE',
    mustChangePassword: false,
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
  },
  {
    id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    email: 'bob@opsgraph.local',
    displayName: 'Bob Manager',
    role: 'OPS_MANAGER',
    status: 'DEACTIVATED',
    mustChangePassword: false,
    createdAt: '2026-10-04T10:00:00.000Z',
    updatedAt: '2026-10-04T10:00:00.000Z',
  },
];

describe('UsersListPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: users, nextCursor: null })),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders user rows returned by the API', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <UsersListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('link', { name: 'Ada Analyst' })).toBeInTheDocument();
    expect(screen.getByText('ada@opsgraph.local')).toBeInTheDocument();
    expect(screen.getAllByText('Operations Analyst').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Bob Manager' })).toBeInTheDocument();
    expect(screen.getAllByText('Operations Manager').length).toBeGreaterThan(0);
  });
});
