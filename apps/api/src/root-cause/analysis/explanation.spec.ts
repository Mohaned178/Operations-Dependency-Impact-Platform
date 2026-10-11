import { entityRef, traced } from '../../../test/root-cause-builders';
import {
  corroborationReason,
  cycleReason,
  disagreementDetail,
  disagreementReason,
  disputedReason,
  evidenceSentence,
  headline,
  searchLimitReason,
  staleReason,
  summarizeRootCause,
  unknownStateReason,
  weakestLinkReason,
  type HeadlineFields,
} from './explanation';

// Every expected string below is copied from contracts/api.md § Explanation text and
// § Acceptance fixtures R1–R9. Assert them literally; never derive them from the builders.

function evidenceItem(name: string, sourceSystem: string, sourceId: string) {
  return { entity: entityRef(traced(name, 'ACTIVE')), sourceSystem, sourceId };
}

const R1_KEY_EVIDENCE = [
  evidenceItem('Order #18492', 'OMS', '18492'),
  evidenceItem('Order #18492', 'ERP', 'SO-18492'),
  evidenceItem('Contract CON-3982', 'ContractMgmt', 'CON-3982'),
  evidenceItem('Payment PAY-88213', 'Payments', 'PAY-88213'),
  evidenceItem('Finance approval APR-2291', 'FinanceApprovals', 'APR-2291'),
  evidenceItem('Budget code for Order #18492', 'FinanceApprovals', 'BR-18492'),
];

const budgetCodeMissing: HeadlineFields = {
  label: 'Budget Code Missing',
  confidence: 'HIGH',
  possible: false,
  inCycle: false,
  continuesBeyondDepth: false,
};

const order = traced('Order #18492', 'BLOCKED');

describe('fixture R1: Order #18492', () => {
  it('writes the 8 confidence reasons', () => {
    expect(
      weakestLinkReason({
        fromName: 'Order #18492',
        relationshipType: 'REQUIRES',
        toName: 'Payment PAY-88213',
        origin: 'SOURCE',
        confidence: 'HIGH',
      }),
    ).toBe(
      'Confidence starts at HIGH, the confidence of the weakest link: Order #18492 REQUIRES Payment PAY-88213 (source-recorded, high confidence).',
    );
    expect(unknownStateReason(false, [])).toBe('No step has an unknown state.');
    expect(cycleReason(false, 'Budget code for Order #18492')).toBe(
      'The chain is not part of a dependency cycle.',
    );
    expect(searchLimitReason(false, false, 6)).toBe('The search was complete within 6 steps.');
    expect(staleReason(false, 'HIGH', [], new Date('2026-09-29T16:00:00.000Z'))).toBe(
      "Every step's state was observed within 72 hours before 2026-09-29T16:00:00.000Z.",
    );
    expect(
      disagreementReason(
        false,
        'HIGH',
        [],
        [
          disagreementDetail('Order #18492', [
            { sourceSystem: 'OMS', state: 'BLOCKED' },
            { sourceSystem: 'ERP', state: 'PENDING' },
          ]),
        ],
      ),
    ).toBe(
      "Sources report different states for Order #18492 (ERP PENDING, OMS BLOCKED), but each step's states share one classification, so confidence is not lowered.",
    );
    expect(
      corroborationReason(false, 'HIGH', 'Budget code for Order #18492', ['FinanceApprovals'], 1),
    ).toBe('The state of Budget code for Order #18492 is corroborated by 1 operational event.');
    expect(disputedReason(false, 'HIGH', [])).toBe('No active note disputes this chain.');
  });

  it('writes the headline, the evidence sentence and the summary', () => {
    expect(headline(budgetCodeMissing, 1, 6)).toBe(
      'Root cause: Budget Code Missing. Confidence: HIGH.',
    );
    expect(evidenceSentence(R1_KEY_EVIDENCE, 7)).toBe(
      'Evidence: Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 7 operational events.',
    );
    expect(
      summarizeRootCause(order, 'ROOT_CAUSES_FOUND', [{ label: 'Budget Code Missing', confidence: 'HIGH' }], 6),
    ).toBe('Order #18492 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH).');
  });
});

describe('fixture R2: Shipment SHP-77120 (consolidated)', () => {
  it('writes the weakest-link reason, the evidence sentence and the summary', () => {
    expect(
      weakestLinkReason({
        fromName: 'Shipment SHP-77120 (consolidated)',
        relationshipType: 'DEPENDS_ON',
        toName: 'Order #18492',
        origin: 'SOURCE',
        confidence: 'HIGH',
      }),
    ).toBe(
      'Confidence starts at HIGH, the confidence of the weakest link: Shipment SHP-77120 (consolidated) DEPENDS_ON Order #18492 (source-recorded, high confidence).',
    );
    expect(
      evidenceSentence(
        [evidenceItem('Shipment SHP-77120 (consolidated)', 'TMS', 'SHP-77120'), ...R1_KEY_EVIDENCE],
        8,
      ),
    ).toBe(
      'Evidence: Shipment SHP-77120 (consolidated) (TMS SHP-77120), Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 8 operational events.',
    );
    expect(
      summarizeRootCause(
        traced('Shipment SHP-77120 (consolidated)', 'DELAYED', { type: 'Shipment' }),
        'ROOT_CAUSES_FOUND',
        [{ label: 'Budget Code Missing', confidence: 'HIGH' }],
        6,
      ),
    ).toBe('Shipment SHP-77120 (consolidated) is DELAYED. 1 root cause found: Budget Code Missing (HIGH).');
  });
});

describe('fixture R3: Acme Corp delivery SLA', () => {
  const sla = traced('Acme Corp delivery SLA', 'AT_RISK', { type: 'SLA' });

  it('writes the inferred weakest-link reason', () => {
    expect(
      weakestLinkReason({
        fromName: 'Acme Corp delivery SLA',
        relationshipType: 'DEPENDS_ON',
        toName: 'Shipment SHP-77120 (consolidated)',
        origin: 'INFERRED',
        confidence: 'MEDIUM',
      }),
    ).toBe(
      'Confidence starts at MEDIUM, the confidence of the weakest link: Acme Corp delivery SLA DEPENDS_ON Shipment SHP-77120 (consolidated) (inferred, medium confidence).',
    );
  });

  it('writes the headline, the summary and the evidence sentence', () => {
    expect(headline({ ...budgetCodeMissing, confidence: 'MEDIUM' }, 1, 6)).toBe(
      'Root cause: Budget Code Missing. Confidence: MEDIUM.',
    );
    expect(
      summarizeRootCause(sla, 'ROOT_CAUSES_FOUND', [{ label: 'Budget Code Missing', confidence: 'MEDIUM' }], 6),
    ).toBe('Acme Corp delivery SLA is AT_RISK. 1 root cause found: Budget Code Missing (MEDIUM).');
    expect(
      evidenceSentence(
        [
          evidenceItem('Acme Corp delivery SLA', 'ContractMgmt', 'SLA-3982-DEL'),
          evidenceItem('Contract CON-3982', 'ContractMgmt', 'CON-3982'),
          evidenceItem('Shipment SHP-77120 (consolidated)', 'TMS', 'SHP-77120'),
          evidenceItem('Order #18492', 'OMS', '18492'),
          evidenceItem('Order #18492', 'ERP', 'SO-18492'),
          evidenceItem('Payment PAY-88213', 'Payments', 'PAY-88213'),
          evidenceItem('Finance approval APR-2291', 'FinanceApprovals', 'APR-2291'),
          evidenceItem('Budget code for Order #18492', 'FinanceApprovals', 'BR-18492'),
        ],
        8,
      ),
    ).toBe(
      'Evidence: Acme Corp delivery SLA (ContractMgmt SLA-3982-DEL), Contract CON-3982 (ContractMgmt CON-3982), Shipment SHP-77120 (consolidated) (TMS SHP-77120), Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 8 operational events.',
    );
  });
});

describe('fixtures R4, R5 and R9: summaries without candidates', () => {
  it('R4: NOT_BLOCKED', () => {
    expect(
      summarizeRootCause(traced('East Distribution Center 02', 'ACTIVE'), 'NOT_BLOCKED', [], 6),
    ).toBe(
      'East Distribution Center 02 is ACTIVE. It is not blocked: no unsatisfied dependency was found within 6 steps, so no root cause applies.',
    );
  });

  it('R5: UNEXPLAINED', () => {
    expect(summarizeRootCause(traced('Order #18532', 'PENDING'), 'UNEXPLAINED', [], 6)).toBe(
      'Order #18532 is PENDING, but no recorded dependency within 6 steps explains this state. No root cause can be named.',
    );
  });

  it('R9: UNEXPLAINED for a root cause itself', () => {
    expect(
      summarizeRootCause(traced('Budget code for Order #18492', 'MISSING'), 'UNEXPLAINED', [], 6),
    ).toBe(
      'Budget code for Order #18492 is MISSING, but no recorded dependency within 6 steps explains this state. No root cause can be named.',
    );
  });

  it('uses the singular "step" at depth 1', () => {
    expect(summarizeRootCause(traced('Order #18532', 'PENDING'), 'NOT_BLOCKED', [], 1)).toContain(
      'within 1 step,',
    );
  });
});

describe('fixture R6: stale evidence', () => {
  it('writes the stale reason with each step and its observation time', () => {
    expect(
      staleReason(
        true,
        'MEDIUM',
        [
          { name: 'Order #18492', observedAt: '2026-09-29T11:40:00.000Z' },
          { name: 'Payment PAY-88213', observedAt: '2026-09-29T10:05:00.000Z' },
          { name: 'Finance approval APR-2291', observedAt: '2026-09-29T10:05:00.000Z' },
          { name: 'Budget code for Order #18492', observedAt: '2026-09-29T10:05:00.000Z' },
        ],
        new Date('2026-10-06T12:00:00.000Z'),
      ),
    ).toBe(
      'Confidence lowered to MEDIUM: the state of Order #18492 (2026-09-29T11:40:00.000Z), Payment PAY-88213 (2026-09-29T10:05:00.000Z), Finance approval APR-2291 (2026-09-29T10:05:00.000Z), Budget code for Order #18492 (2026-09-29T10:05:00.000Z) was last observed more than 72 hours before 2026-10-06T12:00:00.000Z.',
    );
  });

  it('says "never observed" for a step without an observation', () => {
    expect(
      staleReason(true, 'LOW', [{ name: 'Ghost', observedAt: null }], new Date('2026-10-06T12:00:00.000Z')),
    ).toBe(
      'Confidence lowered to LOW: the state of Ghost (never observed) was last observed more than 72 hours before 2026-10-06T12:00:00.000Z.',
    );
  });
});

describe('fixture R7: disputed', () => {
  const text =
    'Approval record APR-2291 is out of date; Finance says the budget code was supplied on 2026-09-30.';

  it('cuts a 97-character text to its first 80 characters plus an ellipsis', () => {
    expect(text).toHaveLength(97);
    expect(
      disputedReason(true, 'MEDIUM', [
        { authorName: 'Analyst B', createdAt: '2026-09-30T09:00:00.000Z', text },
      ]),
    ).toBe(
      'Confidence lowered to MEDIUM: 1 active disputing note: Analyst B on 2026-09-30T09:00:00.000Z: "Approval record APR-2291 is out of date; Finance says the budget code was suppli…".',
    );
  });

  it('keeps a text of exactly 80 characters whole, without an ellipsis', () => {
    const exact = 'x'.repeat(80);
    expect(
      disputedReason(true, 'LOW', [{ authorName: 'A', createdAt: '2026-09-30T09:00:00.000Z', text: exact }]),
    ).toBe(`Confidence lowered to LOW: 1 active disputing note: A on 2026-09-30T09:00:00.000Z: "${exact}".`);
  });

  it('pluralises and joins several notes with ", " in the order given', () => {
    expect(
      disputedReason(true, 'LOW', [
        { authorName: 'A', createdAt: '2026-09-30T09:00:00.000Z', text: 'first' },
        { authorName: 'B', createdAt: '2026-09-30T10:00:00.000Z', text: 'second' },
      ]),
    ).toBe(
      'Confidence lowered to LOW: 2 active disputing notes: A on 2026-09-30T09:00:00.000Z: "first", B on 2026-09-30T10:00:00.000Z: "second".',
    );
  });
});

describe('the other reason branches', () => {
  it('UNKNOWN_STATE applied names the steps', () => {
    expect(unknownStateReason(true, ['Mystery Record', 'Other Record'])).toBe(
      'Confidence set to LOW: the state of Mystery Record, Other Record is unknown.',
    );
  });

  it('CYCLE applied names the root cause', () => {
    expect(cycleReason(true, 'Cycle A')).toBe(
      'Confidence set to LOW: Cycle A is part of a dependency cycle.',
    );
  });

  it('SEARCH_LIMIT applied says whether the chain continues or the search was truncated', () => {
    expect(searchLimitReason(true, true, 1)).toBe(
      'Confidence is at most MEDIUM: the chain continues beyond the depth limit of 1 step, so the true cause may lie deeper.',
    );
    expect(searchLimitReason(true, false, 6)).toBe(
      'Confidence is at most MEDIUM: the blocker search was truncated, so other causes may exist.',
    );
  });

  it('CLASSIFICATION_DISAGREEMENT applied lists only the cross-class entities, joined by "; "', () => {
    const payment = disagreementDetail('Payment PAY-88213', [
      { sourceSystem: 'Payments', state: 'COMPLETED' },
      { sourceSystem: 'ERP', state: 'PENDING' },
    ]);
    const approval = disagreementDetail('Finance approval APR-2291', [
      { sourceSystem: 'FinanceApprovals', state: 'ACTIVE' },
      { sourceSystem: 'ERP', state: 'BLOCKED' },
    ]);
    expect(disagreementReason(true, 'MEDIUM', [payment, approval], ['ignored same-class detail'])).toBe(
      'Confidence lowered to MEDIUM: sources disagree on whether a step can progress: Payment PAY-88213 (ERP PENDING, Payments COMPLETED); Finance approval APR-2291 (ERP BLOCKED, FinanceApprovals ACTIVE).',
    );
  });

  it('CLASSIFICATION_DISAGREEMENT not applied with no disagreement says all sources agree', () => {
    expect(disagreementReason(false, 'HIGH', [], [])).toBe(
      "All sources agree on each step's state.",
    );
  });

  it('UNCORROBORATED applied names the single source', () => {
    expect(
      corroborationReason(true, 'MEDIUM', 'Budget code for Order #18492', ['FinanceApprovals'], 0),
    ).toBe(
      'Confidence lowered to MEDIUM: the state of Budget code for Order #18492 comes from a single source (FinanceApprovals) and no operational event mentions it.',
    );
  });

  it('UNCORROBORATED not applied with two sources and no events says how many sources report it', () => {
    expect(
      corroborationReason(false, 'HIGH', 'Budget code for Order #18492', ['ERP', 'FinanceApprovals'], 0),
    ).toBe('The state of Budget code for Order #18492 is reported by 2 source systems.');
  });

  it('UNCORROBORATED not applied pluralises events', () => {
    expect(corroborationReason(false, 'HIGH', 'Root', ['ERP'], 3)).toBe(
      'The state of Root is corroborated by 3 operational events.',
    );
  });
});

describe('headline variants', () => {
  it('says "Possible root cause — insufficient evidence" for LOW', () => {
    expect(headline({ ...budgetCodeMissing, confidence: 'LOW' }, 1, 6)).toBe(
      'Possible root cause — insufficient evidence: Budget Code Missing. Confidence: LOW.',
    );
  });

  it('says "Possible root cause" when there is more than one candidate', () => {
    expect(headline({ ...budgetCodeMissing, confidence: 'MEDIUM' }, 2, 6)).toBe(
      'Possible root cause: Budget Code Missing. Confidence: MEDIUM.',
    );
  });

  it('appends (state unknown)', () => {
    expect(headline({ ...budgetCodeMissing, possible: true, confidence: 'MEDIUM' }, 1, 6)).toBe(
      'Root cause: Budget Code Missing (state unknown). Confidence: MEDIUM.',
    );
  });

  it('appends (circular dependency)', () => {
    expect(headline({ ...budgetCodeMissing, inCycle: true, confidence: 'MEDIUM' }, 1, 6)).toBe(
      'Root cause: Budget Code Missing (circular dependency). Confidence: MEDIUM.',
    );
  });

  it('appends (deepest cause found within 6 steps)', () => {
    expect(
      headline({ ...budgetCodeMissing, continuesBeyondDepth: true, confidence: 'MEDIUM' }, 1, 6),
    ).toBe('Root cause: Budget Code Missing (deepest cause found within 6 steps). Confidence: MEDIUM.');
  });

  it('appends all three suffixes in order', () => {
    expect(
      headline(
        {
          label: 'Budget Code Missing',
          confidence: 'LOW',
          possible: true,
          inCycle: true,
          continuesBeyondDepth: true,
        },
        1,
        6,
      ),
    ).toBe(
      'Possible root cause — insufficient evidence: Budget Code Missing (state unknown) (circular dependency) (deepest cause found within 6 steps). Confidence: LOW.',
    );
  });
});

describe('summary variants', () => {
  it('says "1 possible root cause found, with insufficient evidence" for one LOW candidate', () => {
    expect(
      summarizeRootCause(order, 'ROOT_CAUSES_FOUND', [{ label: 'Budget Code Missing', confidence: 'LOW' }], 6),
    ).toBe(
      'Order #18492 is BLOCKED. 1 possible root cause found, with insufficient evidence: Budget Code Missing (LOW).',
    );
  });

  it('names the highest-ranked candidate when there are k = 2', () => {
    expect(
      summarizeRootCause(
        order,
        'ROOT_CAUSES_FOUND',
        [
          { label: 'Budget Code Missing', confidence: 'HIGH' },
          { label: 'Contract CON-9 Suspended', confidence: 'MEDIUM' },
        ],
        6,
      ),
    ).toBe(
      'Order #18492 is BLOCKED. 2 possible root causes found; highest ranked: Budget Code Missing (HIGH).',
    );
  });

  it('refuses ROOT_CAUSES_FOUND without candidates', () => {
    expect(() => summarizeRootCause(order, 'ROOT_CAUSES_FOUND', [], 6)).toThrow(
      'without candidates',
    );
  });
});

describe('evidenceSentence', () => {
  it('uses the singular for one event and zero for none', () => {
    expect(evidenceSentence([evidenceItem('Root', 'ERP', 'r1')], 1)).toBe(
      'Evidence: Root (ERP r1); 1 operational event.',
    );
    expect(evidenceSentence([evidenceItem('Root', 'ERP', 'r1')], 0)).toBe(
      'Evidence: Root (ERP r1); 0 operational events.',
    );
  });
});
