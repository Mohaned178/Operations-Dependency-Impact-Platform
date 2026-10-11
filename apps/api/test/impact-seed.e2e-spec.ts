import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  CONFIDENCE_RANK,
  ImpactItemDetailResponseSchema,
  ImpactListResponseSchema,
  ImpactResponseSchema,
  type AffectedEntityDto,
  type ImpactItemDetailResponse,
  type ImpactListResponse,
  type ImpactResponse,
} from '@opsgraph/shared';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { parseAmount } from '../src/impact/analysis/money';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

function sumOf(items: readonly AffectedEntityDto[]): bigint {
  return items.reduce((total, item) => {
    const amount = item.value?.current?.amount;
    if (amount === undefined) {
      throw new Error(`${item.entity.displayName} has no current value`);
    }
    return total + parseAmount(amount);
  }, 0n);
}

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

  // -------------------------------------------------------------------------------------------
  // Drill-down: lists and item detail
  // -------------------------------------------------------------------------------------------

  async function getList(
    startName: string,
    query: Record<string, string | number>,
  ): Promise<ImpactListResponse> {
    const id = await idByName(startName);
    const params = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    );
    const response = await request(server)
      .get(`/api/entities/${id}/impact/items?${params.toString()}`)
      .set('Authorization', `Bearer ${token}`);
    expect([startName, query, response.status]).toEqual([startName, query, 200]);
    return ImpactListResponseSchema.parse(response.body);
  }

  async function getItemStatus(startName: string, targetName: string): Promise<number> {
    const [startId, targetId] = [await idByName(startName), await idByName(targetName)];
    const response = await request(server)
      .get(`/api/entities/${startId}/impact/items/${targetId}`)
      .set('Authorization', `Bearer ${token}`);
    return response.status;
  }

  async function getItem(startName: string, targetName: string): Promise<ImpactItemDetailResponse> {
    const [startId, targetId] = [await idByName(startName), await idByName(targetName)];
    const response = await request(server)
      .get(`/api/entities/${startId}/impact/items/${targetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return ImpactItemDetailResponseSchema.parse(response.body);
  }

  /** Follows nextCursor until the list ends. */
  async function getAll(
    startName: string,
    query: Record<string, string | number>,
    limit: number,
  ): Promise<{ total: number; sum: ImpactListResponse['sum']; items: AffectedEntityDto[] }> {
    const items: AffectedEntityDto[] = [];
    let cursor: string | null = null;
    let first: ImpactListResponse | null = null;
    do {
      const page: ImpactListResponse = await getList(startName, {
        ...query,
        limit,
        ...(cursor === null ? {} : { cursor }),
      });
      first ??= page;
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    if (first === null) {
      throw new Error('a list always has a first page');
    }
    return { total: first.total, sum: first.sum, items };
  }

  const FAB = 'Fabrikam Components';
  const orderNames = (items: readonly AffectedEntityDto[]): string[] =>
    items.map((item) => item.entity.displayName);

  describe('I2. Fabrikam: customer-order lists', () => {
    it('lists the current orders by value, each through a delayed purchase order', async () => {
      const list = await getList(FAB, { list: 'category', type: 'Order', bucket: 'current' });
      expect(list.total).toBe(6);
      expect(list.sum).toBeNull();
      expect(list.nextCursor).toBeNull();
      expect(orderNames(list.items)).toEqual([
        'Order SO-20402',
        'Order SO-20404',
        'Order SO-20401',
        'Order SO-20403',
        'Order SO-20405',
        'Order SO-20406',
      ]);
      expect(list.items.map((item) => item.value?.current?.amount)).toEqual([
        '12400.00',
        '10600.00',
        '9800.00',
        '7250.00',
        '5900.00',
        '5300.00',
      ]);

      for (const item of list.items) {
        expect(item.classification).toBe('CURRENT');
        expect(item.directness).toBe('INDIRECT');
        expect(item.distance).toBe(2);
        const hops = item.primaryPath?.hops ?? [];
        expect(hops).toHaveLength(2);
        expect(hops[0]?.entity.type).toBe('PurchaseOrder');
        expect(hops[0]?.entity.currentState).toBe('DELAYED');
        expect(hops[1]?.entity.id).toBe(item.entity.id);
        expect(item.morePaths).toBe(false);
      }

      const byName = new Map(list.items.map((item) => [item.entity.displayName, item]));
      expect(byName.get('Order SO-20401')?.pathCount).toBe(3);
      expect(byName.get('Order SO-20402')?.pathCount).toBe(5);
      expect(byName.get('Order SO-20404')?.pathCount).toBe(6);
      expect(byName.get('Order SO-20401')?.shortestPath).toBeNull();
    });

    it('lists the potential orders, with the other-cause and inferred-only flags', async () => {
      const list = await getList(FAB, { list: 'category', type: 'Order', bucket: 'potential' });
      expect(list.total).toBe(6);
      expect(orderNames(list.items)).toEqual([
        'Order SO-20409',
        'Order SO-20407',
        'Order SO-20412',
        'Order SO-20410',
        'Order SO-20408',
        'Order SO-20411',
      ]);
      expect(list.items.every((item) => item.classification === 'POTENTIAL')).toBe(true);

      const byName = new Map(list.items.map((item) => [item.entity.displayName, item]));
      const impaired = byName.get('Order SO-20408');
      expect(impaired?.flags.otherCause).toBe(true);
      expect(impaired?.pathCount).toBe(3);

      const inferred = byName.get('Order SO-20411');
      expect(inferred?.flags.inferredOnly).toBe(true);
      expect(inferred?.weakest).toEqual({ origin: 'INFERRED', confidence: 'LOW' });
      expect(inferred?.pathCount).toBe(1);
      expect(inferred?.primaryPath?.hops[0]?.effectiveOrigin).toBe('INFERRED');
      expect(inferred?.primaryPath?.hops[0]?.effectiveConfidence).toBe('LOW');
    });

    it('adds the current exposure list up to its figure', async () => {
      const list = await getList(FAB, { list: 'exposure', currency: 'USD', bucket: 'current' });
      expect(orderNames(list.items)).toEqual([
        'Order SO-20402',
        'Order SO-20404',
        'Order SO-20401',
        'Order SO-20403',
        'Order SO-20405',
        'Order SO-20406',
      ]);
      expect(list.sum).toEqual({ amount: '51250.00', currency: 'USD' });
      expect(sumOf(list.items)).toBe(parseAmount('51250.00'));
    });

    it('lists the inferred-only exposure', async () => {
      const list = await getList(FAB, { list: 'exposure', currency: 'USD', bucket: 'inferredOnly' });
      expect(orderNames(list.items)).toEqual(['Order SO-20411']);
      expect(list.sum).toEqual({ amount: '2400.00', currency: 'USD' });
    });

    it('gives an empty list and a zero sum for a currency with no figure', async () => {
      const list = await getList(FAB, { list: 'exposure', currency: 'EUR', bucket: 'total' });
      expect(list.total).toBe(0);
      expect(list.items).toEqual([]);
      expect(list.sum).toEqual({ amount: '0.00', currency: 'EUR' });
    });
  });

  describe('I3. Fabrikam: customers, not counted, inferred', () => {
    it('lists the customers by exposure, attributed through orders and SLAs', async () => {
      const list = await getList(FAB, { list: 'category', type: 'Customer', bucket: 'total' });
      expect(list.total).toBe(4);
      expect(orderNames(list.items)).toEqual([
        'Blue Yonder Machinery',
        'Woodgrove Manufacturing',
        'Litware Industrial',
        'Proseware Systems',
      ]);
      expect(list.items.map((item) => item.classification)).toEqual([
        'CURRENT',
        'CURRENT',
        'CURRENT',
        'POTENTIAL',
      ]);
      expect(list.items.map((item) => item.attributionCount)).toEqual([4, 4, 3, 4]);
      for (const item of list.items) {
        expect(item.distance).toBeNull();
        expect(item.primaryPath).toBeNull();
        expect(item.directness).toBe('INDIRECT');
        expect(item.pathCount).toBe(0);
        for (const attribution of item.attributions) {
          const hops = attribution.link.hops.map((hop) => hop.relationshipType);
          expect(hops).toEqual(attribution.entity.type === 'SLA' ? ['DEFINES', 'HAS'] : ['PLACED']);
        }
      }
      expect(
        new Set(list.items[0]?.attributions.map((attribution) => attribution.entity.displayName)),
      ).toEqual(
        new Set([
          'Order SO-20401',
          'Order SO-20402',
          'Order SO-20407',
          'Blue Yonder Machinery delivery SLA',
        ]),
      );
    });

    it('lists the not-counted entities, nearest first', async () => {
      const list = await getList(FAB, { list: 'notCounted' });
      expect(list.total).toBe(2);
      expect(orderNames(list.items)).toEqual(['Purchase order PO-7006', 'Order SO-20413']);
      expect(list.items.map((item) => item.distance)).toEqual([1, 2]);
      for (const item of list.items) {
        expect(item.classification).toBe('NOT_COUNTED');
        expect(item.notCountedReason).toBe('TERMINAL');
        expect(item.entity.currentState).toBe('COMPLETED');
      }
    });

    it('lists the inferred-only SLA and product', async () => {
      const sla = await getList(FAB, { list: 'category', type: 'SLA', bucket: 'inferredOnly' });
      expect(orderNames(sla.items)).toEqual(['Woodgrove Manufacturing delivery SLA']);
      expect(sla.items[0]?.classification).toBe('CURRENT');
      expect(sla.items[0]?.weakest).toEqual({ origin: 'INFERRED', confidence: 'MEDIUM' });

      const product = await getList(FAB, { list: 'category', type: 'Product', bucket: 'inferredOnly' });
      expect(orderNames(product.items)).toEqual(['Pressure Sensor Module']);
      expect(product.items[0]?.classification).toBe('POTENTIAL');
    });
  });

  describe('I4. Fabrikam: detail and control entities', () => {
    it('shows all paths of SO-20404 and no attributions', async () => {
      const detail = await getItem(FAB, 'Order SO-20404');
      const fabrikamId = await idByName(FAB);
      expect(detail.item.pathCount).toBe(6);
      expect(detail.attributions).toEqual([]);
      expect(detail.attributionCount).toBe(0);
      expect(detail.alternativePaths).toHaveLength(5);
      for (const path of detail.alternativePaths) {
        const first = path.hops[0];
        expect(first?.fromEntityId === fabrikamId || first?.toEntityId === fabrikamId).toBe(true);
        expect(path.hops.at(-1)?.entity.id).toBe(detail.item.entity.id);
      }
      const ranks = detail.alternativePaths.map(
        (path): [number, number, number] => [
          -CONFIDENCE_RANK[path.weakestConfidence],
          path.nonSourceHops,
          path.length,
        ],
      );
      expect(ranks).toEqual(
        [...ranks].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
      );
    });

    it('shows every attribution of a customer with its own impact path and its link', async () => {
      const detail = await getItem(FAB, 'Blue Yonder Machinery');
      expect(detail.attributionCount).toBe(4);
      expect(detail.attributions).toHaveLength(4);
      for (const attribution of detail.attributions) {
        expect(attribution.primaryPath.hops.at(-1)?.entity.id).toBe(attribution.entity.id);
        expect(attribution.link.hops.length).toBe(attribution.entity.type === 'SLA' ? 2 : 1);
      }
    });

    it.each([
      'Tailspin Parts',
      'Rubber Seal Pack',
      'Purchase order PO-7010',
      'Order SO-20414',
      'Order SO-20415',
      'Shipment SHP-8009',
      'Adventure Works Supply delivery SLA',
      'Adventure Works Supply',
      'Contract CON-5001',
      'Fabrikam Components',
    ])('returns 404 for %s, which is not in the analysis', async (name) => {
      expect(await getItemStatus(FAB, name)).toBe(404);
    });
  });

  describe('I5. determinism (lists)', () => {
    it('returns identical I2 lists for 100 consecutive calls, apart from computedAt', async () => {
      const queries: Array<Record<string, string>> = [
        { list: 'category', type: 'Order', bucket: 'current' },
        { list: 'category', type: 'Order', bucket: 'potential' },
        { list: 'exposure', currency: 'USD', bucket: 'current' },
        { list: 'exposure', currency: 'USD', bucket: 'inferredOnly' },
      ];
      const strip = (list: ImpactListResponse): Omit<ImpactListResponse, 'computedAt'> => {
        const { computedAt, ...rest } = list;
        void computedAt;
        return rest;
      };
      for (const query of queries) {
        const first = strip(await getList(FAB, query));
        for (let call = 1; call < 100; call += 1) {
          expect(strip(await getList(FAB, query))).toEqual(first);
        }
      }
    }, 300_000);
  });

  // -------------------------------------------------------------------------------------------
  // List invariants (key design note 7)
  // -------------------------------------------------------------------------------------------

  describe('list invariants: every number opens a list of exactly that size', () => {
    const CATEGORY_BUCKETS = [
      'total',
      'direct',
      'indirect',
      'current',
      'potential',
      'inferredOnly',
      'stateUnknown',
    ] as const;
    const EXPOSURE_BUCKETS = ['total', 'current', 'potential', 'inferredOnly'] as const;

    it.each(['Fabrikam Components', 'Payment PAY-88213', 'East Distribution Center 02'])(
      '%s',
      async (startName) => {
        const startId = await idByName(startName);
        const summary = await getSummary(startName);
        let opened = 0;

        function expectWellFormed(items: readonly AffectedEntityDto[]): void {
          const seen = items.map((item) => item.entity.id);
          expect(new Set(seen).size).toBe(seen.length);
          for (const item of items) {
            if (item.entity.type === 'Customer') continue;
            const hops = item.primaryPath?.hops ?? [];
            const first = hops[0];
            expect(first).toBeDefined();
            expect(first?.fromEntityId === startId || first?.toEntityId === startId).toBe(true);
            expect(hops.at(-1)?.entity.id).toBe(item.entity.id);
          }
        }

        // Every non-zero category cell.
        for (const category of summary.categories) {
          const idsByBucket = new Map<string, Set<string>>();
          for (const bucket of CATEGORY_BUCKETS) {
            if (category[bucket] === 0) continue;
            const all = await getAll(
              startName,
              { list: 'category', type: category.type, bucket },
              7,
            );
            opened += 1;
            expect(all.total).toBe(category[bucket]);
            expect(all.items).toHaveLength(category[bucket]);
            expectWellFormed(all.items);
            idsByBucket.set(bucket, new Set(all.items.map((item) => item.entity.id)));
          }
          const ids = (bucket: string): Set<string> => idsByBucket.get(bucket) ?? new Set();
          const union = (a: Set<string>, b: Set<string>): Set<string> => new Set([...a, ...b]);
          expect(union(ids('current'), ids('potential'))).toEqual(ids('total'));
          expect(ids('current').size + ids('potential').size).toBe(ids('total').size);
          expect(union(ids('direct'), ids('indirect'))).toEqual(ids('total'));
          expect(ids('direct').size + ids('indirect').size).toBe(ids('total').size);
        }

        // Every exposure figure share.
        for (const figure of summary.exposure.byCurrency) {
          const shares = {
            total: figure.total,
            current: figure.current,
            potential: figure.potential,
            inferredOnly: figure.inferredOnly.total,
          };
          for (const bucket of EXPOSURE_BUCKETS) {
            const share = shares[bucket];
            if (share.orderCount === 0) continue;
            const all = await getAll(
              startName,
              { list: 'exposure', currency: figure.currency, bucket },
              7,
            );
            opened += 1;
            expect(all.total).toBe(share.orderCount);
            expect(all.items).toHaveLength(share.orderCount);
            expect(all.sum).toEqual({ amount: share.amount, currency: figure.currency });
            expect(sumOf(all.items)).toBe(parseAmount(share.amount));
            expectWellFormed(all.items);
          }
        }

        // Value-unknown and not-counted lists.
        const unknown = await getAll(startName, { list: 'valueUnknown' }, 7);
        expect(unknown.total).toBe(summary.exposure.valueUnknownCount);
        expect(unknown.items).toHaveLength(summary.exposure.valueUnknownCount);
        expectWellFormed(unknown.items);

        const notCounted = await getAll(startName, { list: 'notCounted' }, 7);
        expect(notCounted.total).toBe(summary.notCounted.total);
        expect(notCounted.items).toHaveLength(summary.notCounted.total);
        expectWellFormed(notCounted.items);
        for (const entry of summary.notCounted.byType) {
          const ofType = await getAll(startName, { list: 'notCounted', type: entry.type }, 7);
          expect(ofType.total).toBe(entry.count);
          expect(ofType.items).toHaveLength(entry.count);
        }

        expect(opened).toBeGreaterThan(0);
      },
      300_000,
    );
  });
});
