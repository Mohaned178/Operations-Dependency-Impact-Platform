import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  BlockersResponseSchema,
  DependenciesResponseSchema,
  ErrorResponseSchema,
  NeighborhoodResponseSchema,
  type NeighborhoodResponse,
} from '@opsgraph/shared';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

// Acceptance fixtures N1, N3, N9 and N10 (contracts/api.md §5), asserted literally against the
// seeded §39 scenario.
describe('Graph explorer on the seeded §39 scenario (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  /** Display name → entity id for the whole seed (display names are unique in it). */
  const idByName = new Map<string, string>();
  const nameById = new Map<string, string>();

  const ORDER = 'Order #18492';
  const SHIPMENT = 'Shipment SHP-77120 (consolidated)';
  const PAYMENT = 'Payment PAY-88213';
  const PRODUCT = 'Industrial Pallet Racking Kit';
  const SUPPLIER_CONTOSO = 'Contoso Metals';
  const OTHER_ORDERS = [
    '18493',
    '18494',
    '18495',
    '18496',
    '18501',
    '18502',
    '18503',
    '18504',
    '18505',
    '18511',
    '18512',
    '18513',
    '18514',
    '18521',
    '18522',
    '18523',
  ].map((sourceId) => `Order #${sourceId}`);
  const SLAS = [
    'Acme Corp delivery SLA',
    'Globex Retail delivery SLA',
    'Initech Supplies delivery SLA',
    'Umbrella Logistics delivery SLA',
  ];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const analyst = await createUser(prisma, { role: 'ANALYST' });
    token = (await login(app, analyst.email, TEST_PASSWORD)).accessToken;
    const report = await app.get(SeedService).seedScenario39();
    expect(report?.outcome).toBe('APPLIED');

    for (const entity of await prisma.entity.findMany({ select: { id: true, displayName: true } })) {
      idByName.set(entity.displayName, entity.id);
      nameById.set(entity.id, entity.displayName);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  function id(name: string): string {
    const found = idByName.get(name);
    if (found === undefined) {
      throw new Error(`seed entity not found: ${name}`);
    }
    return found;
  }

  function names(body: NeighborhoodResponse, distance: number): string[] {
    return body.nodes
      .filter((node) => node.distance === distance)
      .map((node) => node.displayName)
      .sort();
  }

  async function neighborhoodOf(entityName: string, query = ''): Promise<NeighborhoodResponse> {
    const response = await request(server)
      .get(`/api/entities/${id(entityName)}/neighborhood${query}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return NeighborhoodResponseSchema.parse(response.body);
  }

  function edgeBetween(body: NeighborhoodResponse, type: string, from: string, to: string) {
    return body.edges.find(
      (edge) =>
        edge.relationshipType === type &&
        edge.fromEntityId === id(from) &&
        edge.toEntityId === id(to),
    );
  }

  describe('N1: Order #18492, defaults', () => {
    let body: NeighborhoodResponse;

    beforeAll(async () => {
      body = await neighborhoodOf(ORDER);
    });

    it('has 32 nodes: 1 at distance 0, 7 at distance 1, 24 at distance 2', () => {
      expect(body.nodes).toHaveLength(32);
      expect(body.nodes.filter((n) => n.distance === 0)).toHaveLength(1);
      expect(body.nodes.filter((n) => n.distance === 1)).toHaveLength(7);
      expect(body.nodes.filter((n) => n.distance === 2)).toHaveLength(24);
      expect(body.nodes[0]?.displayName).toBe(ORDER);
    });

    it('names the distance-1 entities', () => {
      expect(names(body, 1)).toEqual(
        [
          'Acme Corp',
          'Contract CON-3982',
          PRODUCT,
          'Invoice INV-55120',
          PAYMENT,
          SHIPMENT,
          'East Distribution Center 02',
        ].sort(),
      );
    });

    it('names the distance-2 entities', () => {
      expect(names(body, 2)).toEqual(
        [
          ...OTHER_ORDERS,
          ...SLAS,
          'Budget code for Order #18492',
          'Finance approval APR-2291',
          'Northwind Steel',
          SUPPLIER_CONTOSO,
        ].sort(),
      );
    });

    it('has 60 edges, nothing omitted, no blockers, and the right reasons', () => {
      expect(body.edges).toHaveLength(60);
      expect(body.totals).toEqual({ visible: 32, omitted: 0, omittedIsLowerBound: false });
      expect(body.blockers).toBeNull();
      expect(body.ignoredExpansions).toEqual([]);
      for (const node of body.nodes) {
        expect(node.reasons).toEqual(node.id === id(ORDER) ? ['FOCUS'] : ['NEIGHBORHOOD']);
      }
      const keys = body.edges.map((edge) => edge.key);
      expect(keys).toEqual([...keys].sort());
    });

    it('marks the inferred supplier edge INFERRED / LOW', () => {
      expect(edgeBetween(body, 'SUPPLIED_BY', PRODUCT, SUPPLIER_CONTOSO)).toMatchObject({
        effectiveOrigin: 'INFERRED',
        effectiveConfidence: 'LOW',
      });
    });

    it('marks PAY-88213 BLOCKS SHP-77120 MANUAL / MEDIUM', () => {
      expect(edgeBetween(body, 'BLOCKS', PAYMENT, SHIPMENT)).toMatchObject({
        effectiveOrigin: 'MANUAL',
        effectiveConfidence: 'MEDIUM',
      });
    });

    it('carries the per-source states of Order #18492 (OMS BLOCKED, ERP PENDING)', () => {
      const order = body.nodes[0];
      const states = Object.fromEntries(
        (order?.state.latestBySource ?? []).map((o) => [o.sourceSystem, o.state]),
      );
      expect(states).toEqual({ OMS: 'BLOCKED', ERP: 'PENDING' });
      expect(order?.currentState).toBe('BLOCKED');
    });

    it('gives every non-focus node a parent that appears earlier and a kept edge to it', () => {
      const seen = new Set<string>();
      const edgeByKey = new Map(body.edges.map((edge) => [edge.key, edge]));
      for (const node of body.nodes) {
        if (node.parentId !== null) {
          expect(seen.has(node.parentId)).toBe(true);
          const edge = edgeByKey.get(node.viaEdgeKey ?? '');
          expect(edge).toBeDefined();
          expect([edge?.fromEntityId, edge?.toEntityId].sort()).toEqual(
            [node.parentId, node.id].sort(),
          );
        }
        seen.add(node.id);
      }
    });
  });

  describe('N3: Shipment SHP-77120, defaults', () => {
    let body: NeighborhoodResponse;

    beforeAll(async () => {
      body = await neighborhoodOf(SHIPMENT);
    });

    it('has 35 nodes: 23 at distance 1 and 11 at distance 2, and 86 edges', () => {
      expect(body.nodes).toHaveLength(35);
      expect(body.nodes.filter((n) => n.distance === 1)).toHaveLength(23);
      expect(body.nodes.filter((n) => n.distance === 2)).toHaveLength(11);
      expect(body.edges).toHaveLength(86);
      expect(body.totals.omitted).toBe(0);
    });

    it('names the distance-1 entities', () => {
      expect(names(body, 1)).toEqual(
        [ORDER, ...OTHER_ORDERS, 'East Distribution Center 02', ...SLAS, PAYMENT].sort(),
      );
    });

    it('names the distance-2 entities', () => {
      expect(names(body, 2)).toEqual(
        [
          'Acme Corp',
          'Globex Retail',
          'Initech Supplies',
          'Umbrella Logistics',
          'Contract CON-3982',
          'Contract CON-4107',
          'Contract CON-4215',
          'Contract CON-4330',
          PRODUCT,
          'Invoice INV-55120',
          'Finance approval APR-2291',
        ].sort(),
      );
    });
  });

  describe('N9: relationship-type filter', () => {
    it('returns the order and the payment with the single REQUIRES edge', async () => {
      const body = await neighborhoodOf(ORDER, '?depth=1&relationshipTypes=REQUIRES');
      expect(body.nodes.map((n) => n.displayName).sort()).toEqual([ORDER, PAYMENT].sort());
      expect(body.edges).toHaveLength(1);
      expect(body.edges[0]).toMatchObject({
        relationshipType: 'REQUIRES',
        fromEntityId: id(ORDER),
        toEntityId: id(PAYMENT),
      });
      expect(body.query.relationshipTypes).toEqual(['REQUIRES']);
    });
  });

  describe('N10: validation', () => {
    async function errorOf(query: string, status = 400) {
      const response = await request(server)
        .get(`/api/entities/${id(ORDER)}/neighborhood${query}`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(status);
      return ErrorResponseSchema.parse(response.body).error;
    }

    it.each([
      ['direction=upstream&relationshipTypes=RELATES_TO', 'relationshipTypes'],
      ['depth=0', 'depth'],
      ['depth=5', 'depth'],
      ['depth=2.5', 'depth'],
      ['entityTypes=Foo', 'entityTypes.0'],
      ['blockers=yes', 'blockers'],
    ])('answers 400 for ?%s', async (query, path) => {
      const error = await errorOf(`?${query}`);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.[0]?.path).toBe(path);
    });

    it('answers 400 for 51 distinct expand ids and accepts 50', async () => {
      const ids = (count: number) => Array.from({ length: count }, () => randomUUID()).join(',');
      const error = await errorOf(`?expand=${ids(51)}`);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.[0]?.path).toBe('expand');

      const ok = await request(server)
        .get(`/api/entities/${id(ORDER)}/neighborhood?expand=${ids(50)}`)
        .set('Authorization', `Bearer ${token}`);
      expect(ok.status).toBe(200);
      expect(NeighborhoodResponseSchema.parse(ok.body).ignoredExpansions).toHaveLength(50);
    });

    it('answers 404 for an unknown entity and 401 without a token', async () => {
      const missing = await request(server)
        .get(`/api/entities/${randomUUID()}/neighborhood`)
        .set('Authorization', `Bearer ${token}`);
      expect(missing.status).toBe(404);
      const anonymous = await request(server).get(`/api/entities/${id(ORDER)}/neighborhood`);
      expect(anonymous.status).toBe(401);
    });
  });

  const BUDGET = 'Budget code for Order #18492';
  const APPROVAL = 'Finance approval APR-2291';

  async function blockersOf(entityName: string) {
    const response = await request(server)
      .get(`/api/entities/${id(entityName)}/blockers`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return BlockersResponseSchema.parse(response.body);
  }

  async function dependenciesOf(entityName: string, query: string) {
    const response = await request(server)
      .get(`/api/entities/${id(entityName)}/dependencies${query}&limit=100`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return DependenciesResponseSchema.parse(response.body);
  }

  describe('N2: Order #18492, blockers on', () => {
    it('has the N1 nodes and edges, with the blocking path first and the blockers payload equal to /blockers', async () => {
      const body = await neighborhoodOf(ORDER, '?blockers=true');
      expect(body.nodes).toHaveLength(32);
      expect(body.edges).toHaveLength(60);
      expect(body.nodes.slice(1, 4).map((n) => n.displayName)).toEqual([
        PAYMENT,
        APPROVAL,
        BUDGET,
      ]);
      for (const node of body.nodes.slice(1, 4)) {
        expect(node.reasons).toEqual(['BLOCKING_PATH', 'NEIGHBORHOOD']);
      }
      const budget = body.nodes[3];
      expect(budget).toMatchObject({ distance: 2, parentId: id(APPROVAL) });
      expect(budget?.viaEdgeKey).toBe(edgeBetween(body, 'REQUIRES', APPROVAL, BUDGET)?.key);

      const expected = await blockersOf(ORDER);
      expect({ ...body.blockers, computedAt: '' }).toEqual({ ...expected, computedAt: '' });
    });
  });

  describe('N4: Shipment SHP-77120, blockers on', () => {
    it('adds the Budget code as a blocking-path-only node and embeds both paths', async () => {
      const body = await neighborhoodOf(SHIPMENT, '?blockers=true');
      expect(body.nodes).toHaveLength(36);
      expect(body.edges).toHaveLength(88);
      expect(body.nodes.slice(1, 5).map((n) => n.displayName)).toEqual([
        ORDER,
        PAYMENT,
        APPROVAL,
        BUDGET,
      ]);
      expect(body.nodes[4]).toMatchObject({
        reasons: ['BLOCKING_PATH'],
        distance: null,
        parentId: id(APPROVAL),
      });
      expect(body.blockers?.paths).toHaveLength(2);
      const expected = await blockersOf(SHIPMENT);
      expect({ ...body.blockers, computedAt: '' }).toEqual({ ...expected, computedAt: '' });
    });

    it('is identical over 100 consecutive calls (SC-008)', async () => {
      const normalize = (body: NeighborhoodResponse) => ({
        ...body,
        computedAt: '',
        blockers: body.blockers === null ? null : { ...body.blockers, computedAt: '' },
      });
      const first = normalize(await neighborhoodOf(SHIPMENT, '?blockers=true'));
      for (let i = 0; i < 99; i += 1) {
        expect(normalize(await neighborhoodOf(SHIPMENT, '?blockers=true'))).toEqual(first);
      }
    }, 60_000);
  });

  describe('N5: Budget code, downstream depth 4', () => {
    it('has 26 nodes and equals /dependencies downstream depth 4', async () => {
      const body = await neighborhoodOf(BUDGET, '?direction=downstream&depth=4');
      expect(body.nodes).toHaveLength(26);
      const perDistance = [0, 1, 2, 3, 4].map(
        (d) => body.nodes.filter((n) => n.distance === d).length,
      );
      expect(perDistance).toEqual([1, 1, 1, 2, 21]);

      const dependencies = await dependenciesOf(BUDGET, '?direction=downstream&depth=4');
      const fromTrace = dependencies.items.map((item) => [item.entity.id, item.distance]).sort();
      const fromView = body.nodes
        .filter((n) => n.id !== id(BUDGET))
        .map((n) => [n.id, n.distance])
        .sort();
      expect(fromView).toEqual(fromTrace);
    });
  });

  describe('N6: Budget code, downstream depth 4, Order and Shipment only', () => {
    it('lists the connectors first, then the orders, with exact parents', async () => {
      const body = await neighborhoodOf(
        BUDGET,
        '?direction=downstream&depth=4&entityTypes=Order,Shipment',
      );
      expect(body.nodes.map((n) => n.displayName)).toEqual([
        BUDGET,
        APPROVAL,
        PAYMENT,
        ORDER,
        SHIPMENT,
        ...OTHER_ORDERS,
      ]);
      expect(body.nodes.map((n) => n.reasons)).toEqual([
        ['FOCUS'],
        ['CONNECTOR'],
        ['CONNECTOR'],
        ['NEIGHBORHOOD'],
        ['NEIGHBORHOOD'],
        ...OTHER_ORDERS.map(() => ['NEIGHBORHOOD']),
      ]);
      expect(body.nodes[4]?.parentId).toBe(id(ORDER));
      for (const node of body.nodes.slice(5)) {
        expect(node.parentId).toBe(id(SHIPMENT));
      }
      expect(body.edges).toHaveLength(21);
    });
  });

  describe('N7: Order #18492, upstream', () => {
    it('has 9 nodes and 9 edges and equals /dependencies upstream depth 2', async () => {
      const body = await neighborhoodOf(ORDER, '?direction=upstream');
      expect(body.nodes).toHaveLength(9);
      expect(body.edges).toHaveLength(9);
      expect(names(body, 1)).toEqual(
        ['Acme Corp', 'Contract CON-3982', PAYMENT, 'East Distribution Center 02', PRODUCT].sort(),
      );
      expect(names(body, 2)).toEqual([APPROVAL, 'Northwind Steel', SUPPLIER_CONTOSO].sort());

      const dependencies = await dependenciesOf(ORDER, '?direction=upstream&depth=2');
      expect(
        body.nodes
          .filter((n) => n.id !== id(ORDER))
          .map((n) => [n.id, n.distance])
          .sort(),
      ).toEqual(dependencies.items.map((item) => [item.entity.id, item.distance]).sort());
    });
  });

  describe('N8: expansion', () => {
    const base = '?direction=upstream&depth=1';

    it('has 6 nodes without expansion', async () => {
      expect((await neighborhoodOf(ORDER, base)).nodes).toHaveLength(6);
    });

    it('adds the expanded neighbors after the base, in request order', async () => {
      const body = await neighborhoodOf(ORDER, `${base}&expand=${id(PRODUCT)},${id(PAYMENT)}`);
      expect(body.nodes).toHaveLength(9);
      expect(body.nodes.slice(6).map((n) => n.displayName)).toEqual([
        'Northwind Steel',
        SUPPLIER_CONTOSO,
        APPROVAL,
      ]);
      expect(body.nodes.slice(6).map((n) => [n.reasons, n.parentId])).toEqual([
        [['EXPANSION'], id(PRODUCT)],
        [['EXPANSION'], id(PRODUCT)],
        [['EXPANSION'], id(PAYMENT)],
      ]);
      for (const expandedName of [PRODUCT, PAYMENT]) {
        expect(body.nodes.find((n) => n.id === id(expandedName))?.expanded).toBe(true);
      }
      expect(body.ignoredExpansions).toEqual([]);
    });

    it('ignores an unknown expansion id', async () => {
      const unknown = randomUUID();
      const body = await neighborhoodOf(ORDER, `${base}&expand=${unknown}`);
      expect(body.nodes).toHaveLength(6);
      expect(body.ignoredExpansions).toEqual([unknown]);
    });

    it('answers 400 when expand contains the focus', async () => {
      const response = await request(server)
        .get(`/api/entities/${id(ORDER)}/neighborhood?expand=${id(ORDER)}`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.details?.[0]?.path).toBe('expand');
    });
  });
});
