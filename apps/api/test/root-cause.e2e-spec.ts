import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  ErrorResponseSchema,
  RootCauseResponseSchema,
  type EntityType,
  type OperationalState,
  type RelationshipType,
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
    return {
      type: edge.type,
      sourceSystem: 'OPSGRAPH',
      sourceId: `rel-${edge.type}-${edge.from}-${edge.to}`,
      from: ref(edge.from),
      to: ref(edge.to),
      origin: 'SOURCE',
      confidence: 'HIGH',
      ...(edge.basis === undefined ? {} : { basis: edge.basis }),
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
      const anyImport = await prisma.import.findFirstOrThrow();
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
          importId: anyImport.id,
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
