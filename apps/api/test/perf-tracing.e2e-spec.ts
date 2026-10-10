import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { BlockersResponseSchema, DependenciesResponseSchema } from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';
import { buildPerfDataset } from './perf-dataset';

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

    ({ g0Id, g6Id, g7Id } = await buildPerfDataset(prisma));
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
