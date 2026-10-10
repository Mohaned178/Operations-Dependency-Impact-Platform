import type { BlockersResponse } from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  F1_BLOCKERS,
  F4_BLOCKERS,
  ORDER_ID,
  tracedEntity,
} from '../entities/tracing-test-data';
import { BlockerHighlightPanel } from './BlockerHighlightPanel';

afterEach(cleanup);

function renderPanel(
  blockers: BlockersResponse,
  selectedPathIndex: number | null = null,
  onSelectPath = vi.fn(),
) {
  return render(
    <MemoryRouter>
      <BlockerHighlightPanel
        blockers={blockers}
        selectedPathIndex={selectedPathIndex}
        onSelectPath={onSelectPath}
      />
    </MemoryRouter>,
  );
}

describe('BlockerHighlightPanel', () => {
  it('shows feature 003 summary and every path explanation with linked entity names', () => {
    renderPanel(F1_BLOCKERS);
    expect(screen.getByText(F1_BLOCKERS.summary)).toBeInTheDocument();
    const firstSentence = F1_BLOCKERS.paths[0]?.explanation[0] ?? '';
    const item = screen.getAllByRole('listitem').find((li) => li.textContent === firstSentence);
    expect(item).toBeDefined();
    expect(
      within(item as HTMLElement).getByRole('link', { name: 'Order #18492' }),
    ).toHaveAttribute('href', `/entities/${ORDER_ID}`);
  });

  it('has a Path n button per path, pressed according to the selection', () => {
    renderPanel(F1_BLOCKERS, 1);
    expect(screen.getByRole('button', { name: 'Path 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Path 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Show all paths' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('marks Show all paths as pressed when no path is selected', () => {
    renderPanel(F1_BLOCKERS, null);
    expect(screen.getByRole('button', { name: 'Show all paths' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('selects a path and clears the selection with Show all paths', async () => {
    const onSelectPath = vi.fn();
    renderPanel(F1_BLOCKERS, null, onSelectPath);
    await userEvent.click(screen.getByRole('button', { name: 'Path 2' }));
    expect(onSelectPath).toHaveBeenLastCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: 'Show all paths' }));
    expect(onSelectPath).toHaveBeenLastCalledWith(null);
  });

  it('labels the manual hop of the second path', () => {
    renderPanel(F1_BLOCKERS);
    const second = screen.getByRole('button', { name: 'Path 2' }).closest('li');
    expect(within(second as HTMLElement).getByText('Manual · MEDIUM')).toBeInTheDocument();
    const first = screen.getByRole('button', { name: 'Path 1' }).closest('li');
    expect(within(first as HTMLElement).queryByText('Manual · MEDIUM')).not.toBeInTheDocument();
  });

  it('labels cycles, depth cuts and unknown states, and shows the truncation notices', () => {
    const unknown = tracedEntity(
      '77777777-7777-4777-8777-777777777777',
      'Order',
      'Mystery',
      'UNKNOWN',
    );
    const source = F1_BLOCKERS.paths[0];
    const hop = source?.hops[0];
    if (source === undefined || hop === undefined) {
      throw new Error('missing fixture');
    }
    renderPanel({
      ...F1_BLOCKERS,
      query: { ...F1_BLOCKERS.query, depth: 3 },
      truncation: { depthLimit: true, explorationLimit: true, pathLimit: true },
      cycleClosingHopCount: 2,
      paths: [
        {
          ...source,
          hops: [{ ...hop, entity: unknown }],
          length: 1,
          continuesBeyondDepth: true,
          endsInCycle: true,
        },
      ],
    });
    expect(screen.getByText('Ends in a cycle')).toBeInTheDocument();
    expect(screen.getByText('Continues beyond depth 3')).toBeInTheDocument();
    expect(screen.getByText('Possible blocker (state unknown)')).toBeInTheDocument();
    expect(screen.getByText('Some chains continue beyond depth 3.')).toBeInTheDocument();
    expect(screen.getByText(/Exploration stopped after/)).toBeInTheDocument();
    expect(screen.getByText(/2 relationships close a dependency cycle/)).toBeInTheDocument();
  });

  it('shows only the summary when nothing blocks', () => {
    renderPanel(F4_BLOCKERS);
    expect(screen.getByText(F4_BLOCKERS.summary)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
