import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  ErrorResponseSchema,
  RootCauseResponseSchema,
  type ConfidenceRule,
  type EntityType,
  type OperationalState,
  type RelationshipType,
  type RootCauseCandidateDto,
  type RootCauseResponse,
} from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  createUser,
  entityIdByKey,
  login,
  resetDb,
  runImport,
  TEST_PASSWORD,
} from './helpers';

const T1 = '2026-09-14T08:00:00+00:00';
const T2 = '2026-09-14T09:00:00+00:00';
const EVALUATED_AT = '2026-09-14T10:00:00Z';

interface NodeSpec {
  /** Source id in system CRM; the display name is `Node <id>` unless given. */
  id: string;
  type?: EntityType;
  state?: OperationalState;
  displayName?: string;
  observedAt?: string;
  attributes?: Record<string, string>;
}

interface EdgeSpec {
  type: RelationshipType;
  from: string;
  to: string;
  observedAt?: string;
  basis?: string;
  origin?: 'SOURCE' | 'INFERRED' | 'MANUAL';
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface EventSpec {
  sourceId: string;
  subject: string;
  occurredAt: string;
}

describe('Root-cause analysis on built graphs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let typeOf: Map<string, EntityType>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  const ref = (id: string) => ({
    entityType: typeOf.get(id) ?? 'Customer',
    sourceSystem: 'CRM',
    sourceId: id,
  });

  async function importDocument(document: Record<string, unknown>): Promise<void> {
    const report = await runImport(app, { format: 'json', content: JSON.stringify(document) });
    if (report?.outcome !== 'APPLIED') {
      throw new Error(
        `Test graph import was ${report?.outcome ?? 'missing'}: ${JSON.stringify([
          ...(report?.fileErrors ?? []),
          ...(report?.rowErrors ?? []),
        ])}`,
      );
    }
  }

  function edgeRow(edge: EdgeSpec) {
    const origin = edge.origin ?? 'SOURCE';
    const basis = edge.basis ?? (origin === 'SOURCE' ? undefined : `test basis for ${origin}`);
    return {
      type: edge.type,
      sourceSystem: 'OPSGRAPH',
      sourceId: `rel-${edge.type}-${edge.from}-${edge.to}`,
      from: ref(edge.from),
      to: ref(edge.to),
      origin,
      confidence: edge.confidence ?? 'HIGH',
      ...(basis === undefined ? {} : { basis }),
      observedAt: edge.observedAt ?? T1,
    };
  }

  /** Resets the database, imports the graph, signs in an analyst, returns entity ids by source id. */
  async function setup(
    nodes: readonly NodeSpec[],
    edges: readonly EdgeSpec[] = [],
    events: readonly EventSpec[] = [],
  ): Promise<Record<string, string>> {
    await resetDb(prisma);
    const analyst = await createUser(prisma, { role: 'ANALYST' });
    token = (await login(app, analyst.email, TEST_PASSWORD)).accessToken;

    typeOf = new Map(nodes.map((node) => [node.id, node.type ?? 'Customer']));
    await importDocument({
      entities: nodes.map((node) => ({
        type: node.type ?? 'Customer',
        sourceSystem: 'CRM',
        sourceId: node.id,
        displayName: node.displayName ?? `Node ${node.id}`,
        ...(node.state === undefined ? {} : { state: node.state }),
        ...(node.attributes === undefined ? {} : { attributes: node.attributes }),
        observedAt: node.observedAt ?? T1,
      })),
      relationships: edges.map(edgeRow),
      events: events.map((event) => ({
        type: 'test.event',
        sourceSystem: 'EVT',
        sourceId: event.sourceId,
        occurredAt: event.occurredAt,
        observedAt: event.occurredAt,
        subject: ref(event.subject),
        description: `Event ${event.sourceId}`,
      })),
    });

    const ids: Record<string, string> = {};
    for (const node of nodes) {
      ids[node.id] = await entityIdByKey(prisma, node.type ?? 'Customer', 'CRM', node.id);
    }
    return ids;
  }

  function get(path: string, authorized = true): request.Test {
    const req = request(server).get(path);
    return authorized ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  async function analyze(id: string, query = `?evaluatedAt=${EVALUATED_AT}`): Promise<RootCauseResponse> {
    const response = await get(`/api/entities/${id}/root-cause${query}`);
    expect(response.status).toBe(200);
    return RootCauseResponseSchema.parse(response.body);
  }

  function evidenceOf(body: RootCauseResponse, entityId: string) {
    const found = body.evidence.entities.find((entry) => entry.entityId === entityId);
    if (found === undefined) {
      throw new Error(`no evidence for ${entityId}`);
    }
    return found;
  }

  describe('validation and access', () => {
    let ids: Record<string, string>;

    beforeAll(async () => {
      ids = await setup(
        [
          { id: 'a', state: 'BLOCKED' },
          { id: 'b', state: 'MISSING' },
        ],
        [{ type: 'REQUIRES', from: 'a', to: 'b' }],
      );
    });

    it.each(['0', '11', 'abc'])('rejects depth=%s with 400 on depth', async (depth) => {
      const response = await get(`/api/entities/${ids['a']}/root-cause?depth=${depth}`);
      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.map((detail) => detail.path)).toEqual(['depth']);
    });

    it('rejects evaluatedAt=yesterday with 400 on evaluatedAt', async () => {
      const response = await get(`/api/entities/${ids['a']}/root-cause?evaluatedAt=yesterday`);
      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.map((detail) => detail.path)).toEqual(['evaluatedAt']);
    });

    it('accepts a UTC evaluatedAt and echoes it in full ISO form', async () => {
      const body = await analyze(ids['a'] ?? '', '?evaluatedAt=2026-09-14T10:00:00Z&depth=3');
      expect(body.query).toEqual({
        entityId: ids['a'],
        depth: 3,
        evaluatedAt: '2026-09-14T10:00:00.000Z',
      });
    });

    it('defaults evaluatedAt to the request time', async () => {
      const before = Date.now();
      const body = await analyze(ids['a'] ?? '', '');
      expect(body.query.depth).toBe(6);
      expect(Date.parse(body.query.evaluatedAt)).toBeGreaterThanOrEqual(before);
      expect(body.query.evaluatedAt).toBe(body.computedAt);
    });

    it('rejects a malformed id with 400', async () => {
      const response = await get('/api/entities/not-a-uuid/root-cause');
      expect(response.status).toBe(400);
    });

    it('answers 404 NOT_FOUND for an unknown id', async () => {
      const response = await get(`/api/entities/${randomUUID()}/root-cause`);
      expect(response.status).toBe(404);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
    });

    it('answers 401 without a token', async () => {
      const response = await get(`/api/entities/${ids['a']}/root-cause`, false);
      expect(response.status).toBe(401);
    });

    it('writes no audit rows', async () => {
      const before = await prisma.auditEntry.count();
      await analyze(ids['a'] ?? '');
      await analyze(ids['a'] ?? '', '?depth=1');
      expect(await prisma.auditEntry.count()).toBe(before);
    });
  });

  function onlyCandidate(body: RootCauseResponse): RootCauseCandidateDto {
    expect(body.candidates).toHaveLength(1);
    const [candidate] = body.candidates;
    if (candidate === undefined) {
      throw new Error('expected one candidate');
    }
    return candidate;
  }

  function ruleOf(candidate: RootCauseCandidateDto, rule: ConfidenceRule) {
    const found = candidate.confidenceRules.find((outcome) => outcome.rule === rule);
    if (found === undefined) {
      throw new Error(`no outcome for ${rule}`);
    }
    return found;
  }

  /** An event on each given entity, so rule 7 (uncorroborated root) does not fire in isolation tests. */
  const corroborate = (...subjects: string[]): EventSpec[] =>
    subjects.map((subject) => ({ sourceId: `evt-${subject}`, subject, occurredAt: T1 }));

  describe('Story 2: inspectable confidence and honest uncertainty', () => {
    describe('1. inferred low link', () => {
      let candidate: RootCauseCandidateDto;

      beforeAll(async () => {
        const ids = await setup(
          [
            { id: 'A', state: 'BLOCKED' },
            { id: 'B', state: 'PENDING' },
            { id: 'C', state: 'PENDING' },
            { id: 'D', state: 'MISSING' },
          ],
          [
            { type: 'REQUIRES', from: 'A', to: 'B' },
            { type: 'REQUIRES', from: 'B', to: 'C' },
            { type: 'REQUIRES', from: 'C', to: 'D', origin: 'INFERRED', confidence: 'LOW' },
          ],
          corroborate('D'),
        );
        candidate = onlyCandidate(await analyze(ids['A'] ?? ''));
      });

      it('is LOW and headed "Possible root cause — insufficient evidence"', () => {
        expect(candidate.confidence).toBe('LOW');
        expect(candidate.insufficientEvidence).toBe(true);
        expect(candidate.explanation.headline).toBe(
          'Possible root cause — insufficient evidence: Node D Missing. Confidence: LOW.',
        );
      });

      it('applies only WEAKEST_LINK, naming the inferred link, with LOW from the start', () => {
        expect(
          candidate.confidenceRules.filter((rule) => rule.applied).map((rule) => rule.rule),
        ).toEqual(['WEAKEST_LINK']);
        expect(ruleOf(candidate, 'WEAKEST_LINK')).toMatchObject({
          confidenceAfter: 'LOW',
          refs: { stepIndexes: [3] },
          reason:
            'Confidence starts at LOW, the confidence of the weakest link: Node C REQUIRES Node D (inferred, low confidence).',
        });
        expect(candidate.explanation.confidence).toEqual([ruleOf(candidate, 'WEAKEST_LINK').reason]);
      });

      it('words every chain sentence with "may be"', () => {
        expect(candidate.explanation.chain).toHaveLength(3);
        for (const sentence of candidate.explanation.chain) {
          expect(sentence).toContain('may be');
        }
        expect(candidate.explanation.chain[0]).toBe(
          'Node A may be blocked because it requires Node B, which is PENDING.',
        );
        expect(candidate.primaryChain.sentences).toEqual(candidate.explanation.chain);
      });
    });

    describe('2. unknown root', () => {
      let candidate: RootCauseCandidateDto;

      beforeAll(async () => {
        const ids = await setup(
          [{ id: 'A', state: 'BLOCKED' }, { id: 'U' }],
          [{ type: 'REQUIRES', from: 'A', to: 'U' }],
          corroborate('U'),
        );
        candidate = onlyCandidate(await analyze(ids['A'] ?? ''));
      });

      it('is a LOW, possible root cause with a "(state unknown)" headline', () => {
        expect(candidate.possible).toBe(true);
        expect(candidate.confidence).toBe('LOW');
        expect(candidate.primaryChain.steps.at(-1)?.possible).toBe(true);
        expect(candidate.explanation.headline).toBe(
          'Possible root cause — insufficient evidence: Node U Unknown (state unknown). Confidence: LOW.',
        );
      });

      it('applies UNKNOWN_STATE naming the entity, and says the state is unknown', () => {
        expect(ruleOf(candidate, 'UNKNOWN_STATE')).toMatchObject({
          applied: true,
          confidenceAfter: 'LOW',
          refs: { stepIndexes: [1] },
          reason: 'Confidence set to LOW: the state of Node U is unknown.',
        });
        expect(candidate.explanation.chain).toEqual([
          'Node A may be blocked because it requires Node U, whose state is unknown.',
        ]);
      });
    });

    describe('3. depth limit', () => {
      let body: RootCauseResponse;
      let candidate: RootCauseCandidateDto;

      beforeAll(async () => {
        const ids = await setup(
          [
            { id: 'A', state: 'BLOCKED' },
            { id: 'B', state: 'PENDING' },
            { id: 'C', state: 'PENDING' },
            { id: 'D', state: 'PENDING' },
            { id: 'E', state: 'MISSING' },
          ],
          [
            { type: 'REQUIRES', from: 'A', to: 'B' },
            { type: 'REQUIRES', from: 'B', to: 'C' },
            { type: 'REQUIRES', from: 'C', to: 'D' },
            { type: 'REQUIRES', from: 'D', to: 'E' },
          ],
          corroborate('C'),
        );
        body = await analyze(ids['A'] ?? '', `?evaluatedAt=${EVALUATED_AT}&depth=2`);
        candidate = onlyCandidate(body);
      });

      it('flags continuesBeyondDepth and caps confidence at MEDIUM', () => {
        expect(body.query.depth).toBe(2);
        expect(candidate.continuesBeyondDepth).toBe(true);
        expect(candidate.primaryChain.continuesBeyondDepth).toBe(true);
        expect(candidate.confidence).toBe('MEDIUM');
        expect(ruleOf(candidate, 'SEARCH_LIMIT')).toMatchObject({
          applied: true,
          confidenceAfter: 'MEDIUM',
          reason:
            'Confidence is at most MEDIUM: the chain continues beyond the depth limit of 2 steps, so the true cause may lie deeper.',
        });
      });

      it('adds the "(deepest cause found within 2 steps)" suffix to the headline', () => {
        expect(candidate.explanation.headline).toBe(
          'Root cause: Node C Pending (deepest cause found within 2 steps). Confidence: MEDIUM.',
        );
      });
    });

    describe('4. blocked with no dependencies', () => {
      it('is UNEXPLAINED, with the exact summary and no candidates', async () => {
        const ids = await setup([{ id: 'A', state: 'BLOCKED' }]);
        const body = await analyze(ids['A'] ?? '');
        expect(body.status).toBe('UNEXPLAINED');
        expect(body.candidates).toEqual([]);
        expect(body.summary).toBe(
          'Node A is BLOCKED, but no recorded dependency within 6 steps explains this state. No root cause can be named.',
        );
        expect(body.evidence.entities.map((entry) => entry.entityId)).toEqual([ids['A']]);
        expect(body.evidence.relationships).toEqual([]);
      });
    });

    describe('5. cross-class disagreement', () => {
      let candidate: RootCauseCandidateDto;

      beforeAll(async () => {
        const ids = await setup(
          [
            { id: 'A', state: 'BLOCKED' },
            { id: 'B', state: 'ACTIVE' },
            { id: 'C', state: 'MISSING' },
          ],
          [
            { type: 'REQUIRES', from: 'A', to: 'B' },
            { type: 'REQUIRES', from: 'B', to: 'C' },
          ],
          corroborate('C'),
        );
        // A second source reports a newer, unsatisfied state for the same entity: CRM says ACTIVE
        // (older), ERP says BLOCKED (newer), so the chain can reach b and the sources disagree.
        await importDocument({
          entities: [
            {
              type: 'Customer',
              sourceSystem: 'ERP',
              sourceId: 'B-erp',
              displayName: 'Node B',
              state: 'BLOCKED',
              observedAt: T2,
              entityRef: { entityType: 'Customer', sourceSystem: 'CRM', sourceId: 'B' },
            },
          ],
        });
        candidate = onlyCandidate(await analyze(ids['A'] ?? ''));
      });

      it('applies CLASSIFICATION_DISAGREEMENT, lowering by one level, with both states in the reason', () => {
        expect(ruleOf(candidate, 'CLASSIFICATION_DISAGREEMENT')).toMatchObject({
          applied: true,
          confidenceAfter: 'MEDIUM',
          refs: { stepIndexes: [1] },
          reason:
            'Confidence lowered to MEDIUM: sources disagree on whether a step can progress: Node B (CRM ACTIVE, ERP BLOCKED).',
        });
        expect(candidate.confidence).toBe('MEDIUM');
      });
    });

    describe('6. stale step', () => {
      let candidate: RootCauseCandidateDto;

      beforeAll(async () => {
        // The evaluation time is 73 hours after b's observation; the other steps are 2 hours old.
        const ids = await setup(
          [
            { id: 'A', state: 'BLOCKED' },
            { id: 'B', state: 'PENDING', observedAt: '2026-09-11T09:00:00+00:00' },
            { id: 'C', state: 'MISSING' },
          ],
          [
            { type: 'REQUIRES', from: 'A', to: 'B' },
            { type: 'REQUIRES', from: 'B', to: 'C' },
          ],
          corroborate('C'),
        );
        candidate = onlyCandidate(await analyze(ids['A'] ?? ''));
      });

      it('applies STALE_EVIDENCE naming that step and its observation time', () => {
        expect(ruleOf(candidate, 'STALE_EVIDENCE')).toMatchObject({
          applied: true,
          confidenceAfter: 'MEDIUM',
          refs: { stepIndexes: [1] },
          reason:
            'Confidence lowered to MEDIUM: the state of Node B (2026-09-11T09:00:00.000Z) was last observed more than 72 hours before 2026-09-14T10:00:00.000Z.',
        });
        expect(candidate.confidence).toBe('MEDIUM');
      });
    });

    describe('7. two root causes', () => {
      let body: RootCauseResponse;

      beforeAll(async () => {
        const ids = await setup(
          [
            { id: 'A', state: 'BLOCKED' },
            { id: 'B', state: 'MISSING' },
            { id: 'C', state: 'MISSING' },
          ],
          [
            { type: 'REQUIRES', from: 'A', to: 'B' },
            { type: 'REQUIRES', from: 'A', to: 'C' },
          ],
          corroborate('B'),
        );
        body = await analyze(ids['A'] ?? '');
      });

      // Only B is corroborated by an event, so B (HIGH) outranks C (MEDIUM) regardless of entity ids.
      it('returns 2 candidates whose headlines say "Possible root cause:"', () => {
        expect(body.status).toBe('ROOT_CAUSES_FOUND');
        expect(body.candidates).toHaveLength(2);
        expect(body.candidates.map((candidate) => candidate.explanation.headline)).toEqual([
          'Possible root cause: Node B Missing. Confidence: HIGH.',
          'Possible root cause: Node C Missing. Confidence: MEDIUM.',
        ]);
      });

      it('summarises the count and the highest-ranked candidate', () => {
        expect(body.summary).toBe(
          'Node A is BLOCKED. 2 possible root causes found; highest ranked: Node B Missing (HIGH).',
        );
      });
    });

    describe('8. cycle', () => {
      let candidate: RootCauseCandidateDto;

      beforeAll(async () => {
        const ids = await setup(
          [
            { id: 'A', state: 'BLOCKED' },
            { id: 'B', state: 'BLOCKED' },
          ],
          [
            { type: 'REQUIRES', from: 'A', to: 'B' },
            { type: 'REQUIRES', from: 'B', to: 'A' },
          ],
          corroborate('B'),
        );
        candidate = onlyCandidate(await analyze(ids['A'] ?? ''));
      });

      it('is LOW with a "(circular dependency)" headline', () => {
        expect(candidate.inCycle).toBe(true);
        expect(candidate.primaryChain.endsInCycle).toBe(true);
        expect(candidate.confidence).toBe('LOW');
        expect(candidate.explanation.headline).toBe(
          'Possible root cause — insufficient evidence: Node B Blocked (circular dependency). Confidence: LOW.',
        );
        expect(ruleOf(candidate, 'CYCLE')).toMatchObject({
          applied: true,
          confidenceAfter: 'LOW',
          reason: 'Confidence set to LOW: Node B is part of a dependency cycle.',
        });
      });
    });

    describe('9. uncorroborated root', () => {
      let candidate: RootCauseCandidateDto;

      beforeAll(async () => {
        const ids = await setup(
          [
            { id: 'A', state: 'BLOCKED' },
            { id: 'B', state: 'MISSING' },
          ],
          [{ type: 'REQUIRES', from: 'A', to: 'B' }],
        );
        candidate = onlyCandidate(await analyze(ids['A'] ?? ''));
      });

      it('applies UNCORROBORATED: one source system and no events', () => {
        expect(ruleOf(candidate, 'UNCORROBORATED')).toMatchObject({
          applied: true,
          confidenceAfter: 'MEDIUM',
          refs: { stepIndexes: [1] },
          reason:
            'Confidence lowered to MEDIUM: the state of Node B comes from a single source (CRM) and no operational event mentions it.',
        });
        expect(candidate.confidence).toBe('MEDIUM');
        expect(candidate.eventCount).toBe(0);
      });
    });
  });

  describe('evidence rules', () => {
    it('returns the newest 20 of 25 events with total 25', async () => {
      const events = Array.from({ length: 25 }, (_unused, index): EventSpec => ({
        sourceId: `evt-${String(index).padStart(2, '0')}`,
        subject: 'b',
        occurredAt: new Date(Date.parse(T1) + index * 60_000).toISOString(),
      }));
      const ids = await setup(
        [
          { id: 'a', state: 'BLOCKED' },
          { id: 'b', state: 'MISSING' },
        ],
        [{ type: 'REQUIRES', from: 'a', to: 'b' }],
        events,
      );

      const body = await analyze(ids['a'] ?? '');
      const evidence = evidenceOf(body, ids['b'] ?? '');
      expect(evidence.events.total).toBe(25);
      expect(evidence.events.items).toHaveLength(20);
      expect(evidence.events.items.map((event) => event.sourceId)).toEqual(
        Array.from({ length: 20 }, (_unused, index) => `evt-${String(24 - index).padStart(2, '0')}`),
      );
      expect(evidence.events.items.every((event) => event.role === 'SUBJECT')).toBe(true);
      expect(body.candidates[0]?.eventCount).toBe(20);
    });

    it('returns both state records, the current one first, for an entity seen by 2 sources', async () => {
      const ids = await setup(
        [
          { id: 'a', state: 'BLOCKED' },
          { id: 'b', state: 'MISSING', observedAt: T2 },
        ],
        [{ type: 'REQUIRES', from: 'a', to: 'b' }],
      );
      await importDocument({
        entities: [
          {
            type: 'Customer',
            sourceSystem: 'ERP',
            sourceId: 'b-erp',
            displayName: 'Node b',
            state: 'PENDING',
            observedAt: T1,
            entityRef: { entityType: 'Customer', sourceSystem: 'CRM', sourceId: 'b' },
          },
        ],
      });

      const evidence = evidenceOf(await analyze(ids['a'] ?? ''), ids['b'] ?? '');
      expect(
        evidence.stateRecords.map((record) => [
          record.sourceRecord.sourceSystem,
          record.observation.state,
          record.current,
        ]),
      ).toEqual([
        ['CRM', 'MISSING', true],
        ['ERP', 'PENDING', false],
      ]);
    });

    it('lists DEFINES and GOVERNS requirement sources of one step sorted by type, name and id', async () => {
      const ids = await setup(
        [
          { id: 'a', state: 'BLOCKED' },
          {
            id: 'r',
            type: 'BudgetRequirement',
            state: 'MISSING',
            displayName: 'Budget code',
            attributes: { requiredField: 'costCenter' },
          },
          { id: 'c-beta', type: 'Contract', state: 'ACTIVE', displayName: 'Contract Beta' },
          { id: 'c-alpha', type: 'Contract', state: 'ACTIVE', displayName: 'Contract Alpha' },
          { id: 'c-aaa', type: 'Contract', state: 'ACTIVE', displayName: 'Contract Aaa' },
        ],
        [
          { type: 'REQUIRES', from: 'a', to: 'r' },
          { type: 'DEFINES', from: 'c-beta', to: 'r' },
          { type: 'DEFINES', from: 'c-alpha', to: 'r' },
        ],
      );
      // The importer only accepts GOVERNS into an Order (RELATIONSHIP_RULES), so a GOVERNS into
      // the same step is inserted directly to prove the ordering across types.
      const seededImport = await prisma.import.findFirstOrThrow();
      await prisma.relationship.create({
        data: {
          id: randomUUID(),
          type: 'GOVERNS',
          fromEntityId: ids['c-aaa'] ?? '',
          toEntityId: ids['r'] ?? '',
          origin: 'SOURCE',
          confidence: 'HIGH',
          sourceSystem: 'OPSGRAPH',
          sourceId: 'rel-GOVERNS-c-aaa-r',
          observedAt: new Date(T1),
          importId: seededImport.id,
        },
      });

      const body = await analyze(ids['a'] ?? '');
      const requirements = evidenceOf(body, ids['r'] ?? '').requirementSources;
      expect(requirements.total).toBe(3);
      expect(
        requirements.items.map((item) => [item.relationship.type, item.entity.displayName]),
      ).toEqual([
        ['DEFINES', 'Contract Alpha'],
        ['DEFINES', 'Contract Beta'],
        ['GOVERNS', 'Contract Aaa'],
      ]);
      expect(requirements.items.every((item) => item.stateRecord?.current === true)).toBe(true);
      expect(requirements.items.every((item) => item.relationship.toEntityId === ids['r'])).toBe(true);
      expect(body.candidates[0]?.label).toBe('Cost Center Missing');
      expect(body.candidates[0]?.labelRule).toBe('REQUIRED_FIELD');
    });

    it('uses the latest of two observations as the relationship record', async () => {
      const ids = await setup(
        [
          { id: 'a', state: 'BLOCKED' },
          { id: 'b', state: 'MISSING' },
        ],
        [{ type: 'REQUIRES', from: 'a', to: 'b' }],
      );
      await importDocument({
        relationships: [edgeRow({ type: 'REQUIRES', from: 'a', to: 'b', observedAt: T2, basis: 're-observed' })],
      });

      const body = await analyze(ids['a'] ?? '');
      expect(body.evidence.relationships).toHaveLength(1);
      const record = body.evidence.relationships[0]?.record;
      expect(record?.observedAt).toBe(new Date(T2).toISOString());
      const records = await prisma.sourceRecord.count({
        where: { relationshipId: body.evidence.relationships[0]?.relationshipId },
      });
      expect(records).toBe(2);
    });
  });
});
