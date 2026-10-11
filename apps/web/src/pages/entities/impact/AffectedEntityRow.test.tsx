import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AffectedEntityDto } from '@opsgraph/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AffectedEntityRow } from './AffectedEntityRow';
import {
  CUSTOMER_ITEM,
  FABRIKAM,
  FAB_ID,
  I2_CURRENT_ORDERS,
  ITEM_DETAIL,
  orderItem,
} from './impact-test-data';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

function renderRow(item: AffectedEntityDto) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ul>
          <AffectedEntityRow item={item} start={FABRIKAM} depth={6} />
        </ul>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FIRST = I2_CURRENT_ORDERS.items[0] as AffectedEntityDto;

describe('AffectedEntityRow', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the name as a link, the state, the classification, the distance, the value and the path count', () => {
    renderRow(FIRST);
    const link = screen.getAllByRole('link', { name: 'Order SO-20402' })[0];
    expect(link).toHaveAttribute('href', `/entities/${FIRST.entity.id}`);
    expect(screen.getAllByText('Waiting').length).toBeGreaterThan(0);
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('2 steps')).toBeInTheDocument();
    expect(screen.getByText('12,400.00 USD')).toBeInTheDocument();
    expect(screen.getByText('5 paths')).toBeInTheDocument();
  });

  it('renders the primary path through PathView and no shortest path when it is the same', () => {
    renderRow(FIRST);
    const details = screen.getByText('Path').closest('details');
    expect(details).not.toBeNull();
    expect((details as HTMLElement).querySelector('ol')?.children).toHaveLength(2);
    expect(screen.queryByText('Shortest path')).toBeNull();
  });

  it('labels the shortest path when there is one', () => {
    const primary = FIRST.primaryPath;
    if (primary === null) throw new Error('fixture has no primary path');
    renderRow({ ...FIRST, shortestPath: { ...primary, hops: primary.hops.slice(1), length: 1 } });
    const details = screen.getByText('Shortest path').closest('details');
    expect((details as HTMLElement).querySelector('ol')?.children).toHaveLength(1);
  });

  it('uses the singular for one path and a plus sign when more paths exist', () => {
    renderRow({ ...FIRST, pathCount: 1 });
    expect(screen.getByText('1 path')).toBeInTheDocument();
    cleanup();
    renderRow({ ...FIRST, pathCount: 21, morePaths: true });
    expect(screen.getByText('21+ paths')).toBeInTheDocument();
  });

  it('shows the flag badges', () => {
    renderRow(
      orderItem('Order SO-20411', '2400.00', {
        classification: 'POTENTIAL',
        flags: { inferredOnly: true, stateUnknown: true, otherCause: true },
        weakest: { origin: 'INFERRED', confidence: 'LOW' },
      }),
    );
    expect(screen.getByText('Only inferred links (INFERRED / LOW)')).toBeInTheDocument();
    expect(screen.getByText('State unknown')).toBeInTheDocument();
    expect(screen.getByText('Impaired for another reason')).toBeInTheDocument();
    expect(screen.getByText('Potential')).toBeInTheDocument();
  });

  it('shows no flag badges when no flag is set', () => {
    renderRow(FIRST);
    expect(screen.queryByText(/Only inferred/)).toBeNull();
    expect(screen.queryByText('State unknown')).toBeNull();
    expect(screen.queryByText('Impaired for another reason')).toBeNull();
  });

  it('labels a not-counted entity', () => {
    renderRow({ ...FIRST, classification: 'NOT_COUNTED', notCountedReason: 'TERMINAL' });
    expect(screen.getByText('Not counted (completed or cancelled)')).toBeInTheDocument();
  });

  it('says when an order has no recorded value or its sources disagree', () => {
    renderRow({ ...FIRST, value: { current: null, bySource: [], disagreement: false, currencyMismatch: false } });
    expect(screen.getByText('No recorded value')).toBeInTheDocument();
    cleanup();
    renderRow({
      ...FIRST,
      value: { ...(FIRST.value as NonNullable<AffectedEntityDto['value']>), disagreement: true },
    });
    expect(screen.getByText('Sources disagree on the value')).toBeInTheDocument();
  });

  it('shows an attributed-only customer with its attributions and no path', () => {
    renderRow(CUSTOMER_ITEM);
    expect(screen.getByText('via attribution')).toBeInTheDocument();
    expect(screen.getByText('Attributed through')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Order SO-20404' })).toBeInTheDocument();
    expect(screen.queryByText('Path')).toBeNull();
    expect(screen.queryByText(/paths?$/)).toBeNull();
  });

  it('says how many attributions are not shown', () => {
    renderRow({ ...CUSTOMER_ITEM, attributionCount: 9 });
    expect(screen.getByText('and 8 more')).toBeInTheDocument();
  });

  it('loads the detail only once the row is expanded', async () => {
    apiFetchMock.mockResolvedValue(ITEM_DETAIL);
    renderRow(FIRST);
    expect(apiFetchMock).not.toHaveBeenCalled();

    const button = screen.getByRole('button', { name: 'Show details' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);

    expect(await screen.findByText('Alternative path 1 (2 hops)')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe(
      `/entities/${FAB_ID}/impact/items/${FIRST.entity.id}?depth=6`,
    );
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByText('Alternative path 1 (2 hops)')).toBeNull();
  });
});
