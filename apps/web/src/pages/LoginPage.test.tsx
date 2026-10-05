import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { LoginPage } from './LoginPage';

const unauthorizedBody = {
  error: {
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password',
    correlationId: '3b1b3f7e-6f2e-4b3e-9d1a-2f5c8a7d4e10',
  },
};

const validSession = {
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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.pathname : input.url;
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

describe('LoginPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(401, unauthorizedBody)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderPage(): void {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it('shows a validation error for a bad email', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'some-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
  });

  it('shows "Invalid email or password" for a rejected sign-in', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'analyst@opsgraph.local');
    await user.type(screen.getByLabelText('Password'), 'some-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
  });

  it.each([
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/admin/users', '/admin/users'],
  ])('only follows a safe next=%s', async (next, expected) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        urlOf(input) === '/api/auth/login'
          ? jsonResponse(200, validSession)
          : jsonResponse(401, unauthorizedBody),
      ),
    );

    render(
      <MemoryRouter initialEntries={[`/login?next=${next}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'analyst@opsgraph.local');
    await user.type(screen.getByLabelText('Password'), 'some-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByTestId('location')).textContent).toBe(expected);
  });
});
