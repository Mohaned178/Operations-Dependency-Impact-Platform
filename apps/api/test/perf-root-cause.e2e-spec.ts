import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { RootCauseResponseSchema } from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

// SC-003: GET /root-cause p95 under 1,500 ms at 50k entities and 150k relationships (research R13).
// The graph is the one from perf-tracing.e2e-spec.ts (copied: that file exports no helper and 003
// tests stay untouched), plus the evidence tables a real import would have filled, so the evidence
// queries run against realistic volumes rather than empty tables.
const ROOT_CAUSE_BUDGET_MS = 1_500;
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

describePerf('Root-cause performance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let g0Id: string;
  let g6Id: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const admin = await createUser(prisma, { role: 'ADMIN', email: 'perf-root-cause@test.local' });
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

    // Evidence volume. One state observation (with its source record) per entity, one source
    // record per relationship, and one event per entity. The chain entities (0..6) get 25 more
    // events each, so the 20-event cap and the newest-first sort are exercised.
    await prisma.$executeRaw`
      INSERT INTO source_records
        (id, kind, source_system, source_id, observed_at, received_at, raw_payload, payload_hash,
          normalized, import_id, entity_id)
      SELECT md5('perf-sr-' || g)::uuid, 'ENTITY', 'PerfSys', 'PERF-ENT-' || g,
        now() - interval '1 hour', now(), '{}', repeat('a', 64), '{}', ${importId}::uuid,
        md5('perf-' || g)::uuid
      FROM generate_series(0, 49999) AS g
    `;
    await prisma.$executeRaw`
      INSERT INTO state_observations
        (id, entity_id, source_record_id, state, source_system, source_id, observed_at,
          received_at, import_id)
      SELECT md5('perf-so-' || g)::uuid, md5('perf-' || g)::uuid, md5('perf-sr-' || g)::uuid,
        e.current_state, 'PerfSys', 'PERF-ENT-' || g, now() - interval '1 hour', now(),
        ${importId}::uuid
      FROM generate_series(0, 49999) AS g
      JOIN entities e ON e.id = md5('perf-' || g)::uuid
    `;
    await prisma.$executeRaw`
      INSERT INTO source_records
        (id, kind, source_system, source_id, observed_at, received_at, raw_payload, payload_hash,
          normalized, import_id, relationship_id)
      SELECT gen_random_uuid(), 'RELATIONSHIP', r.source_system, r.source_id, now(), now(), '{}',
        repeat('b', 64), '{}', ${importId}::uuid, r.id
      FROM relationships r
    `;
    await prisma.$executeRaw`
      INSERT INTO events
        (id, type, occurred_at, observed_at, description, source_system, source_id, import_id,
          created_at, updated_at)
      SELECT md5('perf-ev-' || g)::uuid, 'perf.event',
        now() - (g % 1000) * interval '1 minute', now(), 'Perf event ' || g, 'PerfEvt',
        'PERF-EVT-' || g, ${importId}::uuid, now(), now()
      FROM generate_series(0, 49999) AS g
    `;
    await prisma.$executeRaw`
      INSERT INTO event_entities (event_id, entity_id, role)
      SELECT md5('perf-ev-' || g)::uuid, md5('perf-' || g)::uuid, 'SUBJECT'::"EventEntityRole"
      FROM generate_series(0, 49999) AS g
    `;
    await prisma.$executeRaw`
      INSERT INTO events
        (id, type, occurred_at, observed_at, description, source_system, source_id, import_id,
          created_at, updated_at)
      SELECT md5('perf-chain-ev-' || c || '-' || n)::uuid, 'perf.chain',
        now() - n * interval '1 minute', now(), 'Chain event ' || c || '-' || n, 'PerfEvt',
        'PERF-CHAIN-' || c || '-' || n, ${importId}::uuid, now(), now()
      FROM generate_series(0, 6) AS c, generate_series(1, 25) AS n
    `;
    await prisma.$executeRaw`
      INSERT INTO event_entities (event_id, entity_id, role)
      SELECT md5('perf-chain-ev-' || c || '-' || n)::uuid, md5('perf-' || c)::uuid,
        'SUBJECT'::"EventEntityRole"
      FROM generate_series(0, 6) AS c, generate_series(1, 25) AS n
    `;
    await prisma.$executeRaw`ANALYZE`;

    const g0 = await prisma.entity.findFirstOrThrow({ where: { displayName: 'Perf Shipment 0' } });
    const g6 = await prisma.entity.findFirstOrThrow({ where: { displayName: 'Perf Customer 6' } });
    g0Id = g0.id;
    g6Id = g6.id;
  }, 600_000);

  afterAll(async () => {
    await app.close();
  });

  function auth(): { Authorization: string } {
    return { Authorization: `Bearer ${adminToken}` };
  }

  it(
    'answers root-cause(g=0), a 6-hop chain, with p95 under 1,500 ms (SC-003)',
    async () => {
      // 1 warm-up run, which also checks the shape of the answer.
      const warm = await request(server)
        .get(`/api/entities/${g0Id}/root-cause`)
        .set(auth())
        .expect(200);
      const warmBody = RootCauseResponseSchema.parse(warm.body);
      expect(warmBody.status).toBe('ROOT_CAUSES_FOUND');
      const sixHop = warmBody.candidates.find(
        (candidate) =>
          candidate.rootCause.id === g6Id &&
          [candidate.primaryChain, ...candidate.alternativeChains].some(
            (chain) => chain.length === 6,
          ),
      );
      expect(sixHop).toBeDefined();
      expect(sixHop?.rootCause.currentState).toBe('MISSING');
      expect(warmBody.evidence.entities.some((entry) => entry.events.total > 20)).toBe(true);

      const timings: number[] = [];
      for (let run = 0; run < RUNS; run += 1) {
        const started = performance.now();
        const response = await request(server)
          .get(`/api/entities/${g0Id}/root-cause`)
          .set(auth())
          .expect(200);
        timings.push(performance.now() - started);
        RootCauseResponseSchema.parse(response.body);
      }
      const p95 = percentile95(timings);
      console.log(
        `perf-root-cause root-cause(g=0) p95=${Math.round(p95)}ms runs=${timings.map((ms) => Math.round(ms)).join(',')}`,
      );
      expect(p95).toBeLessThan(ROOT_CAUSE_BUDGET_MS);
    },
    300_000,
  );
});
