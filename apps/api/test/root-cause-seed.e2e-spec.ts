import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  BlockersResponseSchema,
  ErrorResponseSchema,
  EvidenceNoteDtoSchema,
  RootCauseResponseSchema,
  type BlockersResponse,
  type CausalChainDto,
  type EntityType,
  type RootCauseCandidateDto,
  type RootCauseResponse,
} from '@opsgraph/shared';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, entityIdByKey, login, resetDb, TEST_PASSWORD } from './helpers';

// Acceptance fixtures R1–R6, R8 and R9 (contracts/api.md), asserted literally against the seeded §39
// scenario, plus SC-002 (every delivery SLA names Budget Code Missing) and SC-004 determinism.
const EVALUATED_AT = '2026-09-29T16:00:00Z';
const EVALUATED_AT_ECHO = '2026-09-29T16:00:00.000Z';
const STALE_EVALUATED_AT = '2026-10-06T12:00:00Z';
const STALE_EVALUATED_AT_ECHO = '2026-10-06T12:00:00.000Z';
const CLAUSE = 'Orders above 10,000.00 USD require finance approval with a budget code';

describe('Root-cause analysis on the seeded §39 scenario (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;

  const ids = {} as Record<
    | 'shp'
    | 'order'
    | 'pay'
    | 'apr'
    | 'br'
    | 'sla'
    | 'sla4107'
    | 'sla4215'
    | 'sla4330'
    | 'wh'
    | 'contract'
    | 'order18532'
    | 'contract4330',
    string
  >;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const analyst = await createUser(prisma, { role: 'ANALYST' });
    token = (await login(app, analyst.email, TEST_PASSWORD)).accessToken;

    const report = await app.get(SeedService).seedScenario39();
    expect(report?.outcome).toBe('APPLIED');

    const key = (type: EntityType, system: string, sourceId: string) =>
      entityIdByKey(prisma, type, system, sourceId);
    ids.shp = await key('Shipment', 'TMS', 'SHP-77120');
    ids.order = await key('Order', 'OMS', '18492');
    ids.pay = await key('Payment', 'Payments', 'PAY-88213');
    ids.apr = await key('Approval', 'FinanceApprovals', 'APR-2291');
    ids.br = await key('BudgetRequirement', 'FinanceApprovals', 'BR-18492');
    ids.sla = await key('SLA', 'ContractMgmt', 'SLA-3982-DEL');
    ids.sla4107 = await key('SLA', 'ContractMgmt', 'SLA-4107-DEL');
    ids.sla4215 = await key('SLA', 'ContractMgmt', 'SLA-4215-DEL');
    ids.sla4330 = await key('SLA', 'ContractMgmt', 'SLA-4330-DEL');
    ids.wh = await key('Warehouse', 'WMS', 'WH-EAST-02');
    ids.contract = await key('Contract', 'ContractMgmt', 'CON-3982');
    ids.order18532 = await key('Order', 'OMS', '18532');
    ids.contract4330 = await key('Contract', 'ContractMgmt', 'CON-4330');
  });

  afterAll(async () => {
    await app.close();
  });

  async function analyze(id: string, query = `?evaluatedAt=${EVALUATED_AT}`): Promise<RootCauseResponse> {
    const response = await request(server)
      .get(`/api/entities/${id}/root-cause${query}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return RootCauseResponseSchema.parse(response.body);
  }

  async function blockersOf(id: string): Promise<BlockersResponse> {
    const response = await request(server)
      .get(`/api/entities/${id}/blockers`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return BlockersResponseSchema.parse(response.body);
  }

  function only(body: RootCauseResponse): RootCauseCandidateDto {
    expect(body.candidates).toHaveLength(1);
    const [candidate] = body.candidates;
    if (candidate === undefined) {
      throw new Error('expected one candidate');
    }
    return candidate;
  }

  function stepsOf(chain: CausalChainDto) {
    return chain.steps.map((step) => ({
      index: step.index,
      id: step.entity.id,
      roles: step.roles,
    }));
  }

  function evidenceOf(body: RootCauseResponse, entityId: string) {
    const found = body.evidence.entities.find((entry) => entry.entityId === entityId);
    if (found === undefined) {
      throw new Error(`no evidence for ${entityId}`);
    }
    return found;
  }

  function rulesOf(candidate: RootCauseCandidateDto) {
    return candidate.confidenceRules;
  }

  /** contracts/api.md: unless stated otherwise the echoed evaluatedAt is pinned and truncation is false. */
  function expectDefaults(body: RootCauseResponse, entityId: string): void {
    expect(body.query).toEqual({ entityId, depth: 6, evaluatedAt: EVALUATED_AT_ECHO });
    expect(body.truncation).toEqual({ depthLimit: false, explorationLimit: false, pathLimit: false });
  }

  const RULE_ORDER = [
    'WEAKEST_LINK',
    'UNKNOWN_STATE',
    'CYCLE',
    'SEARCH_LIMIT',
    'STALE_EVIDENCE',
    'CLASSIFICATION_DISAGREEMENT',
    'UNCORROBORATED',
    'DISPUTED',
  ];

  const R1_DISAGREEMENT =
    "Sources report different states for Order #18492 (ERP PENDING, OMS BLOCKED), but each step's states share one classification, so confidence is not lowered.";

  describe('R1: Order #18492', () => {
    let body: RootCauseResponse;
    let candidate: RootCauseCandidateDto;

    beforeAll(async () => {
      body = await analyze(ids.order);
      candidate = only(body);
    });

    it('finds exactly one root cause with the exact summary and the echoed query', () => {
      expect(body.status).toBe('ROOT_CAUSES_FOUND');
      expect(body.query).toEqual({ entityId: ids.order, depth: 6, evaluatedAt: EVALUATED_AT_ECHO });
      expect(body.truncation).toEqual({ depthLimit: false, explorationLimit: false, pathLimit: false });
      expect(body.summary).toBe(
        'Order #18492 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH).',
      );
    });

    it('names BR-18492 with the REQUIRED_FIELD label and HIGH confidence', () => {
      expect(candidate.rootCause.id).toBe(ids.br);
      expect(candidate.label).toBe('Budget Code Missing');
      expect(candidate.labelRule).toBe('REQUIRED_FIELD');
      expect(candidate.confidence).toBe('HIGH');
      expect(candidate.insufficientEvidence).toBe(false);
      expect(candidate.possible).toBe(false);
      expect(candidate.inCycle).toBe(false);
      expect(candidate.continuesBeyondDepth).toBe(false);
      expect(candidate.alternativeChains).toEqual([]);
    });

    it('classifies the four steps and records each hop', () => {
      expect(stepsOf(candidate.primaryChain)).toEqual([
        { index: 0, id: ids.order, roles: ['SYMPTOM'] },
        { index: 1, id: ids.pay, roles: ['IMMEDIATE_BLOCKER'] },
        { index: 2, id: ids.apr, roles: ['UPSTREAM_CAUSE'] },
        { index: 3, id: ids.br, roles: ['ROOT_CAUSE'] },
      ]);
      const [first, ...rest] = candidate.primaryChain.steps;
      expect(first?.hop).toBeNull();
      expect(rest).toHaveLength(3);
      for (const step of rest) {
        expect(step.hop).toMatchObject({
          relationshipType: 'REQUIRES',
          traversal: 'FORWARD',
          effectiveOrigin: 'SOURCE',
          effectiveConfidence: 'HIGH',
        });
      }
      expect(candidate.primaryChain.length).toBe(3);
      expect(candidate.primaryChain.weakestConfidence).toBe('HIGH');
    });

    it('lists the 8 confidence rules in order, only WEAKEST_LINK applied, HIGH throughout', () => {
      const rules = rulesOf(candidate);
      expect(rules.map((rule) => rule.rule)).toEqual(RULE_ORDER);
      expect(rules.filter((rule) => rule.applied).map((rule) => rule.rule)).toEqual(['WEAKEST_LINK']);
      expect(rules.every((rule) => rule.confidenceAfter === 'HIGH')).toBe(true);
      expect(rules[0]?.refs.stepIndexes).toEqual([1]);
      expect(rules.map((rule) => rule.reason)).toEqual([
        'Confidence starts at HIGH, the confidence of the weakest link: Order #18492 REQUIRES Payment PAY-88213 (source-recorded, high confidence).',
        'No step has an unknown state.',
        'The chain is not part of a dependency cycle.',
        'The search was complete within 6 steps.',
        "Every step's state was observed within 72 hours before 2026-09-29T16:00:00.000Z.",
        R1_DISAGREEMENT,
        'The state of Budget code for Order #18492 is corroborated by 1 operational event.',
        'No active note disputes this chain.',
      ]);
    });

    it('writes the explanation: headline, the 003 F2 sentences, confidence, evidence', () => {
      expect(candidate.explanation.headline).toBe('Root cause: Budget Code Missing. Confidence: HIGH.');
      expect(candidate.explanation.chain).toEqual([
        'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
        'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
        'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
      ]);
      expect(candidate.primaryChain.sentences).toEqual(candidate.explanation.chain);
      expect(candidate.explanation.confidence).toEqual([
        'Confidence starts at HIGH, the confidence of the weakest link: Order #18492 REQUIRES Payment PAY-88213 (source-recorded, high confidence).',
      ]);
      expect(candidate.explanation.evidence).toBe(
        'Evidence: Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 7 operational events.',
      );
    });

    it('returns the 6 key evidence items in order and eventCount 7', () => {
      expect(
        candidate.keyEvidence.map((item) => `${item.rule} ${item.sourceSystem} ${item.sourceId}`),
      ).toEqual([
        'STATE_RECORD OMS 18492',
        'STATE_RECORD ERP SO-18492',
        'REQUIREMENT_SOURCE ContractMgmt CON-3982',
        'STATE_RECORD Payments PAY-88213',
        'STATE_RECORD FinanceApprovals APR-2291',
        'STATE_RECORD FinanceApprovals BR-18492',
      ]);
      expect(candidate.eventCount).toBe(7);
    });

    it('returns evidence for the four entities in chain order', () => {
      expect(body.evidence.entities.map((entry) => entry.entityId)).toEqual([
        ids.order,
        ids.pay,
        ids.apr,
        ids.br,
      ]);
    });

    it('Order #18492 evidence: two state records, the GOVERNS contract, four events', () => {
      const order = evidenceOf(body, ids.order);
      expect(
        order.stateRecords.map((record) => ({
          system: record.sourceRecord.sourceSystem,
          sourceId: record.sourceRecord.sourceId,
          state: record.observation.state,
          current: record.current,
        })),
      ).toEqual([
        { system: 'OMS', sourceId: '18492', state: 'BLOCKED', current: true },
        { system: 'ERP', sourceId: 'SO-18492', state: 'PENDING', current: false },
      ]);
      expect(order.stateRecords[0]?.observation.observedAt).toBe('2026-09-29T11:40:00.000Z');

      expect(order.requirementSources.total).toBe(1);
      const [requirement] = order.requirementSources.items;
      expect(requirement?.entity.id).toBe(ids.contract);
      expect(requirement?.relationship.type).toBe('GOVERNS');
      expect(requirement?.attributes['clause']).toBe(CLAUSE);

      expect(order.events.total).toBe(4);
      expect(order.events.items.map((event) => event.sourceId)).toEqual([
        'EVT-TMS-5001',
        'EVT-WMS-4001',
        'EVT-PAY-2001',
        'EVT-OMS-1001',
      ]);
    });

    it('BR-18492 evidence: the DEFINES contract and one RELATED event', () => {
      const budget = evidenceOf(body, ids.br);
      expect(budget.requirementSources.items).toHaveLength(1);
      expect(budget.requirementSources.items[0]?.entity.id).toBe(ids.contract);
      expect(budget.requirementSources.items[0]?.relationship.type).toBe('DEFINES');
      expect(budget.events.total).toBe(1);
      expect(budget.events.items.map((event) => [event.sourceId, event.role])).toEqual([
        ['EVT-FA-3002', 'RELATED'],
      ]);
    });

    it('APR-2291 has 3 events and no entity has notes', () => {
      expect(evidenceOf(body, ids.apr).events.total).toBe(3);
      for (const entry of body.evidence.entities) {
        expect(entry.notes.total).toBe(0);
        expect(entry.notes.items).toEqual([]);
      }
    });

    it('returns the 3 REQUIRES assertions as relationship records', () => {
      const hopIds = candidate.primaryChain.steps.flatMap((step) =>
        (step.hop?.assertions ?? []).map((assertion) => assertion.relationshipId),
      );
      expect(body.evidence.relationships.map((entry) => entry.relationshipId)).toEqual(hopIds);
      expect(body.evidence.relationships).toHaveLength(3);
      for (const entry of body.evidence.relationships) {
        expect(entry.rule).toBe('RELATIONSHIP_RECORD');
        expect(entry.origin).toBe('SOURCE');
        expect(entry.record).not.toBeNull();
      }
    });
  });

  describe('R2: Shipment SHP-77120 (consolidated)', () => {
    let body: RootCauseResponse;
    let candidate: RootCauseCandidateDto;
    let blockers: BlockersResponse;

    beforeAll(async () => {
      body = await analyze(ids.shp);
      candidate = only(body);
      blockers = await blockersOf(ids.shp);
    });

    it('names the same root cause with HIGH confidence', () => {
      expectDefaults(body, ids.shp);
      expect(body.summary).toBe(
        'Shipment SHP-77120 (consolidated) is DELAYED. 1 root cause found: Budget Code Missing (HIGH).',
      );
      expect(candidate.rootCause.id).toBe(ids.br);
      expect(candidate.confidence).toBe('HIGH');
    });

    it('classifies the primary chain and reuses the 003 F1 paths[0] sentences', () => {
      expect(stepsOf(candidate.primaryChain)).toEqual([
        { index: 0, id: ids.shp, roles: ['SYMPTOM'] },
        { index: 1, id: ids.order, roles: ['IMMEDIATE_BLOCKER'] },
        { index: 2, id: ids.pay, roles: ['UPSTREAM_CAUSE'] },
        { index: 3, id: ids.apr, roles: ['UPSTREAM_CAUSE'] },
        { index: 4, id: ids.br, roles: ['ROOT_CAUSE'] },
      ]);
      const f1Primary = [
        'Shipment SHP-77120 (consolidated) is delayed because it depends on Order #18492, which is BLOCKED.',
        'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
        'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
        'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
      ];
      expect(candidate.primaryChain.sentences).toEqual(f1Primary);
      expect(blockers.paths[0]?.explanation).toEqual(f1Primary);
    });

    it('has exactly one alternative chain through the manual BLOCKS link', () => {
      expect(candidate.alternativeChains).toHaveLength(1);
      const [alternative] = candidate.alternativeChains;
      if (alternative === undefined) {
        throw new Error('expected an alternative chain');
      }
      expect(stepsOf(alternative)).toEqual([
        { index: 0, id: ids.shp, roles: ['SYMPTOM'] },
        { index: 1, id: ids.pay, roles: ['IMMEDIATE_BLOCKER'] },
        { index: 2, id: ids.apr, roles: ['UPSTREAM_CAUSE'] },
        { index: 3, id: ids.br, roles: ['ROOT_CAUSE'] },
      ]);
      expect(alternative.steps[1]?.hop).toMatchObject({
        relationshipType: 'BLOCKS',
        traversal: 'REVERSE',
        effectiveOrigin: 'MANUAL',
        effectiveConfidence: 'MEDIUM',
      });
      expect(alternative.weakestConfidence).toBe('MEDIUM');
      const f1Alternative = [
        'Shipment SHP-77120 (consolidated) is delayed because Payment PAY-88213, which is PENDING, blocks it (manually recorded, medium confidence: "Recorded by ops analyst: carrier will not book the consolidated load until payment clears").',
        'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
        'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
      ];
      expect(alternative.sentences).toEqual(f1Alternative);
      expect(blockers.paths[1]?.explanation).toEqual(f1Alternative);
    });

    it('writes the weakest-link reason, the same disagreement as R1 and the evidence sentence', () => {
      expect(rulesOf(candidate)[0]?.reason).toBe(
        'Confidence starts at HIGH, the confidence of the weakest link: Shipment SHP-77120 (consolidated) DEPENDS_ON Order #18492 (source-recorded, high confidence).',
      );
      expect(rulesOf(candidate)[5]?.reason).toBe(R1_DISAGREEMENT);
      expect(candidate.explanation.evidence).toBe(
        'Evidence: Shipment SHP-77120 (consolidated) (TMS SHP-77120), Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 8 operational events.',
      );
    });

    it('includes the manual BLOCKS assertion as relationship evidence', () => {
      const manual = body.evidence.relationships.filter((entry) => entry.origin === 'MANUAL');
      expect(manual).toHaveLength(1);
      expect(manual[0]).toMatchObject({ confidence: 'MEDIUM', rule: 'RELATIONSHIP_RECORD' });
      expect(manual[0]?.record?.sourceSystem).toBe('ManualEntry');
    });
  });

  describe('R3: Acme Corp delivery SLA', () => {
    let body: RootCauseResponse;
    let candidate: RootCauseCandidateDto;
    let blockers: BlockersResponse;

    beforeAll(async () => {
      body = await analyze(ids.sla);
      candidate = only(body);
      blockers = await blockersOf(ids.sla);
    });

    it('is MEDIUM because the SLA link is inferred', () => {
      expectDefaults(body, ids.sla);
      expect(body.summary).toBe(
        'Acme Corp delivery SLA is AT_RISK. 1 root cause found: Budget Code Missing (MEDIUM).',
      );
      expect(candidate.rootCause.id).toBe(ids.br);
      expect(candidate.confidence).toBe('MEDIUM');
      expect(candidate.explanation.headline).toBe('Root cause: Budget Code Missing. Confidence: MEDIUM.');
    });

    it('classifies the six steps and states that the first link is inferred', () => {
      expect(stepsOf(candidate.primaryChain)).toEqual([
        { index: 0, id: ids.sla, roles: ['SYMPTOM'] },
        { index: 1, id: ids.shp, roles: ['IMMEDIATE_BLOCKER'] },
        { index: 2, id: ids.order, roles: ['UPSTREAM_CAUSE'] },
        { index: 3, id: ids.pay, roles: ['UPSTREAM_CAUSE'] },
        { index: 4, id: ids.apr, roles: ['UPSTREAM_CAUSE'] },
        { index: 5, id: ids.br, roles: ['ROOT_CAUSE'] },
      ]);
      expect(candidate.explanation.chain[0]).toBe(blockers.paths[0]?.explanation[0]);
      expect(candidate.explanation.chain[0]).toContain('inferred, medium confidence');
      expect(candidate.alternativeChains).toHaveLength(1);
      expect(candidate.alternativeChains[0]?.sentences).toEqual(blockers.paths[1]?.explanation);
    });

    it('applies only WEAKEST_LINK, at MEDIUM, naming step 1', () => {
      const [weakest, ...others] = rulesOf(candidate);
      expect(weakest).toMatchObject({
        rule: 'WEAKEST_LINK',
        applied: true,
        confidenceAfter: 'MEDIUM',
        refs: { stepIndexes: [1] },
        reason:
          'Confidence starts at MEDIUM, the confidence of the weakest link: Acme Corp delivery SLA DEPENDS_ON Shipment SHP-77120 (consolidated) (inferred, medium confidence).',
      });
      expect(others.every((rule) => !rule.applied && rule.confidenceAfter === 'MEDIUM')).toBe(true);
    });

    it('writes the evidence sentence', () => {
      expect(candidate.explanation.evidence).toBe(
        'Evidence: Acme Corp delivery SLA (ContractMgmt SLA-3982-DEL), Contract CON-3982 (ContractMgmt CON-3982), Shipment SHP-77120 (consolidated) (TMS SHP-77120), Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 8 operational events.',
      );
    });
  });

  describe('R4: Warehouse WH-EAST-02', () => {
    it('is NOT_BLOCKED with no candidates and no evidence', async () => {
      const body = await analyze(ids.wh);
      expectDefaults(body, ids.wh);
      expect(body.status).toBe('NOT_BLOCKED');
      expect(body.candidates).toEqual([]);
      expect(body.evidence).toEqual({ entities: [], relationships: [] });
      expect(body.summary).toBe(
        'East Distribution Center 02 is ACTIVE. It is not blocked: no unsatisfied dependency was found within 6 steps, so no root cause applies.',
      );
    });
  });

  describe('R5: Order #18532 (PENDING, no blocker relationships)', () => {
    it('is UNEXPLAINED, names no cause, and returns start-only evidence', async () => {
      const body = await analyze(ids.order18532);
      expectDefaults(body, ids.order18532);
      expect(body.status).toBe('UNEXPLAINED');
      expect(body.candidates).toEqual([]);
      expect(body.summary).toBe(
        'Order #18532 is PENDING, but no recorded dependency within 6 steps explains this state. No root cause can be named.',
      );

      expect(body.evidence.entities.map((entry) => entry.entityId)).toEqual([ids.order18532]);
      expect(body.evidence.relationships).toEqual([]);
      const order = evidenceOf(body, ids.order18532);
      expect(
        order.stateRecords.map((record) => ({
          system: record.sourceRecord.sourceSystem,
          sourceId: record.sourceRecord.sourceId,
          state: record.observation.state,
          current: record.current,
        })),
      ).toEqual([{ system: 'OMS', sourceId: '18532', state: 'PENDING', current: true }]);
      expect(order.requirementSources.total).toBe(1);
      expect(order.requirementSources.items).toHaveLength(1);
      expect(order.requirementSources.items[0]?.entity.id).toBe(ids.contract4330);
      expect(order.requirementSources.items[0]?.entity.displayName).toBe('Contract CON-4330');
      expect(order.requirementSources.items[0]?.relationship.type).toBe('GOVERNS');
      expect(order.events.total).toBe(0);
      expect(order.events.items).toEqual([]);
    });
  });

  describe('R6: Order #18492 evaluated at 2026-10-06T12:00:00Z (stale evidence)', () => {
    let fresh: RootCauseResponse;
    let body: RootCauseResponse;
    let candidate: RootCauseCandidateDto;

    beforeAll(async () => {
      fresh = await analyze(ids.order);
      body = await analyze(ids.order, `?evaluatedAt=${STALE_EVALUATED_AT}`);
      candidate = only(body);
    });

    it('lowers the candidate to MEDIUM and echoes the evaluation time', () => {
      expect(body.status).toBe('ROOT_CAUSES_FOUND');
      expect(body.query).toEqual({ entityId: ids.order, depth: 6, evaluatedAt: STALE_EVALUATED_AT_ECHO });
      expect(body.truncation).toEqual({ depthLimit: false, explorationLimit: false, pathLimit: false });
      expect(candidate.confidence).toBe('MEDIUM');
      expect(candidate.insufficientEvidence).toBe(false);
      expect(candidate.explanation.headline).toBe('Root cause: Budget Code Missing. Confidence: MEDIUM.');
      expect(body.summary).toBe(
        'Order #18492 is BLOCKED. 1 root cause found: Budget Code Missing (MEDIUM).',
      );
    });

    it('applies STALE_EVIDENCE with the exact reason and refs, and carries MEDIUM through rules 6–8', () => {
      const rules = rulesOf(candidate);
      expect(rules.map((rule) => rule.rule)).toEqual(RULE_ORDER);
      expect(rules.filter((rule) => rule.applied).map((rule) => rule.rule)).toEqual([
        'WEAKEST_LINK',
        'STALE_EVIDENCE',
      ]);
      const stale = rules[4];
      expect(stale).toMatchObject({
        rule: 'STALE_EVIDENCE',
        applied: true,
        confidenceAfter: 'MEDIUM',
        refs: { stepIndexes: [0, 1, 2, 3], relationshipIds: [], noteIds: [] },
        reason:
          'Confidence lowered to MEDIUM: the state of Order #18492 (2026-09-29T11:40:00.000Z), Payment PAY-88213 (2026-09-29T10:05:00.000Z), Finance approval APR-2291 (2026-09-29T10:05:00.000Z), Budget code for Order #18492 (2026-09-29T10:05:00.000Z) was last observed more than 72 hours before 2026-10-06T12:00:00.000Z.',
      });
      expect(rules.slice(0, 4).every((rule) => rule.confidenceAfter === 'HIGH')).toBe(true);
      expect(rules.slice(4).every((rule) => rule.confidenceAfter === 'MEDIUM')).toBe(true);
      expect(rules[5]?.reason).toBe(R1_DISAGREEMENT);
      expect(rules[6]?.reason).toBe(
        'The state of Budget code for Order #18492 is corroborated by 1 operational event.',
      );
      expect(rules[7]?.reason).toBe('No active note disputes this chain.');
    });

    it('lists the weakest-link and stale reasons in explanation.confidence', () => {
      expect(candidate.explanation.confidence).toEqual([
        'Confidence starts at HIGH, the confidence of the weakest link: Order #18492 REQUIRES Payment PAY-88213 (source-recorded, high confidence).',
        rulesOf(candidate)[4]?.reason,
      ]);
    });

    it('leaves the label, steps, key evidence and chain sentences unchanged from R1', () => {
      const unchanged = only(fresh);
      expect(candidate.label).toBe(unchanged.label);
      expect(candidate.labelRule).toBe(unchanged.labelRule);
      expect(candidate.rootCause.id).toBe(ids.br);
      expect(stepsOf(candidate.primaryChain)).toEqual(stepsOf(unchanged.primaryChain));
      expect(candidate.keyEvidence).toEqual(unchanged.keyEvidence);
      expect(candidate.eventCount).toBe(unchanged.eventCount);
      expect(candidate.explanation.chain).toEqual(unchanged.explanation.chain);
      expect(candidate.explanation.evidence).toBe(unchanged.explanation.evidence);
    });
  });

  describe('R9: Budget code for Order #18492 itself', () => {
    it('is UNEXPLAINED: a MISSING entity with no dependencies has no cause to name', async () => {
      const body = await analyze(ids.br);
      expectDefaults(body, ids.br);
      expect(body.status).toBe('UNEXPLAINED');
      expect(body.candidates).toEqual([]);
      expect(body.summary).toBe(
        'Budget code for Order #18492 is MISSING, but no recorded dependency within 6 steps explains this state. No root cause can be named.',
      );
      expect(body.evidence.entities.map((entry) => entry.entityId)).toEqual([ids.br]);
    });
  });

  describe('R8: role assignment on short chains', () => {
    it('Finance approval APR-2291: BR-18492 is both the immediate blocker and the root cause', async () => {
      const body = await analyze(ids.apr);
      expectDefaults(body, ids.apr);
      const candidate = only(body);
      expect(body.summary).toBe(
        'Finance approval APR-2291 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH).',
      );
      expect(stepsOf(candidate.primaryChain)).toEqual([
        { index: 0, id: ids.apr, roles: ['SYMPTOM'] },
        { index: 1, id: ids.br, roles: ['IMMEDIATE_BLOCKER', 'ROOT_CAUSE'] },
      ]);
    });

    it('Payment PAY-88213: no UPSTREAM_CAUSE step', async () => {
      const body = await analyze(ids.pay);
      expectDefaults(body, ids.pay);
      const candidate = only(body);
      expect(stepsOf(candidate.primaryChain)).toEqual([
        { index: 0, id: ids.pay, roles: ['SYMPTOM'] },
        { index: 1, id: ids.apr, roles: ['IMMEDIATE_BLOCKER'] },
        { index: 2, id: ids.br, roles: ['ROOT_CAUSE'] },
      ]);
      expect(candidate.confidence).toBe('HIGH');
    });
  });

  describe('SC-002: every acceptance entity names Budget Code Missing', () => {
    it.each([
      ['Order #18492', 'order'],
      ['Shipment SHP-77120', 'shp'],
      ['SLA-3982-DEL', 'sla'],
      ['SLA-4107-DEL', 'sla4107'],
      ['SLA-4215-DEL', 'sla4215'],
      ['SLA-4330-DEL (Umbrella, ACTIVE)', 'sla4330'],
    ] as const)('%s', async (_name, key) => {
      const body = await analyze(ids[key]);
      expect(body.status).toBe('ROOT_CAUSES_FOUND');
      expect(body.candidates.map((candidate) => candidate.label)).toEqual(['Budget Code Missing']);
    });
  });

  describe('SC-004: determinism', () => {
    it.each([
      ['Order #18492', 'order'],
      ['Shipment SHP-77120', 'shp'],
      ['Acme Corp delivery SLA', 'sla'],
    ] as const)(
      '100 sequential calls for %s are deep-equal apart from computedAt',
      async (_name, key) => {
        // computedAt is the only field allowed to differ between runs.
        const withoutComputedAt = (body: RootCauseResponse): RootCauseResponse => ({
          ...body,
          computedAt: '',
        });
        const first = withoutComputedAt(await analyze(ids[key]));
        for (let run = 1; run < 100; run += 1) {
          expect(withoutComputedAt(await analyze(ids[key]))).toEqual(first);
        }
      },
      120_000,
    );
  });

  // R7 mutates the database (notes are append-only), so it runs last and in order.
  describe('R7: evidence notes change the analysis (sequence, against R1)', () => {
    const SUPPORT_TEXT =
      'Finance confirmed the budget code was never submitted; requested from account manager on 2026-09-30';
    const SUPPORT_REFERENCE = 'Call with Finance, ticket FIN-4410';
    const DISPUTE_TEXT =
      'Approval record APR-2291 is out of date; Finance says the budget code was supplied on 2026-09-30.';
    const DISPUTE_EXCERPT =
      'Approval record APR-2291 is out of date; Finance says the budget code was suppli…';
    const RETRACT_REASON = 'Confirmed with Finance: the approval record is current.';

    let userB: Awaited<ReturnType<typeof createUser>>;
    const tokens = {} as Record<'a' | 'b', string>;
    let relationshipId: string;
    let supportNote: ReturnType<typeof EvidenceNoteDtoSchema.parse>;
    let disputeNote: ReturnType<typeof EvidenceNoteDtoSchema.parse>;

    const auditCount = (action: string) => prisma.auditEntry.count({ where: { action } });

    function post(who: 'a' | 'b', path: string, body: Record<string, unknown>) {
      return request(server).post(path).set('Authorization', `Bearer ${tokens[who]}`).send(body);
    }

    beforeAll(async () => {
      const userA = await createUser(prisma, { role: 'ANALYST' });
      userB = await createUser(prisma, { role: 'ANALYST' });
      tokens.a = (await login(app, userA.email, TEST_PASSWORD)).accessToken;
      tokens.b = (await login(app, userB.email, TEST_PASSWORD)).accessToken;
      const relationship = await prisma.relationship.findFirstOrThrow({
        where: { type: 'REQUIRES', fromEntityId: ids.apr, toEntityId: ids.br },
      });
      relationshipId = relationship.id;
    });

    it('1. a SUPPORTS note on BR-18492 keeps R1 at HIGH and appears in its evidence', async () => {
      const created = await auditCount('evidence_note.created');
      const response = await post('a', '/api/evidence-notes', {
        target: { kind: 'ENTITY', entityId: ids.br },
        stance: 'SUPPORTS',
        text: SUPPORT_TEXT,
        reference: SUPPORT_REFERENCE,
      });
      expect(response.status).toBe(201);
      supportNote = EvidenceNoteDtoSchema.parse(response.body);
      expect(supportNote.active).toBe(true);
      expect(supportNote.reference).toBe(SUPPORT_REFERENCE);
      expect(await auditCount('evidence_note.created')).toBe(created + 1);

      const body = await analyze(ids.order);
      const candidate = only(body);
      expect(candidate.confidence).toBe('HIGH');
      expect(rulesOf(candidate).filter((rule) => rule.applied).map((rule) => rule.rule)).toEqual([
        'WEAKEST_LINK',
      ]);
      expect(evidenceOf(body, ids.br).notes.items[0]).toMatchObject({
        id: supportNote.id,
        rule: 'MANUAL_NOTE',
        origin: 'MANUAL',
        stance: 'SUPPORTS',
        text: SUPPORT_TEXT,
        active: true,
      });
    });

    it('2. a DISPUTES note on the APR-2291 → BR-18492 link lowers R1 and R2 to MEDIUM', async () => {
      const response = await post('b', '/api/evidence-notes', {
        target: { kind: 'RELATIONSHIP', relationshipId },
        stance: 'DISPUTES',
        text: DISPUTE_TEXT,
      });
      expect(response.status).toBe(201);
      disputeNote = EvidenceNoteDtoSchema.parse(response.body);
      expect(DISPUTE_TEXT).toHaveLength(97);

      const candidate = only(await analyze(ids.order));
      expect(candidate.confidence).toBe('MEDIUM');
      const disputed = rulesOf(candidate)[7];
      expect(disputed).toMatchObject({
        rule: 'DISPUTED',
        applied: true,
        confidenceAfter: 'MEDIUM',
        refs: { stepIndexes: [3], relationshipIds: [relationshipId], noteIds: [disputeNote.id] },
      });
      // Q4: the contract fixture omits the final period but its template ends the reason with one;
      // implemented per the template.
      expect(disputed?.reason).toBe(
        `Confidence lowered to MEDIUM: 1 active disputing note: ${userB.displayName} on ${disputeNote.createdAt}: "${DISPUTE_EXCERPT}".`,
      );
      expect(candidate.explanation.confidence).toHaveLength(2);

      const shipment = only(await analyze(ids.shp));
      expect(shipment.confidence).toBe('MEDIUM');
      expect(rulesOf(shipment)[7]?.applied).toBe(true);
    });

    it('3. analyst A cannot retract analyst B’s note: 403 and one auth.forbidden row', async () => {
      const forbidden = await auditCount('auth.forbidden');
      const retracted = await auditCount('evidence_note.retracted');
      const response = await post('a', `/api/evidence-notes/${disputeNote.id}/retract`, {
        reason: 'Not mine to retract',
      });
      expect(response.status).toBe(403);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('FORBIDDEN');
      expect(await auditCount('auth.forbidden')).toBe(forbidden + 1);
      expect(await auditCount('evidence_note.retracted')).toBe(retracted);
      const stored = await prisma.evidenceNote.findUniqueOrThrow({
        where: { id: disputeNote.id },
        include: { retraction: true },
      });
      expect(stored.retraction).toBeNull();
    });

    it('4. B retracts: R1 returns to HIGH and the retracted note stays on the link, inactive', async () => {
      const retracted = await auditCount('evidence_note.retracted');
      const response = await post('b', `/api/evidence-notes/${disputeNote.id}/retract`, {
        reason: RETRACT_REASON,
      });
      expect(response.status).toBe(200);
      const body = EvidenceNoteDtoSchema.parse(response.body);
      expect(body.active).toBe(false);
      expect(body.retraction?.reason).toBe(RETRACT_REASON);
      expect(body.retraction?.retractedBy.id).toBe(userB.id);
      expect(await auditCount('evidence_note.retracted')).toBe(retracted + 1);

      const audit = await prisma.auditEntry.findFirstOrThrow({
        where: { action: 'evidence_note.retracted', targetId: disputeNote.id },
      });
      expect(audit.before).toMatchObject({ active: true });
      expect(audit.after).toMatchObject({ active: false });

      const analysis = await analyze(ids.order);
      const candidate = only(analysis);
      expect(candidate.confidence).toBe('HIGH');
      expect(rulesOf(candidate)[7]).toMatchObject({
        applied: false,
        reason: 'No active note disputes this chain.',
      });
      const relationshipEvidence = analysis.evidence.relationships.find(
        (entry) => entry.relationshipId === relationshipId,
      );
      expect(relationshipEvidence?.notes.items[0]).toMatchObject({
        id: disputeNote.id,
        active: false,
      });
    });

    it('5. a second retraction returns 200, unchanged, with no new audit row', async () => {
      const retracted = await auditCount('evidence_note.retracted');
      const response = await post('b', `/api/evidence-notes/${disputeNote.id}/retract`, {
        reason: 'A different reason',
      });
      expect(response.status).toBe(200);
      expect(EvidenceNoteDtoSchema.parse(response.body).retraction?.reason).toBe(RETRACT_REASON);
      expect(await auditCount('evidence_note.retracted')).toBe(retracted);
    });

    it('6. direct UPDATE and DELETE on the note tables raise an append-only error', async () => {
      await expect(
        prisma.$executeRaw`UPDATE evidence_notes SET text = 'x' WHERE id = ${disputeNote.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRaw`DELETE FROM evidence_note_retractions WHERE note_id = ${disputeNote.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });
  });
});
