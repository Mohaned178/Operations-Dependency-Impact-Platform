import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { AuditListResponseSchema } from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

const PERF_ROWS = 100_000;
const BUDGET_MS = 2000;
const describePerf = process.env.RUN_PERF === '1' ? describe : describe.skip;

describePerf('Audit performance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'returns the first filtered page in under 2 s at 100k rows',
    async () => {
      await resetDb(prisma);
      await createUser(prisma, { role: 'ADMIN', email: 'admin@test.local' });
      ({ accessToken: adminToken } = await login(app, 'admin@test.local', TEST_PASSWORD));

      await prisma.$executeRaw`
        INSERT INTO audit_entries
          (occurred_at, actor_type, action, target_type, target_id, metadata, correlation_id)
        SELECT now() - (g || ' seconds')::interval,
               'system',
               CASE WHEN g % 100 = 0 THEN 'user.role_changed' ELSE 'perf.filler' END,
               'user',
               'perf-' || g,
               jsonb_build_object('g', g),
               gen_random_uuid()
        FROM generate_series(1, ${PERF_ROWS}) AS g
      `;

      const started = performance.now();
      const response = await request(server)
        .get('/api/audit?action=user.role_changed&limit=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const elapsed = performance.now() - started;

      const body: unknown = response.body;
      const page = AuditListResponseSchema.parse(body);
      expect(page.items).toHaveLength(50);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    },
    120_000,
  );
});
