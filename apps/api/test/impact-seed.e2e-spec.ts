import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ImpactResponseSchema, type ImpactResponse } from '@opsgraph/shared';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

// Acceptance fixtures I1 to I14 (contracts/api.md), asserted literally against the seeded §39 and
// §40 scenarios, plus determinism (I5, SC-006).
describe('Impact analysis on the seeded §39 and §40 scenarios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;

  const ids = new Map<string, string>();

  async function idByName(displayName: string): Promise<string> {
    const cached = ids.get(displayName);
    if (cached !== undefined) {
      return cached;
    }
    const matches = await prisma.entity.findMany({ where: { displayName }, select: { id: true } });
    const [only] = matches;
    if (matches.length !== 1 || only === undefined) {
      throw new Error(`Expected exactly one entity named "${displayName}", found ${matches.length}`);
    }
    ids.set(displayName, only.id);
    return only.id;
  }

  async function getSummary(displayName: string, depth?: number): Promise<ImpactResponse> {
    const id = await idByName(displayName);
    const response = await request(server)
      .get(`/api/entities/${id}/impact${depth === undefined ? '' : `?depth=${depth}`}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return ImpactResponseSchema.parse(response.body);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const manager = await createUser(prisma, { role: 'OPS_MANAGER' });
    token = (await login(app, manager.email, TEST_PASSWORD)).accessToken;

    const seed = app.get(SeedService);
    expect((await seed.seedScenario39())?.outcome).toBe('APPLIED');
    expect((await seed.seedScenario40())?.outcome).toBe('APPLIED');
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  describe('I1. Fabrikam Components (SUP-400, SUSPENDED): summary', () => {
    let body: ImpactResponse;

    beforeAll(async () => {
      body = await getSummary('Fabrikam Components');
    });

    it('describes the start and the limits', async () => {
      expect(body.query).toEqual({ entityId: await idByName('Fabrikam Components'), depth: 6 });
      expect(body.start.displayName).toBe('Fabrikam Components');
      expect(body.start.currentState).toBe('SUSPENDED');
      expect(body.startClass).toBe('IMPAIRED');
      expect(body.countedTotal).toBe(31);
      expect(body.startOwnValue).toBeNull();
      expect(body.limits).toEqual({ depthLimit: false, explorationLimit: false, lowerBound: false });
      expect(Number.isNaN(Date.parse(body.computedAt))).toBe(false);
    });

    it('returns the category table and no other category', () => {
      const row = (
        type: string,
        label: string,
        counts: [number, number, number, number, number, number, number],
      ) => {
        const [total, direct, indirect, current, potential, inferredOnly, stateUnknown] = counts;
        return {
          type,
          label,
          headline: true,
          total,
          direct,
          indirect,
          current,
          potential,
          inferredOnly,
          stateUnknown,
        };
      };
      expect(body.categories).toEqual([
        row('Product', 'Products', [4, 4, 0, 0, 4, 1, 0]),
        row('PurchaseOrder', 'Purchase orders', [5, 5, 0, 3, 2, 0, 0]),
        row('Order', 'Customer orders', [12, 0, 12, 6, 6, 1, 0]),
        row('Customer', 'Customers', [4, 0, 4, 3, 1, 0, 0]),
        row('Shipment', 'Shipments', [3, 0, 3, 2, 1, 0, 0]),
        row('SLA', 'SLA commitments', [3, 0, 3, 2, 1, 1, 0]),
      ]);
    });

    it('returns the USD exposure and nothing else', () => {
      expect(body.exposure).toEqual({
        byCurrency: [
          {
            currency: 'USD',
            total: { amount: '84000.00', orderCount: 12 },
            current: { amount: '51250.00', orderCount: 6 },
            potential: { amount: '32750.00', orderCount: 6 },
            inferredOnly: {
              total: { amount: '2400.00', orderCount: 1 },
              current: { amount: '0.00', orderCount: 0 },
              potential: { amount: '2400.00', orderCount: 1 },
            },
            disagreementOrderCount: 0,
            range: null,
          },
        ],
        valueUnknownCount: 0,
      });
    });

    it('counts what is left out', () => {
      expect(body.notCounted).toEqual({
        total: 2,
        byType: [
          { type: 'Order', count: 1 },
          { type: 'PurchaseOrder', count: 1 },
        ],
      });
    });

    it('writes the exact summary text', () => {
      expect(body.summary).toEqual([
        'Fabrikam Components is SUSPENDED.',
        'Currently affected: 3 purchase orders, 6 customer orders, 3 customers, 2 shipments, 2 SLA commitments. 51,250.00 USD exposed.',
        'Potentially affected if it continues: 4 products, 2 purchase orders, 6 customer orders, 1 customer, 1 shipment, 1 SLA commitment. 32,750.00 USD more exposed.',
        'Total exposure: 84,000.00 USD across 12 customer orders.',
        '3 of the affected entities are reached only through inferred or manual links, including 2,400.00 USD of exposure.',
        'Not counted: 2 completed or cancelled entities.',
      ]);
    });
  });

  describe('I5. determinism (summary)', () => {
    it('returns identical responses for 100 consecutive calls, apart from computedAt', async () => {
      const strip = (response: ImpactResponse): Omit<ImpactResponse, 'computedAt'> => {
        const { computedAt, ...rest } = response;
        void computedAt;
        return rest;
      };
      const first = strip(await getSummary('Fabrikam Components'));
      for (let call = 1; call < 100; call += 1) {
        expect(strip(await getSummary('Fabrikam Components'))).toEqual(first);
      }
    }, 120_000);
  });
});
