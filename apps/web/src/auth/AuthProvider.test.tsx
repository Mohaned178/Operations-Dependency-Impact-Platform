import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '@opsgraph/shared';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';

const session: AuthSession = {
  accessToken: 'access-token-1',
  expiresIn: 900,
  user: {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    email: 'analyst@opsgraph.local',
    displayName: 'Ada Analyst',
    role: 'ANALYST',
    status: 'ACTIVE',
    mustChangePassword: false,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function Probe() {
  const { status } = useAuth();
  return <div data-testid="status">{status}</div>;
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

describe('AuthProvider session restore', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('performs a single refresh under StrictMode and ends authenticated', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse(200, session)), 10);
        }),
    );

    render(
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
