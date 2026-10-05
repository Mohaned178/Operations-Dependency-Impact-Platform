import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  EntityDetailDtoSchema,
  EntityListResponseSchema,
  ErrorResponseSchema,
  NeighborListResponseSchema,
  SourceRecordListResponseSchema,
  SourceSystemListResponseSchema,
  StateHistoryResponseSchema,
  TimelineResponseSchema,
  type EntityListResponse,
  type NeighborListResponse,
} from '@opsgraph/shared';
import type { EntityType } from '@prisma/client';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

describe('Entities (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let orderId: string;

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

    orderId = await entityId('Order', 'OMS', '18492');
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

  function authorized(path: string): request.Test {
    return request(server).get(path).set('Authorization', `Bearer ${token}`);
  }

  async function listEntities(query: string): Promise<EntityListResponse> {
    const response = await authorized(`/api/entities?${query}`);
    expect(response.status).toBe(200);
    return EntityListResponseSchema.parse(response.body);
  }

  async function neighborsOf(id: string): Promise<NeighborListResponse> {
    const response = await authorized(`/api/entities/${id}/neighbors?limit=200`);
    expect(response.status).toBe(200);
    return NeighborListResponseSchema.parse(response.body);
  }

  it('lists entities ordered by display name and paginates without gaps or duplicates', async () => {
    const all = await listEntities('limit=200');
    expect(all.items).toHaveLength(44);
    expect(all.nextCursor).toBeNull();

    for (let index = 1; index < all.items.length; index += 1) {
      const previous = all.items[index - 1];
      const current = all.items[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous === undefined || current === undefined) {
        continue;
      }
      const ordered =
        previous.displayName < current.displayName ||
        (previous.displayName === current.displayName && previous.id < current.id);
      expect(ordered).toBe(true);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const query = cursor === undefined ? 'limit=10' : `limit=10&cursor=${encodeURIComponent(cursor)}`;
      const response = await listEntities(query);
      seen.push(...response.items.map((item) => item.id));
      cursor = response.nextCursor ?? undefined;
      if (response.nextCursor === null) {
        break;
      }
    }

    expect(seen).toHaveLength(44);
    expect(new Set(seen).size).toBe(44);
    expect(seen).toEqual(all.items.map((item) => item.id));
  });

  it('filters by type, state, source system and search', async () => {
    const orders = await listEntities('type=Order&limit=200');
    expect(orders.items).toHaveLength(20);
    expect(orders.items.every((item) => item.type === 'Order')).toBe(true);

    const blocked = await listEntities('state=BLOCKED&limit=200');
    expect(blocked.items.map((item) => item.displayName).sort()).toEqual([
      'Finance approval APR-2291',
      'Order #18492',
    ]);

    const oms = await listEntities('sourceSystem=OMS&limit=200');
    expect(oms.items).toHaveLength(20);
    expect(oms.items.every((item) => item.sourceSystems.includes('OMS'))).toBe(true);

    const byName = await listEntities('q=Northwind&limit=200');
    expect(byName.items).toHaveLength(1);
    expect(byName.items[0]?.displayName).toBe('Northwind Steel');

    const bySourceId = await listEntities('q=AC-778&limit=200');
    expect(bySourceId.items).toHaveLength(1);
    expect(bySourceId.items[0]?.displayName).toBe('Acme Corp');

    const orderSearch = await listEntities('q=18492&limit=200');
    expect(orderSearch.items.map((item) => item.id)).toContain(orderId);
  });

  it('returns the Order #18492 detail from quickstart step 2', async () => {
    const response = await authorized(`/api/entities/${orderId}`);
    expect(response.status).toBe(200);
    const detail = EntityDetailDtoSchema.parse(response.body);

    expect(detail.type).toBe('Order');
    expect(detail.displayName).toBe('Order #18492');
    expect(detail.currentState).toBe('BLOCKED');
    expect(detail.attributes).toMatchObject({ amount: '12480.00', currency: 'USD' });
    expect(
      detail.identifiers.map(({ sourceSystem, sourceId }) => ({ sourceSystem, sourceId })),
    ).toEqual([
      { sourceSystem: 'OMS', sourceId: '18492' },
      { sourceSystem: 'ERP', sourceId: 'SO-18492' },
    ]);
    for (const identifier of detail.identifiers) {
      expect(identifier.firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(detail.sourceSystems).toEqual(['ERP', 'OMS']);
    expect(detail.lastObservedAt).toBe('2026-09-29T11:40:00.000Z');

    expect(detail.currentStateObservation).toMatchObject({
      state: 'BLOCKED',
      sourceStatus: 'ON_HOLD',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: '2026-09-29T11:40:00.000Z',
    });
    expect(detail.latestStateBySource.map((item) => `${item.sourceSystem}:${item.state}`)).toEqual([
      'ERP:PENDING',
      'OMS:BLOCKED',
    ]);
    expect(detail.counts).toEqual({
      sourceRecords: 4,
      stateObservations: 4,
      relationships: 7,
      events: 4,
    });
  });

  it('returns neighbors with origin, confidence, basis and provenance', async () => {
    const parsed = await neighborsOf(orderId);
    expect(parsed.items).toHaveLength(7);
    expect(parsed.nextCursor).toBeNull();

    for (const item of parsed.items) {
      expect(item.relationship.sourceSystem.length).toBeGreaterThan(0);
      expect(item.relationship.sourceId.length).toBeGreaterThan(0);
      expect(item.relationship.importId).toMatch(/^[0-9a-f-]{36}$/);
      expect(item.relationship.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(item.relationship.origin).toBe('SOURCE');
      expect(item.relationship.confidence).toBe('HIGH');
      expect(item.relationship.basis).toBeNull();
    }

    const byNeighbor = new Map(parsed.items.map((item) => [item.neighbor.displayName, item]));
    expect(byNeighbor.get('Acme Corp')?.relationship).toMatchObject({
      type: 'PLACED',
      direction: 'IN',
    });
    expect(byNeighbor.get('Contract CON-3982')?.relationship).toMatchObject({
      type: 'GOVERNS',
      direction: 'IN',
    });
    expect(byNeighbor.get('Payment PAY-88213')?.relationship).toMatchObject({
      type: 'REQUIRES',
      direction: 'OUT',
    });
    expect(byNeighbor.get('East Distribution Center 02')?.relationship).toMatchObject({
      type: 'FULFILLED_BY',
      direction: 'OUT',
    });
    expect(byNeighbor.get('Shipment SHP-77120 (consolidated)')?.relationship).toMatchObject({
      type: 'DEPENDS_ON',
      direction: 'IN',
    });
    expect(byNeighbor.get('Industrial Pallet Racking Kit')?.relationship).toMatchObject({
      type: 'CONTAINS',
      direction: 'OUT',
    });
    expect(byNeighbor.get('Invoice INV-55120')?.relationship).toMatchObject({
      type: 'GENERATES',
      direction: 'OUT',
    });
  });

  it('shows the INFERRED and MANUAL relationships with their basis', async () => {
    const productId = await entityId('Product', 'PIM', 'PRD-5521');
    const productNeighbors = await neighborsOf(productId);
    const inferred = productNeighbors.items.find(
      (item) => item.neighbor.displayName === 'Contoso Metals',
    );
    expect(inferred?.relationship).toMatchObject({
      type: 'SUPPLIED_BY',
      direction: 'OUT',
      origin: 'INFERRED',
      confidence: 'LOW',
      basis: 'Alternate supplier inferred from 2026 purchase-order history',
    });

    const shipmentId = await entityId('Shipment', 'TMS', 'SHP-77120');
    const shipmentNeighbors = await neighborsOf(shipmentId);
    const manual = shipmentNeighbors.items.find(
      (item) => item.neighbor.displayName === 'Payment PAY-88213',
    );
    expect(manual?.relationship).toMatchObject({
      type: 'BLOCKS',
      direction: 'IN',
      origin: 'MANUAL',
      confidence: 'MEDIUM',
      basis: 'Recorded by ops analyst: carrier will not book the consolidated load until payment clears',
    });
  });

  it('returns the timeline in chronological order with events before state changes', async () => {
    const response = await authorized(`/api/entities/${orderId}/timeline?limit=200`);
    expect(response.status).toBe(200);
    const parsed = TimelineResponseSchema.parse(response.body);

    expect(parsed.items.map((item) => item.kind)).toEqual([
      'EVENT',
      'STATE',
      'EVENT',
      'STATE',
      'STATE',
      'EVENT',
      'STATE',
      'EVENT',
    ]);
    const times = parsed.items.map((item) => item.at);
    expect(times).toEqual([...times].sort());

    const first = parsed.items[0];
    expect(first?.kind).toBe('EVENT');
    if (first?.kind === 'EVENT') {
      expect(first.eventType).toBe('order.created');
      expect(first.role).toBe('SUBJECT');
      expect(first.entities.map((link) => link.entity.displayName)).toEqual([
        'Order #18492',
        'Acme Corp',
        'Contract CON-3982',
      ]);
    }

    const paymentEvent = parsed.items[2];
    if (paymentEvent?.kind === 'EVENT') {
      expect(paymentEvent.eventType).toBe('payment.initiated');
      expect(paymentEvent.role).toBe('RELATED');
    }

    const delayed = parsed.items[7];
    if (delayed?.kind === 'EVENT') {
      expect(delayed.eventType).toBe('shipment.delayed');
      expect(delayed.role).toBe('RELATED');
    }
  });

  it('paginates state observations newest first', async () => {
    const firstResponse = await authorized(`/api/entities/${orderId}/states?limit=2`);
    expect(firstResponse.status).toBe(200);
    const firstPage = StateHistoryResponseSchema.parse(firstResponse.body);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0]).toMatchObject({
      state: 'BLOCKED',
      sourceSystem: 'OMS',
      observedAt: '2026-09-29T11:40:00.000Z',
    });
    expect(firstPage.items[1]).toMatchObject({
      state: 'PENDING',
      sourceSystem: 'ERP',
      observedAt: '2026-09-29T09:20:00.000Z',
    });
    expect(firstPage.nextCursor).not.toBeNull();

    const secondResponse = await authorized(
      `/api/entities/${orderId}/states?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
    );
    const secondPage = StateHistoryResponseSchema.parse(secondResponse.body);
    expect(secondPage.items.map((item) => item.observedAt)).toEqual([
      '2026-09-29T09:14:00.000Z',
      '2026-09-29T09:12:00.000Z',
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('paginates source records newest first and keeps the raw payload', async () => {
    const firstResponse = await authorized(`/api/entities/${orderId}/source-records?limit=2`);
    expect(firstResponse.status).toBe(200);
    const firstPage = SourceRecordListResponseSchema.parse(firstResponse.body);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0]).toMatchObject({
      kind: 'ENTITY',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: '2026-09-29T11:40:00.000Z',
    });
    expect(firstPage.items[0]?.rawPayload).toMatchObject({ type: 'Order', state: 'BLOCKED' });
    expect(firstPage.items[1]).toMatchObject({
      sourceSystem: 'ERP',
      sourceId: 'SO-18492',
      observedAt: '2026-09-29T09:20:00.000Z',
    });
    expect(firstPage.nextCursor).not.toBeNull();

    const secondResponse = await authorized(
      `/api/entities/${orderId}/source-records?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
    );
    const secondPage = SourceRecordListResponseSchema.parse(secondResponse.body);
    expect(secondPage.items.map((item) => item.observedAt)).toEqual([
      '2026-09-29T09:14:00.000Z',
      '2026-09-29T09:12:00.000Z',
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('returns the distinct, sorted source systems', async () => {
    const response = await authorized('/api/source-systems');
    expect(response.status).toBe(200);
    const parsed = SourceSystemListResponseSchema.parse(response.body);
    expect(parsed.items).toEqual([
      'CRM',
      'ContractMgmt',
      'ERP',
      'FinanceApprovals',
      'OMS',
      'PIM',
      'Payments',
      'TMS',
      'WMS',
    ]);
  });

  it('returns 404 for an unknown entity, 400 for a bad id and 401 without a token', async () => {
    const missing = await authorized(`/api/entities/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(ErrorResponseSchema.parse(missing.body).error.code).toBe('NOT_FOUND');

    const bad = await authorized('/api/entities/not-a-uuid');
    expect(bad.status).toBe(400);
    expect(ErrorResponseSchema.parse(bad.body).error.code).toBe('VALIDATION_FAILED');

    const anonymous = await request(server).get('/api/entities');
    expect(anonymous.status).toBe(401);
  });
});
