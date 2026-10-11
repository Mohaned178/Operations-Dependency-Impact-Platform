import type { EntityEvidenceDto } from '@opsgraph/shared';
import {
  blockingPath,
  entityEvidence,
  eventEvidence,
  requirementSource,
  stateRecord,
  traced,
  uuid,
} from '../../../test/root-cause-builders';
import { eventCount, keyEvidence } from './key-evidence';
import { toCausalChain } from './roles';

// The shape of fixture R1: Order #18492 has two state records and a GOVERNS contract; the same
// contract also DEFINES the budget code, so its state record must appear only once.
const order = traced('Order #18492', 'BLOCKED', { sourceSystem: 'OMS' });
const payment = traced('Payment PAY-88213', 'PENDING', { type: 'Payment', sourceSystem: 'Payments' });
const approval = traced('Finance approval APR-2291', 'BLOCKED', {
  type: 'Approval',
  sourceSystem: 'FinanceApprovals',
});
const budget = traced('Budget code for Order #18492', 'MISSING', {
  type: 'BudgetRequirement',
  sourceSystem: 'FinanceApprovals',
});
const contract = traced('Contract CON-3982', 'ACTIVE', { type: 'Contract' });

const contractRecordId = uuid();
const contractRecord = () =>
  stateRecord('ACTIVE', {
    sourceSystem: 'ContractMgmt',
    sourceId: 'CON-3982',
    sourceRecordId: contractRecordId,
  });

const chain = toCausalChain(
  order,
  blockingPath(order, [{ entity: payment }, { entity: approval }, { entity: budget }]),
  ['s'],
);

function r1Evidence(): Map<string, EntityEvidenceDto> {
  return new Map([
    [
      order.id,
      entityEvidence(order, {
        stateRecords: [
          stateRecord('BLOCKED', { sourceSystem: 'OMS', sourceId: '18492', current: true }),
          stateRecord('PENDING', { sourceSystem: 'ERP', sourceId: 'SO-18492', current: false }),
        ],
        requirementSources: [
          requirementSource(contract, { type: 'GOVERNS', stateRecord: contractRecord() }),
        ],
      }),
    ],
    [
      payment.id,
      entityEvidence(payment, {
        stateRecords: [stateRecord('PENDING', { sourceSystem: 'Payments', sourceId: 'PAY-88213' })],
      }),
    ],
    [
      approval.id,
      entityEvidence(approval, {
        stateRecords: [
          stateRecord('BLOCKED', { sourceSystem: 'FinanceApprovals', sourceId: 'APR-2291' }),
        ],
      }),
    ],
    [
      budget.id,
      entityEvidence(budget, {
        stateRecords: [
          stateRecord('MISSING', { sourceSystem: 'FinanceApprovals', sourceId: 'BR-18492' }),
        ],
        requirementSources: [
          requirementSource(contract, { type: 'DEFINES', stateRecord: contractRecord() }),
        ],
      }),
    ],
  ]);
}

describe('keyEvidence', () => {
  it('R1 shape: 6 items in chain order, with the contract kept once', () => {
    const items = keyEvidence(chain, r1Evidence());
    expect(
      items.map((item) => `${item.rule} | ${item.entity.displayName} | ${item.sourceSystem} ${item.sourceId}`),
    ).toEqual([
      'STATE_RECORD | Order #18492 | OMS 18492',
      'STATE_RECORD | Order #18492 | ERP SO-18492',
      'REQUIREMENT_SOURCE | Contract CON-3982 | ContractMgmt CON-3982',
      'STATE_RECORD | Payment PAY-88213 | Payments PAY-88213',
      'STATE_RECORD | Finance approval APR-2291 | FinanceApprovals APR-2291',
      'STATE_RECORD | Budget code for Order #18492 | FinanceApprovals BR-18492',
    ]);
    expect(new Set(items.map((item) => item.sourceRecordId)).size).toBe(6);
  });

  it('describes a state record by the step entity, without leaking its state evidence', () => {
    const [first] = keyEvidence(chain, r1Evidence());
    expect(first?.entity).toEqual({
      id: order.id,
      type: 'Order',
      displayName: 'Order #18492',
      currentState: 'BLOCKED',
    });
    expect(first?.origin).toBe('SOURCE');
  });

  it("keeps a requirement source's own origin and the defining entity", () => {
    const evidence = r1Evidence();
    evidence.set(
      order.id,
      entityEvidence(order, {
        stateRecords: [stateRecord('BLOCKED', { sourceSystem: 'OMS', sourceId: '18492' })],
        requirementSources: [
          requirementSource(contract, {
            origin: 'INFERRED',
            stateRecord: stateRecord('ACTIVE', { sourceSystem: 'ContractMgmt', sourceId: 'CON-3982' }),
          }),
        ],
      }),
    );
    const requirement = keyEvidence(chain, evidence).find((item) => item.rule === 'REQUIREMENT_SOURCE');
    expect(requirement?.origin).toBe('INFERRED');
    expect(requirement?.entity.id).toBe(contract.id);
  });

  it('skips a requirement source without a state record', () => {
    const evidence = r1Evidence();
    evidence.set(
      order.id,
      entityEvidence(order, {
        stateRecords: [stateRecord('BLOCKED', { sourceSystem: 'OMS', sourceId: '18492' })],
        requirementSources: [requirementSource(contract, { stateRecord: null })],
      }),
    );
    evidence.set(
      budget.id,
      entityEvidence(budget, {
        stateRecords: [
          stateRecord('MISSING', { sourceSystem: 'FinanceApprovals', sourceId: 'BR-18492' }),
        ],
        requirementSources: [
          requirementSource(contract, { type: 'DEFINES', stateRecord: null }),
        ],
      }),
    );
    const rules = keyEvidence(chain, evidence).map((item) => item.rule);
    expect(rules).toEqual(['STATE_RECORD', 'STATE_RECORD', 'STATE_RECORD', 'STATE_RECORD']);
  });

  it('refuses a step without evidence', () => {
    expect(() => keyEvidence(chain, new Map())).toThrow('no evidence for entity');
  });
});

describe('eventCount', () => {
  it('counts an event shared by 2 steps once', () => {
    const shared = uuid();
    const evidence = r1Evidence();
    evidence.set(
      order.id,
      entityEvidence(order, {
        events: [eventEvidence(order, { id: shared }), eventEvidence(order)],
      }),
    );
    evidence.set(
      payment.id,
      entityEvidence(payment, {
        events: [eventEvidence(payment, { id: shared }), eventEvidence(payment)],
      }),
    );
    expect(eventCount(chain, evidence)).toBe(3);
  });

  it('counts the returned events, not the totals', () => {
    const evidence = r1Evidence();
    evidence.set(order.id, entityEvidence(order, { events: [eventEvidence(order)], eventTotal: 25 }));
    expect(eventCount(chain, evidence)).toBe(1);
  });

  it('is 0 when no step has events', () => {
    expect(eventCount(chain, r1Evidence())).toBe(0);
  });
});
