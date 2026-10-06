import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  BlockersResponseSchema,
  type BlockersResponse,
  type EntityType,
} from '@opsgraph/shared';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, entityIdByKey, login, resetDb, TEST_PASSWORD } from './helpers';

// Acceptance fixtures F1-F4 and the blocker half of F10 (contracts/api.md), asserted literally
// against the seeded §39 scenario.
describe('Dependency tracing on the seeded §39 scenario: blockers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;

  const ids = {} as Record<'shp' | 'order' | 'pay' | 'apr' | 'br' | 'sla' | 'wh', string>;

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
});

function emptyPath(): BlockersResponse['paths'][number] {
  throw new Error('expected a path in the response');
}
