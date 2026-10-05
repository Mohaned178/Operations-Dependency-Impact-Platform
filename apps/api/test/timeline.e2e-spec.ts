import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { TimelineResponseSchema, type TimelineItemDto } from '@opsgraph/shared';
import type { EntityType } from '@prisma/client';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

describe('Timeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let acmeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    const analyst = await createUser(prisma, { role: 'ANALYST' });
    token = (await login(app, analyst.email, TEST_PASSWORD)).accessToken;

    const seed = app.get(SeedService);
    const report = await seed.seedScenario39();
    expect(report?.outcome).toBe('APPLIED');

    acmeId = await entityId('Customer', 'CRM', 'CUST-1001');
  });

  afterAll(async () => {
    await app.close();
  });

  async function entityId(
    entityType: EntityType,
    sourceSystem: string,
    sourceId: string,
  ): Promise<string> {
    const identifier = await prisma.entityIdentifier.findUnique({
      where: { entityType_sourceSystem_sourceId: { entityType, sourceSystem, sourceId } },
    });
    if (identifier === null) {
      throw new Error(`No identifier ${entityType}/${sourceSystem}/${sourceId}`);
    }
    return identifier.entityId;
  }

  async function timelinePage(limit: number, cursor?: string): Promise<TimelineItemDto[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor !== undefined) {
      params.set('cursor', cursor);
    }
    const response = await request(server)
      .get(`/api/entities/${acmeId}/timeline?${params.toString()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return TimelineResponseSchema.parse(response.body).items;
  }

  it('shows a related event with role RELATED and state changes as STATE items', async () => {
    const response = await request(server)
      .get(`/api/entities/${acmeId}/timeline?limit=200`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const parsed = TimelineResponseSchema.parse(response.body);

    expect(parsed.items.map((item) => item.kind)).toEqual(['STATE', 'STATE', 'EVENT']);
    expect(parsed.items[0]).toMatchObject({
      kind: 'STATE',
      state: 'ACTIVE',
      sourceSystem: 'ERP',
      at: '2026-08-15T08:00:00.000Z',
    });
    expect(parsed.items[1]).toMatchObject({
      kind: 'STATE',
      state: 'ACTIVE',
      sourceSystem: 'CRM',
      at: '2026-09-01T08:00:00.000Z',
    });

    const event = parsed.items[2];
    expect(event?.kind).toBe('EVENT');
    if (event?.kind === 'EVENT') {
      expect(event.eventType).toBe('order.created');
      expect(event.role).toBe('RELATED');
      expect(event.at).toBe('2026-09-29T09:12:00.000Z');
      const self = event.entities.find((link) => link.entity.id === acmeId);
      expect(self?.role).toBe('RELATED');
      const subject = event.entities.find((link) => link.role === 'SUBJECT');
      expect(subject?.entity.displayName).toBe('Order #18492');
    }
  });

  it('returns items in ascending order and paginates without gaps or duplicates', async () => {
    const first = await timelinePage(1);
    expect(first).toHaveLength(1);

    const firstResponse = await request(server)
      .get(`/api/entities/${acmeId}/timeline?limit=1`)
      .set('Authorization', `Bearer ${token}`);
    const firstPage = TimelineResponseSchema.parse(firstResponse.body);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondResponse = await request(server)
      .get(
        `/api/entities/${acmeId}/timeline?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      )
      .set('Authorization', `Bearer ${token}`);
    const secondPage = TimelineResponseSchema.parse(secondResponse.body);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).not.toBeNull();

    const thirdResponse = await request(server)
      .get(
        `/api/entities/${acmeId}/timeline?limit=1&cursor=${encodeURIComponent(secondPage.nextCursor ?? '')}`,
      )
      .set('Authorization', `Bearer ${token}`);
    const thirdPage = TimelineResponseSchema.parse(thirdResponse.body);
    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.nextCursor).toBeNull();

    const all = [...firstPage.items, ...secondPage.items, ...thirdPage.items];
    expect(all).toHaveLength(3);
    expect(new Set(all.map((item) => item.id)).size).toBe(3);
    const times = all.map((item) => item.at);
    expect(times).toEqual([...times].sort());
    expect(all.map((item) => item.kind)).toEqual(['STATE', 'STATE', 'EVENT']);
  });
});
