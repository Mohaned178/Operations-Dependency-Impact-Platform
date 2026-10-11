import type { ConfidenceRuleOutcomeDto } from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfidenceRules } from './ConfidenceRules';
import { R1_ORDER } from './root-cause-test-data';

function r1Rules(): ConfidenceRuleOutcomeDto[] {
  const candidate = R1_ORDER.candidates.at(0);
  if (candidate === undefined) {
    throw new Error('fixture: missing candidate');
  }
  return candidate.confidenceRules;
}

function rowsAfterOpening() {
  return screen.getAllByRole('listitem');
}

describe('ConfidenceRules', () => {
  afterEach(() => {
    cleanup();
  });

  it('is collapsed until its disclosure is opened', async () => {
    const user = userEvent.setup();
    render(<ConfidenceRules confidence="HIGH" rules={r1Rules()} />);

    const disclosure = screen.getByRole('button', { name: 'Confidence: HIGH — show the 8 rules' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    await user.click(disclosure);

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(rowsAfterOpening()).toHaveLength(8);
  });

  it('shows 8 rows for R1 with only Weakest link applied, as text', async () => {
    const user = userEvent.setup();
    const rules = r1Rules();
    render(<ConfidenceRules confidence="HIGH" rules={rules} />);
    await user.click(screen.getByRole('button', { name: /show the 8 rules/ }));

    const rows = rowsAfterOpening();
    expect(rows).toHaveLength(8);
    const applied = rows.filter((row) => within(row).queryByText('Applied') !== null);
    expect(applied).toHaveLength(1);
    expect(within(applied.at(0) ?? document.body).getByText('Weakest link')).toBeInTheDocument();
    expect(screen.getAllByText('Not applied')).toHaveLength(7);
    for (const outcome of rules) {
      expect(screen.getByText(outcome.reason)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Confidence after: HIGH')).toHaveLength(8);
  });

  it('marks Stale evidence as applied for an R6-like outcome list', async () => {
    const user = userEvent.setup();
    const staleReason =
      'Confidence lowered to MEDIUM: the state of Order #18492 (2026-09-29T11:40:00.000Z) was last observed more than 72 hours before 2026-10-06T12:00:00.000Z.';
    // Rules after STALE_EVIDENCE carry the lowered level forward, as in fixture R6.
    const rules = r1Rules().map((outcome, position): ConfidenceRuleOutcomeDto => {
      if (outcome.rule === 'STALE_EVIDENCE') {
        return {
          ...outcome,
          applied: true,
          confidenceAfter: 'MEDIUM',
          reason: staleReason,
          refs: { stepIndexes: [0], relationshipIds: [], noteIds: [] },
        };
      }
      return position > 4 ? { ...outcome, confidenceAfter: 'MEDIUM' } : outcome;
    });
    render(<ConfidenceRules confidence="MEDIUM" rules={rules} />);
    await user.click(screen.getByRole('button', { name: 'Confidence: MEDIUM — show the 8 rules' }));

    const stale = rowsAfterOpening().find(
      (row) => within(row).queryByText('Stale evidence') !== null,
    );
    if (stale === undefined) {
      throw new Error('expected a Stale evidence row');
    }
    expect(within(stale).getByText('Applied')).toBeInTheDocument();
    expect(within(stale).getByText('Confidence after: MEDIUM')).toBeInTheDocument();
    expect(within(stale).getByText(staleReason)).toBeInTheDocument();
  });
});
