import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CausalChainDto,
  CausalStepDto,
  RootCauseCandidateDto,
  RootCauseResponse,
} from '@opsgraph/shared';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { CausalChainView } from './CausalChainView';
import { R1_ORDER, R2_SHIPMENT } from './root-cause-test-data';

const CLAUSE = 'clause: Orders above 10,000.00 USD require finance approval with a budget code';

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`fixture: missing ${what}`);
  }
  return value;
}

function candidateOf(response: RootCauseResponse): RootCauseCandidateDto {
  return required(response.candidates.at(0), 'candidate');
}

function stepAt(chain: CausalChainDto, index: number): CausalStepDto {
  return required(chain.steps.at(index), `step ${index}`);
}

/** The list item of the step whose entity link has this name. */
function stepItem(name: string): HTMLElement {
  const item = screen.getByRole('link', { name }).closest('li') ?? undefined;
  return required(item, `list item for ${name}`);
}

function renderChain(chain: CausalChainDto, evidence: RootCauseResponse['evidence']) {
  return render(
    <MemoryRouter>
      <CausalChainView chain={chain} evidence={evidence} />
    </MemoryRouter>,
  );
}

describe('CausalChainView', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the four R1 steps in order, each with its role badge', () => {
    const chain = candidateOf(R1_ORDER).primaryChain;
    renderChain(chain, R1_ORDER.evidence);

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(4);

    const expected: [string, string][] = [
      ['Order #18492', 'Symptom'],
      ['Payment PAY-88213', 'Immediate Blocker'],
      ['Finance approval APR-2291', 'Upstream Cause'],
      ['Budget code for Order #18492', 'Root Cause'],
    ];
    expected.forEach(([name, badge], position) => {
      const item = required(items.at(position), `item ${position}`);
      expect(within(item).getByRole('link', { name })).toHaveAttribute(
        'href',
        `/entities/${required(chain.steps.at(position), 'step').entity.id}`,
      );
      expect(within(item).getByText(badge)).toBeInTheDocument();
    });
  });

  it('shows the relationship as recorded with its origin and confidence', () => {
    renderChain(candidateOf(R1_ORDER).primaryChain, R1_ORDER.evidence);

    const paymentStep = stepItem('Payment PAY-88213');
    expect(
      within(paymentStep).getByText('Order #18492 REQUIRES Payment PAY-88213'),
    ).toBeInTheDocument();
    expect(within(paymentStep).getByText('Source · HIGH')).toBeInTheDocument();
    expect(within(stepItem('Order #18492')).queryByText(/REQUIRES/)).not.toBeInTheDocument();
  });

  it('shows two badges on a step that has two roles', () => {
    const r1 = candidateOf(R1_ORDER).primaryChain;
    const chain: CausalChainDto = {
      ...r1,
      length: 1,
      steps: [
        { ...stepAt(r1, 2), index: 0, roles: ['SYMPTOM'], hop: null },
        { ...stepAt(r1, 3), index: 1, roles: ['IMMEDIATE_BLOCKER', 'ROOT_CAUSE'] },
      ],
    };
    renderChain(chain, R1_ORDER.evidence);

    const budgetStep = stepItem('Budget code for Order #18492');
    expect(within(budgetStep).getByText('Immediate Blocker')).toBeInTheDocument();
    expect(within(budgetStep).getByText('Root Cause')).toBeInTheDocument();
    expect(
      within(budgetStep).getByText(
        'Finance approval APR-2291 REQUIRES Budget code for Order #18492',
      ),
    ).toBeInTheDocument();
  });

  it('reads a REVERSE hop from the step back to the previous step', () => {
    const alternative = required(
      candidateOf(R2_SHIPMENT).alternativeChains.at(0),
      'alternative chain',
    );
    renderChain(alternative, R2_SHIPMENT.evidence);

    const paymentStep = stepItem('Payment PAY-88213');
    expect(
      within(paymentStep).getByText('Payment PAY-88213 BLOCKS Shipment SHP-77120 (consolidated)'),
    ).toBeInTheDocument();
    expect(within(paymentStep).getByText('Manual · MEDIUM')).toBeInTheDocument();
  });

  it('reveals a step evidence only after its disclosure is expanded', async () => {
    const user = userEvent.setup();
    renderChain(candidateOf(R1_ORDER).primaryChain, R1_ORDER.evidence);

    const budgetStep = stepItem('Budget code for Order #18492');
    const disclosure = within(budgetStep).getByRole('button', {
      name: 'Show evidence for Budget code for Order #18492',
    });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(CLAUSE)).not.toBeInTheDocument();

    await user.click(disclosure);

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(CLAUSE)).toBeInTheDocument();
    expect(
      screen.getByText('Contract CON-3982 DEFINES Budget code for Order #18492'),
    ).toBeInTheDocument();
  });

  it('says the evidence is unavailable when a step has no entity evidence', async () => {
    const user = userEvent.setup();
    renderChain(candidateOf(R1_ORDER).primaryChain, { entities: [], relationships: [] });

    await user.click(screen.getByRole('button', { name: 'Show evidence for Order #18492' }));

    expect(screen.getByText('Evidence unavailable')).toBeInTheDocument();
  });
});
