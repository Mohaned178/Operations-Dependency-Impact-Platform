import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ExplanationSentence, linkTargets } from './ExplanationSentence';
import {
  APPROVAL,
  BR_ID,
  BUDGET,
  F1_BLOCKERS,
  ORDER,
  ORDER_ID,
  PAY_ID,
  SHIPMENT,
  hop,
  tracedEntity,
} from './tracing-test-data';

function renderSentence(text: string, targets: ReadonlyMap<string, string>) {
  return render(
    <MemoryRouter>
      <p data-testid="sentence">
        <ExplanationSentence sentence={text} targets={targets} />
      </p>
    </MemoryRouter>,
  );
}

describe('ExplanationSentence', () => {
  afterEach(() => {
    cleanup();
  });

  it('links every entity named in the sentence and keeps the text intact', () => {
    const path = F1_BLOCKERS.paths[0];
    if (path === undefined) {
      throw new Error('fixture: F1 has no first path');
    }
    const text = 'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.';
    renderSentence(text, linkTargets(F1_BLOCKERS.start, path));

    expect(screen.getByTestId('sentence')).toHaveTextContent(text);
    expect(screen.getByRole('link', { name: 'Order #18492' })).toHaveAttribute(
      'href',
      `/entities/${ORDER_ID}`,
    );
    expect(screen.getByRole('link', { name: 'Payment PAY-88213' })).toHaveAttribute(
      'href',
      `/entities/${PAY_ID}`,
    );
  });

  it('prefers the longest name, so a name inside another name is not split', () => {
    const targets = new Map([
      [ORDER.displayName, ORDER_ID],
      [BUDGET.displayName, BR_ID],
    ]);
    renderSentence(
      `Finance approval APR-2291 is blocked because it requires ${BUDGET.displayName}, which is MISSING.`,
      targets,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent(BUDGET.displayName);
    expect(links[0]).toHaveAttribute('href', `/entities/${BR_ID}`);
  });

  it('does not link a name shared by two different entities on the path', () => {
    const twin = tracedEntity(
      '66666666-6666-4666-8666-666666666666',
      'Approval',
      APPROVAL.displayName,
      'BLOCKED',
    );
    const path = {
      ...F1_BLOCKERS.paths[0],
      hops: [
        hop('REQUIRES', 'FORWARD', SHIPMENT.id, APPROVAL.id, APPROVAL),
        hop('REQUIRES', 'FORWARD', APPROVAL.id, twin.id, twin),
      ],
      length: 2,
      weakestConfidence: 'HIGH' as const,
      nonSourceHops: 0,
      continuesBeyondDepth: false,
      endsInCycle: false,
      explanation: ['unused'],
    };

    const targets = linkTargets(SHIPMENT, path);
    expect(targets.has(APPROVAL.displayName)).toBe(false);
    expect(targets.get(SHIPMENT.displayName)).toBe(SHIPMENT.id);
  });
});
