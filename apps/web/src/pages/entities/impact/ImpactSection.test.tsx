import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAB_ID,
  I1_SUMMARY,
  I14_SUMMARY,
  I2_CURRENT_ORDERS,
  I2_EXPOSURE_CURRENT,
  INVOICE_ID,
} from './impact-test-data';
import { ImpactSection } from './ImpactSection';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderSection(entityId = FAB_ID, initialEntry = `/entities/${entityId}`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationDisplay />
        <ImpactSection entityId={entityId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const location = () => screen.getByTestId('location').textContent;

function answer(path: string): Promise<unknown> {
  if (path.includes('/impact/items')) {
    return Promise.resolve(path.includes('list=exposure') ? I2_EXPOSURE_CURRENT : I2_CURRENT_ORDERS);
  }
  if (path.startsWith(`/entities/${INVOICE_ID}/impact`)) {
    return Promise.resolve(I14_SUMMARY);
  }
  if (path.startsWith(`/entities/${FAB_ID}/impact`)) {
    return Promise.resolve(I1_SUMMARY);
  }
  return Promise.reject(new Error(`Unexpected path ${path}`));
}

describe('ImpactSection', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(answer);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders I1: the summary with a bold first line, the table and the exposure', async () => {
    const { container } = renderSection();

    expect(await screen.findByRole('heading', { name: 'Impact' })).toBeInTheDocument();
    expect(container.querySelector('section#impact')).not.toBeNull();

    const first = await screen.findByText('Fabrikam Components is SUSPENDED.');
    expect(first.tagName).toBe('STRONG');
    for (const line of I1_SUMMARY.summary.slice(1)) {
      const element = screen.getByText(line);
      expect(element.tagName).toBe('P');
    }

    expect(screen.getByRole('table', { name: 'Affected entities by type' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6 customer orders, current' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exposure in USD' })).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe(`/entities/${FAB_ID}/impact?depth=6`);
  });

  it('does not link entity names in the summary sentences', async () => {
    renderSection();
    await screen.findByText('Fabrikam Components is SUSPENDED.');
    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  it('is a single line when nothing is affected (I14)', async () => {
    renderSection(INVOICE_ID);

    expect(await screen.findByText('Nothing is affected within 6 steps.')).toBeInTheDocument();
    expect(screen.queryByText('Invoice INV-55120 is PENDING.')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('changes the depth through the URL and requests the new depth', async () => {
    renderSection();
    await screen.findByText('Fabrikam Components is SUSPENDED.');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Depth/ }), '3');
    expect(location()).toBe(`/entities/${FAB_ID}?idepth=3`);
    await vi.waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(`/entities/${FAB_ID}/impact?depth=3`, expect.anything());
    });
    // The section stays on screen while the new depth loads and afterwards.
    expect(screen.getByRole('combobox', { name: /Depth/ })).toHaveValue('3');
  });

  it('opens a list in place by setting ilist, and closes it again', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '6 customer orders, current' }));

    expect(location()).toBe(`/entities/${FAB_ID}?ilist=category.Order.current`);
    expect(await screen.findByRole('heading', { name: 'Customer orders — current (6)' })).toBeInTheDocument();
    expect(screen.queryByText(/The data has changed/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Close list' }));
    expect(location()).toBe(`/entities/${FAB_ID}`);
    expect(screen.queryByRole('heading', { name: /Customer orders — current/ })).toBeNull();
  });

  it('opens an exposure list from the exposure figures', async () => {
    renderSection();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Current 51,250.00 USD (6 customer orders)' }),
    );
    expect(location()).toBe(`/entities/${FAB_ID}?ilist=exposure.USD.current`);
    expect(await screen.findByText('Total: 51,250.00 USD')).toBeInTheDocument();
  });

  it('restores the depth and the opened list from a copied link', async () => {
    renderSection(FAB_ID, `/entities/${FAB_ID}?idepth=4&ilist=category.Order.current&dep=downstream`);

    expect(await screen.findByRole('heading', { name: 'Customer orders — current (6)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Depth/ })).toHaveValue('4');
    const urls = apiFetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain(`/entities/${FAB_ID}/impact?depth=4`);
    expect(urls.some((url) => url.includes('/impact/items?list=category&type=Order&bucket=current&depth=4'))).toBe(true);
    expect(location()).toContain('dep=downstream');
  });

  it('ignores an invalid ilist', async () => {
    renderSection(FAB_ID, `/entities/${FAB_ID}?ilist=nonsense&idepth=99`);
    await screen.findByText('Fabrikam Components is SUSPENDED.');
    expect(screen.queryByRole('region')).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe(`/entities/${FAB_ID}/impact?depth=6`);
  });

  it('warns when an opened list no longer matches the summary', async () => {
    apiFetchMock.mockImplementation((path: string) =>
      path.includes('/impact/items')
        ? Promise.resolve({ ...I2_CURRENT_ORDERS, total: 7 })
        : answer(path),
    );
    renderSection(FAB_ID, `/entities/${FAB_ID}?ilist=category.Order.current`);
    const notice = (await screen.findByText(/The data has changed/)).closest('p');
    expect(notice).not.toBeNull();
    expect(within(notice as HTMLElement).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('shows its own error state without throwing', async () => {
    apiFetchMock.mockRejectedValue(new Error('down'));
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load impact.');
    expect(screen.getByRole('heading', { name: 'Impact' })).toBeInTheDocument();
  });

  it('shows a loading state first', () => {
    apiFetchMock.mockReturnValue(new Promise(() => undefined));
    renderSection();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
