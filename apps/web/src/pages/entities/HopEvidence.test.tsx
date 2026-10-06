import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HopEvidence } from './HopEvidence';
import { hop, ORDER, ORDER_ID, PAY_ID, PAYMENT, SHP_ID, tracedEntity } from './tracing-test-data';

describe('HopEvidence', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows every assertion with its origin, basis, source and time', () => {
    const target = hop('BLOCKS', 'REVERSE', PAY_ID, SHP_ID, PAYMENT, {
      origin: 'MANUAL',
      confidence: 'MEDIUM',
      basis: 'Recorded by ops analyst',
    });
    const [first] = target.assertions;
    if (first === undefined) {
      throw new Error('expected an assertion');
    }
    target.assertions.push({
      ...first,
      relationshipId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      origin: 'SOURCE',
      confidence: 'HIGH',
      basis: null,
      sourceSystem: 'ERP',
      sourceId: 'LINK-9',
    });

    render(<HopEvidence hop={target} />);

    expect(screen.getByText('Manual · MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('Source · HIGH')).toBeInTheDocument();
    expect(screen.getByText('Recorded by ops analyst')).toBeInTheDocument();
    expect(
      screen.getByText(
        (content) => content.startsWith('OPSGRAPH · rel-') && content.includes('2026'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (content) => content.startsWith('ERP · LINK-9 · ') && content.includes('2026'),
      ),
    ).toBeInTheDocument();
  });

  it('shows the state line with the reporting system and time', () => {
    render(<HopEvidence hop={hop('DEPENDS_ON', 'FORWARD', SHP_ID, ORDER_ID, ORDER)} />);

    expect(
      screen.getByText(
        (content) =>
          content.startsWith('State: Blocked — reported by OMS at ') && content.includes('2026'),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Sources disagree:')).not.toBeInTheDocument();
  });

  it('lists each source when the sources disagree', () => {
    const disagreeing = tracedEntity(ORDER_ID, 'Order', 'Order #18492', 'BLOCKED', {
      observation: ORDER.state.observation,
      latestBySource: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          state: 'PENDING',
          sourceStatus: null,
          sourceSystem: 'ERP',
          sourceId: 'SO-18492',
          observedAt: '2026-09-29T09:20:00.000Z',
          receivedAt: '2026-09-29T09:21:00.000Z',
          importId: '99999999-9999-4999-8999-999999999999',
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          state: 'BLOCKED',
          sourceStatus: 'ON_HOLD',
          sourceSystem: 'OMS',
          sourceId: '18492',
          observedAt: '2026-09-29T11:40:00.000Z',
          receivedAt: '2026-09-29T11:41:00.000Z',
          importId: '99999999-9999-4999-8999-999999999999',
        },
      ],
    });

    render(<HopEvidence hop={hop('DEPENDS_ON', 'FORWARD', SHP_ID, ORDER_ID, disagreeing)} />);

    expect(screen.getByText('Sources disagree:')).toBeInTheDocument();
    expect(screen.getByText('ERP: Pending')).toBeInTheDocument();
    expect(screen.getByText('OMS: Blocked')).toBeInTheDocument();
  });

  it('says so when the entity has no state observation', () => {
    render(<HopEvidence hop={hop('REQUIRES', 'FORWARD', ORDER_ID, PAY_ID, PAYMENT)} />);

    expect(screen.getByText('No state observation')).toBeInTheDocument();
  });
});
