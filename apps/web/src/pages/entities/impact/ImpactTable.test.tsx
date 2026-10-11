import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I1_SUMMARY, I14_SUMMARY } from './impact-test-data';
import { ImpactTable } from './ImpactTable';

afterEach(() => {
  cleanup();
});

describe('ImpactTable', () => {
  it('renders the I1 table with a caption and the columns in order', () => {
    render(<ImpactTable categories={I1_SUMMARY.categories} onOpen={vi.fn()} />);

    expect(screen.getByRole('table', { name: 'Affected entities by type' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Category',
      'Current',
      'Potential',
      'Total',
      'Direct',
      'Indirect',
      'Only inferred',
      'State unknown',
    ]);
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Products',
      'Purchase orders',
      'Customer orders',
      'Customers',
      'Shipments',
      'SLA commitments',
    ]);

    const orders = screen.getByRole('row', { name: /^Customer orders/ });
    expect(within(orders).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '6',
      '6',
      '12',
      '0',
      '12',
      '1',
      '0',
    ]);
  });

  it('gives every non-zero number an accessible name and opens its list', async () => {
    const onOpen = vi.fn();
    render(<ImpactTable categories={I1_SUMMARY.categories} onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('button', { name: '6 customer orders, current' }));
    expect(onOpen).toHaveBeenLastCalledWith({ list: 'category', type: 'Order', bucket: 'current' });

    await userEvent.click(screen.getByRole('button', { name: '12 customer orders, indirect' }));
    expect(onOpen).toHaveBeenLastCalledWith({ list: 'category', type: 'Order', bucket: 'indirect' });

    await userEvent.click(screen.getByRole('button', { name: '1 SLA commitment, only inferred' }));
    expect(onOpen).toHaveBeenLastCalledWith({ list: 'category', type: 'SLA', bucket: 'inferredOnly' });

    await userEvent.click(screen.getByRole('button', { name: '1 customer, potential' }));
    expect(onOpen).toHaveBeenLastCalledWith({ list: 'category', type: 'Customer', bucket: 'potential' });
    expect(onOpen).toHaveBeenCalledTimes(4);
  });

  it('shows zero as plain text, not as a button', () => {
    render(<ImpactTable categories={I1_SUMMARY.categories} onOpen={vi.fn()} />);

    const products = screen.getByRole('row', { name: /^Products/ });
    expect(within(products).queryByRole('button', { name: /current/ })).toBeNull();
    // 4 products are potential, direct and total; one is only inferred; none are current.
    expect(within(products).getAllByRole('button')).toHaveLength(4);
  });

  it('has no buttons when nothing is affected', () => {
    render(<ImpactTable categories={I14_SUMMARY.categories} onOpen={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
