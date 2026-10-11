import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AffectedEntityDetail } from './AffectedEntityDetail';
import { CUSTOMER_DETAIL, FAB_ID, ITEM_DETAIL } from './impact-test-data';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

function renderDetail(targetId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AffectedEntityDetail entityId={FAB_ID} depth={6} targetId={targetId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AffectedEntityDetail', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a loading state, then the alternative paths', async () => {
    apiFetchMock.mockResolvedValue(ITEM_DETAIL);
    renderDetail(ITEM_DETAIL.item.entity.id);
    expect(screen.getByText('Loading details…')).toBeInTheDocument();

    expect(await screen.findByText('Alternative path 1 (2 hops)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Other paths' })).toBeInTheDocument();
    expect(screen.queryByText(/Attributions/)).toBeNull();
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe(
      `/entities/${FAB_ID}/impact/items/${ITEM_DETAIL.item.entity.id}?depth=6`,
    );
  });

  it('says so when there are no other paths', async () => {
    apiFetchMock.mockResolvedValue({ ...ITEM_DETAIL, alternativePaths: [] });
    renderDetail(ITEM_DETAIL.item.entity.id);
    expect(await screen.findByText('No other paths.')).toBeInTheDocument();
  });

  it('lists every attribution with its link and its impact path', async () => {
    apiFetchMock.mockResolvedValue(CUSTOMER_DETAIL);
    renderDetail(CUSTOMER_DETAIL.item.entity.id);

    expect(await screen.findByRole('heading', { name: 'Attributions (1)' })).toBeInTheDocument();
    const entry = screen.getAllByRole('link', { name: 'Order SO-20404' })[0]?.closest('li');
    expect(entry).not.toBeNull();
    const scope = within(entry as HTMLElement);
    expect(scope.getByText('Current')).toBeInTheDocument();
    expect(scope.getByText('Link to the customer')).toBeInTheDocument();
    expect(scope.getByText('How it is affected')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('says how many attributions are shown when the list is cut', async () => {
    apiFetchMock.mockResolvedValue({ ...CUSTOMER_DETAIL, attributionCount: 250 });
    renderDetail(CUSTOMER_DETAIL.item.entity.id);
    expect(await screen.findByText('Showing 1 of 250.')).toBeInTheDocument();
  });

  it('has its own error state', async () => {
    apiFetchMock.mockRejectedValue(new Error('down'));
    renderDetail(ITEM_DETAIL.item.entity.id);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load the details of this entity.',
    );
  });
});
