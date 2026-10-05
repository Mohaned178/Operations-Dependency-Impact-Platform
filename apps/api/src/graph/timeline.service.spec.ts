import type { PrismaService } from '../prisma/prisma.service';
import { TimelineService } from './timeline.service';

const ENTITY_ID = '55555555-5555-4555-8555-555555555555';
const IMPORT_ID = '66666666-6666-4666-8666-666666666666';
const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const S1 = '33333333-3333-4333-8333-333333333333';
const S2 = '44444444-4444-4444-8444-444444444444';
const T = new Date('2026-09-29T09:12:00.000Z');

function event(id: string, at: Date) {
  return {
    id,
    type: 'order.created',
    occurredAt: at,
    observedAt: new Date(at.getTime() + 60_000),
    description: null,
    sourceSystem: 'OMS',
    sourceId: `EVT-${id}`,
    importId: IMPORT_ID,
    entities: [
      {
        entityId: ENTITY_ID,
        role: 'SUBJECT' as const,
        entity: {
          id: ENTITY_ID,
          type: 'Order' as const,
          displayName: 'Order #18492',
          currentState: 'BLOCKED' as const,
        },
      },
    ],
  };
}

function state(id: string, at: Date) {
  return {
    id,
    state: 'PENDING' as const,
    sourceStatus: 'NEW',
    sourceSystem: 'OMS',
    sourceId: `OBS-${id}`,
    observedAt: at,
    importId: IMPORT_ID,
  };
}

function createService() {
  const entityFindUnique = jest.fn();
  const eventFindMany = jest.fn();
  const stateFindMany = jest.fn();
  const prisma = {
    entity: { findUnique: entityFindUnique },
    event: { findMany: eventFindMany },
    stateObservation: { findMany: stateFindMany },
  } as unknown as PrismaService;

  return { service: new TimelineService(prisma), entityFindUnique, eventFindMany, stateFindMany };
}

describe('TimelineService', () => {
  it('orders events before state changes at equal timestamps', async () => {
    const { service, entityFindUnique, eventFindMany, stateFindMany } = createService();
    entityFindUnique.mockResolvedValue({ id: ENTITY_ID });
    eventFindMany.mockResolvedValue([event(E1, T), event(E2, T)]);
    stateFindMany.mockResolvedValue([state(S1, T)]);

    const response = await service.list(ENTITY_ID, { limit: 50 });

    expect(response.items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      `EVENT:${E1}`,
      `EVENT:${E2}`,
      `STATE:${S1}`,
    ]);
    expect(response.nextCursor).toBeNull();
  });

  it('pages across a tie without gaps or duplicates', async () => {
    const { service, entityFindUnique, eventFindMany, stateFindMany } = createService();
    entityFindUnique.mockResolvedValue({ id: ENTITY_ID });
    eventFindMany
      .mockResolvedValueOnce([event(E1, T), event(E2, T)])
      .mockResolvedValueOnce([event(E2, T)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    stateFindMany
      .mockResolvedValueOnce([state(S1, T), state(S2, T)])
      .mockResolvedValueOnce([state(S1, T), state(S2, T)])
      .mockResolvedValueOnce([state(S1, T), state(S2, T)])
      .mockResolvedValueOnce([state(S2, T)]);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page += 1) {
      const response = await service.list(ENTITY_ID, { cursor, limit: 1 });
      seen.push(...response.items.map((item) => `${item.kind}:${item.id}`));
      cursor = response.nextCursor ?? undefined;
      if (response.nextCursor === null) {
        break;
      }
    }

    expect(seen).toEqual([`EVENT:${E1}`, `EVENT:${E2}`, `STATE:${S1}`, `STATE:${S2}`]);
    expect(new Set(seen).size).toBe(seen.length);

    const stateCalls = stateFindMany.mock.calls as Array<[{ where: unknown }]>;
    expect(stateCalls[2]?.[0]?.where).toEqual({
      entityId: ENTITY_ID,
      observedAt: { gte: T },
    });
    const eventCalls = eventFindMany.mock.calls as Array<[{ where: unknown }]>;
    expect(eventCalls[2]?.[0]?.where).toEqual({
      entities: { some: { entityId: ENTITY_ID } },
      OR: [{ occurredAt: { gt: T } }, { occurredAt: T, id: { gt: E2 } }],
    });
    expect(stateCalls[3]?.[0]?.where).toEqual({
      entityId: ENTITY_ID,
      OR: [{ observedAt: { gt: T } }, { observedAt: T, id: { gt: S1 } }],
    });
  });

  it('includes events at the cursor time when the cursor is a state change', async () => {
    const { service, entityFindUnique, eventFindMany, stateFindMany } = createService();
    entityFindUnique.mockResolvedValue({ id: ENTITY_ID });
    eventFindMany.mockResolvedValue([]);
    stateFindMany.mockResolvedValue([]);

    const cursor = Buffer.from(
      JSON.stringify({ at: T.toISOString(), kindRank: 1, id: S1 }),
      'utf8',
    ).toString('base64url');
    await service.list(ENTITY_ID, { cursor, limit: 10 });

    const eventCalls = eventFindMany.mock.calls as Array<[{ where: unknown }]>;
    expect(eventCalls[0]?.[0]?.where).toEqual({
      entities: { some: { entityId: ENTITY_ID } },
      occurredAt: { gt: T },
    });
    const stateCalls = stateFindMany.mock.calls as Array<[{ where: unknown }]>;
    expect(stateCalls[0]?.[0]?.where).toEqual({
      entityId: ENTITY_ID,
      OR: [{ observedAt: { gt: T } }, { observedAt: T, id: { gt: S1 } }],
    });
  });

  it('throws NOT_FOUND for an unknown entity', async () => {
    const { service, entityFindUnique } = createService();
    entityFindUnique.mockResolvedValue(null);

    await expect(service.list(ENTITY_ID, { limit: 10 })).rejects.toMatchObject({ status: 404 });
  });
});
