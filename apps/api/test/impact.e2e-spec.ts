import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  ErrorResponseSchema,
  ImpactItemDetailResponseSchema,
  ImpactListResponseSchema,
  ImpactResponseSchema,
  type Confidence,
  type EntityType,
  type ImpactItemDetailResponse,
  type ImpactListResponse,
  type ImpactResponse,
  type OperationalState,
  type RelationshipOrigin,
  type RelationshipType,
  type Role,
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

interface NodeSpec {
  /** Source id; the display name is `Node <id>`. */
  id: string;
  type?: EntityType;
  state?: OperationalState;
  attributes?: Record<string, string>;
  observedAt?: string;
}

interface EdgeSpec {
  type: RelationshipType;
  from: string;
  to: string;
  origin?: RelationshipOrigin;
  confidence?: Confidence;
}

function order(id: string, amount: string, currency: string, state: OperationalState): NodeSpec {
  return { id, type: 'Order', state, attributes: { amount, currency } };
}

const dependsOn = (from: string, to: string): EdgeSpec => ({ type: 'DEPENDS_ON', from, to });

describe('Impact analysis on built graphs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Resets the database, imports the graph, signs in a manager, and returns the ids by source id. */
  async function setup(
    nodes: readonly NodeSpec[],
    edges: readonly EdgeSpec[] = [],
    extraEntities: readonly object[] = [],
  ): Promise<Record<string, string>> {
    await resetDb(prisma);
    const manager = await createUser(prisma, { role: 'OPS_MANAGER' });
    token = (await login(app, manager.email, TEST_PASSWORD)).accessToken;

    const typeOf = new Map(nodes.map((node) => [node.id, node.type ?? 'Shipment']));
    const ref = (id: string) => ({
      entityType: typeOf.get(id) ?? 'Shipment',
      sourceSystem: 'CRM',
      sourceId: id,
    });
    const report = await runImport(app, {
      format: 'json',
      content: JSON.stringify({
        entities: [
          ...nodes.map((node) => ({
            type: node.type ?? 'Shipment',
            sourceSystem: 'CRM',
            sourceId: node.id,
            displayName: `Node ${node.id}`,
            ...(node.state === undefined ? {} : { state: node.state }),
            ...(node.attributes === undefined ? {} : { attributes: node.attributes }),
            observedAt: node.observedAt ?? T1,
          })),
          ...extraEntities,
        ],
        relationships: edges.map((edge) => {
          const origin = edge.origin ?? 'SOURCE';
          return {
            type: edge.type,
            sourceSystem: 'OPSGRAPH',
            sourceId: `rel-${edge.type}-${edge.from}-${edge.to}`,
            from: ref(edge.from),
            to: ref(edge.to),
            origin,
            confidence: edge.confidence ?? 'HIGH',
            ...(origin === 'SOURCE' ? {} : { basis: `test basis for ${origin}` }),
            observedAt: T1,
          };
        }),
      }),
    });
    if (report?.outcome !== 'APPLIED') {
      throw new Error(
        `Test graph import was ${report?.outcome ?? 'missing'}: ${JSON.stringify([
          ...(report?.fileErrors ?? []),
          ...(report?.rowErrors ?? []),
        ])}`,
      );
    }

    const ids: Record<string, string> = {};
    for (const node of nodes) {
      ids[node.id] = await entityIdByKey(prisma, node.type ?? 'Shipment', 'CRM', node.id);
    }
    return ids;
  }

  function get(path: string, authorized = true): request.Test {
    const req = request(server).get(path);
    return authorized ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  async function summaryOf(id: string, depth?: number): Promise<ImpactResponse> {
    const response = await get(`/api/entities/${id}/impact${depth === undefined ? '' : `?depth=${depth}`}`);
    expect(response.status).toBe(200);
    return ImpactResponseSchema.parse(response.body);
  }

  async function listOf(id: string, query: string): Promise<ImpactListResponse> {
    const response = await get(`/api/entities/${id}/impact/items?${query}`);
    expect(response.status).toBe(200);
    return ImpactListResponseSchema.parse(response.body);
  }

  async function itemOf(id: string, targetId: string): Promise<ImpactItemDetailResponse> {
    const response = await get(`/api/entities/${id}/impact/items/${targetId}`);
    expect(response.status).toBe(200);
    return ImpactItemDetailResponseSchema.parse(response.body);
  }

  const category = (body: ImpactResponse, type: EntityType) =>
    body.categories.find((entry) => entry.type === type);

  describe('states', () => {
    it('treats everything as potential when the start state is UNKNOWN', async () => {
      const ids = await setup(
        [
          { id: 'S', type: 'Supplier', state: 'UNKNOWN' },
          { id: 'A', state: 'BLOCKED' },
        ],
        [dependsOn('A', 'S')],
      );
      const body = await summaryOf(ids['S'] ?? '');
      expect(body.startClass).toBe('INDETERMINATE');
      expect(body.summary[0]).toBe('Node S has an unknown state.');
      expect(category(body, 'Shipment')).toMatchObject({ total: 1, current: 0, potential: 1 });
      expect(body.summary[1]).toBe('If Node S became unavailable: 1 shipment.');
    });

    it('counts an UNKNOWN entity in a chain as potential, flags it, and breaks the live chain', async () => {
      const ids = await setup(
        [
          { id: 'S', type: 'Supplier', state: 'SUSPENDED' },
          { id: 'A', state: 'UNKNOWN' },
          { id: 'B', state: 'BLOCKED' },
        ],
        [dependsOn('A', 'S'), dependsOn('B', 'A')],
      );
      const body = await summaryOf(ids['S'] ?? '');
      expect(category(body, 'Shipment')).toMatchObject({
        total: 2,
        current: 0,
        potential: 2,
        stateUnknown: 1,
      });
      expect(body.summary).toContain(
        '1 affected entity has an unknown state and is counted as potential.',
      );

      const flagged = await listOf(ids['S'] ?? '', 'list=category&type=Shipment&bucket=stateUnknown');
      expect(flagged.items.map((item) => item.entity.displayName)).toEqual(['Node A']);
      expect(flagged.items[0]?.flags.stateUnknown).toBe(true);
      expect(flagged.items[0]?.classification).toBe('POTENTIAL');

      const beyond = await listOf(ids['S'] ?? '', 'list=category&type=Shipment&bucket=potential');
      const behind = beyond.items.find((item) => item.entity.displayName === 'Node B');
      expect(behind?.classification).toBe('POTENTIAL');
      expect(behind?.flags.otherCause).toBe(true);
    });

    it('does not count a CANCELLED entity and does not reach anything behind it', async () => {
      const ids = await setup(
        [
          { id: 'S', type: 'Supplier', state: 'SUSPENDED' },
          { id: 'C', state: 'CANCELLED' },
          { id: 'D', state: 'ACTIVE' },
        ],
        [dependsOn('C', 'S'), dependsOn('D', 'C')],
      );
      const body = await summaryOf(ids['S'] ?? '');
      expect(body.countedTotal).toBe(0);
      expect(body.notCounted).toEqual({ total: 1, byType: [{ type: 'Shipment', count: 1 }] });
      expect(body.summary).toEqual([
        'Node S is SUSPENDED.',
        'Nothing is affected within 6 steps.',
        'Not counted: 1 completed or cancelled entity.',
      ]);
      const response = await get(`/api/entities/${ids['S']}/impact/items/${ids['D']}`);
      expect(response.status).toBe(404);
    });
  });

  describe('graph shapes and limits', () => {
    it('terminates on a 2-node cycle and lists its cycle-closing hop', async () => {
      const ids = await setup(
        [
          { id: 'S', type: 'Supplier', state: 'SUSPENDED' },
          { id: 'A', state: 'BLOCKED' },
          { id: 'B', state: 'BLOCKED' },
        ],
        [dependsOn('A', 'S'), dependsOn('B', 'A'), dependsOn('A', 'B')],
      );
      const body = await summaryOf(ids['S'] ?? '');
      expect(category(body, 'Shipment')).toMatchObject({ total: 2, current: 2 });
      expect(body.cycleClosingHopCount).toBe(1);
      expect(body.cycleClosingHops).toHaveLength(1);
      expect(body.cycleClosingHops[0]).toMatchObject({
        relationshipType: 'DEPENDS_ON',
        fromEntityId: ids['A'],
        toEntityId: ids['B'],
      });
    });

    it('honours depth 1 and depth 10', async () => {
      const chain = Array.from({ length: 10 }, (_, index) => `N${index + 1}`);
      const ids = await setup(
        [{ id: 'S', type: 'Supplier', state: 'SUSPENDED' }, ...chain.map((id) => ({ id, state: 'BLOCKED' as const }))],
        chain.map((id, index) => dependsOn(id, index === 0 ? 'S' : (chain[index - 1] ?? 'S'))),
      );

      const shallow = await summaryOf(ids['S'] ?? '', 1);
      expect(shallow.countedTotal).toBe(1);
      expect(shallow.limits).toEqual({ depthLimit: true, explorationLimit: false, lowerBound: true });
      expect(shallow.summary.at(-1)).toBe(
        'Impact continues beyond 1 step; these figures are lower bounds.',
      );

      const deep = await summaryOf(ids['S'] ?? '', 10);
      expect(deep.countedTotal).toBe(10);
      expect(deep.limits.depthLimit).toBe(false);
      expect(deep.summary.some((line) => line.includes('lower bounds'))).toBe(false);
    });
  });

  describe('exposure', () => {
    it('keeps USD and EUR apart and joins them in the summary', async () => {
      const ids = await setup(
        [
          { id: 'S', type: 'Supplier', state: 'SUSPENDED' },
          order('O1', '100.00', 'USD', 'BLOCKED'),
          order('O2', '80.00', 'EUR', 'BLOCKED'),
        ],
        [dependsOn('O1', 'S'), dependsOn('O2', 'S')],
      );
      const body = await summaryOf(ids['S'] ?? '');
      expect(body.exposure.byCurrency.map((figure) => [figure.currency, figure.total.amount])).toEqual([
        ['EUR', '80.00'],
        ['USD', '100.00'],
      ]);
      expect(body.summary).toContain(
        'Currently affected: 2 customer orders. 80.00 EUR and 100.00 USD exposed.',
      );
      expect(body.summary).toContain('Total exposure: 80.00 EUR and 100.00 USD across 2 customer orders.');

      const eur = await listOf(ids['S'] ?? '', 'list=exposure&currency=EUR&bucket=total');
      expect(eur.items.map((item) => item.entity.displayName)).toEqual(['Node O2']);
      expect(eur.sum).toEqual({ amount: '80.00', currency: 'EUR' });
    });

    it('shows a range and summary line 9 when two sources disagree on an order value', async () => {
      const ids = await setup(
        [
          { id: 'S', type: 'Supplier', state: 'SUSPENDED' },
          { ...order('O', '100.00', 'USD', 'BLOCKED'), observedAt: '2026-09-14T09:00:00+00:00' },
        ],
        [dependsOn('O', 'S')],
        [
          {
            type: 'Order',
            sourceSystem: 'ERP',
            sourceId: 'SO-O',
            displayName: 'Node O',
            observedAt: T1,
            state: 'BLOCKED',
            entityRef: { entityType: 'Order', sourceSystem: 'CRM', sourceId: 'O' },
            attributes: { amount: '120.00', currency: 'USD' },
          },
        ],
      );
      const body = await summaryOf(ids['S'] ?? '');
      const figure = body.exposure.byCurrency[0];
      expect(figure?.total).toEqual({ amount: '100.00', orderCount: 1 });
      expect(figure?.disagreementOrderCount).toBe(1);
      expect(figure?.range).toEqual({ low: '100.00', high: '120.00' });
      expect(body.summary).toContain(
        '1 customer order has values that disagree between sources; exposure could range from 100.00 USD to 120.00 USD.',
      );

      const detail = await itemOf(ids['S'] ?? '', ids['O'] ?? '');
      expect(detail.item.value?.disagreement).toBe(true);
      expect(detail.item.value?.currencyMismatch).toBe(false);
      expect(detail.item.value?.bySource.map((source) => [source.sourceSystem, source.amount])).toEqual([
        ['CRM', '100.00'],
        ['ERP', '120.00'],
      ]);
    });
  });

  describe('customers', () => {
    it('merges a customer reached downstream with its attribution', async () => {
      const ids = await setup(
        [
          { id: 'S', type: 'Supplier', state: 'SUSPENDED' },
          { id: 'C', type: 'Customer', state: 'ACTIVE' },
          order('O', '100.00', 'USD', 'BLOCKED'),
        ],
        [dependsOn('C', 'S'), dependsOn('O', 'S'), { type: 'PLACED', from: 'C', to: 'O' }],
      );
      const list = await listOf(ids['S'] ?? '', 'list=category&type=Customer&bucket=total');
      expect(list.total).toBe(1);
      const [customer] = list.items;
      expect(customer?.entity.displayName).toBe('Node C');
      expect(customer?.distance).toBe(1);
      expect(customer?.directness).toBe('DIRECT');
      expect(customer?.primaryPath).not.toBeNull();
      expect(customer?.attributionCount).toBe(1);
      expect(customer?.attributions[0]?.entity.displayName).toBe('Node O');
      expect(customer?.classification).toBe('CURRENT');
    });

    it('does not count an analyzed customer as its own customer', async () => {
      const ids = await setup(
        [
          { id: 'C', type: 'Customer', state: 'SUSPENDED' },
          order('O', '100.00', 'USD', 'BLOCKED'),
        ],
        [dependsOn('O', 'C'), { type: 'PLACED', from: 'C', to: 'O' }],
      );
      const body = await summaryOf(ids['C'] ?? '');
      expect(category(body, 'Customer')?.total).toBe(0);
      expect(category(body, 'Order')?.total).toBe(1);
      expect(body.countedTotal).toBe(1);
      const customers = await listOf(ids['C'] ?? '', 'list=category&type=Customer&bucket=total');
      expect(customers.items).toEqual([]);
    });
  });

  describe('validation and access (contracts/api.md)', () => {
    let ids: Record<string, string>;
    let startId: string;
    let targetId: string;

    beforeAll(async () => {
      ids = await setup(
        [
          { id: 'S', type: 'Supplier', state: 'SUSPENDED' },
          order('O', '100.00', 'USD', 'BLOCKED'),
          { id: 'X', state: 'ACTIVE' },
        ],
        [dependsOn('O', 'S')],
      );
      startId = ids['S'] ?? '';
      targetId = ids['O'] ?? '';
    });

    async function expectValidation(path: string, field: string): Promise<{ message: string }[]> {
      const response = await get(path);
      expect([path, response.status]).toEqual([path, 400]);
      const error = ErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      const details = (error.details ?? []).filter((detail) => detail.path === field);
      expect([path, details.length > 0]).toEqual([path, true]);
      return details;
    }

    it.each(['0', '11', 'abc'])('rejects depth=%s on the summary', async (depth) => {
      await expectValidation(`/api/entities/${startId}/impact?depth=${depth}`, 'depth');
    });

    it('rejects a list request without list', async () => {
      await expectValidation(`/api/entities/${startId}/impact/items`, 'list');
    });

    it('rejects list=category without type', async () => {
      await expectValidation(`/api/entities/${startId}/impact/items?list=category&bucket=total`, 'type');
    });

    it('rejects an unknown bucket and lists the allowed ones', async () => {
      const details = await expectValidation(
        `/api/entities/${startId}/impact/items?list=category&type=Order&bucket=sum`,
        'bucket',
      );
      expect(details[0]?.message).toContain('total, direct, indirect, current, potential, inferredOnly, stateUnknown');
    });

    it('rejects currency for list=category', async () => {
      const details = await expectValidation(
        `/api/entities/${startId}/impact/items?list=category&type=Order&bucket=total&currency=USD`,
        'currency',
      );
      expect(details[0]?.message).toBe('currency is not allowed for list=category');
    });

    it('rejects list=exposure without currency, and a lower-case currency', async () => {
      await expectValidation(`/api/entities/${startId}/impact/items?list=exposure&bucket=total`, 'currency');
      await expectValidation(
        `/api/entities/${startId}/impact/items?list=exposure&currency=usd&bucket=total`,
        'currency',
      );
    });

    it('answers an exposure list for a currency with no figure with an empty list', async () => {
      const list = await listOf(startId, 'list=exposure&currency=EUR&bucket=total');
      expect(list.total).toBe(0);
      expect(list.items).toEqual([]);
      expect(list.sum).toEqual({ amount: '0.00', currency: 'EUR' });
    });

    it('rejects an unknown type for list=notCounted', async () => {
      await expectValidation(`/api/entities/${startId}/impact/items?list=notCounted&type=Widget`, 'type');
    });

    it.each(['0', '201'])('rejects limit=%s', async (limit) => {
      await expectValidation(`/api/entities/${startId}/impact/items?list=valueUnknown&limit=${limit}`, 'limit');
    });

    it('rejects a malformed cursor', async () => {
      await expectValidation(
        `/api/entities/${startId}/impact/items?list=category&type=Order&bucket=total&cursor=garbage`,
        'cursor',
      );
    });

    it('answers 404 on all three routes for an unknown start entity', async () => {
      const unknown = randomUUID();
      for (const path of [
        `/api/entities/${unknown}/impact`,
        `/api/entities/${unknown}/impact/items?list=valueUnknown`,
        `/api/entities/${unknown}/impact/items/${targetId}`,
      ]) {
        const response = await get(path);
        expect([path, response.status]).toEqual([path, 404]);
        expect(ErrorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
      }
    });

    it('answers 400 for a malformed start id or target id', async () => {
      for (const path of [
        '/api/entities/not-a-uuid/impact',
        '/api/entities/not-a-uuid/impact/items?list=valueUnknown',
        `/api/entities/${startId}/impact/items/not-a-uuid`,
      ]) {
        expect([path, (await get(path)).status]).toEqual([path, 400]);
      }
    });

    it('answers 404 for an entity that is not in the analysis, and for the start itself', async () => {
      for (const id of [ids['X'] ?? '', startId]) {
        const response = await get(`/api/entities/${startId}/impact/items/${id}`);
        expect(response.status).toBe(404);
        expect(ErrorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
      }
    });

    it('answers 401 on all three routes without a token', async () => {
      for (const path of [
        `/api/entities/${startId}/impact`,
        `/api/entities/${startId}/impact/items?list=valueUnknown`,
        `/api/entities/${startId}/impact/items/${targetId}`,
      ]) {
        expect([path, (await get(path, false)).status]).toEqual([path, 401]);
      }
    });

    it('answers 200 for every role and writes nothing: no audit row and no data change', async () => {
      const snapshot = async () =>
        Promise.all([
          prisma.auditEntry.count(),
          prisma.entity.count(),
          prisma.relationship.count(),
          prisma.stateObservation.count(),
          prisma.sourceRecord.count(),
          prisma.event.count(),
        ]);

      const roles: Role[] = ['ANALYST', 'OPS_MANAGER', 'ADMIN'];
      const tokens: string[] = [];
      for (const role of roles) {
        const user = await createUser(prisma, { role });
        tokens.push((await login(app, user.email, TEST_PASSWORD)).accessToken);
      }

      const before = await snapshot();
      for (const roleToken of tokens) {
        for (const path of [
          `/api/entities/${startId}/impact`,
          `/api/entities/${startId}/impact/items?list=category&type=Order&bucket=total`,
          `/api/entities/${startId}/impact/items/${targetId}`,
        ]) {
          const response = await request(server).get(path).set('Authorization', `Bearer ${roleToken}`);
          expect([path, response.status]).toEqual([path, 200]);
        }
      }
      expect(await snapshot()).toEqual(before);
    });
  });
});
