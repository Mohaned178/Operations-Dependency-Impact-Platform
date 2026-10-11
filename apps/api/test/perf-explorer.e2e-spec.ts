import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { NeighborhoodResponseSchema } from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';
import { buildPerfDataset } from './perf-dataset';

// SC-003: the default neighborhood p95 < 2 s; one expansion adds < 1 s on top of that.
const NEIGHBORHOOD_BUDGET_MS = 2_000;
const EXPANSION_BUDGET_MS = 1_000;
const SAMPLE_SIZE = 20;

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

describePerf('Graph explorer performance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let hubId: string;
  let sampleIds: string[];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const admin = await createUser(prisma, { role: 'ADMIN', email: 'perf-explorer@test.local' });
    adminToken = (await login(app, admin.email, TEST_PASSWORD)).accessToken;
    await buildPerfDataset(prisma);

    const hub = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT e::text AS id
      FROM (
        SELECT from_entity_id AS e FROM relationships
        UNION ALL
        SELECT to_entity_id AS e FROM relationships
      ) ends
      GROUP BY e
      ORDER BY count(*) DESC, e
      LIMIT 1
    `;
    const hubRow = hub[0];
    if (hubRow === undefined) {
      throw new Error('no relationships in the perf dataset');
    }
    hubId = hubRow.id;

    // The highest-degree entity plus 19 evenly spread ones (deterministic ids, research R11).
    const positions = Array.from({ length: SAMPLE_SIZE - 1 }, (_, i) => i * 2_631);
    const spread = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT md5('perf-' || g)::uuid::text AS id
      FROM unnest(${positions}::int[]) WITH ORDINALITY AS t(g, n)
      ORDER BY n
    `;
    sampleIds = [hubId, ...spread.map((row) => row.id).filter((id) => id !== hubId)].slice(
      0,
      SAMPLE_SIZE,
    );
  }, 300_000);

  afterAll(async () => {
    await app.close();
  });

  async function timed(path: string): Promise<{ ms: number; body: unknown }> {
    const started = performance.now();
    const response = await request(server)
      .get(path)
      .set({ Authorization: `Bearer ${adminToken}` })
      .expect(200);
    return { ms: performance.now() - started, body: response.body };
  }

  it(
    'shows the default neighborhood in under 2,000 ms (p95) and one expansion in under 1,000 ms more',
    async () => {
      expect(sampleIds.length).toBe(SAMPLE_SIZE);
      const base: number[] = [];
      const expanded: number[] = [];
      let largest = 0;

      for (const id of sampleIds) {
        const path = `/api/entities/${id}/neighborhood`;
        // 1 warm-up run of the base request, then the timed one.
        const warm = NeighborhoodResponseSchema.parse((await timed(path)).body);
        const first = warm.nodes[1];
        const run = await timed(path);
        const parsed = NeighborhoodResponseSchema.parse(run.body);
        largest = Math.max(largest, parsed.nodes.length);
        base.push(run.ms);

        if (first !== undefined) {
          const expandPath = `${path}?expand=${first.id}`;
          await timed(expandPath);
          const withExpansion = await timed(expandPath);
          const expandedBody = NeighborhoodResponseSchema.parse(withExpansion.body);
          expect(expandedBody.nodes.length).toBeLessThanOrEqual(200);
          expanded.push(withExpansion.ms);
        }
      }

      const baseP95 = percentile95(base);
      const expandedP95 = percentile95(expanded);
      console.log(
        `perf-explorer default p95=${Math.round(baseP95)}ms (n=${base.length}, ` +
          `largest view ${largest} nodes) ` +
          `with one expand p95=${Math.round(expandedP95)}ms ` +
          `(+${Math.round(expandedP95 - baseP95)}ms) ` +
          `runs=${base.map((ms) => Math.round(ms)).join(',')}`,
      );
      expect(baseP95).toBeLessThan(NEIGHBORHOOD_BUDGET_MS);
      expect(expandedP95 - baseP95).toBeLessThan(EXPANSION_BUDGET_MS);
    },
    600_000,
  );

  it(
    'records all-directions depth 4 from the highest-degree entity (logged, not asserted)',
    async () => {
      const path = `/api/entities/${hubId}/neighborhood?direction=all&depth=4`;
      await timed(path);
      const timings: number[] = [];
      let totals = { visible: 0, omitted: 0, omittedIsLowerBound: false };
      for (let run = 0; run < SAMPLE_SIZE; run += 1) {
        const result = await timed(path);
        timings.push(result.ms);
        totals = NeighborhoodResponseSchema.parse(result.body).totals;
      }
      console.log(
        `perf-explorer all depth=4 hub p95=${Math.round(percentile95(timings))}ms ` +
          `visible=${totals.visible} omitted=${totals.omitted} ` +
          `lowerBound=${String(totals.omittedIsLowerBound)}`,
      );
      expect(totals.visible).toBeLessThanOrEqual(200);
    },
    600_000,
  );
});
