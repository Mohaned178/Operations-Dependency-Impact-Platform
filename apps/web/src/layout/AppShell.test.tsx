import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@opsgraph/shared';
import { AppShell } from './AppShell';

const { auth } = vi.hoisted(() => ({
  auth: {
    status: 'authenticated' as const,
    user: null as PublicUser | null,
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    changePassword: () => Promise.resolve(),
    setSession: () => undefined,
  },
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => auth,
}));

function userWithRole(role: PublicUser['role']): PublicUser {
  return {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    email: 'user@opsgraph.local',
    displayName: 'Test User',
    role,
    status: 'ACTIVE',
    mustChangePassword: false,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  };
}

function renderShell(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<div>home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  afterEach(() => {
    cleanup();
  });

  it('hides the Admin navigation for an analyst', () => {
    auth.user = userWithRole('ANALYST');
    renderShell();

    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Operations Analyst')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entities' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
  });

  it('shows the Admin navigation for an administrator', () => {
    auth.user = userWithRole('ADMIN');
    renderShell();

    expect(screen.getByRole('link', { name: 'Entities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit' })).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });
});
