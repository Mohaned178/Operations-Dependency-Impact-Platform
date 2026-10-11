import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityListItemDto } from '@opsgraph/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerPickerPage } from './ExplorerPickerPage';

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
  sourceSystems: ['OMS'],
  lastObservedAt: '2026-09-29T11:40:00.000Z',
};

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/graph']}>
        <LocationDisplay />
        <Routes>
          <Route path="/graph" element={<ExplorerPickerPage />} />
          <Route path="/graph/:id" element={<p>explorer target</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExplorerPickerPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({ items: [ORDER], nextCursor: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the heading and the scope sentence without requesting anything', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Graph Explorer' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose an entity to explore its neighborhood. The explorer never shows the whole graph.',
      ),
    ).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('debounces the search and requests the entity list with q and limit', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Search entities'), 'Ord');

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/entities?q=Ord&limit=20', expect.anything());
    });
    const paths = apiFetchMock.mock.calls.map((call) => call[0] as string);
    expect(paths).not.toContain('/entities?q=O&limit=20');
    expect(paths).not.toContain('/entities?q=Or&limit=20');
  });

  it('renders results as links to the explorer with the state badge', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Search entities'), 'Order');

    const link = await screen.findByRole('link', { name: /Order #18492/ });
    expect(link).toHaveAttribute('href', `/graph/${ORDER.id}`);
    expect(link).toHaveTextContent('Blocked');
    expect(link).toHaveTextContent('Order');
  });

  it('shows a message when nothing matches', async () => {
    apiFetchMock.mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Search entities'), 'zzz');

    expect(await screen.findByText('No entities match “zzz”.')).toBeInTheDocument();
  });

  it('does not request anything when the input is cleared', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText('Search entities');
    await user.type(input, 'Ord');
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });

    await user.clear(input);
    await new Promise((resolve) => {
      window.setTimeout(resolve, 400);
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});
