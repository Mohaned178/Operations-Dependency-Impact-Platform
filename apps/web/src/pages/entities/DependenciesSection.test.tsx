import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DependenciesResponse } from '@opsgraph/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DependenciesSection } from './DependenciesSection';
import { ORDER, PAYMENT, SHIPMENT, SHP_ID, hop } from './tracing-test-data';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function baseResponse(overrides: Partial<DependenciesResponse> = {}): DependenciesResponse {
  return {
    query: {
      entityId: SHP_ID,
      kind: 'upstream',
      depth: 6,
      relationshipTypes: ['REQUIRES'],
      entityTypes: [],
    },
    computedAt: '2026-10-06T09:00:00.000Z',
    start: SHIPMENT,
    truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
    totalReached: 2,
    items: [
      {
        entity: ORDER,
        distance: 1,
        path: {
          hops: [hop('DEPENDS_ON', 'FORWARD', SHP_ID, ORDER.id, ORDER)],
          length: 1,
          weakestConfidence: 'HIGH',
          nonSourceHops: 0,
          continuesBeyondDepth: false,
        },
      },
      {
        entity: PAYMENT,
        distance: 1,
        path: {
          hops: [
            hop('DEPENDS_ON', 'FORWARD', SHP_ID, ORDER.id, ORDER),
            hop('REQUIRES', 'FORWARD', ORDER.id, PAYMENT.id, PAYMENT),
          ],
          length: 2,
          weakestConfidence: 'HIGH',
          nonSourceHops: 0,
          continuesBeyondDepth: false,
        },
      },
    ],
    nextCursor: null,
    cycleClosingHops: [],
    cycleClosingHopCount: 0,
    ...overrides,
  };
}

function renderSection(initialEntry = `/entities/${SHP_ID}`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationDisplay />
        <DependenciesSection entityId={SHP_ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DependenciesSection', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(baseResponse());
  });

  afterEach(() => {
    cleanup();
  });

  it('requests upstream with depth 6 and limit 50 by default, without type params', async () => {
    renderSection();

    await screen.findAllByText('Order #18492');
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [path] = apiFetchMock.mock.calls[0] ?? [];
    expect(path).toBe(`/entities/${SHP_ID}/dependencies?direction=upstream&depth=6&limit=50`);
    expect(path).not.toContain('relationshipTypes');
    expect(path).not.toContain('entityTypes');
  });

  it('clicking Downstream changes the URL and the request direction', async () => {
    const user = userEvent.setup();
    renderSection();

    await screen.findAllByText('Order #18492');
    apiFetchMock.mockClear();

    await user.click(screen.getByRole('button', { name: /Downstream/ }));
    expect(await screen.findByTestId('location')).toHaveTextContent('dep=downstream');

    await waitFor(() => {
      const calls = apiFetchMock.mock.calls.map(([path]) => String(path));
      expect(calls.some((path) => path.includes('direction=downstream'))).toBe(true);
    });
  });

  it('ticking Order adds types=Order to the URL and entityTypes=Order to the request', async () => {
    const user = userEvent.setup();
    renderSection();

    await screen.findAllByText('Order #18492');
    apiFetchMock.mockClear();

    await user.click(screen.getByRole('checkbox', { name: 'Order' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('types=Order');

    await waitFor(() => {
      const calls = apiFetchMock.mock.calls.map(([path]) => String(path));
      expect(calls.some((path) => path.includes('entityTypes=Order'))).toBe(true);
    });
  });

  it('keeps the last checked relationship type checked instead of widening to all types', async () => {
    renderSection(`/entities/${SHP_ID}?rel=REQUIRES`);

    await screen.findAllByText('Order #18492');
    expect(screen.getByRole('checkbox', { name: 'REQUIRES' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'REQUIRES' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'DEPENDS_ON' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'DEPENDS_ON' })).toBeEnabled();
  });

  it('reproduces downstream depth 3 with an Order filter from the URL', async () => {
    renderSection(`/entities/${SHP_ID}?dep=downstream&depth=3&types=Order`);

    await screen.findAllByText('Order #18492');
    expect(screen.getByRole('button', { name: /Downstream/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('combobox')).toHaveValue('3');
    expect(screen.getByRole('checkbox', { name: 'Order' })).toBeChecked();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [path] = apiFetchMock.mock.calls[0] ?? [];
    expect(String(path)).toContain('direction=downstream');
    expect(String(path)).toContain('depth=3');
    expect(String(path)).toContain('entityTypes=Order');
  });

  it('requests the next cursor on Load more', async () => {
    const user = userEvent.setup();
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('cursor=')) {
        return Promise.resolve(baseResponse({ items: [], totalReached: 2, nextCursor: null }));
      }
      return Promise.resolve(baseResponse({ nextCursor: 'CURSOR1' }));
    });
    renderSection();

    await screen.findByRole('button', { name: 'Load more' });
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      const calls = apiFetchMock.mock.calls.map(([path]) => String(path));
      expect(calls.some((path) => path.includes('cursor=CURSOR1'))).toBe(true);
    });
  });

  it('shows path shown when the path length differs from the distance', async () => {
    renderSection();

    await screen.findAllByText('Order #18492');
    expect(screen.getByText(/path shown: 2 steps/)).toBeInTheDocument();
  });
});
