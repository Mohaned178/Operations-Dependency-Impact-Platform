import {
  STATE_CLASSIFICATION,
  type BlockerDto,
  type Confidence,
  type HopDto,
  type OperationalState,
  type RelationshipOrigin,
  type TraceableRelationshipType,
  type TracedEntityDto,
} from '@opsgraph/shared';
import { explainBlockingPath, summarizeBlockers } from './explanation';

let counter = 0;

function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function entity(
  displayName: string,
  currentState: OperationalState,
  type: TracedEntityDto['type'] = 'Order',
): TracedEntityDto {
  return {
    id: uuid(),
    type,
    displayName,
    currentState,
    state: {
      classification: STATE_CLASSIFICATION[currentState],
      observation: null,
      latestBySource: [],
    },
  };
}

interface HopOptions {
  origin?: RelationshipOrigin;
  confidence?: Confidence;
  basis?: string | null;
}

function hop(
  relationshipType: TraceableRelationshipType,
  traversal: 'FORWARD' | 'REVERSE',
  entityReached: TracedEntityDto,
  options: HopOptions = {},
): HopDto {
  const origin = options.origin ?? 'SOURCE';
  const confidence = options.confidence ?? 'HIGH';
  return {
    key: uuid(),
    relationshipType,
    fromEntityId: uuid(),
    toEntityId: uuid(),
    traversal,
    effectiveOrigin: origin,
    effectiveConfidence: confidence,
    assertions: [
      {
        relationshipId: uuid(),
        origin,
        confidence,
        basis: options.basis ?? null,
        sourceSystem: 'OPSGRAPH',
        sourceId: 'rel',
        observedAt: '2026-09-14T08:00:00.000Z',
        importId: uuid(),
      },
    ],
    entity: entityReached,
  };
}

function blocker(
  target: TracedEntityDto,
  pathLength: number,
  flags: Partial<Pick<BlockerDto, 'possible' | 'continuesBeyondDepth' | 'inCycle'>> = {},
): BlockerDto {
  return {
    entity: target,
    pathLength,
    possible: flags.possible ?? false,
    continuesBeyondDepth: flags.continuesBeyondDepth ?? false,
    inCycle: flags.inCycle ?? false,
  };
}

const shipment = entity('Shipment SHP-77120 (consolidated)', 'DELAYED', 'Shipment');
const order = entity('Order #18492', 'BLOCKED');
const payment = entity('Payment PAY-88213', 'PENDING', 'Payment');
const approval = entity('Finance approval APR-2291', 'BLOCKED', 'Approval');
const budget = entity('Budget code for Order #18492', 'MISSING', 'BudgetRequirement');
const sla = entity('Acme Corp delivery SLA', 'AT_RISK', 'SLA');
const warehouse = entity('East Distribution Center 02', 'ACTIVE', 'Warehouse');

const MANUAL_BASIS =
  'Recorded by ops analyst: carrier will not book the consolidated load until payment clears';
const INFERRED_BASIS = "SLA measures on-time delivery of the customer's orders on this shipment";

describe('explainBlockingPath (contracts/api.md F1–F3)', () => {
  it('writes the four sentences of F1 paths[0]', () => {
    const path = {
      hops: [
        hop('DEPENDS_ON', 'FORWARD', order),
        hop('REQUIRES', 'FORWARD', payment),
        hop('REQUIRES', 'FORWARD', approval),
        hop('REQUIRES', 'FORWARD', budget),
      ],
    };
    expect(explainBlockingPath(shipment, path)).toEqual([
      'Shipment SHP-77120 (consolidated) is delayed because it depends on Order #18492, which is BLOCKED.',
      'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
      'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
      'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
    ]);
  });

  it('writes the manual BLOCKS sentence of F1 paths[1]', () => {
    const path = {
      hops: [
        hop('BLOCKS', 'REVERSE', payment, {
          origin: 'MANUAL',
          confidence: 'MEDIUM',
          basis: MANUAL_BASIS,
        }),
        hop('REQUIRES', 'FORWARD', approval),
        hop('REQUIRES', 'FORWARD', budget),
      ],
    };
    expect(explainBlockingPath(shipment, path)[0]).toBe(
      `Shipment SHP-77120 (consolidated) is delayed because Payment PAY-88213, which is PENDING, blocks it (manually recorded, medium confidence: "${MANUAL_BASIS}").`,
    );
  });

  it('writes F2 explanation[0]', () => {
    const path = {
      hops: [
        hop('REQUIRES', 'FORWARD', payment),
        hop('REQUIRES', 'FORWARD', approval),
        hop('REQUIRES', 'FORWARD', budget),
      ],
    };
    expect(explainBlockingPath(order, path)[0]).toBe(
      'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
    );
  });

  it('writes F3 paths[0].explanation[0] with an inferred hop from an at-risk start', () => {
    const path = {
      hops: [
        hop('DEPENDS_ON', 'FORWARD', shipment, {
          origin: 'INFERRED',
          confidence: 'MEDIUM',
          basis: INFERRED_BASIS,
        }),
      ],
    };
    expect(explainBlockingPath(sla, path)[0]).toBe(
      `Acme Corp delivery SLA is at risk because it depends on Shipment SHP-77120 (consolidated) (inferred, medium confidence: "${INFERRED_BASIS}"), which is DELAYED.`,
    );
  });

  it('says "has an unknown state, and" and "whose state is unknown" for an INDETERMINATE entity', () => {
    const unknown = entity('Mystery Record', 'UNKNOWN');
    const path = {
      hops: [hop('REQUIRES', 'FORWARD', unknown), hop('REQUIRES', 'FORWARD', budget)],
    };
    expect(explainBlockingPath(order, path)).toEqual([
      'Order #18492 is blocked because it requires Mystery Record, whose state is unknown.',
      'Mystery Record has an unknown state, and it requires Budget code for Order #18492, which is MISSING.',
    ]);
  });

  it('says "is active, but" for an ACTIVE start', () => {
    const path = { hops: [hop('REQUIRES', 'FORWARD', payment)] };
    expect(explainBlockingPath(warehouse, path)[0]).toBe(
      'East Distribution Center 02 is active, but it requires Payment PAY-88213, which is PENDING.',
    );
  });

  it('omits the quoted basis of a MANUAL hop whose basis is null', () => {
    const path = {
      hops: [hop('BLOCKS', 'REVERSE', payment, { origin: 'MANUAL', confidence: 'LOW', basis: null })],
    };
    expect(explainBlockingPath(shipment, path)[0]).toBe(
      'Shipment SHP-77120 (consolidated) is delayed because Payment PAY-88213, which is PENDING, blocks it (manually recorded, low confidence).',
    );
  });

  it('takes the basis from the first assertion that matches the effective origin', () => {
    const inferred = hop('REQUIRES', 'FORWARD', payment, {
      origin: 'INFERRED',
      confidence: 'HIGH',
      basis: 'first inferred basis',
    });
    const [firstAssertion] = inferred.assertions;
    if (firstAssertion === undefined) {
      throw new Error('expected one assertion');
    }
    inferred.assertions.push({ ...firstAssertion, basis: 'second inferred basis' });
    expect(explainBlockingPath(order, { hops: [inferred] })[0]).toContain(
      '(inferred, high confidence: "first inferred basis")',
    );
  });

  it('throws on an unsupported hop', () => {
    expect(() =>
      explainBlockingPath(order, { hops: [hop('FULFILLED_BY', 'FORWARD', payment)] }),
    ).toThrow('explainBlockingPath: unsupported hop');
    expect(() =>
      explainBlockingPath(order, { hops: [hop('REQUIRES', 'REVERSE', payment)] }),
    ).toThrow('explainBlockingPath: unsupported hop');
  });
});

describe('summarizeBlockers (contracts/api.md F1–F4, F10)', () => {
  it('F1: one deepest blocker', () => {
    expect(summarizeBlockers(shipment, [blocker(budget, 4)], 6)).toBe(
      'Shipment SHP-77120 (consolidated) is DELAYED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 4 steps away.',
    );
  });

  it('F2: one deepest blocker three steps away', () => {
    expect(summarizeBlockers(order, [blocker(budget, 3)], 6)).toBe(
      'Order #18492 is BLOCKED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 3 steps away.',
    );
  });

  it('F3: an at-risk start', () => {
    expect(summarizeBlockers(sla, [blocker(budget, 5)], 6)).toBe(
      'Acme Corp delivery SLA is AT_RISK. 1 deepest blocker: Budget code for Order #18492 (MISSING), 5 steps away.',
    );
  });

  it('F4: no blockers', () => {
    expect(summarizeBlockers(warehouse, [], 6)).toBe(
      'East Distribution Center 02 is ACTIVE. No blockers found within 6 steps.',
    );
  });

  it('F10: two deepest blockers at the depth limit', () => {
    expect(
      summarizeBlockers(
        sla,
        [
          blocker(payment, 3, { continuesBeyondDepth: true }),
          blocker(approval, 3, { continuesBeyondDepth: true }),
        ],
        3,
      ),
    ).toBe(
      'Acme Corp delivery SLA is AT_RISK. 2 deepest blockers found within 3 steps; highest ranked: Payment PAY-88213 (PENDING), 3 steps away; the chain continues beyond the depth limit.',
    );
  });

  it('names a single blocker at the depth limit', () => {
    expect(summarizeBlockers(sla, [blocker(payment, 3, { continuesBeyondDepth: true })], 3)).toBe(
      'Acme Corp delivery SLA is AT_RISK. 1 deepest blocker found within 3 steps: Payment PAY-88213 (PENDING), 3 steps away; the chain continues beyond the depth limit.',
    );
  });

  it('names several blockers without a depth cut', () => {
    expect(summarizeBlockers(order, [blocker(budget, 3), blocker(approval, 2)], 6)).toBe(
      'Order #18492 is BLOCKED. 2 deepest blockers; highest ranked: Budget code for Order #18492 (MISSING), 3 steps away.',
    );
  });

  it('describes a single possible blocker as "state unknown, possible blocker"', () => {
    const unknown = entity('Mystery Record', 'UNKNOWN');
    expect(summarizeBlockers(order, [blocker(unknown, 1, { possible: true })], 6)).toBe(
      'Order #18492 is BLOCKED. 1 deepest blocker: Mystery Record (state unknown, possible blocker), 1 step away.',
    );
  });

  it('appends the cycle sentence when the highest-ranked blocker is in a cycle', () => {
    expect(summarizeBlockers(order, [blocker(payment, 1, { inCycle: true })], 6)).toBe(
      'Order #18492 is BLOCKED. 1 deepest blocker: Payment PAY-88213 (PENDING), 1 step away. It is part of a dependency cycle.',
    );
  });

  it('uses "1 step" for a depth of 1', () => {
    expect(summarizeBlockers(warehouse, [], 1)).toBe(
      'East Distribution Center 02 is ACTIVE. No blockers found within 1 step.',
    );
  });
});
