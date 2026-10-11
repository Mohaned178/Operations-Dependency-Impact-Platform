import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RootCauseCandidateDto, RootCauseResponse } from '@opsgraph/shared';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { RootCauseCandidate } from './RootCauseCandidate';
import { R1_ORDER, R2_SHIPMENT } from './root-cause-test-data';
import { sentence } from './tracing-test-data';

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`fixture: missing ${what}`);
  }
  return value;
}

function candidateOf(response: RootCauseResponse): RootCauseCandidateDto {
  return required(response.candidates.at(0), 'candidate');
}

function renderCandidate(
  candidate: RootCauseCandidateDto,
  evidence: RootCauseResponse['evidence'],
) {
  return render(
    <MemoryRouter>
      <RootCauseCandidate candidate={candidate} evidence={evidence} />
    </MemoryRouter>,
  );
}

describe('RootCauseCandidate', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the headline, the three chain sentences and the evidence sentence for R1', () => {
    const candidate = candidateOf(R1_ORDER);
    renderCandidate(candidate, R1_ORDER.evidence);

    expect(
      screen.getByRole('heading', { name: 'Root cause: Budget Code Missing. Confidence: HIGH.' }),
    ).toBeInTheDocument();
    expect(candidate.explanation.chain).toHaveLength(3);
    for (const text of candidate.explanation.chain) {
      expect(screen.getByText(sentence(text))).toBeInTheDocument();
    }
    expect(screen.getByText(candidate.explanation.evidence)).toBeInTheDocument();
    for (const reason of candidate.explanation.confidence) {
      expect(screen.getByText(reason)).toBeInTheDocument();
    }
  });

  it('shows the primary chain and no alternatives button when there are none', () => {
    renderCandidate(candidateOf(R1_ORDER), R1_ORDER.evidence);

    expect(screen.getByText('Root Cause')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alternative chains/ })).not.toBeInTheDocument();
  });

  it('collapses the 8 confidence rules until the disclosure is opened', async () => {
    const user = userEvent.setup();
    renderCandidate(candidateOf(R1_ORDER), R1_ORDER.evidence);

    const disclosure = screen.getByRole('button', { name: 'Confidence: HIGH — show the 8 rules' });
    expect(screen.queryByText('Not applied')).not.toBeInTheDocument();

    await user.click(disclosure);

    expect(screen.getAllByText('Not applied')).toHaveLength(7);
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.queryByText('Insufficient evidence')).not.toBeInTheDocument();
  });

  it('flags a LOW candidate as insufficient evidence, with hedged sentences and the applied reasons', () => {
    const base = candidateOf(R1_ORDER);
    const hedged = [
      'Order #18492 may be blocked because it requires Payment PAY-88213, which is PENDING.',
      'Payment PAY-88213 may be pending because it requires Finance approval APR-2291, which is BLOCKED.',
      'Finance approval APR-2291 may be blocked because it requires Budget code for Order #18492, which is MISSING.',
    ];
    const reason =
      'Confidence starts at LOW, the confidence of the weakest link: Finance approval APR-2291 REQUIRES Budget code for Order #18492 (inferred, low confidence).';
    const low: RootCauseCandidateDto = {
      ...base,
      confidence: 'LOW',
      insufficientEvidence: true,
      confidenceRules: base.confidenceRules.map((outcome) => ({
        ...outcome,
        confidenceAfter: 'LOW',
        ...(outcome.rule === 'WEAKEST_LINK' ? { reason } : {}),
      })),
      explanation: {
        ...base.explanation,
        headline: 'Possible root cause — insufficient evidence: Budget Code Missing. Confidence: LOW.',
        chain: hedged,
        confidence: [reason],
      },
    };
    renderCandidate(low, R1_ORDER.evidence);

    const heading = screen.getByRole('heading', {
      name: /^Possible root cause — insufficient evidence/,
    });
    expect(heading).toBeInTheDocument();
    const badge = screen.getByText('Insufficient evidence');
    expect(badge).toBeInTheDocument();
    for (const text of hedged) {
      expect(screen.getByText(sentence(text))).toBeInTheDocument();
    }

    const article = screen.getByRole('article');
    const describedBy = article.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(reason);
    expect(screen.getByRole('button', { name: 'Confidence: LOW — show the 8 rules' })).toBeInTheDocument();
  });

  it('keeps the R2 alternative chain collapsed until its disclosure is expanded', async () => {
    const user = userEvent.setup();
    const candidate = candidateOf(R2_SHIPMENT);
    const alternative = required(candidate.alternativeChains.at(0), 'alternative chain');
    const alternativeSentence = required(alternative.sentences.at(0), 'alternative sentence');
    renderCandidate(candidate, R2_SHIPMENT.evidence);

    const disclosure = screen.getByRole('button', { name: 'Alternative chains (1)' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/manually recorded/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Alternative chain 1' })).not.toBeInTheDocument();

    await user.click(disclosure);

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Alternative chain 1' })).toBeInTheDocument();
    expect(screen.getByText(sentence(alternativeSentence))).toBeInTheDocument();
    expect(screen.getByText(/manually recorded/)).toBeInTheDocument();
    expect(
      screen.getByText('Payment PAY-88213 BLOCKS Shipment SHP-77120 (consolidated)'),
    ).toBeInTheDocument();
  });
});
