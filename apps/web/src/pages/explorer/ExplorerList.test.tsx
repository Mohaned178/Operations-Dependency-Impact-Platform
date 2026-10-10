import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { NeighborhoodResponse } from '@opsgraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeEmphasis } from './emphasis';
import { ExplorerList } from './ExplorerList';
import type { Selection } from './flow-types';
import { blockersStub, edge, node, response, smallResponse, uuid } from './test-fixtures';
import { flowFor } from './flow-test-utils';

afterEach(cleanup);

function renderList(
  r: NeighborhoodResponse,
  options: {
    selection?: Selection;
    onSelectNode?: (id: string, from: 'list') => void;
    onSelectEdge?: (key: string, from: 'list') => void;
  } = {},
) {
  const selection = options.selection ?? null;
  return render(
    <MemoryRouter>
      <ExplorerList
        response={r}
        selection={selection}
        emphasis={computeEmphasis({ response: r, selection, focusMode: false, selectedPathIndex: null })}
        onSelectNode={options.onSelectNode ?? vi.fn()}
        onSelectEdge={options.onSelectEdge ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('ExplorerList groups', () => {
  it('groups entities by distance with counts and keeps response order inside a group', () => {
    renderList(smallResponse());
    expect(screen.getByRole('heading', { name: 'Focus (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 step (3)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2 steps (2)' })).toBeInTheDocument();

    const group = screen.getByRole('heading', { name: '1 step (3)' }).parentElement as HTMLElement;
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-entity-id'));
    expect(names).toEqual([uuid(2), uuid(3), uuid(4)]);
  });

  it('puts null-distance nodes under blocking path or expansion', () => {
    const r = response(
      [
        node({ n: 1 }),
        node({ n: 2, parent: 1, via: 1, distance: null, reasons: ['BLOCKING_PATH'] }),
        node({ n: 3, parent: 1, via: 2, distance: null, reasons: ['EXPANSION'] }),
      ],
      [
        edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 }),
        edge({ k: 2, type: 'REQUIRES', from: 1, to: 3 }),
      ],
    );
    renderList(r);
    expect(screen.getByRole('heading', { name: 'Added by blocking path (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Added by expansion (1)' })).toBeInTheDocument();
    expect(screen.getByText('Blocking path')).toBeInTheDocument();
    expect(screen.getByText('Expansion')).toBeInTheDocument();
  });

  it('shows type, name, state, chips and reasons for a row', () => {
    const r = response(
      [
        node({ n: 1 }),
        node({
          n: 2,
          parent: 1,
          via: 1,
          name: 'Disputed',
          type: 'Payment',
          latestBySource: [
            { sourceSystem: 'OMS', state: 'BLOCKED' },
            { sourceSystem: 'ERP', state: 'PENDING' },
          ],
        }),
      ],
      [edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 })],
    );
    renderList(r);
    const row = screen.getByText('Disputed').closest('button') as HTMLElement;
    expect(within(row).getByText('Payment')).toBeInTheDocument();
    expect(within(row).getByText('Pending')).toBeInTheDocument();
    expect(within(row).getByText('Conflict')).toBeInTheDocument();
    expect(within(row).getByText('Neighborhood')).toBeInTheDocument();
  });

  it('dims rows that are dimmed by blocker highlighting', () => {
    const r = {
      ...smallResponse(),
      blockers: blockersStub({ paths: [[[2, 1]]], direct: [2], deepest: [2] }),
    };
    renderList(r);
    const dimmed = screen.getByText('Downstream').closest('li');
    const kept = screen.getByText('Upstream').closest('li');
    expect(dimmed?.className).toContain('opacity-50');
    expect(kept?.className ?? '').not.toContain('opacity-50');
    expect(within(kept as HTMLElement).getByText('Direct blocker')).toBeInTheDocument();
  });
});

describe('ExplorerList relationships', () => {
  it('lists each relationship as recorded with its origin as text, ordered by from, type, to', () => {
    renderList(smallResponse());
    const buttons = Array.from(document.querySelectorAll('[data-edge-key]'));
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Focus RELATES_TO SiblingSource · HIGH',
      'Focus REQUIRES UpstreamSource · HIGH',
      'Upstream REQUIRES Upstream 2Source · HIGH',
      'Downstream REQUIRES FocusSource · HIGH',
      'Downstream 2 REQUIRES DownstreamSource · HIGH',
    ]);
  });

  it('shows non-SOURCE origins as text', () => {
    const r = response(
      [node({ n: 1 }), node({ n: 2, parent: 1, via: 1 })],
      [edge({ k: 1, type: 'REQUIRES', from: 1, to: 2, origin: 'MANUAL', confidence: 'MEDIUM' })],
    );
    renderList(r);
    expect(screen.getByText('Manual · MEDIUM')).toBeInTheDocument();
  });
});

describe('ExplorerList selection and keyboard', () => {
  it('marks the selected row with aria-pressed and offers Open Entity 360 for it only', () => {
    renderList(smallResponse(), { selection: { kind: 'node', id: uuid(2) } });
    const selected = document.querySelector(`[data-entity-id="${uuid(2)}"]`);
    const other = document.querySelector(`[data-entity-id="${uuid(3)}"]`);
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(other).toHaveAttribute('aria-pressed', 'false');
    const links = screen.getAllByRole('link', { name: 'Open Entity 360' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', `/entities/${uuid(2)}`);
  });

  it('marks a selected relationship row', () => {
    renderList(smallResponse(), { selection: { kind: 'edge', key: uuid(1002) } });
    expect(document.querySelector(`[data-edge-key="${uuid(1002)}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('link', { name: 'Open Entity 360' })).not.toBeInTheDocument();
  });

  it('selects a row by click and with the keyboard (Tab, Enter)', async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();
    const onSelectEdge = vi.fn();
    renderList(smallResponse(), { onSelectNode, onSelectEdge });

    await user.click(screen.getByText('Upstream').closest('button') as HTMLElement);
    expect(onSelectNode).toHaveBeenLastCalledWith(uuid(2), 'list');

    await user.tab();
    // Focus continues from the clicked row to the next row.
    expect(document.activeElement).toHaveAttribute('data-entity-id', uuid(3));
    await user.keyboard('{Enter}');
    expect(onSelectNode).toHaveBeenLastCalledWith(uuid(3), 'list');

    const edgeButton = document.querySelector(`[data-edge-key="${uuid(1001)}"]`) as HTMLElement;
    edgeButton.focus();
    await user.keyboard('{Enter}');
    expect(onSelectEdge).toHaveBeenCalledWith(uuid(1001), 'list');
  });
});

describe('graph and list agree (SC-005)', () => {
  it('lists exactly the node ids and edge keys that the canvas draws', () => {
    const cases = [
      smallResponse(),
      response(
        [node({ n: 1 }), node({ n: 2, parent: 1, via: 1 }), node({ n: 3, parent: 2, via: 2 })],
        [
          edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 }),
          edge({ k: 2, type: 'BLOCKS', from: 2, to: 3 }),
          edge({ k: 3, type: 'DEPENDS_ON', from: 3, to: 1 }),
        ],
      ),
    ];
    for (const r of cases) {
      renderList(r);
      const listNodes = Array.from(document.querySelectorAll('[data-entity-id]')).map((e) =>
        e.getAttribute('data-entity-id'),
      );
      const listEdges = Array.from(document.querySelectorAll('[data-edge-key]')).map((e) =>
        e.getAttribute('data-edge-key'),
      );
      const flow = flowFor(r);
      expect([...listNodes].sort()).toEqual(flow.nodes.map((n) => n.id).sort());
      expect([...listEdges].sort()).toEqual(flow.edges.map((e) => e.id).sort());
      cleanup();
    }
  });
});
