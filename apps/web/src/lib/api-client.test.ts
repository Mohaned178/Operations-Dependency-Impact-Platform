import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicUserSchema, type AuthSession, type PublicUser } from '@opsgraph/shared';
import { ApiError, apiFetch, setAccessToken } from './api-client';

const user: PublicUser = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  email: 'analyst@opsgraph.local',
  displayName: 'Ada Analyst',
  role: 'ANALYST',
  status: 'ACTIVE',
  mustChangePassword: false,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
};

const session: AuthSession = {
  accessToken: 'access-token-1',
  expiresIn: 900,
  user,
};

const unauthorizedBody = {
  error: {
    code: 'UNAUTHENTICATED',
    message: 'Authentication required',
    correlationId: '3b1b3f7e-6f2e-4b3e-9d1a-2f5c8a7d4e10',
  },
};

const invalidCredentialsBody = {
  error: {
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password',
    correlationId: '3b1b3f7e-6f2e-4b3e-9d1a-2f5c8a7d4e10',
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

describe('apiFetch silent refresh', () => {
  beforeEach(() => {
    setAccessToken(null);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes and retries /auth/me after a 401', async () => {
    let meCalls = 0;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/auth/refresh') {
        return Promise.resolve(jsonResponse(200, session));
      }
      if (url === '/api/auth/me') {
        meCalls += 1;
        return Promise.resolve(
          meCalls === 1 ? jsonResponse(401, unauthorizedBody) : jsonResponse(200, user),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const result = await apiFetch('/auth/me', { schema: PublicUserSchema });

    expect(result.email).toBe('analyst@opsgraph.local');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/auth/me',
    ]);
  });

  it('does not refresh when /auth/login returns 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, invalidCredentialsBody));

    await expect(
      apiFetch('/auth/login', {
        method: 'POST',
        body: { email: 'analyst@opsgraph.local', password: 'wrong-password-123' },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(['/api/auth/login']);
  });
});
