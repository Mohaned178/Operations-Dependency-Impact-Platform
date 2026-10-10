import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GraphEdgeDto } from '@opsgraph/shared';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeDetailsPanel } from './EdgeDetailsPanel';
import { edge, node, uuid } from './test-fixtures';

afterEach(cleanup);

const nodes = new Map(
  [
    node({ n: 1, name: 'Payment PAY-88213', type: 'Payment' }),
    node({ n: 2, parent: 1, via: 1, name: 'Shipment SHP-77120', type: 'Shipment' }),
  ].map((n) => [n.id, n]),
);

function renderPanel(target: GraphEdgeDto, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <EdgeDetailsPanel edge={target} nodesById={nodes} search="" onClose={onClose} />
    </MemoryRouter>,
  );
}

describe('EdgeDetailsPanel', () => {
  it('shows the relationship as recorded with both names linked to Entity 360', () => {
    renderPanel(edge({ k: 1, type: 'BLOCKS', from: 1, to: 2 }));
    const sentence = screen.getByTestId('recorded-sentence');
    expect(sentence.textContent).toContain('Payment PAY-88213');
    expect(sentence.textContent).toContain('BLOCKS');
    expect(sentence.textContent).toContain('Shipment SHP-77120');
    expect(within(sentence).getByRole('link', { name: 'Payment PAY-88213' })).toHaveAttribute(
      'href',
      `/entities/${uuid(1)}`,
    );
    expect(within(sentence).getByRole('link', { name: 'Shipment SHP-77120' })).toHaveAttribute(
      'href',
      `/entities/${uuid(2)}`,
    );
    expect(within(sentence).getByRole('link', { name: 'Explore Shipment SHP-77120' })).toHaveAttribute(
      'href',
      `/graph/${uuid(2)}`,
    );
  });

  it('shows the effective origin and confidence and every assertion with its provenance', () => {
    const base = edge({ k: 1, type: 'BLOCKS', from: 1, to: 2, origin: 'MANUAL', confidence: 'MEDIUM' });
    const second = {
      ...base.assertions[0],
      relationshipId: uuid(2000),
      origin: 'INFERRED' as const,
      confidence: 'LOW' as const,
      basis: null,
      sourceSystem: 'InferenceRules',
      sourceId: 'rule-9',
    };
    const target: GraphEdgeDto = {
      ...base,
      assertions: [{ ...base.assertions[0], basis: 'Carrier will not book until payment clears' }, second],
    } as GraphEdgeDto;
    renderPanel(target);

    expect(screen.getByRole('heading', { name: 'Assertions (2)' })).toBeInTheDocument();
    expect(screen.getAllByText('Manual · MEDIUM').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Inferred · LOW')).toBeInTheDocument();
    expect(screen.getByText('Basis: Carrier will not book until payment clears')).toBeInTheDocument();
    expect(screen.getByText(/^OMS · rel-1 · observed /)).toBeInTheDocument();
    expect(screen.getByText(/^InferenceRules · rule-9 · observed /)).toBeInTheDocument();
    expect(screen.getAllByText(/^Import /)).toHaveLength(2);
  });

  it('omits the basis line when the assertion has none', () => {
    renderPanel(edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 }));
    expect(screen.queryByText(/^Basis:/)).not.toBeInTheDocument();
  });

  it('closes on request', async () => {
    const onClose = vi.fn();
    renderPanel(edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 }), onClose);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
