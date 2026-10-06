import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { BlockersResponseSchema, DependenciesResponseSchema } from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

const BLOCKERS_BUDGET_MS = 1_000;
const DEPENDENCIES_BUDGET_MS = 2_000;
const RUNS = 20;

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

describePerf('Tracing performance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let g0Id: string;
  let g6Id: string;
  let g7Id: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const admin = await createUser(prisma, { role: 'ADMIN', email: 'perf-tracing@test.local' });
    adminToken = (await login(app, admin.email, TEST_PASSWORD)).accessToken;

    const importId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO imports
        (id, trigger, format, dry_run, outcome, actor_type, file_name, byte_size,
          received_at, counts, file_errors, row_errors, correlation_id)
      VALUES (${importId}::uuid, 'SEED', 'JSON', false, 'APPLIED', 'system', 'perf-seed.json', 0,
        now(), '{}', '[]', '[]', ${randomUUID()}::uuid)
    `;

    // Entities: 50,000 with deterministic ids md5('perf-' || g)::uuid (research R11).
    await prisma.$executeRaw`
      INSERT INTO entities (id, type, display_name, attributes, current_state, last_observed_at, created_at, updated_at)
      SELECT md5('perf-' || g)::uuid,
        (CASE (g % 10)
          WHEN 0 THEN 'Shipment'
          WHEN 1 THEN 'Order'
          WHEN 2 THEN 'Payment'
          WHEN 3 THEN 'Approval'
          WHEN 4 THEN 'BudgetRequirement'
          WHEN 5 THEN 'Contract'
          WHEN 6 THEN 'Customer'
          WHEN 7 THEN 'Warehouse'
          WHEN 8 THEN 'Product'
          ELSE 'Supplier'
        END)::"EntityType",
        'Perf ' ||
        (CASE (g % 10)
          WHEN 0 THEN 'Shipment'
          WHEN 1 THEN 'Order'
          WHEN 2 THEN 'Payment'
          WHEN 3 THEN 'Approval'
          WHEN 4 THEN 'BudgetRequirement'
          WHEN 5 THEN 'Contract'
          WHEN 6 THEN 'Customer'
          WHEN 7 THEN 'Warehouse'
          WHEN 8 THEN 'Product'
          ELSE 'Supplier'
        END) || ' ' || g,
        '{}',
        (CASE
          WHEN (g / 10) = 0 THEN
            CASE (g % 10)
              WHEN 0 THEN 'DELAYED'
              WHEN 1 THEN 'BLOCKED'
              WHEN 2 THEN 'PENDING'
              WHEN 3 THEN 'BLOCKED'
              WHEN 4 THEN 'WAITING'
              WHEN 5 THEN 'PENDING'
              WHEN 6 THEN 'MISSING'
              ELSE 'ACTIVE'
            END
          ELSE
            CASE WHEN (g % 10) <= 2 OR ((g / 10) % 7) = 0 THEN 'PENDING' ELSE 'ACTIVE' END
        END)::"OperationalState",
        now(), now(), now()
      FROM generate_series(0, 49999) AS g
    `;

    // R1: 45,000 rows within each chain, pos p DEPENDS_ON pos p+1, HIGH.
    await prisma.$executeRaw`
      INSERT INTO relationships
        (id, type, from_entity_id, to_entity_id, origin, confidence,
          source_system, source_id, observed_at, import_id, created_at, updated_at)
      SELECT gen_random_uuid(), 'DEPENDS_ON',
        md5('perf-' || g)::uuid, md5('perf-' || (g + 1))::uuid,
        'SOURCE', 'HIGH', 'Perf', 'PERF-R1-' || g, now(), ${importId}::uuid, now(), now()
      FROM generate_series(0, 49999) AS g
      WHERE (g % 10) <= 8
    `;

    // R2: 50,000 rows, every entity REQUIRES the entity at the same pos in the next chain, MEDIUM.
    await prisma.$executeRaw`
      INSERT INTO relationships
        (id, type, from_entity_id, to_entity_id, origin, confidence,
          source_system, source_id, observed_at, import_id, created_at, updated_at)
      SELECT gen_random_uuid(), 'REQUIRES',
        md5('perf-' || g)::uuid,
        md5('perf-' || ((((g / 10) + 1) % 5000) * 10 + (g % 10)))::uuid,
        'SOURCE', 'MEDIUM', 'Perf', 'PERF-R2-' || g, now(), ${importId}::uuid, now(), now()
      FROM generate_series(0, 49999) AS g
    `;

    // R3: 50,000 rows of RELATES_TO noise that traversal must ignore.
    await prisma.$executeRaw`
      INSERT INTO relationships
        (id, type, from_entity_id, to_entity_id, origin, confidence,
          source_system, source_id, observed_at, import_id, created_at, updated_at)
      SELECT gen_random_uuid(), 'RELATES_TO',
        md5('perf-' || g)::uuid, md5('perf-' || ((g + 7919) % 50000))::uuid,
        'SOURCE', 'HIGH', 'Perf', 'PERF-R3-' || g, now(), ${importId}::uuid, now(), now()
      FROM generate_series(0, 49999) AS g
      WHERE ((g + 7919) % 50000) <> g
    `;

    // R4: 5,000 rows, every Shipment FULFILLED_BY its hub warehouse, HIGH.
    await prisma.$executeRaw`
      INSERT INTO relationships
        (id, type, from_entity_id, to_entity_id, origin, confidence,
          source_system, source_id, observed_at, import_id, created_at, updated_at)
      SELECT gen_random_uuid(), 'FULFILLED_BY',
        md5('perf-' || g)::uuid, md5('perf-' || (((g / 10) % 50) * 10 + 7))::uuid,
        'SOURCE', 'HIGH', 'Perf', 'PERF-R4-' || g, now(), ${importId}::uuid, now(), now()
      FROM generate_series(0, 49999) AS g
      WHERE (g % 10) = 0
    `;

    const g0 = await prisma.entity.findFirstOrThrow({ where: { displayName: 'Perf Shipment 0' } });
    const g6 = await prisma.entity.findFirstOrThrow({ where: { displayName: 'Perf Customer 6' } });
    const g7 = await prisma.entity.findFirstOrThrow({ where: { displayName: 'Perf Warehouse 7' } });
    g0Id = g0.id;
    g6Id = g6.id;
    g7Id = g7.id;
  }, 300_000);

  afterAll(async () => {
    await app.close();
  });

  function auth(): { Authorization: string } {
    return { Authorization: `Bearer ${adminToken}` };
  }

  it(
    'answers blockers(g=0) with p95 under 1,000 ms (SC-003)',
    async () => {
      // 1 warm-up run.
      const warm = await request(server).get(`/api/entities/${g0Id}/blockers`).set(auth()).expect(200);
      const warmBody = BlockersResponseSchema.parse(warm.body);
      const sixHop = warmBody.paths.find(
        (path) => path.length === 6 && path.hops[5]?.entity.id === g6Id,
      );
      expect(sixHop).toBeDefined();
      expect(sixHop?.hops[5]?.entity.currentState).toBe('MISSING');
      for (const path of warmBody.paths) {
        for (const hop of path.hops) {
          expect(hop.relationshipType).not.toBe('RELATES_TO');
        }
      }

      const timings: number[] = [];
      for (let run = 0; run < RUNS; run += 1) {
        const started = performance.now();
        const response = await request(server)
          .get(`/api/entities/${g0Id}/blockers`)
          .set(auth())
          .expect(200);
        timings.push(performance.now() - started);
        BlockersResponseSchema.parse(response.body);
      }
      const p95 = percentile95(timings);
      console.log(`perf-tracing blockers(g=0) p95=${Math.round(p95)}ms runs=${timings.map((ms) => Math.round(ms)).join(',')}`);
      expect(p95).toBeLessThan(BLOCKERS_BUDGET_MS);
    },
    300_000,
  );

  it(
    'answers the first dependencies pages with p95 under 2,000 ms (SC-004)',
    async () => {
      async function measure(path: string): Promise<number> {
        // 1 warm-up run.
        const warm = await request(server).get(path).set(auth()).expect(200);
        DependenciesResponseSchema.parse(warm.body);
        const timings: number[] = [];
        for (let run = 0; run < RUNS; run += 1) {
          const started = performance.now();
          const response = await request(server).get(path).set(auth()).expect(200);
          timings.push(performance.now() - started);
          DependenciesResponseSchema.parse(response.body);
        }
        return percentile95(timings);
      }

      const downstreamG6 = await measure(`/api/entities/${g6Id}/dependencies?direction=downstream`);
      const downstreamG7 = await measure(`/api/entities/${g7Id}/dependencies?direction=downstream`);
      const upstreamG0 = await measure(`/api/entities/${g0Id}/dependencies?direction=upstream`);

      console.log(
        `perf-tracing downstream(g=6) p95=${Math.round(downstreamG6)}ms ` +
          `downstream(g=7) p95=${Math.round(downstreamG7)}ms ` +
          `upstream(g=0) p95=${Math.round(upstreamG0)}ms`,
      );
      expect(downstreamG6).toBeLessThan(DEPENDENCIES_BUDGET_MS);
      expect(downstreamG7).toBeLessThan(DEPENDENCIES_BUDGET_MS);
      expect(upstreamG0).toBeLessThan(DEPENDENCIES_BUDGET_MS);
    },
    300_000,
  );
});
