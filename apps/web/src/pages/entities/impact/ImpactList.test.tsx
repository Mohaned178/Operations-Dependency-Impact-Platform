import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ImpactListSelector } from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAB_ID, I2_CURRENT_ORDERS, I2_EXPOSURE_CURRENT } from './impact-test-data';
import { ImpactList } from './ImpactList';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

const CURRENT_ORDERS: ImpactListSelector = { list: 'category', type: 'Order', bucket: 'current' };
const EXPOSURE_CURRENT: ImpactListSelector = { list: 'exposure', currency: 'USD', bucket: 'current' };

function renderList(
  selector: ImpactListSelector,
  summaryCount: number,
  onClose = vi.fn(),
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return {
    queryClient,
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ImpactList
            entityId={FAB_ID}
            depth={6}
            selector={selector}
            summaryCount={summaryCount}
            onClose={onClose}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('ImpactList', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders I2 with a heading from the selector and one row per order', async () => {
    apiFetchMock.mockResolvedValue(I2_CURRENT_ORDERS);
    renderList(CURRENT_ORDERS, 6);

    expect(await screen.findByRole('heading', { name: 'Customer orders — current (6)' })).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Customer orders — current' });
    expect(within(section).getAllByRole('button', { name: 'Show details' })).toHaveLength(6);
    expect(within(section).getAllByRole('link', { name: /^Order SO-/ })).toHaveLength(6 * 2);
    expect(screen.getByText('Showing 6 of 6')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/^Total:/)).toBeNull();
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe(
      `/entities/${FAB_ID}/impact/items?list=category&type=Order&bucket=current&depth=6&limit=50`,
    );
  });

  it('loads the next page with the cursor', async () => {
    const [firstHalf, secondHalf] = [I2_CURRENT_ORDERS.items.slice(0, 3), I2_CURRENT_ORDERS.items.slice(3)];
    apiFetchMock
      .mockResolvedValueOnce({ ...I2_CURRENT_ORDERS, items: firstHalf, nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ ...I2_CURRENT_ORDERS, items: secondHalf, nextCursor: null });
    renderList(CURRENT_ORDERS, 6);

    expect(await screen.findByText('Showing 3 of 6')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Showing 6 of 6')).toBeInTheDocument();
    expect(String(apiFetchMock.mock.calls[1]?.[0])).toContain('cursor=cursor-1');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows a total row equal to the sum for an exposure list', async () => {
    apiFetchMock.mockResolvedValue(I2_EXPOSURE_CURRENT);
    renderList(EXPOSURE_CURRENT, 6);
    expect(
      await screen.findByRole('heading', { name: 'Exposure in USD — current (6)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Total: 51,250.00 USD')).toBeInTheDocument();
  });

  it('warns when the list total differs from the summary number, and Refresh reloads the impact data', async () => {
    apiFetchMock.mockResolvedValue(I2_CURRENT_ORDERS);
    const { queryClient } = renderList(CURRENT_ORDERS, 7);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('The data has changed since the summary was computed.');
    await userEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['entities', FAB_ID, 'impact'] });
  });

  it('has a close button', async () => {
    apiFetchMock.mockResolvedValue(I2_CURRENT_ORDERS);
    const { onClose } = renderList(CURRENT_ORDERS, 6);
    await screen.findByText('Showing 6 of 6');
    await userEvent.click(screen.getByRole('button', { name: 'Close list' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when the list is empty, and shows its own error state', async () => {
    apiFetchMock.mockResolvedValueOnce({ ...I2_CURRENT_ORDERS, total: 0, items: [], nextCursor: null });
    renderList(CURRENT_ORDERS, 0);
    expect(await screen.findByText('Nothing to list.')).toBeInTheDocument();
    cleanup();

    apiFetchMock.mockReset();
    apiFetchMock.mockRejectedValue(new Error('down'));
    renderList(CURRENT_ORDERS, 6);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load this list.');
    expect(screen.getByRole('button', { name: 'Close list' })).toBeInTheDocument();
  });
});
