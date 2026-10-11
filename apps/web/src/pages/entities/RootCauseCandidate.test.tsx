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
