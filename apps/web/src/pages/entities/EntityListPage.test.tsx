import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityListItemDto } from '@opsgraph/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityListPage } from './EntityListPage';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', () => ({ apiFetch: apiFetchMock }));

const ORDER: EntityListItemDto = {
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  type: 'Order',
  displayName: 'Order #18492',
  currentState: 'BLOCKED',
  primaryIdentifier: {
    sourceSystem: 'OMS',
    sourceId: '18492',
    firstSeenAt: '2026-09-29T09:12:00.000Z',
  },
  sourceSystems: ['ERP', 'OMS'],
  lastObservedAt: '2026-09-29T11:40:00.000Z',
};

const CUSTOMER: EntityListItemDto = {
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  type: 'Customer',
  displayName: 'Acme Corp',
  currentState: 'ACTIVE',
  primaryIdentifier: {
    sourceSystem: 'CRM',
    sourceId: 'AC-778',
    firstSeenAt: '2026-08-15T08:00:00.000Z',
  },
  sourceSystems: ['CRM'],
  lastObservedAt: '2026-09-01T08:00:00.000Z',
};

function listResponse(items: EntityListItemDto[], nextCursor: string | null = null) {
  return Promise.resolve({ items, nextCursor });
}

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(initialEntry = '/entities', extra: ReactNode = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        {extra}
        <LocationDisplay />
        <EntityListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntityListPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/source-systems') {
        return Promise.resolve({ items: ['CRM', 'ERP', 'OMS'] });
      }
      if (path.startsWith('/entities?')) {
        return listResponse([ORDER, CUSTOMER]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the entity rows with their state, sources and primary identifier', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'Order #18492' })).toBeInTheDocument();
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getByText('ERP, OMS')).toBeInTheDocument();
    expect(screen.getByText('OMS · 18492')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme Corp' })).toBeInTheDocument();
    expect(screen.getByText('CRM · AC-778')).toBeInTheDocument();
  });

  it('shows the empty state when no entities match', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/source-systems') {
        return Promise.resolve({ items: [] });
      }
      return listResponse([]);
    });

    renderPage();

    expect(await screen.findByText('No entities match these filters')).toBeInTheDocument();
  });

  it('shows an error state when the list request fails', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/source-systems') {
        return Promise.resolve({ items: [] });
      }
      return Promise.reject(new Error('down'));
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load entities.');
  });

  it('reads the filters from the URL and passes them to the API', async () => {
    renderPage('/entities?type=Order&q=18492');

    await screen.findByRole('link', { name: 'Order #18492' });

    const entityCalls = apiFetchMock.mock.calls
      .map((call) => call[0] as string)
      .filter((path) => path.startsWith('/entities?'));
    expect(entityCalls[0]).toContain('type=Order');
    expect(entityCalls[0]).toContain('q=18492');
    expect(screen.getByLabelText('Search')).toHaveValue('18492');
  });

  it('keeps the debounced search in the URL', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('link', { name: 'Order #18492' });
    await user.type(screen.getByLabelText('Search'), 'Acme');

    await waitFor(() => {
      const paths = apiFetchMock.mock.calls.map((call) => call[0] as string);
      expect(paths.some((path) => path.includes('q=Acme'))).toBe(true);
    });
  });

  it('does not restore an old search after the URL is cleared from outside', async () => {
    const user = userEvent.setup();
    renderPage('/entities?q=Acme', <Link to="/entities">Entities</Link>);

    await screen.findByRole('link', { name: 'Order #18492' });
    await user.click(screen.getByRole('link', { name: 'Entities' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Search')).toHaveValue('');
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/entities$/);
  });

  it('loads more rows with the next cursor', async () => {
    let call = 0;
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/source-systems') {
        return Promise.resolve({ items: [] });
      }
      call += 1;
      if (call === 1) {
        return listResponse([ORDER], 'cursor-1');
      }
      return listResponse([CUSTOMER]);
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('link', { name: 'Order #18492' });
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('link', { name: 'Acme Corp' })).toBeInTheDocument();
    const paths = apiFetchMock.mock.calls.map((call) => call[0] as string);
    expect(paths.some((path) => path.includes('cursor=cursor-1'))).toBe(true);
  });
});
