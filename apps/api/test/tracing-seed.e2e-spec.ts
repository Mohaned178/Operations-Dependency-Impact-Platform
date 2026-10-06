import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  BlockersResponseSchema,
  DependenciesResponseSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  type BlockersResponse,
  type DependenciesResponse,
  type EntityType,
} from '@opsgraph/shared';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, entityIdByKey, login, resetDb, TEST_PASSWORD } from './helpers';

// Acceptance fixtures F1-F10 (contracts/api.md), asserted literally against the seeded §39
// scenario, plus SC-005 determinism and SC-006 provenance.
describe('Dependency tracing on the seeded §39 scenario: blockers (e2e)', () => {
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
    | 'wh'
    | 'inv'
    | 'acme'
    | 'contract'
    | 'product'
    | 'northwind'
    | 'contoso'
    | 'sla4107'
    | 'sla4215'
    | 'sla4330'
    | 'ctrl18530'
    | 'ctrl18531'
    | 'ctrl18532',
    string
  >;
  const orderIds: string[] = [];
  const otherOrderSourceIds = [
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

    const key = (type: EntityType, system: string, sourceId: string) =>
      entityIdByKey(prisma, type, system, sourceId);
    ids.shp = await key('Shipment', 'TMS', 'SHP-77120');
    ids.order = await key('Order', 'OMS', '18492');
    ids.pay = await key('Payment', 'Payments', 'PAY-88213');
    ids.apr = await key('Approval', 'FinanceApprovals', 'APR-2291');
    ids.br = await key('BudgetRequirement', 'FinanceApprovals', 'BR-18492');
    ids.sla = await key('SLA', 'ContractMgmt', 'SLA-3982-DEL');
    ids.wh = await key('Warehouse', 'WMS', 'WH-EAST-02');
    ids.inv = await key('Invoice', 'ERP', 'INV-55120');
    ids.acme = await key('Customer', 'CRM', 'CUST-1001');
    ids.contract = await key('Contract', 'ContractMgmt', 'CON-3982');
    ids.product = await key('Product', 'PIM', 'PRD-5521');
    ids.northwind = await key('Supplier', 'PIM', 'SUP-310');
    ids.contoso = await key('Supplier', 'PIM', 'SUP-322');
    ids.sla4107 = await key('SLA', 'ContractMgmt', 'SLA-4107-DEL');
    ids.sla4215 = await key('SLA', 'ContractMgmt', 'SLA-4215-DEL');
    ids.sla4330 = await key('SLA', 'ContractMgmt', 'SLA-4330-DEL');
    ids.ctrl18530 = await key('Order', 'OMS', '18530');
    ids.ctrl18531 = await key('Order', 'OMS', '18531');
    ids.ctrl18532 = await key('Order', 'OMS', '18532');
    orderIds.length = 0;
    for (const sourceId of otherOrderSourceIds) {
      orderIds.push(await key('Order', 'OMS', sourceId));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function blockersOf(id: string, query = ''): Promise<BlockersResponse> {
    const response = await request(server)
      .get(`/api/entities/${id}/blockers${query}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return BlockersResponseSchema.parse(response.body);
  }

  async function dependenciesOf(id: string, query = ''): Promise<DependenciesResponse> {
    const response = await request(server)
      .get(`/api/entities/${id}/dependencies${query}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return DependenciesResponseSchema.parse(response.body);
  }

  function dependencyById(body: DependenciesResponse, id: string) {
    const item = body.items.find((row) => row.entity.id === id);
    expect(item).toBeDefined();
    if (item === undefined) {
      throw new Error(`expected entity ${id} in dependencies response`);
    }
    return item;
  }

  function entityIdsOf(path: BlockersResponse['paths'][number]): string[] {
    return path.hops.map((hop) => hop.entity.id);
  }

  describe('F1: blockers of Shipment SHP-77120', () => {
    let body: BlockersResponse;

    beforeAll(async () => {
      body = await blockersOf(ids.shp);
    });

    it('returns two paths and no truncation', () => {
      expect(body.query).toMatchObject({
        entityId: ids.shp,
        kind: 'blockers',
        depth: 6,
        relationshipTypes: ['REQUIRES', 'DEPENDS_ON', 'BLOCKS'],
        entityTypes: [],
      });
      expect(body.paths).toHaveLength(2);
      expect(body.totalPaths).toBe(2);
      expect(body.truncation).toEqual({
        depthLimit: false,
        explorationLimit: false,
        pathLimit: false,
      });
      expect(body.cycleClosingHopCount).toBe(0);
      expect(body.cycleClosingHops).toEqual([]);
    });

    it('paths[0]: DEPENDS_ON, then three REQUIRES, all SOURCE / HIGH', () => {
      const path = body.paths[0];
      expect(path).toBeDefined();
      if (path === undefined) {
        return;
      }
      expect(entityIdsOf(path)).toEqual([ids.order, ids.pay, ids.apr, ids.br]);
      expect(path.hops.map((hop) => [hop.relationshipType, hop.traversal])).toEqual([
        ['DEPENDS_ON', 'FORWARD'],
        ['REQUIRES', 'FORWARD'],
        ['REQUIRES', 'FORWARD'],
        ['REQUIRES', 'FORWARD'],
      ]);
      expect(path).toMatchObject({
        length: 4,
        weakestConfidence: 'HIGH',
        nonSourceHops: 0,
        continuesBeyondDepth: false,
        endsInCycle: false,
      });
      expect(path.explanation).toEqual([
        'Shipment SHP-77120 (consolidated) is delayed because it depends on Order #18492, which is BLOCKED.',
        'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
        'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
        'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
      ]);
    });

    it('paths[1]: the MANUAL / MEDIUM BLOCKS shortcut', () => {
      const path = body.paths[1];
      expect(path).toBeDefined();
      if (path === undefined) {
        return;
      }
      expect(entityIdsOf(path)).toEqual([ids.pay, ids.apr, ids.br]);
      expect(path).toMatchObject({ length: 3, weakestConfidence: 'MEDIUM', nonSourceHops: 1 });
      expect(path.hops[0]).toMatchObject({
        relationshipType: 'BLOCKS',
        traversal: 'REVERSE',
        fromEntityId: ids.pay,
        toEntityId: ids.shp,
        effectiveOrigin: 'MANUAL',
        effectiveConfidence: 'MEDIUM',
      });
      expect(path.explanation[0]).toBe(
        'Shipment SHP-77120 (consolidated) is delayed because Payment PAY-88213, which is PENDING, blocks it (manually recorded, medium confidence: "Recorded by ops analyst: carrier will not book the consolidated load until payment clears").',
      );
    });

    it('lists the direct and deepest blockers', () => {
      expect(body.directBlockers.map((b) => [b.entity.id, b.pathLength])).toEqual([
        [ids.order, 1],
        [ids.pay, 1],
      ]);
      expect(body.deepestBlockers).toHaveLength(1);
      expect(body.deepestBlockers[0]).toMatchObject({
        pathLength: 4,
        possible: false,
        continuesBeyondDepth: false,
        inCycle: false,
      });
      expect(body.deepestBlockers[0]?.entity.id).toBe(ids.br);
    });

    it('has the exact summary', () => {
      expect(body.summary).toBe(
        'Shipment SHP-77120 (consolidated) is DELAYED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 4 steps away.',
      );
    });

    it('carries state evidence on the Order #18492 hop, including the disagreement', () => {
      const entity = body.paths[0]?.hops[0]?.entity;
      expect(entity?.id).toBe(ids.order);
      expect(entity?.state.observation?.sourceSystem).toBe('OMS');
      expect(entity?.state.latestBySource.map((o) => [o.sourceSystem, o.state])).toEqual([
        ['ERP', 'PENDING'],
        ['OMS', 'BLOCKED'],
      ]);
    });
  });

  describe('F2: blockers of Order #18492', () => {
    it('returns the single chain to the missing budget code', async () => {
      const body = await blockersOf(ids.order);
      expect(body.paths).toHaveLength(1);
      expect(entityIdsOf(body.paths[0] ?? emptyPath())).toEqual([ids.pay, ids.apr, ids.br]);
      expect(body.paths[0]?.explanation[0]).toBe(
        'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
      );
      expect(body.directBlockers.map((b) => b.entity.id)).toEqual([ids.pay]);
      expect(body.deepestBlockers.map((b) => [b.entity.id, b.pathLength])).toEqual([[ids.br, 3]]);
      expect(body.summary).toBe(
        'Order #18492 is BLOCKED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 3 steps away.',
      );
    });
  });

  describe('F3: blockers of Acme Corp delivery SLA', () => {
    it('ranks the 5-hop path with one inferred hop above the 4-hop path with two non-SOURCE hops', async () => {
      const body = await blockersOf(ids.sla);
      expect(body.paths).toHaveLength(2);

      const [first, second] = body.paths;
      expect(entityIdsOf(first ?? emptyPath())).toEqual([ids.shp, ids.order, ids.pay, ids.apr, ids.br]);
      expect(first).toMatchObject({ length: 5, weakestConfidence: 'MEDIUM', nonSourceHops: 1 });
      expect(first?.hops[0]).toMatchObject({
        relationshipType: 'DEPENDS_ON',
        effectiveOrigin: 'INFERRED',
        effectiveConfidence: 'MEDIUM',
      });

      expect(entityIdsOf(second ?? emptyPath())).toEqual([ids.shp, ids.pay, ids.apr, ids.br]);
      expect(second).toMatchObject({ length: 4, weakestConfidence: 'MEDIUM', nonSourceHops: 2 });
      expect(second?.hops[1]).toMatchObject({ relationshipType: 'BLOCKS', traversal: 'REVERSE' });

      expect(first?.explanation[0]).toBe(
        'Acme Corp delivery SLA is at risk because it depends on Shipment SHP-77120 (consolidated) (inferred, medium confidence: "SLA measures on-time delivery of the customer\'s orders on this shipment"), which is DELAYED.',
      );
      expect(body.summary).toBe(
        'Acme Corp delivery SLA is AT_RISK. 1 deepest blocker: Budget code for Order #18492 (MISSING), 5 steps away.',
      );
    });
  });

  describe('F4: blockers of Warehouse WH-EAST-02', () => {
    it('finds no blockers', async () => {
      const body = await blockersOf(ids.wh);
      expect(body.paths).toEqual([]);
      expect(body.directBlockers).toEqual([]);
      expect(body.deepestBlockers).toEqual([]);
      expect(body.totalPaths).toBe(0);
      expect(body.summary).toBe('East Distribution Center 02 is ACTIVE. No blockers found within 6 steps.');
    });
  });

  describe('F10: depth', () => {
    it('cuts the SLA trace at depth=3', async () => {
      const body = await blockersOf(ids.sla, '?depth=3');
      expect(body.query.depth).toBe(3);
      expect(body.paths).toHaveLength(2);
      expect(body.truncation.depthLimit).toBe(true);

      const [first, second] = body.paths;
      expect(entityIdsOf(first ?? emptyPath())).toEqual([ids.shp, ids.order, ids.pay]);
      expect(first).toMatchObject({
        length: 3,
        continuesBeyondDepth: true,
        weakestConfidence: 'MEDIUM',
        nonSourceHops: 1,
      });
      expect(entityIdsOf(second ?? emptyPath())).toEqual([ids.shp, ids.pay, ids.apr]);
      expect(second).toMatchObject({
        length: 3,
        continuesBeyondDepth: true,
        weakestConfidence: 'MEDIUM',
        nonSourceHops: 2,
      });

      expect(body.directBlockers).toHaveLength(1);
      expect(body.directBlockers[0]).toMatchObject({
        pathLength: 1,
        continuesBeyondDepth: false,
        inCycle: false,
      });
      expect(body.directBlockers[0]?.entity.id).toBe(ids.shp);

      expect(body.deepestBlockers.map((b) => [b.entity.id, b.pathLength, b.continuesBeyondDepth])).toEqual([
        [ids.pay, 3, true],
        [ids.apr, 3, true],
      ]);
      expect(body.summary).toBe(
        'Acme Corp delivery SLA is AT_RISK. 2 deepest blockers found within 3 steps; highest ranked: Payment PAY-88213 (PENDING), 3 steps away; the chain continues beyond the depth limit.',
      );
    });

    it('accepts depth=10 on SHP-77120 and matches F1 apart from the echoed depth', async () => {
      const [shallow, deep] = [await blockersOf(ids.shp), await blockersOf(ids.shp, '?depth=10')];
      expect(deep.query.depth).toBe(10);
      expect(deep.paths).toHaveLength(2);
      expect(deep.paths.map(entityIdsOf)).toEqual(shallow.paths.map(entityIdsOf));
      expect(deep.paths.map((p) => p.explanation)).toEqual(shallow.paths.map((p) => p.explanation));
      expect(deep.truncation).toEqual(shallow.truncation);
      expect(deep.summary).toBe(shallow.summary);
    });
  });

  describe('F5: downstream of BR-18492 (default depth, no filters)', () => {
    let body: DependenciesResponse;

    beforeAll(async () => {
      body = await dependenciesOf(ids.br, '?direction=downstream&limit=200');
    });

    it('reaches 25 entities and no depth limit', () => {
      expect(body.query).toMatchObject({
        entityId: ids.br,
        kind: 'downstream',
        depth: 6,
        relationshipTypes: [...TRACEABLE_RELATIONSHIP_TYPES],
        entityTypes: [],
      });
      expect(body.totalReached).toBe(25);
      expect(body.truncation).toEqual({
        depthLimit: false,
        explorationLimit: false,
        pathLimit: false,
      });
      expect(body.nextCursor).toBeNull();
    });

    it('has the expected distances', () => {
      expect(dependencyById(body, ids.apr).distance).toBe(1);
      expect(dependencyById(body, ids.pay).distance).toBe(2);
      expect(dependencyById(body, ids.order).distance).toBe(3);
      expect(dependencyById(body, ids.shp).distance).toBe(3);
      expect(dependencyById(body, ids.inv).distance).toBe(4);
      for (const id of orderIds) {
        expect(dependencyById(body, id).distance).toBe(4);
      }
      for (const id of [ids.sla, ids.sla4107, ids.sla4215, ids.sla4330]) {
        expect(dependencyById(body, id).distance).toBe(4);
      }
    });

    it('does not reach the control orders', () => {
      const reached = new Set(body.items.map((item) => item.entity.id));
      expect(reached.has(ids.ctrl18530)).toBe(false);
      expect(reached.has(ids.ctrl18531)).toBe(false);
      expect(reached.has(ids.ctrl18532)).toBe(false);
    });

    it('prefers the 4-hop SOURCE/HIGH canonical path for SHP-77120', () => {
      const shp = dependencyById(body, ids.shp);
      expect(shp.path.length).toBe(4);
      expect(shp.path.weakestConfidence).toBe('HIGH');
      expect(shp.path.nonSourceHops).toBe(0);
      expect(shp.path.hops.map((hop) => hop.entity.id)).toEqual([
        ids.apr,
        ids.pay,
        ids.order,
        ids.shp,
      ]);
      for (const hop of shp.path.hops) {
        expect(hop.effectiveOrigin).toBe('SOURCE');
        expect(hop.effectiveConfidence).toBe('HIGH');
      }
    });
  });

  describe('F6: downstream of BR-18492 with relationshipTypes=REQUIRES,DEPENDS_ON', () => {
    it('drops INV-55120 and pushes SHP-77120 to distance 4', async () => {
      const body = await dependenciesOf(
        ids.br,
        '?direction=downstream&relationshipTypes=REQUIRES,DEPENDS_ON&limit=200',
      );
      expect(body.query.relationshipTypes).toEqual(['REQUIRES', 'DEPENDS_ON']);
      expect(body.totalReached).toBe(24);
      expect(body.items.some((item) => item.entity.id === ids.inv)).toBe(false);
      expect(dependencyById(body, ids.shp).distance).toBe(4);
    });
  });

  describe('F7: downstream of BR-18492 with entityTypes=Order', () => {
    it('returns only the 17 orders and keeps intermediates on the path', async () => {
      const body = await dependenciesOf(
        ids.br,
        '?direction=downstream&entityTypes=Order&limit=200',
      );
      expect(body.totalReached).toBe(17);
      for (const item of body.items) {
        expect(item.entity.type).toBe('Order');
      }
      const target = orderIds[0];
      if (target === undefined) {
        throw new Error('expected an affected order id');
      }
      const order = dependencyById(body, target);
      expect(order.path.length).toBe(5);
      expect(order.path.hops.map((hop) => hop.entity.id)).toEqual([
        ids.apr,
        ids.pay,
        ids.order,
        ids.shp,
        target,
      ]);
    });
  });

  describe('F8: upstream of Order #18492 (default depth)', () => {
    it('reaches 9 entities with Contoso Metals weakest LOW', async () => {
      const body = await dependenciesOf(ids.order, '?direction=upstream&limit=200');
      expect(body.query).toMatchObject({
        entityId: ids.order,
        kind: 'upstream',
        depth: 6,
        entityTypes: [],
      });
      expect(body.totalReached).toBe(9);
      const byId = new Map(body.items.map((item) => [item.entity.id, item]));
      expect(byId.get(ids.acme)?.distance).toBe(1);
      expect(byId.get(ids.contract)?.distance).toBe(1);
      expect(byId.get(ids.product)?.distance).toBe(1);
      expect(byId.get(ids.pay)?.distance).toBe(1);
      expect(byId.get(ids.wh)?.distance).toBe(1);
      expect(byId.get(ids.apr)?.distance).toBe(2);
      expect(byId.get(ids.northwind)?.distance).toBe(2);
      expect(byId.get(ids.contoso)?.distance).toBe(2);
      expect(byId.get(ids.br)?.distance).toBe(3);

      const contoso = dependencyById(body, ids.contoso);
      const lastHop = contoso.path.hops.at(-1);
      expect(lastHop?.relationshipType).toBe('SUPPLIED_BY');
      expect(lastHop?.effectiveOrigin).toBe('INFERRED');
      expect(lastHop?.effectiveConfidence).toBe('LOW');
      expect(contoso.path.weakestConfidence).toBe('LOW');
    });
  });

  describe('F9: upstream of Shipment SHP-77120 (default depth)', () => {
    it('reaches 10 entities with PAY distance 1 but a 2-hop path', async () => {
      const body = await dependenciesOf(ids.shp, '?direction=upstream&limit=200');
      expect(body.totalReached).toBe(10);
      const pay = dependencyById(body, ids.pay);
      expect(pay.distance).toBe(1);
      expect(pay.path.length).toBe(2);
      expect(pay.path.hops.map((hop) => hop.entity.id)).toEqual([ids.order, ids.pay]);
      for (const hop of pay.path.hops) {
        expect(hop.effectiveOrigin).toBe('SOURCE');
        expect(hop.effectiveConfidence).toBe('HIGH');
      }
      const br = dependencyById(body, ids.br);
      expect(br.distance).toBe(3);
      expect(br.path.length).toBe(4);
    });
  });

  describe('F10: depth (dependencies half)', () => {
    it('cuts downstream of BR-18492 at depth=2', async () => {
      const body = await dependenciesOf(ids.br, '?direction=downstream&depth=2&limit=200');
      expect(body.query.depth).toBe(2);
      expect(body.totalReached).toBe(2);
      expect(body.truncation.depthLimit).toBe(true);
      expect(dependencyById(body, ids.apr).distance).toBe(1);
      expect(dependencyById(body, ids.pay).distance).toBe(2);
    });
  });

  describe('SC-005: determinism', () => {
    it('returns identical bodies across 100 runs once computedAt is removed', async () => {
      const calls = [
        () => blockersOf(ids.shp),
        () => blockersOf(ids.order),
        () => dependenciesOf(ids.br, '?direction=downstream&limit=200'),
        () => dependenciesOf(ids.order, '?direction=upstream&limit=200'),
      ];
      for (const call of calls) {
        const first = await call();
        const { computedAt, ...rest } = first;
        void computedAt;
        const baseline = JSON.stringify(rest);
        for (let i = 1; i < 100; i += 1) {
          const next = await call();
          const { computedAt: nextComputedAt, ...nextRest } = next;
          void nextComputedAt;
          expect(JSON.stringify(nextRest)).toBe(baseline);
        }
      }
    }, 120_000);
  });

  describe('SC-006: provenance', () => {
    it('carries source evidence on every hop of every entity', async () => {
      const entities = await prisma.entity.findMany({ select: { id: true } });
      expect(entities.length).toBeGreaterThan(0);
      for (const { id } of entities) {
        const blockers = await blockersOf(id);
        for (const path of blockers.paths) {
          for (const hop of path.hops) {
            expect(hop.effectiveOrigin).toBeDefined();
            expect(hop.effectiveConfidence).toBeDefined();
            expect(hop.assertions.length).toBeGreaterThan(0);
            for (const assertion of hop.assertions) {
              expect(assertion.sourceSystem.length).toBeGreaterThan(0);
              expect(assertion.sourceId.length).toBeGreaterThan(0);
              expect(assertion.observedAt.length).toBeGreaterThan(0);
            }
            if (hop.entity.state.observation !== null) {
              expect(hop.entity.state.observation.sourceSystem.length).toBeGreaterThan(0);
            }
            if (hop.effectiveOrigin !== 'SOURCE') {
              const sentence = path.explanation[path.hops.indexOf(hop)];
              expect(sentence).toMatch(/inferred,|manually recorded,/);
            }
          }
        }
        const upstream = await dependenciesOf(id, '?direction=upstream&limit=200');
        for (const item of upstream.items) {
          for (const hop of item.path.hops) {
            expect(hop.effectiveOrigin).toBeDefined();
            expect(hop.effectiveConfidence).toBeDefined();
            expect(hop.assertions.length).toBeGreaterThan(0);
            for (const assertion of hop.assertions) {
              expect(assertion.sourceSystem.length).toBeGreaterThan(0);
              expect(assertion.sourceId.length).toBeGreaterThan(0);
              expect(assertion.observedAt.length).toBeGreaterThan(0);
            }
            if (hop.entity.state.observation !== null) {
              expect(hop.entity.state.observation.sourceSystem.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }, 120_000);
  });
});

function emptyPath(): BlockersResponse['paths'][number] {
  throw new Error('expected a path in the response');
}
