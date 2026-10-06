import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  EntityDetailDtoSchema,
  EntityListResponseSchema,
  ImportReportSchema,
  NeighborListResponseSchema,
  TimelineResponseSchema,
} from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  createUser,
  importFile,
  login,
  resetDb,
  TEST_PASSWORD,
} from './helpers';

const ENTITY_ROWS = 50_000;
const HUB_EDGES = 1_000;
const IMPORT_ROWS = 10_000;

const LIST_BUDGET_MS = 2_000;
const DETAIL_BUDGET_MS = 2_000;
const NEIGHBOR_BUDGET_MS = 500;
const IMPORT_BUDGET_MS = 60_000;

const describePerf = process.env.RUN_PERF === '1' ? describe : describe.skip;

describePerf('Graph performance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let hubId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const admin = await createUser(prisma, { role: 'ADMIN', email: 'perf-graph@test.local' });
    adminToken = (await login(app, admin.email, TEST_PASSWORD)).accessToken;

    hubId = randomUUID();
    const importId = randomUUID();

    await prisma.$executeRaw`
      INSERT INTO imports
        (id, trigger, format, dry_run, outcome, actor_type, file_name, byte_size,
         received_at, counts, file_errors, row_errors, correlation_id)
      VALUES (${importId}::uuid, 'SEED', 'JSON', false, 'APPLIED', 'system', 'perf-seed.json', 0,
        now(), '{}', '[]', '[]', ${randomUUID()}::uuid)
    `;
    await prisma.$executeRaw`
      INSERT INTO entities (id, type, display_name, attributes, current_state, last_observed_at, created_at, updated_at)
      SELECT gen_random_uuid(), 'Order', 'Perf Order ' || g, '{}', 'PENDING', now(), now(), now()
      FROM generate_series(1, ${ENTITY_ROWS}) AS g
    `;
    await prisma.$executeRaw`
      INSERT INTO entities (id, type, display_name, attributes, current_state, last_observed_at, created_at, updated_at)
      VALUES (${hubId}::uuid, 'Order', 'Perf Hub', '{}', 'BLOCKED', now(), now(), now())
    `;
    await prisma.$executeRaw`
      INSERT INTO entity_identifiers (id, entity_id, entity_type, source_system, source_id, created_at)
      SELECT gen_random_uuid(), id, type, 'Perf', 'PERF-' || row_number() OVER (), now()
      FROM entities
    `;
    await prisma.$executeRaw`
      INSERT INTO relationships
        (id, type, from_entity_id, to_entity_id, origin, confidence,
         source_system, source_id, observed_at, import_id, created_at, updated_at)
      SELECT gen_random_uuid(), 'RELATES_TO', ${hubId}::uuid, id, 'SOURCE', 'HIGH',
             'Perf', 'REL-' || row_number() OVER (), now(), ${importId}::uuid, now(), now()
      FROM entities
      WHERE id <> ${hubId}::uuid
      LIMIT ${HUB_EDGES}
    `;
    await prisma.$executeRaw`
      INSERT INTO events
        (id, type, occurred_at, observed_at, description, source_system, source_id, import_id, created_at, updated_at)
      SELECT gen_random_uuid(), 'perf.tick', now(), now(), NULL, 'Perf', 'EVT-' || g,
             ${importId}::uuid, now(), now()
      FROM generate_series(1, ${HUB_EDGES}) AS g
    `;
    await prisma.$executeRaw`
      INSERT INTO event_entities (event_id, entity_id, role)
      SELECT id, ${hubId}::uuid, 'SUBJECT' FROM events
    `;
  });

  afterAll(async () => {
    await app.close();
  });

  function auth(): { Authorization: string } {
    return { Authorization: `Bearer ${adminToken}` };
  }

  it(
    'answers the SC-003 reads in under 2 s at 50k entities',
    async () => {
      let started = performance.now();
      const list = await request(server)
        .get('/api/entities?type=Order&limit=50')
        .set(auth())
        .expect(200);
      const listMs = performance.now() - started;
      expect(EntityListResponseSchema.parse(list.body).items).toHaveLength(50);

      started = performance.now();
      const detailResponse = await request(server)
        .get(`/api/entities/${hubId}`)
        .set(auth())
        .expect(200);
      const detailMs = performance.now() - started;
      expect(EntityDetailDtoSchema.parse(detailResponse.body).id).toBe(hubId);

      started = performance.now();
      const neighbors = await request(server)
        .get(`/api/entities/${hubId}/neighbors`)
        .set(auth())
        .expect(200);
      const neighborsMs = performance.now() - started;
      expect(NeighborListResponseSchema.parse(neighbors.body).items.length).toBeGreaterThan(0);

      started = performance.now();
      const timeline = await request(server)
        .get(`/api/entities/${hubId}/timeline`)
        .set(auth())
        .expect(200);
      const timelineMs = performance.now() - started;
      expect(TimelineResponseSchema.parse(timeline.body).items.length).toBeGreaterThan(0);

      console.log(
        `SC-003 list=${Math.round(listMs)}ms detail=${Math.round(detailMs)}ms ` +
          `neighbors=${Math.round(neighborsMs)}ms timeline=${Math.round(timelineMs)}ms`,
      );
      expect(listMs).toBeLessThan(LIST_BUDGET_MS);
      expect(detailMs).toBeLessThan(DETAIL_BUDGET_MS);
      expect(neighborsMs).toBeLessThan(DETAIL_BUDGET_MS);
      expect(timelineMs).toBeLessThan(DETAIL_BUDGET_MS);
    },
    120_000,
  );

  it(
    'answers the SC-008 neighbor lookup in under 500 ms, deterministically',
    async () => {
      const started = performance.now();
      const first = await request(server)
        .get(`/api/entities/${hubId}/neighbors`)
        .set(auth())
        .expect(200);
      const elapsed = performance.now() - started;
      const second = await request(server)
        .get(`/api/entities/${hubId}/neighbors`)
        .set(auth())
        .expect(200);

      console.log(`SC-008 neighbors=${Math.round(elapsed)}ms`);
      expect(elapsed).toBeLessThan(NEIGHBOR_BUDGET_MS);
      expect(second.body).toEqual(first.body);
    },
    120_000,
  );

  it(
    'applies a 10,000-row JSON import through the API in under 60 s (SC-004)',
    async () => {
      const document = {
        entities: Array.from({ length: IMPORT_ROWS }, (_value, index) => ({
          type: 'Order',
          sourceSystem: 'PerfImport',
          sourceId: `PI-${index}`,
          displayName: `Perf import order ${index}`,
          observedAt: '2026-09-29T08:00:00Z',
          state: 'PENDING',
          attributes: { amount: '10.00', currency: 'USD' },
        })),
      };

      const started = performance.now();
      const response = await importFile(app, adminToken, JSON.stringify(document), {
        format: 'json',
        fileName: 'perf-10k.json',
      });
      const elapsed = performance.now() - started;

      expect(response.status).toBe(201);
      const report = ImportReportSchema.parse(response.body);
      expect(report.outcome).toBe('APPLIED');
      expect(report.counts.entities.created).toBe(IMPORT_ROWS);

      console.log(`SC-004 import=${Math.round(elapsed)}ms`);
      expect(elapsed).toBeLessThan(IMPORT_BUDGET_MS);
    },
    300_000,
  );
});
