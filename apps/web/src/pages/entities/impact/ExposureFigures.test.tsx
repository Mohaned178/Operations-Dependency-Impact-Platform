import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExposureFigures } from './ExposureFigures';
import { I1_SUMMARY, I14_SUMMARY, RANGE_SUMMARY } from './impact-test-data';

afterEach(() => {
  cleanup();
});

describe('ExposureFigures', () => {
  it('renders the I1 figure with total, current and potential as buttons', async () => {
    const onOpen = vi.fn();
    render(
      <ExposureFigures exposure={I1_SUMMARY.exposure} notCounted={I1_SUMMARY.notCounted} onOpen={onOpen} />,
    );

    expect(screen.getByRole('heading', { name: 'Exposure in USD' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Total 84,000.00 USD (12 customer orders)' }));
    expect(onOpen).toHaveBeenLastCalledWith({ list: 'exposure', currency: 'USD', bucket: 'total' });

    await userEvent.click(screen.getByRole('button', { name: 'Current 51,250.00 USD (6 customer orders)' }));
    expect(onOpen).toHaveBeenLastCalledWith({ list: 'exposure', currency: 'USD', bucket: 'current' });

    await userEvent.click(screen.getByRole('button', { name: 'Potential 32,750.00 USD (6 customer orders)' }));
    expect(onOpen).toHaveBeenLastCalledWith({ list: 'exposure', currency: 'USD', bucket: 'potential' });
  });

  it('shows the inferred-only share as a button', async () => {
    const onOpen = vi.fn();
    render(
      <ExposureFigures exposure={I1_SUMMARY.exposure} notCounted={I1_SUMMARY.notCounted} onOpen={onOpen} />,
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Of which reached only through inferred links: 2,400.00 USD (1 customer order)',
      }),
    );
    expect(onOpen).toHaveBeenCalledWith({ list: 'exposure', currency: 'USD', bucket: 'inferredOnly' });
  });

  it('offers the not-counted entities, and no range or value-unknown note when there are none', async () => {
    const onOpen = vi.fn();
    render(
      <ExposureFigures exposure={I1_SUMMARY.exposure} notCounted={I1_SUMMARY.notCounted} onOpen={onOpen} />,
    );
    expect(screen.queryByText(/between/)).toBeNull();
    expect(screen.queryByText(/without a recorded value/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '2 completed or cancelled entities' }));
    expect(onOpen).toHaveBeenCalledWith({ list: 'notCounted', type: null });
    expect(screen.getByText(/are not counted\./)).toBeInTheDocument();
  });

  it('states the range when sources disagree and offers the orders without a value', async () => {
    const onOpen = vi.fn();
    render(
      <ExposureFigures
        exposure={RANGE_SUMMARY.exposure}
        notCounted={RANGE_SUMMARY.notCounted}
        onOpen={onOpen}
      />,
    );
    expect(
      screen.getByText(
        'Source values disagree on 2 customer orders: exposure is between 82,000.00 USD and 90,500.00 USD.',
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: '2 customer orders without a recorded value' }),
    );
    expect(onOpen).toHaveBeenCalledWith({ list: 'valueUnknown' });
    expect(screen.getByText(/are left out of exposure\./)).toBeInTheDocument();
  });

  it('names a disagreement without a range when the sources only differ in currency', () => {
    render(
      <ExposureFigures
        exposure={{
          byCurrency: [
            {
              currency: 'USD',
              total: { amount: '100.00', orderCount: 1 },
              current: { amount: '100.00', orderCount: 1 },
              potential: { amount: '0.00', orderCount: 0 },
              inferredOnly: {
                total: { amount: '0.00', orderCount: 0 },
                current: { amount: '0.00', orderCount: 0 },
                potential: { amount: '0.00', orderCount: 0 },
              },
              disagreementOrderCount: 1,
              range: null,
            },
          ],
          valueUnknownCount: 0,
        }}
        notCounted={{ total: 0, byType: [] }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Source values disagree on 1 customer order.')).toBeInTheDocument();
    expect(screen.queryByText(/between/)).toBeNull();
  });

  it('shows a share without orders as plain text', () => {
    render(
      <ExposureFigures
        exposure={{
          byCurrency: [
            {
              currency: 'USD',
              total: { amount: '100.00', orderCount: 1 },
              current: { amount: '100.00', orderCount: 1 },
              potential: { amount: '0.00', orderCount: 0 },
              inferredOnly: {
                total: { amount: '0.00', orderCount: 0 },
                current: { amount: '0.00', orderCount: 0 },
                potential: { amount: '0.00', orderCount: 0 },
              },
              disagreementOrderCount: 0,
              range: null,
            },
          ],
          valueUnknownCount: 0,
        }}
        notCounted={{ total: 0, byType: [] }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Potential/ })).toBeNull();
    expect(screen.getByText('Potential 0.00 USD (0 customer orders)')).toBeInTheDocument();
    expect(screen.queryByText(/inferred/)).toBeNull();
  });

  it('renders nothing when there is nothing to show', () => {
    const { container } = render(
      <ExposureFigures exposure={I14_SUMMARY.exposure} notCounted={I14_SUMMARY.notCounted} onOpen={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
