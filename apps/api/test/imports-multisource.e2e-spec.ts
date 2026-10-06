import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  type EntityDetailDto,
  type ImportReport,
  type SourceRecordListResponse,
  type StateHistoryResponse,
} from '@opsgraph/shared';
import type { User } from '@prisma/client';
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

const T1 = '2026-09-29T09:00:00Z';
const T2 = '2026-09-29T10:00:00Z';

function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'Order',
    sourceSystem: 'OMS',
    sourceId: 'ORD-1',
    displayName: 'Order #1',
    observedAt: T2,
    state: 'BLOCKED',
    sourceStatus: 'OPEN',
    attributes: { amount: '12480.00', currency: 'USD' },
    ...overrides,
  };
}

jest.setTimeout(30_000);

describe('Imports from several systems (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let admin: User;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    admin = await createUser(prisma, { role: 'ADMIN', email: 'multisource-admin@test.local' });
    adminToken = (await login(app, admin.email, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function postEntities(rows: Record<string, unknown>[]): Promise<ImportReport> {
    const response = await importFile(app, adminToken, JSON.stringify({ entities: rows }), {
      format: 'json',
    });
    expect(response.status).toBe(201);
    return response.body as ImportReport;
  }

  async function detailOf(entityId: string): Promise<EntityDetailDto> {
    const response = await request(server)
      .get(`/api/entities/${entityId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    return response.body as EntityDetailDto;
  }

  it('attaches a second system record through entityRef and lists both systems and records', async () => {
    const first = await postEntities([orderRow()]);
    expect(first.outcome).toBe('APPLIED');
    expect(first.counts.entities).toEqual({
      received: 1,
      created: 1,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });

    const second = await postEntities([
      orderRow({
        sourceSystem: 'ERP',
        sourceId: 'SO-1',
        observedAt: T1,
        state: 'PENDING',
        entityRef: { entityType: 'Order', sourceSystem: 'OMS', sourceId: 'ORD-1' },
      }),
    ]);
    expect(second.outcome).toBe('APPLIED');
    expect(second.counts.entities).toEqual({
      received: 1,
      created: 0,
      updated: 1,
      unchanged: 0,
      rejected: 0,
    });

    expect(await prisma.entity.count()).toBe(1);

    const entity = await prisma.entity.findFirstOrThrow();
    const detail = await detailOf(entity.id);
    expect(detail.sourceSystems).toEqual(['ERP', 'OMS']);
    expect(detail.identifiers).toHaveLength(2);
    expect(detail.currentState).toBe('BLOCKED');

    const records = await request(server)
      .get(`/api/entities/${entity.id}/source-records`)
      .set('Authorization', `Bearer ${adminToken}`);
    const body = records.body as SourceRecordListResponse;
    expect(body.items).toHaveLength(2);
    expect(body.items.map((record) => record.sourceSystem).sort()).toEqual(['ERP', 'OMS']);
  });

  it('creates a separate entity when the second system does not reference the first', async () => {
    await postEntities([orderRow({ displayName: 'Order #1', observedAt: T1 })]);

    const second = await postEntities([
      orderRow({ sourceSystem: 'ERP', sourceId: 'ORD-1', displayName: 'Order #1', observedAt: T1 }),
    ]);
    expect(second.outcome).toBe('APPLIED');
    expect(second.counts.entities.created).toBe(1);

    expect(await prisma.entity.count()).toBe(2);
    const entities = await prisma.entity.findMany({
      include: { identifiers: true },
    });
    expect(entities.map((entity) => entity.displayName)).toEqual(['Order #1', 'Order #1']);
    for (const entity of entities) {
      expect(entity.identifiers).toHaveLength(1);
    }
  });

  it('stores an older state observation in history without changing the current state', async () => {
    await postEntities([orderRow({ observedAt: T2, state: 'BLOCKED' })]);

    const second = await postEntities([orderRow({ observedAt: T1, state: 'CANCELLED' })]);
    expect(second.outcome).toBe('APPLIED');
    expect(second.counts.entities.updated).toBe(1);

    const entity = await prisma.entity.findFirstOrThrow();
    const detail = await detailOf(entity.id);
    expect(detail.currentState).toBe('BLOCKED');

    const history = await request(server)
      .get(`/api/entities/${entity.id}/states`)
      .set('Authorization', `Bearer ${adminToken}`);
    const states = history.body as StateHistoryResponse;
    expect(states.items).toHaveLength(2);
    expect(states.items[0]).toMatchObject({ state: 'BLOCKED', observedAt: '2026-09-29T10:00:00.000Z' });
    expect(states.items[1]).toMatchObject({ state: 'CANCELLED', observedAt: '2026-09-29T09:00:00.000Z' });

    expect(detail.counts.stateObservations).toBe(2);
    expect(detail.counts.sourceRecords).toBe(2);
  });

  it('marks an identical re-submit unchanged and writes no per-row audit entry', async () => {
    await postEntities([orderRow()]);

    const recordsBefore = await prisma.sourceRecord.count();
    const second = await postEntities([orderRow()]);
    expect(second.outcome).toBe('APPLIED');
    expect(second.counts.entities).toEqual({
      received: 1,
      created: 0,
      updated: 0,
      unchanged: 1,
      rejected: 0,
    });

    expect(await prisma.sourceRecord.count()).toBe(recordsBefore);

    const linked = await prisma.auditEntry.findMany({
      where: { metadata: { path: ['importId'], equals: second.id } },
    });
    expect(linked).toEqual([]);

    const summaries = await prisma.auditEntry.findMany({
      where: { action: AUDIT_ACTIONS.IMPORT_APPLIED, targetId: second.id },
    });
    expect(summaries).toHaveLength(1);
  });

  it('shows each source latest state beside the overall current state', async () => {
    await postEntities([
      orderRow({ sourceSystem: 'ERP', sourceId: 'SO-1', observedAt: T2, state: 'PENDING' }),
    ]);
    await postEntities([
      orderRow({
        observedAt: T1,
        entityRef: { entityType: 'Order', sourceSystem: 'ERP', sourceId: 'SO-1' },
      }),
    ]);

    const entity = await prisma.entity.findFirstOrThrow();
    const detail = await detailOf(entity.id);

    expect(detail.currentState).toBe('PENDING');
    expect(
      detail.latestStateBySource.map((observation) => ({
        sourceSystem: observation.sourceSystem,
        state: observation.state,
      })),
    ).toEqual([
      { sourceSystem: 'ERP', state: 'PENDING' },
      { sourceSystem: 'OMS', state: 'BLOCKED' },
    ]);
  });

  it('rejects attaching an identifier that already belongs to another entity (P4)', async () => {
    await postEntities([
      orderRow(),
      orderRow({ sourceSystem: 'ERP', sourceId: 'SO-2', observedAt: T1, state: 'PENDING' }),
    ]);

    const rejected = await postEntities([
      orderRow({
        sourceSystem: 'ERP',
        sourceId: 'SO-2',
        observedAt: T1,
        entityRef: { entityType: 'Order', sourceSystem: 'OMS', sourceId: 'ORD-1' },
      }),
    ]);
    expect(rejected.outcome).toBe('REJECTED');
    expect(rejected.rowErrors).toHaveLength(1);
    expect(rejected.rowErrors[0]).toMatchObject({ kind: 'entities', row: 1, field: 'entityRef' });
    expect(rejected.rowErrors[0]?.message).toContain('already belongs to entity');

    expect(await prisma.entity.count()).toBe(2);
    expect(await prisma.sourceRecord.count()).toBe(2);
  });

  it('rejects an entityRef chain', async () => {
    const rejected = await postEntities([
      orderRow(),
      orderRow({
        sourceSystem: 'ERP',
        sourceId: 'SO-1',
        observedAt: T1,
        state: 'PENDING',
        entityRef: { entityType: 'Order', sourceSystem: 'OMS', sourceId: 'ORD-1' },
      }),
      orderRow({
        sourceSystem: 'WMS',
        sourceId: 'W-1',
        observedAt: T1,
        state: 'PENDING',
        entityRef: { entityType: 'Order', sourceSystem: 'ERP', sourceId: 'SO-1' },
      }),
    ]);

    expect(rejected.outcome).toBe('REJECTED');
    expect(rejected.rowErrors).toEqual([
      {
        kind: 'entities',
        row: 3,
        field: 'entityRef',
        message: "Reference chains are not supported; reference the entity's own key or OpsGraph id",
        dependsOn: null,
      },
    ]);
    expect(await prisma.entity.count()).toBe(0);
  });

  it('produces the same projections when two files arrive in opposite orders', async () => {
    const fileA = [
      orderRow({
        observedAt: T2,
        state: 'PENDING',
        attributes: { amount: '12480.00', currency: 'USD', channel: 'web' },
      }),
    ];
    const fileB = [
      orderRow({
        observedAt: T1,
        state: 'BLOCKED',
        attributes: { amount: '12480.00', currency: 'USD', channel: 'phone' },
      }),
    ];

    async function projectionsAfterOrder(
      first: Record<string, unknown>[],
      second: Record<string, unknown>[],
    ): Promise<Record<string, unknown>> {
      await resetDb(prisma);
      const runner = await createUser(prisma, {
        role: 'ADMIN',
        email: `determinism-${randomUUID()}@test.local`,
      });
      const token = (await login(app, runner.email, TEST_PASSWORD)).accessToken;

      for (const rows of [first, second]) {
        const response = await importFile(app, token, JSON.stringify({ entities: rows }), {
          format: 'json',
        });
        expect(response.status).toBe(201);
        expect((response.body as ImportReport).outcome).toBe('APPLIED');
      }

      const found = await prisma.entity.findFirstOrThrow();
      const response = await request(server)
        .get(`/api/entities/${found.id}`)
        .set('Authorization', `Bearer ${token}`);
      const detail = response.body as EntityDetailDto;
      return {
        displayName: detail.displayName,
        attributes: detail.attributes,
        currentState: detail.currentState,
        lastObservedAt: detail.lastObservedAt,
        sourceSystems: detail.sourceSystems,
        identifiers: detail.identifiers.map(
          (identifier) => `${identifier.sourceSystem}/${identifier.sourceId}`,
        ),
        counts: detail.counts,
        latestStateBySource: detail.latestStateBySource.map((observation) => ({
          sourceSystem: observation.sourceSystem,
          state: observation.state,
          observedAt: observation.observedAt,
        })),
      };
    }

    const forward = await projectionsAfterOrder(fileA, fileB);
    const reverse = await projectionsAfterOrder(fileB, fileA);

    expect(reverse).toEqual(forward);
    expect(forward).toMatchObject({
      displayName: 'Order #1',
      attributes: { amount: '12480.00', currency: 'USD', channel: 'web' },
      currentState: 'PENDING',
      lastObservedAt: '2026-09-29T10:00:00.000Z',
      sourceSystems: ['OMS'],
      identifiers: ['OMS/ORD-1'],
      counts: { sourceRecords: 2, stateObservations: 2, relationships: 0, events: 0 },
    });
  });
});
