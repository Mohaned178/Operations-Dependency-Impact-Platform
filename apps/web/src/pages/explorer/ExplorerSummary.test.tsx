import type { ExplorerUrlParams, NeighborhoodResponse } from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorerSummary } from './ExplorerSummary';
import { node, response, smallResponse } from './test-fixtures';

const DEFAULT_SETTINGS: ExplorerUrlParams = {
  direction: 'all',
  depth: 2,
  relationshipTypes: [],
  entityTypes: [],
  blockers: false,
};

function renderSummary(
  overrides: {
    response?: NeighborhoodResponse;
    settings?: ExplorerUrlParams;
    onRefresh?: () => void;
    isUpdating?: boolean;
  } = {},
) {
  return render(
    <ExplorerSummary
      response={overrides.response ?? smallResponse()}
      settings={overrides.settings ?? DEFAULT_SETTINGS}
      onRefresh={overrides.onRefresh ?? vi.fn()}
      isUpdating={overrides.isUpdating ?? false}
    />,
  );
}

describe('ExplorerSummary', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the view title as the heading', () => {
    renderSummary();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Focus — all directions, 2 steps: 6 entities, 5 relationships',
      }),
    ).toBeInTheDocument();
  });

  it('shows the filters only when a filter is set', () => {
    const { unmount } = renderSummary();
    expect(screen.queryByText(/Entity types:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Relationship types:/)).not.toBeInTheDocument();
    unmount();

    renderSummary({
      settings: {
        ...DEFAULT_SETTINGS,
        entityTypes: ['Order'],
        relationshipTypes: ['REQUIRES'],
      },
    });
    expect(
      screen.getByText('Entity types: Order · Relationship types: REQUIRES'),
    ).toBeInTheDocument();
  });

  it('shows the exact omitted sentence in a status region', () => {
    const nodes = [
      node({ n: 1, name: 'Focus' }),
      ...Array.from({ length: 199 }, (_, i) => node({ n: i + 2, parent: 1, via: i + 2 })),
    ];
    renderSummary({
      response: response(nodes, [], {
        totals: { visible: 200, omitted: 4312, omittedIsLowerBound: false },
      }),
    });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(
      'Showing 200 of 4512 entities — 4312 more. Refine filters, reduce the step limit, or choose a direction.',
    );
  });

  it('shows the empty message when only the focus remains', () => {
    renderSummary({
      response: response([node({ n: 1, name: 'Lonely Order' })], []),
    });

    expect(
      screen.getByText('Lonely Order has no relationships matching the current settings.'),
    ).toBeInTheDocument();
  });

  it('adds the remove-filters hint to the empty message when filters are set', () => {
    renderSummary({
      response: response([node({ n: 1, name: 'Lonely Order' })], []),
      settings: { ...DEFAULT_SETTINGS, entityTypes: ['Order'] },
    });

    expect(
      screen.getByText(
        'Lonely Order has no relationships matching the current settings. Try removing filters.',
      ),
    ).toBeInTheDocument();
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderSummary({ onRefresh });

    const loaded = screen.getByText(/^Loaded /);
    await user.click(within(loaded).getByRole('button', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows Updating… only while isUpdating', () => {
    const { unmount } = renderSummary();
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
    unmount();

    renderSummary({ isUpdating: true });
    expect(screen.getByText('Updating…')).toBeInTheDocument();
  });
});
