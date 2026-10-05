import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { EntityType } from '@opsgraph/shared';
import { GRAPH_REPOSITORY, type GraphRepository } from '../src/graph/graph.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDb, runImport } from './helpers';

const T1 = '2026-09-14T08:00:00+00:00';

function keyRef(entityType: EntityType, sourceSystem: string, sourceId: string) {
  return { entityType, sourceSystem, sourceId };
}

const DOCUMENT = {
  entities: [
    {
      type: 'Product',
      sourceSystem: 'PIM',
      sourceId: 'HUB',
      displayName: 'Hub Product',
      observedAt: T1,
    },
    {
      type: 'Customer',
      sourceSystem: 'CRM',
      sourceId: 'c1',
      displayName: 'Alpha Customer',
      observedAt: T1,
    },
    {
      type: 'Customer',
      sourceSystem: 'CRM',
      sourceId: 'c3',
      displayName: 'Gamma Customer',
      observedAt: T1,
    },
    {
      type: 'Supplier',
      sourceSystem: 'PIM',
      sourceId: 's1',
      displayName: 'Supplier One',
      observedAt: T1,
    },
    {
      type: 'Warehouse',
      sourceSystem: 'WMS',
      sourceId: 'w1',
      displayName: 'Warehouse One',
      observedAt: T1,
    },
    {
      type: 'Customer',
      sourceSystem: 'CRM',
      sourceId: 'cycle-a',
      displayName: 'Cycle A',
      observedAt: T1,
    },
    {
      type: 'Customer',
      sourceSystem: 'CRM',
      sourceId: 'cycle-b',
      displayName: 'Cycle B',
      observedAt: T1,
    },
  ],
  relationships: [
    {
      type: 'REQUIRES',
      sourceSystem: 'OPSGRAPH',
      sourceId: 'rel-hub-c1-a',
      from: keyRef('Product', 'PIM', 'HUB'),
      to: keyRef('Customer', 'CRM', 'c1'),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
    {
      type: 'REQUIRES',
      sourceSystem: 'LEGACY',
      sourceId: 'rel-hub-c1-b',
      from: keyRef('Product', 'PIM', 'HUB'),
      to: keyRef('Customer', 'CRM', 'c1'),
      origin: 'INFERRED',
      confidence: 'LOW',
      basis: 'Duplicated link from the legacy system',
      observedAt: T1,
    },
    {
      type: 'DEPENDS_ON',
      sourceSystem: 'OPSGRAPH',
      sourceId: 'rel-hub-c3',
      from: keyRef('Product', 'PIM', 'HUB'),
      to: keyRef('Customer', 'CRM', 'c3'),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
    {
      type: 'RELATES_TO',
      sourceSystem: 'OPSGRAPH',
      sourceId: 'rel-hub-s1',
      from: keyRef('Product', 'PIM', 'HUB'),
      to: keyRef('Supplier', 'PIM', 's1'),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
    {
      type: 'RELATES_TO',
      sourceSystem: 'OPSGRAPH',
      sourceId: 'rel-hub-w1',
      from: keyRef('Product', 'PIM', 'HUB'),
      to: keyRef('Warehouse', 'WMS', 'w1'),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
    {
      type: 'REQUIRES',
      sourceSystem: 'CRM',
      sourceId: 'rel-c1-hub',
      from: keyRef('Customer', 'CRM', 'c1'),
      to: keyRef('Product', 'PIM', 'HUB'),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
    {
      type: 'DEPENDS_ON',
      sourceSystem: 'WMS',
      sourceId: 'rel-w1-hub',
      from: keyRef('Warehouse', 'WMS', 'w1'),
      to: keyRef('Product', 'PIM', 'HUB'),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
    {
      type: 'RELATES_TO',
      sourceSystem: 'OPSGRAPH',
      sourceId: 'rel-cycle-ab',
      from: keyRef('Customer', 'CRM', 'cycle-a'),
      to: keyRef('Customer', 'CRM', 'cycle-b'),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
    {
      type: 'RELATES_TO',
      sourceSystem: 'OPSGRAPH',
      sourceId: 'rel-cycle-ba',
      from: keyRef('Customer', 'CRM', 'cycle-b'),
      to: keyRef('Customer', 'CRM', 'cycle-a'),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
  ],
};

describe('GraphRepository (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: GraphRepository;
  let hubId: string;
  let cycleAId: string;
  let cycleBId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    repository = app.get<GraphRepository>(GRAPH_REPOSITORY);

    await resetDb(prisma);
    const report = await runImport(app, { format: 'json', content: JSON.stringify(DOCUMENT) });
    expect(report?.outcome).toBe('APPLIED');

    hubId = await entityId('Product', 'PIM', 'HUB');
    cycleAId = await entityId('Customer', 'CRM', 'cycle-a');
    cycleBId = await entityId('Customer', 'CRM', 'cycle-b');
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

  it('returns OUT, IN and BOTH with the right direction labels', async () => {
    const both = await repository.findNeighbors({ entityId: hubId, direction: 'BOTH', limit: 200 });
    expect(both.items).toHaveLength(7);
    expect(both.nextCursor).toBeNull();

    const out = await repository.findNeighbors({ entityId: hubId, direction: 'OUT', limit: 200 });
    expect(out.items).toHaveLength(5);
    expect(out.items.every((row) => row.relationship.direction === 'OUT')).toBe(true);
    expect(out.items.map((row) => row.neighbor.displayName)).toEqual(
      expect.arrayContaining(['Alpha Customer', 'Gamma Customer', 'Supplier One', 'Warehouse One']),
    );

    const incoming = await repository.findNeighbors({
      entityId: hubId,
      direction: 'IN',
      limit: 200,
    });
    expect(incoming.items).toHaveLength(2);
    expect(incoming.items.every((row) => row.relationship.direction === 'IN')).toBe(true);
    expect(incoming.items.map((row) => row.neighbor.displayName).sort()).toEqual([
      'Alpha Customer',
      'Warehouse One',
    ]);
  });

  it('applies the relationshipTypes and neighborTypes filters', async () => {
    const requires = await repository.findNeighbors({
      entityId: hubId,
      direction: 'BOTH',
      relationshipTypes: ['REQUIRES'],
      limit: 200,
    });
    expect(requires.items).toHaveLength(3);
    expect(requires.items.every((row) => row.relationship.type === 'REQUIRES')).toBe(true);

    const customers = await repository.findNeighbors({
      entityId: hubId,
      direction: 'BOTH',
      neighborTypes: ['Customer'],
      limit: 200,
    });
    expect(customers.items).toHaveLength(4);
    expect(customers.items.every((row) => row.neighbor.type === 'Customer')).toBe(true);

    const none = await repository.findNeighbors({
      entityId: hubId,
      direction: 'BOTH',
      relationshipTypes: ['BLOCKS'],
      limit: 200,
    });
    expect(none.items).toEqual([]);
  });

  it('returns two relationships of the same type and endpoints from different sources', async () => {
    const page = await repository.findNeighbors({
      entityId: hubId,
      direction: 'OUT',
      relationshipTypes: ['REQUIRES'],
      limit: 200,
    });

    const toAlpha = page.items.filter((row) => row.neighbor.displayName === 'Alpha Customer');
    expect(toAlpha).toHaveLength(2);
    expect(toAlpha.map((row) => row.relationship.sourceSystem).sort()).toEqual([
      'LEGACY',
      'OPSGRAPH',
    ]);
  });

  it('handles a 2-node cycle without returning a node as its own neighbor', async () => {
    const fromA = await repository.findNeighbors({
      entityId: cycleAId,
      direction: 'BOTH',
      limit: 200,
    });
    expect(fromA.items).toHaveLength(2);
    expect(fromA.items.every((row) => row.neighbor.id === cycleBId)).toBe(true);
    expect(fromA.items.map((row) => row.relationship.direction).sort()).toEqual(['IN', 'OUT']);

    const fromB = await repository.findNeighbors({
      entityId: cycleBId,
      direction: 'BOTH',
      limit: 200,
    });
    expect(fromB.items).toHaveLength(2);
    expect(fromB.items.every((row) => row.neighbor.id === cycleAId)).toBe(true);

    expect(await repository.countNeighbors(cycleAId)).toBe(2);
    expect(await repository.countNeighbors(cycleBId)).toBe(2);
  });

  it('paginates across 3 pages without gaps or duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const page = await repository.findNeighbors({
        entityId: hubId,
        direction: 'BOTH',
        cursor,
        limit: 3,
      });
      pages += 1;
      seen.push(...page.items.map((row) => row.relationship.id));
      cursor = page.nextCursor ?? undefined;
      if (page.nextCursor === null) {
        break;
      }
    } while (cursor !== undefined);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);

    const all = await repository.findNeighbors({ entityId: hubId, direction: 'BOTH', limit: 200 });
    expect(seen).toEqual(all.items.map((row) => row.relationship.id));
  });

  it('returns identical output for two identical calls', async () => {
    const first = await repository.findNeighbors({ entityId: hubId, direction: 'BOTH', limit: 200 });
    const second = await repository.findNeighbors({
      entityId: hubId,
      direction: 'BOTH',
      limit: 200,
    });
    expect(second).toEqual(first);
  });

  it('returns an empty page for an unknown entity id', async () => {
    const page = await repository.findNeighbors({
      entityId: randomUUID(),
      direction: 'BOTH',
      limit: 200,
    });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('countNeighbors equals the number of relationships returned across all pages', async () => {
    expect(await repository.countNeighbors(hubId)).toBe(7);
    expect(await repository.countNeighbors(randomUUID())).toBe(0);
  });

  it('rejects an invalid cursor', async () => {
    await expect(
      repository.findNeighbors({ entityId: hubId, direction: 'BOTH', cursor: 'not-a-cursor', limit: 3 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
