import {
  type CausalChainDto,
  type ConfidenceRule,
  type ConfidenceRuleOutcomeDto,
  type EntityEvidenceDto,
  type EntityRefDto,
  type EventEvidenceDto,
  type HopDto,
  type KeyEvidenceItemDto,
  type OperationalState,
  type RelationshipEvidenceDto,
  type RelationshipOrigin,
  type RequirementSourceDto,
  type RootCauseCandidateDto,
  type RootCauseResponse,
  type SourceRecordDto,
  type StateObservationDto,
  type StateRecordEvidenceDto,
  type TracedEntityDto,
} from '@opsgraph/shared';
import {
  APR_ID,
  BR_ID,
  F4_BLOCKERS,
  MANUAL_BASIS,
  ORDER_ID,
  PAY_ID,
  SHP_ID,
  hop,
  tracedEntity,
} from './tracing-test-data';

/**
 * Hand-built fixtures shaped like contracts/api.md (root-cause) R1, R2, R4 and R5.
 * Values the contract does not give (ids, timestamps, raw payloads) are invented but consistent.
 */

const IMPORT_ID = '99999999-9999-4999-8999-999999999999';
const CONTRACT_ID = '50000000-0000-4000-8000-000000000001';
const ORDER_18532_ID = '50000000-0000-4000-8000-000000000002';
const CONTRACT_4330_ID = '50000000-0000-4000-8000-000000000003';
const GOVERNS_ORDER_ID = '40000000-0000-4000-8000-000000000001';
const DEFINES_BUDGET_ID = '40000000-0000-4000-8000-000000000002';
const GOVERNS_18532_ID = '40000000-0000-4000-8000-000000000003';

const EVALUATED_AT = '2026-09-29T16:00:00.000Z';
const NO_TRUNCATION = { depthLimit: false, explorationLimit: false, pathLimit: false };
const CLAUSE = 'Orders above 10,000.00 USD require finance approval with a budget code';

function idOf(group: string, n: number): string {
  return `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function addMinute(iso: string): string {
  return new Date(Date.parse(iso) + 60000).toISOString();
}

function observationOf(
  id: string,
  state: OperationalState,
  sourceStatus: string | null,
  sourceSystem: string,
  sourceId: string,
  observedAt: string,
): StateObservationDto {
  return {
    id,
    state,
    sourceStatus,
    sourceSystem,
    sourceId,
    observedAt,
    receivedAt: addMinute(observedAt),
    importId: IMPORT_ID,
  };
}

function stateRecordOf(
  current: boolean,
  observation: StateObservationDto,
  recordId: string,
): StateRecordEvidenceDto {
  return {
    rule: 'STATE_RECORD',
    origin: 'SOURCE',
    current,
    observation,
    sourceRecord: {
      id: recordId,
      kind: 'ENTITY',
      sourceSystem: observation.sourceSystem,
      sourceId: observation.sourceId,
      observedAt: observation.observedAt,
      receivedAt: observation.receivedAt,
      importId: observation.importId,
      rawPayload: { state: observation.state, sourceStatus: observation.sourceStatus },
    },
  };
}

function refOf(entity: TracedEntityDto): EntityRefDto {
  return {
    id: entity.id,
    type: entity.type,
    displayName: entity.displayName,
    currentState: entity.currentState,
  };
}

function relationshipEvidenceOf(target: HopDto, recordId: string): RelationshipEvidenceDto {
  const [assertion] = target.assertions;
  if (assertion === undefined) {
    throw new Error('expected a hop assertion');
  }
  const record: SourceRecordDto = {
    id: recordId,
    kind: 'RELATIONSHIP',
    sourceSystem: assertion.sourceSystem,
    sourceId: assertion.sourceId,
    observedAt: assertion.observedAt,
    receivedAt: addMinute(assertion.observedAt),
    importId: assertion.importId,
    rawPayload: { relationshipType: target.relationshipType },
  };
  return {
    relationshipId: assertion.relationshipId,
    rule: 'RELATIONSHIP_RECORD',
    origin: assertion.origin,
    confidence: assertion.confidence,
    record,
    notes: { items: [], total: 0 },
  };
}

/** The manual BLOCKS assertion is recorded by ManualEntry rather than the OPSGRAPH default. */
function recordedManually(target: HopDto): HopDto {
  return {
    ...target,
    assertions: target.assertions.map((assertion) => ({
      ...assertion,
      sourceSystem: 'ManualEntry',
    })),
  };
}

// Observations (R1 and R6 timestamps).
const OMS_OBS = observationOf(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'BLOCKED',
  'ON_HOLD',
  'OMS',
  '18492',
  '2026-09-29T11:40:00.000Z',
);
const ERP_OBS = observationOf(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'PENDING',
  null,
  'ERP',
  'SO-18492',
  '2026-09-29T09:20:00.000Z',
);
const PAY_OBS = observationOf(
  idOf('20000000', 1),
  'PENDING',
  'AWAITING_APPROVAL',
  'Payments',
  'PAY-88213',
  '2026-09-29T10:05:00.000Z',
);
const APR_OBS = observationOf(
  idOf('20000000', 2),
  'BLOCKED',
  'AWAITING_BUDGET_CODE',
  'FinanceApprovals',
  'APR-2291',
  '2026-09-29T10:05:00.000Z',
);
const BR_OBS = observationOf(
  idOf('20000000', 3),
  'MISSING',
  'NOT_SUPPLIED',
  'FinanceApprovals',
  'BR-18492',
  '2026-09-29T10:05:00.000Z',
);
const CON_OBS = observationOf(
  idOf('20000000', 4),
  'ACTIVE',
  'IN_FORCE',
  'ContractMgmt',
  'CON-3982',
  '2026-09-01T08:00:00.000Z',
);
const SHP_OBS = observationOf(
  idOf('20000000', 5),
  'DELAYED',
  'DELAYED',
  'TMS',
  'SHP-77120',
  '2026-09-29T12:31:00.000Z',
);
const OMS_18532_OBS = observationOf(
  idOf('20000000', 6),
  'PENDING',
  'AWAITING_STOCK',
  'OMS',
  '18532',
  '2026-09-29T11:00:00.000Z',
);
const CON_4330_OBS = observationOf(
  idOf('20000000', 7),
  'ACTIVE',
  'IN_FORCE',
  'ContractMgmt',
  'CON-4330',
  '2026-09-01T08:00:00.000Z',
);

// Traced entities on the chains.
const ORDER_R1 = tracedEntity(ORDER_ID, 'Order', 'Order #18492', 'BLOCKED', {
  observation: OMS_OBS,
  latestBySource: [ERP_OBS, OMS_OBS],
});
const PAYMENT_R1 = tracedEntity(PAY_ID, 'Payment', 'Payment PAY-88213', 'PENDING', {
  observation: PAY_OBS,
});
const APPROVAL_R1 = tracedEntity(APR_ID, 'Approval', 'Finance approval APR-2291', 'BLOCKED', {
  observation: APR_OBS,
});
const BUDGET_R1 = tracedEntity(
  BR_ID,
  'BudgetRequirement',
  'Budget code for Order #18492',
  'MISSING',
  { observation: BR_OBS },
);
const SHIPMENT_R2 = tracedEntity(
  SHP_ID,
  'Shipment',
  'Shipment SHP-77120 (consolidated)',
  'DELAYED',
  {
    observation: SHP_OBS,
  },
);
const ORDER_18532 = tracedEntity(ORDER_18532_ID, 'Order', 'Order #18532', 'PENDING', {
  observation: OMS_18532_OBS,
});

const ORDER_REF = refOf(ORDER_R1);
const PAY_REF = refOf(PAYMENT_R1);
const APR_REF = refOf(APPROVAL_R1);
const BR_REF = refOf(BUDGET_R1);
const SHP_REF = refOf(SHIPMENT_R2);
const CONTRACT_REF: EntityRefDto = {
  id: CONTRACT_ID,
  type: 'Contract',
  displayName: 'Contract CON-3982',
  currentState: 'ACTIVE',
};
const CONTRACT_4330_REF: EntityRefDto = {
  id: CONTRACT_4330_ID,
  type: 'Contract',
  displayName: 'Contract CON-4330',
  currentState: 'ACTIVE',
};

// Hops. The REQUIRES hops are shared by R1 and R2, so their relationship ids match.
const HOP_SHIP_ORDER = hop('DEPENDS_ON', 'FORWARD', SHP_ID, ORDER_ID, ORDER_R1);
const HOP_ORDER_PAY = hop('REQUIRES', 'FORWARD', ORDER_ID, PAY_ID, PAYMENT_R1);
const HOP_PAY_APR = hop('REQUIRES', 'FORWARD', PAY_ID, APR_ID, APPROVAL_R1);
const HOP_APR_BR = hop('REQUIRES', 'FORWARD', APR_ID, BR_ID, BUDGET_R1);
const HOP_BLOCKS = recordedManually(
  hop('BLOCKS', 'REVERSE', PAY_ID, SHP_ID, PAYMENT_R1, {
    origin: 'MANUAL',
    confidence: 'MEDIUM',
    basis: MANUAL_BASIS,
  }),
);

// State records.
const OMS_RECORD = stateRecordOf(true, OMS_OBS, idOf('10000000', 1));
const ERP_RECORD = stateRecordOf(false, ERP_OBS, idOf('10000000', 2));
const PAY_RECORD = stateRecordOf(true, PAY_OBS, idOf('10000000', 3));
const APR_RECORD = stateRecordOf(true, APR_OBS, idOf('10000000', 4));
const BR_RECORD = stateRecordOf(true, BR_OBS, idOf('10000000', 5));
const CONTRACT_RECORD = stateRecordOf(true, CON_OBS, idOf('10000000', 6));
const SHP_RECORD = stateRecordOf(true, SHP_OBS, idOf('10000000', 7));
const OMS_18532_RECORD = stateRecordOf(true, OMS_18532_OBS, idOf('10000000', 8));
const CONTRACT_4330_RECORD = stateRecordOf(true, CON_4330_OBS, idOf('10000000', 9));

// Requirement sources (the contract defines or governs the order and the budget code).
const GOVERNS_ORDER: RequirementSourceDto = {
  rule: 'REQUIREMENT_SOURCE',
  origin: 'SOURCE',
  confidence: 'HIGH',
  relationship: {
    id: GOVERNS_ORDER_ID,
    type: 'GOVERNS',
    fromEntityId: CONTRACT_ID,
    toEntityId: ORDER_ID,
    basis: null,
    sourceSystem: 'ContractMgmt',
    sourceId: 'CON-3982',
    observedAt: '2026-09-01T08:00:00.000Z',
  },
  entity: CONTRACT_REF,
  attributes: { clause: CLAUSE },
  stateRecord: CONTRACT_RECORD,
};
const DEFINES_BUDGET: RequirementSourceDto = {
  rule: 'REQUIREMENT_SOURCE',
  origin: 'SOURCE',
  confidence: 'HIGH',
  relationship: {
    id: DEFINES_BUDGET_ID,
    type: 'DEFINES',
    fromEntityId: CONTRACT_ID,
    toEntityId: BR_ID,
    basis: null,
    sourceSystem: 'ContractMgmt',
    sourceId: 'CON-3982',
    observedAt: '2026-09-01T08:00:00.000Z',
  },
  entity: CONTRACT_REF,
  attributes: { clause: CLAUSE },
  stateRecord: CONTRACT_RECORD,
};
const GOVERNS_18532: RequirementSourceDto = {
  rule: 'REQUIREMENT_SOURCE',
  origin: 'SOURCE',
  confidence: 'HIGH',
  relationship: {
    id: GOVERNS_18532_ID,
    type: 'GOVERNS',
    fromEntityId: CONTRACT_4330_ID,
    toEntityId: ORDER_18532_ID,
    basis: null,
    sourceSystem: 'ContractMgmt',
    sourceId: 'CON-4330',
    observedAt: '2026-09-01T08:00:00.000Z',
  },
  entity: CONTRACT_4330_REF,
  attributes: {},
  stateRecord: CONTRACT_4330_RECORD,
};

// Events. Each event is shared by every entity it touches; the role is per entity.
interface EventParticipant {
  entity: EntityRefDto;
  role: 'SUBJECT' | 'RELATED';
}

interface EventFacts {
  id: string;
  eventType: string;
  occurredAt: string;
  observedAt: string;
  description: string;
  sourceSystem: string;
  sourceId: string;
  participants: EventParticipant[];
}

function eventOf(facts: EventFacts, role: 'SUBJECT' | 'RELATED'): EventEvidenceDto {
  return {
    rule: 'EVENT',
    origin: 'SOURCE',
    id: facts.id,
    eventType: facts.eventType,
    occurredAt: facts.occurredAt,
    observedAt: facts.observedAt,
    description: facts.description,
    role,
    entities: facts.participants,
    sourceSystem: facts.sourceSystem,
    sourceId: facts.sourceId,
    importId: IMPORT_ID,
  };
}

const EVT_OMS_1001: EventFacts = {
  id: idOf('30000000', 1),
  eventType: 'ORDER_HOLD_PLACED',
  occurredAt: '2026-09-28T08:15:00.000Z',
  observedAt: '2026-09-28T08:16:00.000Z',
  description: 'Order placed on credit hold',
  sourceSystem: 'OMS',
  sourceId: 'EVT-OMS-1001',
  participants: [{ entity: ORDER_REF, role: 'SUBJECT' }],
};
const EVT_PAY_2001: EventFacts = {
  id: idOf('30000000', 2),
  eventType: 'PAYMENT_PENDING',
  occurredAt: '2026-09-28T16:20:00.000Z',
  observedAt: '2026-09-28T16:21:00.000Z',
  description: 'Payment PAY-88213 awaiting approval',
  sourceSystem: 'Payments',
  sourceId: 'EVT-PAY-2001',
  participants: [
    { entity: PAY_REF, role: 'SUBJECT' },
    { entity: ORDER_REF, role: 'RELATED' },
  ],
};
const EVT_WMS_4001: EventFacts = {
  id: idOf('30000000', 3),
  eventType: 'PICK_WAVE_HELD',
  occurredAt: '2026-09-29T09:00:00.000Z',
  observedAt: '2026-09-29T09:02:00.000Z',
  description: 'Pick wave held pending budget code',
  sourceSystem: 'WMS',
  sourceId: 'EVT-WMS-4001',
  participants: [{ entity: ORDER_REF, role: 'SUBJECT' }],
};
const EVT_TMS_5001: EventFacts = {
  id: idOf('30000000', 4),
  eventType: 'ORDER_CONSOLIDATED',
  occurredAt: '2026-09-29T10:00:00.000Z',
  observedAt: '2026-09-29T10:02:00.000Z',
  description: 'Order #18492 consolidated into SHP-77120',
  sourceSystem: 'TMS',
  sourceId: 'EVT-TMS-5001',
  participants: [
    { entity: SHP_REF, role: 'SUBJECT' },
    { entity: ORDER_REF, role: 'RELATED' },
  ],
};
const EVT_TMS_5002: EventFacts = {
  id: idOf('30000000', 5),
  eventType: 'SHIPMENT_DELAYED',
  occurredAt: '2026-09-29T12:30:00.000Z',
  observedAt: '2026-09-29T12:31:00.000Z',
  description: 'Shipment SHP-77120 marked delayed',
  sourceSystem: 'TMS',
  sourceId: 'EVT-TMS-5002',
  participants: [{ entity: SHP_REF, role: 'SUBJECT' }],
};
const EVT_FA_3001: EventFacts = {
  id: idOf('30000000', 6),
  eventType: 'APPROVAL_REQUESTED',
  occurredAt: '2026-09-27T09:00:00.000Z',
  observedAt: '2026-09-27T09:05:00.000Z',
  description: 'Finance approval requested for Order #18492',
  sourceSystem: 'FinanceApprovals',
  sourceId: 'EVT-FA-3001',
  participants: [{ entity: APR_REF, role: 'SUBJECT' }],
};
const EVT_FA_3002: EventFacts = {
  id: idOf('30000000', 7),
  eventType: 'BUDGET_CODE_REQUESTED',
  occurredAt: '2026-09-28T12:00:00.000Z',
  observedAt: '2026-09-28T12:05:00.000Z',
  description: 'Budget code requested from account manager',
  sourceSystem: 'FinanceApprovals',
  sourceId: 'EVT-FA-3002',
  participants: [
    { entity: APR_REF, role: 'SUBJECT' },
    { entity: BR_REF, role: 'RELATED' },
  ],
};
const EVT_FA_3003: EventFacts = {
  id: idOf('30000000', 8),
  eventType: 'APPROVAL_BLOCKED',
  occurredAt: '2026-09-28T14:00:00.000Z',
  observedAt: '2026-09-28T14:02:00.000Z',
  description: 'Approval blocked: budget code missing',
  sourceSystem: 'FinanceApprovals',
  sourceId: 'EVT-FA-3003',
  participants: [{ entity: APR_REF, role: 'SUBJECT' }],
};

const NO_NOTES = { items: [], total: 0 };
const NO_REQUIREMENTS = { items: [], total: 0 };

// Entity evidence (R1). Entities are in first-appearance order.
const ORDER_EVIDENCE: EntityEvidenceDto = {
  entityId: ORDER_ID,
  stateRecords: [OMS_RECORD, ERP_RECORD],
  requirementSources: { items: [GOVERNS_ORDER], total: 1 },
  events: {
    items: [
      eventOf(EVT_TMS_5001, 'RELATED'),
      eventOf(EVT_WMS_4001, 'SUBJECT'),
      eventOf(EVT_PAY_2001, 'RELATED'),
      eventOf(EVT_OMS_1001, 'SUBJECT'),
    ],
    total: 4,
  },
  notes: NO_NOTES,
};
const PAY_EVIDENCE: EntityEvidenceDto = {
  entityId: PAY_ID,
  stateRecords: [PAY_RECORD],
  requirementSources: NO_REQUIREMENTS,
  events: { items: [eventOf(EVT_PAY_2001, 'SUBJECT')], total: 1 },
  notes: NO_NOTES,
};
const APR_EVIDENCE: EntityEvidenceDto = {
  entityId: APR_ID,
  stateRecords: [APR_RECORD],
  requirementSources: NO_REQUIREMENTS,
  events: {
    items: [
      eventOf(EVT_FA_3003, 'SUBJECT'),
      eventOf(EVT_FA_3002, 'SUBJECT'),
      eventOf(EVT_FA_3001, 'SUBJECT'),
    ],
    total: 3,
  },
  notes: NO_NOTES,
};
const BR_EVIDENCE: EntityEvidenceDto = {
  entityId: BR_ID,
  stateRecords: [BR_RECORD],
  requirementSources: { items: [DEFINES_BUDGET], total: 1 },
  events: { items: [eventOf(EVT_FA_3002, 'RELATED')], total: 1 },
  notes: NO_NOTES,
};

// Entity evidence (R2 adds the shipment; the other entities are the same as in R1).
const SHP_EVIDENCE: EntityEvidenceDto = {
  entityId: SHP_ID,
  stateRecords: [SHP_RECORD],
  requirementSources: NO_REQUIREMENTS,
  events: {
    items: [eventOf(EVT_TMS_5002, 'SUBJECT'), eventOf(EVT_TMS_5001, 'SUBJECT')],
    total: 2,
  },
  notes: NO_NOTES,
};

const ORDER_18532_EVIDENCE: EntityEvidenceDto = {
  entityId: ORDER_18532_ID,
  stateRecords: [OMS_18532_RECORD],
  requirementSources: { items: [GOVERNS_18532], total: 1 },
  events: { items: [], total: 0 },
  notes: NO_NOTES,
};

function keyItemOf(
  rule: KeyEvidenceItemDto['rule'],
  origin: RelationshipOrigin,
  entity: EntityRefDto,
  record: SourceRecordDto,
): KeyEvidenceItemDto {
  return {
    rule,
    origin,
    entity,
    sourceRecordId: record.id,
    sourceSystem: record.sourceSystem,
    sourceId: record.sourceId,
    observedAt: record.observedAt,
  };
}

const R1_KEY_EVIDENCE: KeyEvidenceItemDto[] = [
  keyItemOf('STATE_RECORD', 'SOURCE', ORDER_REF, OMS_RECORD.sourceRecord),
  keyItemOf('STATE_RECORD', 'SOURCE', ORDER_REF, ERP_RECORD.sourceRecord),
  keyItemOf('REQUIREMENT_SOURCE', GOVERNS_ORDER.origin, CONTRACT_REF, CONTRACT_RECORD.sourceRecord),
  keyItemOf('STATE_RECORD', 'SOURCE', PAY_REF, PAY_RECORD.sourceRecord),
  keyItemOf('STATE_RECORD', 'SOURCE', APR_REF, APR_RECORD.sourceRecord),
  keyItemOf('STATE_RECORD', 'SOURCE', BR_REF, BR_RECORD.sourceRecord),
];

const REL_ORDER_PAY = relationshipEvidenceOf(HOP_ORDER_PAY, idOf('11000000', 2));
const REL_PAY_APR = relationshipEvidenceOf(HOP_PAY_APR, idOf('11000000', 3));
const REL_APR_BR = relationshipEvidenceOf(HOP_APR_BR, idOf('11000000', 4));
const REL_SHIP_ORDER = relationshipEvidenceOf(HOP_SHIP_ORDER, idOf('11000000', 1));
const REL_BLOCKS = relationshipEvidenceOf(HOP_BLOCKS, idOf('11000000', 5));

// Confidence rules (R1; the 8 outcomes in evaluation order).
const NOT_APPLIED_REFS = { stepIndexes: [], relationshipIds: [], noteIds: [] };

function notApplied(rule: ConfidenceRule, reason: string): ConfidenceRuleOutcomeDto {
  return { rule, applied: false, confidenceAfter: 'HIGH', reason, refs: NOT_APPLIED_REFS };
}

const WEAKEST_LINK_R1 =
  'Confidence starts at HIGH, the confidence of the weakest link: Order #18492 REQUIRES Payment PAY-88213 (source-recorded, high confidence).';
const WEAKEST_LINK_R2 =
  'Confidence starts at HIGH, the confidence of the weakest link: Shipment SHP-77120 (consolidated) DEPENDS_ON Order #18492 (source-recorded, high confidence).';

const R1_RULES: ConfidenceRuleOutcomeDto[] = [
  {
    rule: 'WEAKEST_LINK',
    applied: true,
    confidenceAfter: 'HIGH',
    reason: WEAKEST_LINK_R1,
    refs: { stepIndexes: [1], relationshipIds: [REL_ORDER_PAY.relationshipId], noteIds: [] },
  },
  notApplied('UNKNOWN_STATE', 'No step has an unknown state.'),
  notApplied('CYCLE', 'The chain is not part of a dependency cycle.'),
  notApplied('SEARCH_LIMIT', 'The search was complete within 6 steps.'),
  notApplied(
    'STALE_EVIDENCE',
    "Every step's state was observed within 72 hours before 2026-09-29T16:00:00.000Z.",
  ),
  notApplied(
    'CLASSIFICATION_DISAGREEMENT',
    "Sources report different states for Order #18492 (ERP PENDING, OMS BLOCKED), but each step's states share one classification, so confidence is not lowered.",
  ),
  notApplied(
    'UNCORROBORATED',
    'The state of Budget code for Order #18492 is corroborated by 1 operational event.',
  ),
  notApplied('DISPUTED', 'No active note disputes this chain.'),
];

// Chain sentences (003 templates; the R1 chain is the path of F2 and F1).
const R1_SENTENCES = [
  'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
  'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
  'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
];
const R2_PRIMARY_SENTENCES = [
  'Shipment SHP-77120 (consolidated) is delayed because it depends on Order #18492, which is BLOCKED.',
  'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
  'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
  'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
];
const R2_ALTERNATIVE_SENTENCES = [
  `Shipment SHP-77120 (consolidated) is delayed because Payment PAY-88213, which is PENDING, blocks it (manually recorded, medium confidence: "${MANUAL_BASIS}").`,
  'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
  'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
];

const R1_CHAIN: CausalChainDto = {
  steps: [
    { index: 0, roles: ['SYMPTOM'], possible: false, entity: ORDER_R1, hop: null },
    {
      index: 1,
      roles: ['IMMEDIATE_BLOCKER'],
      possible: false,
      entity: PAYMENT_R1,
      hop: HOP_ORDER_PAY,
    },
    { index: 2, roles: ['UPSTREAM_CAUSE'], possible: false, entity: APPROVAL_R1, hop: HOP_PAY_APR },
    { index: 3, roles: ['ROOT_CAUSE'], possible: false, entity: BUDGET_R1, hop: HOP_APR_BR },
  ],
  length: 3,
  weakestConfidence: 'HIGH',
  nonSourceHops: 0,
  continuesBeyondDepth: false,
  endsInCycle: false,
  sentences: R1_SENTENCES,
};

const R1_CANDIDATE: RootCauseCandidateDto = {
  rootCause: BUDGET_R1,
  label: 'Budget Code Missing',
  labelRule: 'REQUIRED_FIELD',
  possible: false,
  inCycle: false,
  continuesBeyondDepth: false,
  insufficientEvidence: false,
  confidence: 'HIGH',
  confidenceRules: R1_RULES,
  primaryChain: R1_CHAIN,
  alternativeChains: [],
  keyEvidence: R1_KEY_EVIDENCE,
  eventCount: 7,
  explanation: {
    headline: 'Root cause: Budget Code Missing. Confidence: HIGH.',
    chain: R1_SENTENCES,
    confidence: [WEAKEST_LINK_R1],
    evidence:
      'Evidence: Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 7 operational events.',
  },
};

export const R1_ORDER: RootCauseResponse = {
  query: { entityId: ORDER_ID, depth: 6, evaluatedAt: EVALUATED_AT },
  computedAt: EVALUATED_AT,
  status: 'ROOT_CAUSES_FOUND',
  start: ORDER_R1,
  summary: 'Order #18492 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH).',
  truncation: NO_TRUNCATION,
  candidates: [R1_CANDIDATE],
  evidence: {
    entities: [ORDER_EVIDENCE, PAY_EVIDENCE, APR_EVIDENCE, BR_EVIDENCE],
    relationships: [REL_ORDER_PAY, REL_PAY_APR, REL_APR_BR],
  },
};

// R2: the shipment's primary chain, with one alternative through the manual BLOCKS hop.
const R2_CHAIN: CausalChainDto = {
  steps: [
    { index: 0, roles: ['SYMPTOM'], possible: false, entity: SHIPMENT_R2, hop: null },
    {
      index: 1,
      roles: ['IMMEDIATE_BLOCKER'],
      possible: false,
      entity: ORDER_R1,
      hop: HOP_SHIP_ORDER,
    },
    {
      index: 2,
      roles: ['UPSTREAM_CAUSE'],
      possible: false,
      entity: PAYMENT_R1,
      hop: HOP_ORDER_PAY,
    },
    { index: 3, roles: ['UPSTREAM_CAUSE'], possible: false, entity: APPROVAL_R1, hop: HOP_PAY_APR },
    { index: 4, roles: ['ROOT_CAUSE'], possible: false, entity: BUDGET_R1, hop: HOP_APR_BR },
  ],
  length: 4,
  weakestConfidence: 'HIGH',
  nonSourceHops: 0,
  continuesBeyondDepth: false,
  endsInCycle: false,
  sentences: R2_PRIMARY_SENTENCES,
};

const R2_ALTERNATIVE: CausalChainDto = {
  steps: [
    { index: 0, roles: ['SYMPTOM'], possible: false, entity: SHIPMENT_R2, hop: null },
    {
      index: 1,
      roles: ['IMMEDIATE_BLOCKER'],
      possible: false,
      entity: PAYMENT_R1,
      hop: HOP_BLOCKS,
    },
    { index: 2, roles: ['UPSTREAM_CAUSE'], possible: false, entity: APPROVAL_R1, hop: HOP_PAY_APR },
    { index: 3, roles: ['ROOT_CAUSE'], possible: false, entity: BUDGET_R1, hop: HOP_APR_BR },
  ],
  length: 3,
  weakestConfidence: 'MEDIUM',
  nonSourceHops: 1,
  continuesBeyondDepth: false,
  endsInCycle: false,
  sentences: R2_ALTERNATIVE_SENTENCES,
};

const R2_CANDIDATE: RootCauseCandidateDto = {
  rootCause: BUDGET_R1,
  label: 'Budget Code Missing',
  labelRule: 'REQUIRED_FIELD',
  possible: false,
  inCycle: false,
  continuesBeyondDepth: false,
  insufficientEvidence: false,
  confidence: 'HIGH',
  confidenceRules: [
    {
      rule: 'WEAKEST_LINK',
      applied: true,
      confidenceAfter: 'HIGH',
      reason: WEAKEST_LINK_R2,
      refs: { stepIndexes: [1], relationshipIds: [REL_SHIP_ORDER.relationshipId], noteIds: [] },
    },
    ...R1_RULES.slice(1),
  ],
  primaryChain: R2_CHAIN,
  alternativeChains: [R2_ALTERNATIVE],
  keyEvidence: [
    keyItemOf('STATE_RECORD', 'SOURCE', SHP_REF, SHP_RECORD.sourceRecord),
    ...R1_KEY_EVIDENCE,
  ],
  eventCount: 8,
  explanation: {
    headline: 'Root cause: Budget Code Missing. Confidence: HIGH.',
    chain: R2_PRIMARY_SENTENCES,
    confidence: [WEAKEST_LINK_R2],
    evidence:
      'Evidence: Shipment SHP-77120 (consolidated) (TMS SHP-77120), Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 8 operational events.',
  },
};

export const R2_SHIPMENT: RootCauseResponse = {
  query: { entityId: SHP_ID, depth: 6, evaluatedAt: EVALUATED_AT },
  computedAt: EVALUATED_AT,
  status: 'ROOT_CAUSES_FOUND',
  start: SHIPMENT_R2,
  summary:
    'Shipment SHP-77120 (consolidated) is DELAYED. 1 root cause found: Budget Code Missing (HIGH).',
  truncation: NO_TRUNCATION,
  candidates: [R2_CANDIDATE],
  evidence: {
    entities: [SHP_EVIDENCE, ORDER_EVIDENCE, PAY_EVIDENCE, APR_EVIDENCE, BR_EVIDENCE],
    relationships: [REL_SHIP_ORDER, REL_ORDER_PAY, REL_PAY_APR, REL_APR_BR, REL_BLOCKS],
  },
};

// R4: the warehouse is satisfied, so nothing is blocking it.
export const R4_NOT_BLOCKED: RootCauseResponse = {
  query: { entityId: F4_BLOCKERS.start.id, depth: 6, evaluatedAt: EVALUATED_AT },
  computedAt: EVALUATED_AT,
  status: 'NOT_BLOCKED',
  start: F4_BLOCKERS.start,
  summary:
    'East Distribution Center 02 is ACTIVE. It is not blocked: no unsatisfied dependency was found within 6 steps, so no root cause applies.',
  truncation: NO_TRUNCATION,
  candidates: [],
  evidence: { entities: [], relationships: [] },
};

// R5: the order is pending but no recorded dependency explains it.
export const R5_UNEXPLAINED: RootCauseResponse = {
  query: { entityId: ORDER_18532_ID, depth: 6, evaluatedAt: EVALUATED_AT },
  computedAt: EVALUATED_AT,
  status: 'UNEXPLAINED',
  start: ORDER_18532,
  summary:
    'Order #18532 is PENDING, but no recorded dependency within 6 steps explains this state. No root cause can be named.',
  truncation: NO_TRUNCATION,
  candidates: [],
  evidence: { entities: [ORDER_18532_EVIDENCE], relationships: [] },
};
