import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityFlowNode } from './flow-types';
import { flowFor, renderFlow } from './flow-test-utils';
import { blockersStub, edge, node, response, smallResponse, uuid } from './test-fixtures';

afterEach(cleanup);

function nodeEl(name: string): HTMLElement {
  const el = screen.getByText(name).closest('.react-flow__node');
  if (!(el instanceof HTMLElement)) {
    throw new Error(`no node element for ${name}`);
  }
  return el;
}

function card(name: string): HTMLElement {
  const el = screen.getByText(name).parentElement;
  if (el === null) {
    throw new Error(`no card for ${name}`);
  }
  return el;
}

function render(nodes: EntityFlowNode[], toggleExpand: (id: string) => void = () => undefined) {
  renderFlow(nodes, [], { toggleExpand });
}

describe('EntityNode expand button', () => {
  it('is offered on a non-focus node and not on the focus', () => {
    render(flowFor(smallResponse()).nodes);
    expect(screen.getByRole('button', { name: 'Expand Upstream' })).toHaveTextContent('+');
    expect(screen.queryByRole('button', { name: /Focus$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(smallResponse().nodes.length - 1);
  });

  it('offers Collapse with a minus sign on an expanded node', () => {
    const base = smallResponse();
    const r = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === uuid(2) ? { ...n, expanded: true } : n)),
    };
    render(flowFor(r).nodes);
    expect(screen.getByRole('button', { name: 'Collapse Upstream' })).toHaveTextContent('−');
    expect(screen.getByRole('button', { name: 'Expand Downstream' })).toHaveTextContent('+');
  });

  it('asks the page to toggle that node when clicked', () => {
    const toggleExpand = vi.fn();
    render(flowFor(smallResponse()).nodes, toggleExpand);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Downstream' }));
    expect(toggleExpand).toHaveBeenCalledTimes(1);
    expect(toggleExpand).toHaveBeenCalledWith(uuid(3));
  });
});

describe('EntityNode', () => {
  it('marks the focus with its label, border and ring', () => {
    render(flowFor(smallResponse()).nodes);
    expect(screen.getByText('Order · Focus')).toBeInTheDocument();
    expect(card('Focus').className).toContain('border-blue-600');
    expect(card('Focus').className).toContain('ring-blue-100');
    expect(card('Upstream').className).toContain('border-slate-300');
    expect(card('Upstream').className).not.toContain('ring-');
  });

  it('shows type, name and state', () => {
    render(flowFor(smallResponse()).nodes);
    expect(screen.getByText('Upstream')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  });

  it('draws a selected node with a ring, and a selected focus with the stronger ring', () => {
    render(flowFor(smallResponse(), { selection: { kind: 'node', id: uuid(2) } }).nodes);
    expect(card('Upstream').className).toContain('ring-2 ring-blue-500');
    cleanup();
    render(flowFor(smallResponse(), { selection: { kind: 'node', id: uuid(1) } }).nodes);
    expect(card('Focus').className).toContain('ring-blue-300');
    expect(card('Focus').className).not.toContain('ring-blue-100');
  });

  it('draws a connector dashed and muted, with a Connector chip', () => {
    const r = response(
      [node({ n: 1 }), node({ n: 2, parent: 1, via: 1, name: 'Via', reasons: ['CONNECTOR'] })],
      [edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 })],
    );
    render(flowFor(r).nodes);
    const cls = card('Via').className;
    expect(cls).toContain('border-dashed');
    expect(cls).toContain('bg-slate-50');
    expect(cls).toContain('opacity-70');
    expect(screen.getByText('Connector')).toBeInTheDocument();
  });

  it('highlights and dims by emphasis; dimmed overrides the connector opacity', () => {
    const r = {
      ...smallResponse(),
      blockers: blockersStub({ paths: [[[2, 1]]], direct: [2], deepest: [2] }),
    };
    render(flowFor(r).nodes);
    expect(card('Upstream').className).toContain('border-red-600');
    expect(card('Downstream').className).toContain('opacity-20');
    cleanup();

    const connector = response(
      [node({ n: 1 }), node({ n: 2, parent: 1, via: 1, name: 'Via', reasons: ['CONNECTOR'] }), node({ n: 3, parent: 1, via: 2, name: 'Hit' })],
      [
        edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 }),
        edge({ k: 2, type: 'REQUIRES', from: 1, to: 3 }),
      ],
      { blockers: blockersStub({ paths: [[[3, 2]]], direct: [3], deepest: [3] }) },
    );
    render(flowFor(connector).nodes);
    expect(card('Via').className).toContain('opacity-20');
    expect(card('Via').className).not.toContain('opacity-70');
  });

  it('shows the chips in order: Conflict, State unknown, Direct blocker, Deepest blocker, Connector', () => {
    const r = response(
      [
        node({ n: 1 }),
        node({
          n: 2,
          parent: 1,
          via: 1,
          name: 'Everything',
          state: 'UNKNOWN',
          reasons: ['CONNECTOR'],
          latestBySource: [
            { sourceSystem: 'OMS', state: 'BLOCKED' },
            { sourceSystem: 'ERP', state: 'PENDING' },
          ],
        }),
      ],
      [edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 })],
      { blockers: blockersStub({ paths: [[[2, 1]]], direct: [2], deepest: [2] }) },
    );
    render(flowFor(r).nodes);
    const chips = ['Conflict', 'State unknown', 'Direct blocker', 'Deepest blocker', 'Connector'];
    const chipRow = screen.getByText('Conflict').parentElement;
    expect(chipRow).not.toBeNull();
    const texts = Array.from(chipRow?.children ?? []).map((c) => c.textContent);
    expect(texts.filter((t) => chips.includes(t ?? ''))).toEqual(chips);
    expect(screen.getByText('Conflict')).toHaveAttribute(
      'title',
      "Sources disagree on this entity's state",
    );
  });

  it('shows no chips for a plain node', () => {
    render(flowFor(smallResponse()).nodes);
    for (const chip of ['Conflict', 'State unknown', 'Direct blocker', 'Deepest blocker', 'Connector']) {
      expect(screen.queryByText(chip)).not.toBeInTheDocument();
    }
  });

  it('renders the React Flow node wrapper with the accessible label', () => {
    render(flowFor(smallResponse()).nodes);
    expect(nodeEl('Focus')).toHaveAttribute('aria-label', 'Order Focus, Pending');
  });
});
