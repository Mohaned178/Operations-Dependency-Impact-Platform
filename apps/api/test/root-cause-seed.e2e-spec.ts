import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  BlockersResponseSchema,
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

// Acceptance fixtures R1–R4 and R8 (contracts/api.md), asserted literally against the seeded §39
// scenario, plus SC-002 (every delivery SLA names Budget Code Missing) and SC-004 determinism.
const EVALUATED_AT = '2026-09-29T16:00:00Z';
const EVALUATED_AT_ECHO = '2026-09-29T16:00:00.000Z';
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
    | 'contract',
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
});
