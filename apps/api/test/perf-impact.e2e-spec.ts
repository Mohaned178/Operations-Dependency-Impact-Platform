import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ImpactListResponseSchema, ImpactResponseSchema } from '@opsgraph/shared';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

const BUDGET_MS = 2_000;
const RUNS = 20;
const BLOCKS = 50;
const BLOCK_SIZE = 1_000;

const describePerf = process.env.RUN_PERF === '1' ? describe : describe.skip;

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  const value = sorted[index];
  if (value === undefined) {
    throw new Error('percentile95: no values');
  }
  return value;
}

/** The id of entity number g: md5('perf-impact-' || g)::uuid (research R12). */
const entityId = (expression: string): string => `md5('perf-impact-' || (${expression}))::uuid`;

interface RelationSpec {
  type: string;
  /** Unique within the dataset; the relationship source id is `<tag>-<g>`. */
  tag: string;
  /** Row filter over g (entity number), b (block) and k (position in the block). */
  where: string;
  /** Entity number of the `to` end. */
  to: string;
  /** Entity number of the `from` end; defaults to g. */
  from?: string;
}

/**
 * Research R12: 50,000 entities in 50 supplier blocks of 1,000, deterministic ids and about 30%
 * impaired purchase orders and orders. Block layout by position k: 0 supplier, 1-30 products,
 * 31-90 purchase orders, 91-690 orders, 691-750 shipments, 751-810 SLAs, 811-999 customers.
 */
async function buildImpactDataset(prisma: PrismaService): Promise<number> {
  const importId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO imports
      (id, trigger, format, dry_run, outcome, actor_type, file_name, byte_size,
        received_at, counts, file_errors, row_errors, correlation_id)
    VALUES (${importId}::uuid, 'SEED', 'JSON', false, 'APPLIED', 'system', 'perf-impact.json', 0,
      now(), '{}', '[]', '[]', ${randomUUID()}::uuid)
  `;

  await prisma.$executeRaw`
    INSERT INTO entities (id, type, display_name, attributes, current_state, last_observed_at, created_at, updated_at)
    SELECT md5('perf-impact-' || g)::uuid, t::"EntityType", 'Perf ' || t || ' ' || g,
      CASE WHEN t = 'Order'
        THEN jsonb_build_object('amount', ((g % 900) + 100)::text || '.00', 'currency', 'USD')
        ELSE '{}'::jsonb END,
      (CASE t
        WHEN 'Supplier' THEN (CASE WHEN g = 0 THEN 'SUSPENDED' ELSE 'ACTIVE' END)
        WHEN 'PurchaseOrder' THEN (CASE WHEN (k - 31) % 10 < 3 THEN 'DELAYED' ELSE 'ACTIVE' END)
        WHEN 'Order' THEN (CASE WHEN (k - 91) % 10 < 3 THEN 'BLOCKED' ELSE 'ACTIVE' END)
        WHEN 'Shipment' THEN (CASE WHEN (k - 691) % 10 < 3 THEN 'DELAYED' ELSE 'ACTIVE' END)
        ELSE 'ACTIVE' END)::"OperationalState",
      now(), now(), now()
    FROM (
      SELECT g, k,
        CASE WHEN k = 0 THEN 'Supplier' WHEN k <= 30 THEN 'Product' WHEN k <= 90 THEN 'PurchaseOrder'
             WHEN k <= 690 THEN 'Order' WHEN k <= 750 THEN 'Shipment' WHEN k <= 810 THEN 'SLA'
             ELSE 'Customer' END AS t
      FROM (SELECT g, g % ${BLOCK_SIZE} AS k FROM generate_series(0, ${BLOCKS * BLOCK_SIZE - 1}) AS g) a
    ) b
  `;

  const relate = async (spec: RelationSpec): Promise<void> => {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO relationships
        (id, type, from_entity_id, to_entity_id, origin, confidence,
          source_system, source_id, observed_at, import_id, created_at, updated_at)
      SELECT gen_random_uuid(), ${spec.type}::"RelationshipType",
        ${Prisma.raw(entityId(spec.from ?? 'g'))}, ${Prisma.raw(entityId(spec.to))},
        'SOURCE', 'HIGH', 'Perf', ${spec.tag} || '-' || g, now(), ${importId}::uuid, now(), now()
      FROM (
        SELECT g, g / ${BLOCK_SIZE} AS b, g % ${BLOCK_SIZE} AS k
        FROM generate_series(0, ${BLOCKS * BLOCK_SIZE - 1}) AS g
      ) t
      WHERE ${Prisma.raw(spec.where)}
    `);
  };

  const inBlock = (from: number, to: number): string => `k BETWEEN ${from} AND ${to}`;
  const supplier = `b * ${BLOCK_SIZE}`;

  await relate({ type: 'SUPPLIED_BY', tag: 'PI-PS', where: inBlock(1, 30), to: supplier });
  await relate({ type: 'SUPPLIED_BY', tag: 'PI-OS', where: inBlock(31, 90), to: supplier });
  // The hub: block 0's supplier also supplies the products of blocks 1 to 3.
  await relate({ type: 'SUPPLIED_BY', tag: 'PI-HUB', where: `b BETWEEN 1 AND 3 AND ${inBlock(1, 30)}`, to: '0' });
  for (const offset of [0, 7]) {
    await relate({
      type: 'CONTAINS',
      tag: `PI-PC${offset}`,
      where: inBlock(31, 90),
      to: `b * ${BLOCK_SIZE} + 1 + ((k - 31 + ${offset}) % 30)`,
    });
  }
  for (const offset of [0, 11]) {
    await relate({
      type: 'CONTAINS',
      tag: `PI-OC${offset}`,
      where: inBlock(91, 690),
      to: `b * ${BLOCK_SIZE} + 1 + ((k - 91 + ${offset}) % 30)`,
    });
  }
  await relate({
    type: 'DEPENDS_ON',
    tag: 'PI-OP',
    where: inBlock(91, 690),
    to: `b * ${BLOCK_SIZE} + 31 + ((k - 91) % 60)`,
  });
  for (let order = 0; order < 10; order += 1) {
    await relate({
      type: 'DEPENDS_ON',
      tag: `PI-SO${order}`,
      where: inBlock(691, 750),
      to: `b * ${BLOCK_SIZE} + 91 + ((k - 691) * 10 + ${order})`,
    });
  }
  await relate({
    type: 'DEPENDS_ON',
    tag: 'PI-LS',
    where: inBlock(751, 810),
    to: `b * ${BLOCK_SIZE} + 691 + (k - 751)`,
  });
  await relate({
    type: 'PLACED',
    tag: 'PI-CP',
    where: inBlock(91, 690),
    from: `b * ${BLOCK_SIZE} + 811 + ((k - 91) % 189)`,
    to: 'g',
  });
  // Noise that traversal must ignore.
  await relate({
    type: 'RELATES_TO',
    tag: 'PI-NZ',
    where: `((g + 7919) % ${BLOCKS * BLOCK_SIZE}) <> g`,
    to: `(g + 7919) % ${BLOCKS * BLOCK_SIZE}`,
  });

  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM relationships`;
  const total = rows[0]?.count;
  if (total === undefined) {
    throw new Error('relationship count not returned');
  }
  return Number(total);
}

describePerf('Impact performance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let token: string;
  let hubId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const admin = await createUser(prisma, { role: 'ADMIN', email: 'perf-impact@test.local' });
    token = (await login(app, admin.email, TEST_PASSWORD)).accessToken;

    const relationships = await buildImpactDataset(prisma);
    expect(relationships).toBeGreaterThanOrEqual(150_000);
    const [hub] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT md5('perf-impact-0')::uuid::text AS id`;
    if (hub === undefined) {
      throw new Error('hub id not computed');
    }
    hubId = hub.id;
  }, 600_000);

  afterAll(async () => {
    await app.close();
  });

  const auth = (): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

  async function measure(path: string, parse: (body: unknown) => unknown): Promise<number> {
    // 1 warm-up run.
    parse((await request(server).get(path).set(auth()).expect(200)).body);
    const timings: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const response = await request(server).get(path).set(auth()).expect(200);
      timings.push(performance.now() - started);
      parse(response.body);
    }
    return percentile95(timings);
  }

  it('reaches at least 2,000 counted entities from the hub supplier (SC-003 dataset)', async () => {
    const response = await request(server).get(`/api/entities/${hubId}/impact`).set(auth()).expect(200);
    const body = ImpactResponseSchema.parse(response.body);
    console.log(`perf-impact hub countedTotal=${body.countedTotal}`);
    expect(body.countedTotal).toBeGreaterThanOrEqual(2_000);
    expect(body.limits.explorationLimit).toBe(false);
  }, 300_000);

  it('answers the summary and the first drill-down pages with p95 under 2,000 ms (SC-003)', async () => {
    const summary = await measure(`/api/entities/${hubId}/impact`, (body) =>
      ImpactResponseSchema.parse(body),
    );
    const orders = await measure(
      `/api/entities/${hubId}/impact/items?list=category&type=Order&bucket=total`,
      (body) => ImpactListResponseSchema.parse(body),
    );
    const exposure = await measure(
      `/api/entities/${hubId}/impact/items?list=exposure&currency=USD&bucket=total`,
      (body) => ImpactListResponseSchema.parse(body),
    );

    console.log(
      `perf-impact summary p95=${Math.round(summary)}ms ` +
        `items(category.Order.total) p95=${Math.round(orders)}ms ` +
        `items(exposure.USD.total) p95=${Math.round(exposure)}ms`,
    );
    expect(summary).toBeLessThan(BUDGET_MS);
    expect(orders).toBeLessThan(BUDGET_MS);
    expect(exposure).toBeLessThan(BUDGET_MS);
  }, 600_000);
});
