import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  RelationshipTypeSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  type EntityType,
} from '@opsgraph/shared';
import { GRAPH_REPOSITORY, type GraphRepository } from '../src/graph/graph.repository';
import { compareCodeUnits, compareIdSequences } from '../src/graph/traversal/path-order';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, entityIdByKey, resetDb, runImport } from './helpers';

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

// Research R3 "Risk to verify first": the CROSS JOIN LATERAL ( ... UNION ALL ... ) shape inside the
// recursive term. The SQL below is the exact step-1 query of R3, run on a 3-node cycle.
describe('Recursive CTE smoke test on a 3-node cycle (research R3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);

    const order = (sourceId: string) => ({
      type: 'Order',
      sourceSystem: 'OMS',
      sourceId,
      displayName: `Order ${sourceId}`,
      state: 'PENDING',
      attributes: { amount: '100.00', currency: 'USD' },
      observedAt: T1,
    });
    const requires = (from: string, to: string) => ({
      type: 'REQUIRES',
      sourceSystem: 'OPSGRAPH',
      sourceId: `rel-${from}-${to}`,
      from: keyRef('Order', 'OMS', from),
      to: keyRef('Order', 'OMS', to),
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    });
    const report = await runImport(app, {
      format: 'json',
      content: JSON.stringify({
        entities: [order('A'), order('B'), order('C')],
        relationships: [requires('A', 'B'), requires('B', 'C'), requires('C', 'A')],
      }),
    });
    expect(report?.outcome).toBe('APPLIED');
  });

  afterAll(async () => {
    await app.close();
  });

  it('terminates and returns each entity once, at its minimum depth', async () => {
    const startId = await entityIdByKey(prisma, 'Order', 'OMS', 'A');
    const followFromTypes = ['REQUIRES'];
    const followToTypes: string[] = [];
    const maxDepthPlusOne = 7;

    const rows = await prisma.$queryRaw<Array<{ id: string; depth: number }>>`
      WITH RECURSIVE walk(entity_id, depth) AS (
        SELECT ${startId}::uuid, 0
        UNION
        SELECT step.next_id, w.depth + 1
        FROM walk w
        CROSS JOIN LATERAL (
          SELECT r.to_entity_id AS next_id
          FROM relationships r
          WHERE r.from_entity_id = w.entity_id
            AND r.type = ANY(${followFromTypes}::"RelationshipType"[])
          UNION ALL
          SELECT r.from_entity_id AS next_id
          FROM relationships r
          WHERE r.to_entity_id = w.entity_id
            AND r.type = ANY(${followToTypes}::"RelationshipType"[])
        ) step
        WHERE w.depth < ${maxDepthPlusOne}
      )
      SELECT e.id::text AS id, m.depth AS depth
      FROM (SELECT entity_id, min(depth)::int AS depth FROM walk GROUP BY entity_id) m
      JOIN entities e ON e.id = m.entity_id`;

    expect(rows).toHaveLength(3);

    const depthByKey = new Map<string, number>();
    for (const sourceId of ['A', 'B', 'C']) {
      const id = await entityIdByKey(prisma, 'Order', 'OMS', sourceId);
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined) {
        throw new Error(`Entity ${sourceId} missing from the walk`);
      }
      depthByKey.set(sourceId, row.depth);
    }
    expect(Object.fromEntries(depthByKey)).toEqual({ A: 0, B: 1, C: 2 });
  });
});

describe('GraphRepository neighborhood on the seeded �39 scenario (e2e)', () => {
  let app: INestApplication;
  let repository: GraphRepository;
  let orderId: string;
  let budgetId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const prisma = app.get(PrismaService);
    repository = app.get<GraphRepository>(GRAPH_REPOSITORY);
    await resetDb(prisma);
    const report = await app.get(SeedService).seedScenario39();
    expect(report?.outcome).toBe('APPLIED');
    orderId = await entityIdByKey(prisma, 'Order', 'OMS', '18492');
    budgetId = await entityIdByKey(prisma, 'BudgetRequirement', 'FinanceApprovals', 'BR-18492');
  });

  afterAll(async () => {
    await app.close();
  });

  async function neighborhoodIds(startId: string) {
    const trace = await repository.traceNeighborhood({
      startId,
      walk: 'ALL',
      maxDepth: 2,
      relationshipTypes: RelationshipTypeSchema.options,
    });
    if (trace === null) {
      throw new Error('expected a neighborhood');
    }
    return trace;
  }

  describe.each([
    ['UPSTREAM', 'Order #18492'],
    ['DOWNSTREAM', 'Order #18492'],
    ['UPSTREAM', 'Budget code'],
    ['DOWNSTREAM', 'Budget code'],
  ] as const)('%s walk from %s', (walk, label) => {
    it.each([1, 2, 3, 4])('matches traceDependencies at depth %i', async (depth) => {
      const startId = label === 'Budget code' ? budgetId : orderId;
      const neighborhood = await repository.traceNeighborhood({
        startId,
        walk,
        maxDepth: depth,
        relationshipTypes: TRACEABLE_RELATIONSHIP_TYPES,
      });
      const dependencies = await repository.traceDependencies({
        startId,
        direction: walk,
        maxDepth: depth,
        relationshipTypes: TRACEABLE_RELATIONSHIP_TYPES,
      });
      expect(neighborhood).not.toBeNull();
      expect(dependencies).not.toBeNull();
      expect(neighborhood?.start.id).toBe(startId);
      expect(neighborhood?.reached.map((r) => [r.entity.id, r.distance])).toEqual(
        dependencies?.reached.map((r) => [r.entity.id, r.distance]),
      );
      expect(neighborhood?.reached.map((r) => r.pathEntityIds)).toEqual(
        dependencies?.reached.map((r) => [startId, ...r.path.hops.map((h) => h.target.id)]),
      );
      expect(neighborhood?.reached.map((r) => r.pathEdgeKeys)).toEqual(
        dependencies?.reached.map((r) => r.path.hops.map((h) => h.key)),
      );
    });
  });

  it('reaches 31 entities for ALL at depth 2 from Order #18492 (fixture N1)', async () => {
    const trace = await neighborhoodIds(orderId);
    expect(trace.reached).toHaveLength(31);
    expect(trace.explorationLimitReached).toBe(false);
    expect(trace.reached.filter((r) => r.distance === 1)).toHaveLength(7);
    expect(trace.reached.filter((r) => r.distance === 2)).toHaveLength(24);
    for (const reached of trace.reached) {
      expect(reached.pathEntityIds[0]).toBe(orderId);
      expect(reached.pathEntityIds.at(-1)).toBe(reached.entity.id);
      expect(reached.pathEdgeKeys).toHaveLength(reached.pathEntityIds.length - 1);
      expect(reached.pathEdgeKeys.length).toBeGreaterThanOrEqual(reached.distance);
    }
  });

  it('returns null for a nonexistent start entity', async () => {
    await expect(
      repository.traceNeighborhood({
        startId: randomUUID(),
        walk: 'ALL',
        maxDepth: 2,
        relationshipTypes: RelationshipTypeSchema.options,
      }),
    ).resolves.toBeNull();
  });

  it('refuses RELATES_TO for a directed walk', async () => {
    await expect(
      repository.traceNeighborhood({
        startId: orderId,
        walk: 'UPSTREAM',
        maxDepth: 1,
        relationshipTypes: ['RELATES_TO'],
      }),
    ).rejects.toThrow('RELATES_TO');
  });

  it('finds 60 relationship groups among the N1 entities, sorted by key (fixture N1)', async () => {
    const trace = await neighborhoodIds(orderId);
    const ids = [trace.start.id, ...trace.reached.map((r) => r.entity.id)];
    expect(ids).toHaveLength(32);
    const groups = await repository.findRelationshipsAmong(ids, RelationshipTypeSchema.options);
    expect(groups).toHaveLength(60);
    const keys = groups.map((g) => g.key);
    expect(keys).toEqual([...keys].sort());
    const idSet = new Set(ids);
    for (const group of groups) {
      expect(idSet.has(group.fromEntityId)).toBe(true);
      expect(idSet.has(group.toEntityId)).toBe(true);
      expect(group.assertions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns no groups for empty ids or empty types', async () => {
    await expect(
      repository.findRelationshipsAmong([], RelationshipTypeSchema.options),
    ).resolves.toEqual([]);
    await expect(repository.findRelationshipsAmong([orderId], [])).resolves.toEqual([]);
  });
});

describe('GraphRepository.findIncomingRelationships on the seeded §39 scenario (e2e)', () => {
  const CLAUSE = 'Orders above 10,000.00 USD require finance approval with a budget code';
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: GraphRepository;
  let orderId: string;
  let budgetId: string;
  let contractId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    repository = app.get<GraphRepository>(GRAPH_REPOSITORY);

    await resetDb(prisma);
    const report = await app.get(SeedService).seedScenario39();
    expect(report?.outcome).toBe('APPLIED');

    orderId = await entityIdByKey(prisma, 'Order', 'OMS', '18492');
    budgetId = await entityIdByKey(prisma, 'BudgetRequirement', 'FinanceApprovals', 'BR-18492');
    contractId = await entityIdByKey(prisma, 'Contract', 'ContractMgmt', 'CON-3982');
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns [] for an empty id list or an empty type list', async () => {
    expect(await repository.findIncomingRelationships([], ['DEFINES'])).toEqual([]);
    expect(await repository.findIncomingRelationships([orderId], [])).toEqual([]);
  });

  it('returns the DEFINES relationship into BR-18492 with the contract and its clause', async () => {
    const rows = await repository.findIncomingRelationships([budgetId], ['DEFINES', 'GOVERNS']);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.targetEntityId).toBe(budgetId);
    expect(row?.relationship.type).toBe('DEFINES');
    expect(row?.relationship.direction).toBe('IN');
    expect(row?.source.id).toBe(contractId);
    expect(row?.source.displayName).toBe('Contract CON-3982');
    expect(row?.source.attributes['clause']).toBe(CLAUSE);
  });

  it('returns the GOVERNS relationship into Order #18492 from CON-3982', async () => {
    const rows = await repository.findIncomingRelationships([orderId], ['DEFINES', 'GOVERNS']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relationship.type).toBe('GOVERNS');
    expect(rows[0]?.source.id).toBe(contractId);
  });

  it('returns rows for several targets together, ordered by targetEntityId', async () => {
    const rows = await repository.findIncomingRelationships(
      [orderId, budgetId],
      ['DEFINES', 'GOVERNS'],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.targetEntityId)).toEqual([orderId, budgetId].sort());
  });

  it('does not return PLACED relationships when only DEFINES and GOVERNS are requested', async () => {
    const placed = await repository.findNeighbors({
      entityId: orderId,
      direction: 'IN',
      relationshipTypes: ['PLACED'],
      limit: 10,
    });
    expect(placed.items).toHaveLength(1);

    const rows = await repository.findIncomingRelationships([orderId], ['DEFINES', 'GOVERNS']);
    expect(rows.some((row) => row.relationship.type === 'PLACED')).toBe(false);

    const placedRows = await repository.findIncomingRelationships([orderId], ['PLACED']);
    expect(placedRows).toHaveLength(1);
    expect(placedRows[0]?.relationship.type).toBe('PLACED');
  });
});

interface ImpactNode {
  type: EntityType;
  sourceId: string;
  state?: string;
  attributes?: Record<string, string>;
}

function impactEntity(node: ImpactNode) {
  return {
    type: node.type,
    sourceSystem: 'IMPACT',
    sourceId: node.sourceId,
    displayName: node.sourceId,
    observedAt: T1,
    ...(node.state === undefined ? {} : { state: node.state }),
    ...(node.attributes === undefined ? {} : { attributes: node.attributes }),
  };
}

function impactRelationship(
  type: string,
  from: ImpactNode,
  to: ImpactNode,
  options: { origin?: 'SOURCE' | 'INFERRED'; confidence?: 'HIGH' | 'LOW' } = {},
) {
  const origin = options.origin ?? 'SOURCE';
  return {
    type,
    sourceSystem: 'OPSGRAPH',
    sourceId: `rel-${type}-${from.sourceId}-${to.sourceId}`,
    from: keyRef(from.type, 'IMPACT', from.sourceId),
    to: keyRef(to.type, 'IMPACT', to.sourceId),
    origin,
    confidence: options.confidence ?? 'HIGH',
    ...(origin === 'SOURCE' ? {} : { basis: 'Added by the repository test' }),
    observedAt: T1,
  };
}

describe('GraphRepository.traceImpact (e2e)', () => {
  const sup: ImpactNode = { type: 'Supplier', sourceId: 'SUP', state: 'SUSPENDED' };
  const p1: ImpactNode = { type: 'Product', sourceId: 'P1', state: 'BLOCKED' };
  const sh1: ImpactNode = { type: 'Shipment', sourceId: 'SH1', state: 'WAITING' };
  const sh2: ImpactNode = { type: 'Shipment', sourceId: 'SH2', state: 'ACTIVE' };
  const sh3: ImpactNode = { type: 'Shipment', sourceId: 'SH3', state: 'WAITING' };
  const sh5: ImpactNode = { type: 'Shipment', sourceId: 'SH5', state: 'WAITING' };
  const done: ImpactNode = { type: 'Shipment', sourceId: 'DONE', state: 'COMPLETED' };
  const afterDone: ImpactNode = { type: 'Shipment', sourceId: 'AFTER-DONE', state: 'ACTIVE' };
  const inferred: ImpactNode = { type: 'Shipment', sourceId: 'INF', state: 'ACTIVE' };
  // A separate chain whose only entity past depth 1 is COMPLETED.
  const chainStart: ImpactNode = { type: 'Shipment', sourceId: 'CHAIN-START', state: 'BLOCKED' };
  const chainMid: ImpactNode = { type: 'Shipment', sourceId: 'CHAIN-MID', state: 'WAITING' };
  const chainEnd: ImpactNode = { type: 'Shipment', sourceId: 'CHAIN-END', state: 'COMPLETED' };
  const nodes = [sup, p1, sh1, sh2, sh3, sh5, done, afterDone, inferred, chainStart, chainMid, chainEnd];

  let app: INestApplication;
  let prisma: PrismaService;
  let repository: GraphRepository;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    repository = app.get<GraphRepository>(GRAPH_REPOSITORY);
    await resetDb(prisma);
    const report = await runImport(app, {
      format: 'json',
      content: JSON.stringify({
        entities: nodes.map(impactEntity),
        relationships: [
          impactRelationship('DEPENDS_ON', p1, sup),
          impactRelationship('DEPENDS_ON', sh1, p1),
          impactRelationship('DEPENDS_ON', sh2, p1),
          impactRelationship('DEPENDS_ON', sh3, sh2),
          impactRelationship('DEPENDS_ON', sh5, sh1),
          impactRelationship('DEPENDS_ON', sh5, sh2),
          impactRelationship('DEPENDS_ON', done, sup),
          impactRelationship('DEPENDS_ON', afterDone, done),
          impactRelationship('DEPENDS_ON', inferred, sup, { origin: 'INFERRED', confidence: 'LOW' }),
          impactRelationship('DEPENDS_ON', chainMid, chainStart),
          impactRelationship('DEPENDS_ON', chainEnd, chainMid),
        ],
      }),
    });
    expect(report?.outcome).toBe('APPLIED');
  });

  afterAll(async () => {
    await app.close();
  });

  const idOf = (node: ImpactNode) => entityIdByKey(prisma, node.type, 'IMPACT', node.sourceId);

  it('returns null for an unknown start entity', async () => {
    expect(await repository.traceImpact({ startId: randomUUID(), maxDepth: 6 })).toBeNull();
  });

  it('lists a COMPLETED entity but does not expand through it', async () => {
    const trace = await repository.traceImpact({ startId: await idOf(sup), maxDepth: 6 });
    const names = trace?.reached.map((row) => row.entity.displayName);
    expect(names).toEqual(['P1', 'DONE', 'INF', 'SH1', 'SH2', 'SH3', 'SH5']);
    expect(names).not.toContain('AFTER-DONE');
    expect(trace?.start.displayName).toBe('SUP');
  });

  it('respects maxDepth and flags a depth cut', async () => {
    const shallow = await repository.traceImpact({ startId: await idOf(sup), maxDepth: 1 });
    expect(shallow?.reached.map((row) => row.entity.displayName)).toEqual(['P1', 'DONE', 'INF']);
    expect(shallow?.reached.every((row) => row.distance === 1)).toBe(true);
    expect(shallow?.depthLimitReached).toBe(true);

    const deep = await repository.traceImpact({ startId: await idOf(sup), maxDepth: 6 });
    expect(deep?.depthLimitReached).toBe(false);
    expect(deep?.explorationLimitReached).toBe(false);
  });

  it('does not flag a depth cut when the only entity past the depth is COMPLETED', async () => {
    const trace = await repository.traceImpact({ startId: await idOf(chainStart), maxDepth: 1 });
    expect(trace?.reached.map((row) => row.entity.displayName)).toEqual(['CHAIN-MID']);
    expect(trace?.depthLimitReached).toBe(false);

    const full = await repository.traceImpact({ startId: await idOf(chainStart), maxDepth: 2 });
    expect(full?.reached.map((row) => row.entity.displayName)).toEqual(['CHAIN-MID', 'CHAIN-END']);
    expect(full?.depthLimitReached).toBe(false);
  });

  it('reports distances, live paths and sourced reach for the hand-built graph', async () => {
    const trace = await repository.traceImpact({ startId: await idOf(sup), maxDepth: 6 });
    const byName = new Map(trace?.reached.map((row) => [row.entity.displayName, row]));
    const get = (name: string) => {
      const row = byName.get(name);
      if (row === undefined) throw new Error(`${name} was not reached`);
      return row;
    };
    const names = ['P1', 'SH1', 'SH2', 'SH3', 'SH5', 'DONE', 'INF'];

    expect(names.map((name) => get(name).distance)).toEqual([1, 2, 2, 3, 3, 1, 1]);
    expect(names.map((name) => get(name).livePath !== null)).toEqual([
      true,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(get('SH5').livePath?.hops.map((hop) => hop.target.displayName)).toEqual([
      'P1',
      'SH1',
      'SH5',
    ]);
    expect(names.map((name) => get(name).sourcedReach)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);

    for (const row of trace?.reached ?? []) {
      expect(row.shortestPath.hops).toHaveLength(row.distance);
      expect(row.canonicalPath.hops.at(-1)?.target.id).toBe(row.entity.id);
    }
    expect(get('INF').canonicalPath.hops[0]?.effectiveOrigin).toBe('INFERRED');
  });

  it('has no live entities when the start is not impaired', async () => {
    const idle = await repository.traceImpact({ startId: await idOf(sh2), maxDepth: 6 });
    expect(idle?.reached.length).toBeGreaterThan(0);
    expect(idle?.reached.every((row) => row.livePath === null)).toBe(true);
  });

  it('enumerates sorted paths on demand', async () => {
    const trace = await repository.traceImpact({ startId: await idOf(sup), maxDepth: 6 });
    const sh5Id = await idOf(sh5);
    const unknownId = randomUUID();
    const sets = trace?.paths([sh5Id, unknownId]);

    const found = sets?.get(sh5Id);
    expect(found?.morePaths).toBe(false);
    expect(found?.found).toHaveLength(2);
    const idLists = (found?.found ?? []).map((path) => path.hops.map((hop) => hop.target.id));
    for (const ids of idLists) {
      expect(ids).toHaveLength(3);
      expect(ids.at(-1)).toBe(sh5Id);
    }
    expect(idLists).toEqual([...idLists].sort((a, b) => compareIdSequences(a, b)));
    expect(sets?.get(unknownId)).toEqual({ found: [], morePaths: false });
  });
});

describe('GraphRepository.traceImpact exploration limit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: GraphRepository;
  let startId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    repository = app.get<GraphRepository>(GRAPH_REPOSITORY);
    await resetDb(prisma);

    const importId = randomUUID();
    startId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO imports
        (id, trigger, format, dry_run, outcome, actor_type, file_name, byte_size,
          received_at, counts, file_errors, row_errors, correlation_id)
      VALUES (${importId}::uuid, 'SEED', 'JSON', false, 'APPLIED', 'system', 'fanout.json', 0,
        now(), '{}', '[]', '[]', ${randomUUID()}::uuid)`;
    await prisma.$executeRaw`
      INSERT INTO entities (id, type, display_name, attributes, current_state, last_observed_at, created_at, updated_at)
      VALUES (${startId}::uuid, 'Supplier', 'Fan-out start', '{}', 'SUSPENDED', now(), now(), now())`;
    await prisma.$executeRaw`
      INSERT INTO entities (id, type, display_name, attributes, current_state, last_observed_at, created_at, updated_at)
      SELECT md5('fanout-' || g)::uuid, 'Order', 'Fan-out order ' || lpad(g::text, 5, '0'), '{}', 'PENDING', now(), now(), now()
      FROM generate_series(1, 10001) AS g`;
    await prisma.$executeRaw`
      INSERT INTO relationships
        (id, type, from_entity_id, to_entity_id, origin, confidence,
          source_system, source_id, observed_at, import_id, created_at, updated_at)
      SELECT gen_random_uuid(), 'DEPENDS_ON', md5('fanout-' || g)::uuid, ${startId}::uuid,
        'SOURCE', 'HIGH', 'Perf', 'FANOUT-' || g, now(), ${importId}::uuid, now(), now()
      FROM generate_series(1, 10001) AS g`;
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('stops at 10,000 reached entities and says so', async () => {
    const trace = await repository.traceImpact({ startId, maxDepth: 6 });
    expect(trace?.explorationLimitReached).toBe(true);
    expect(trace?.reached).toHaveLength(10_000);
    expect(trace?.reached.every((row) => row.distance === 1)).toBe(true);
  }, 120_000);
});

describe('GraphRepository.findAttributedCustomers (e2e)', () => {
  const c1: ImpactNode = { type: 'Customer', sourceId: 'C1', state: 'ACTIVE' };
  const c2: ImpactNode = { type: 'Customer', sourceId: 'C2', state: 'ACTIVE' };
  const k1: ImpactNode = { type: 'Contract', sourceId: 'K1', state: 'ACTIVE' };
  const k2: ImpactNode = { type: 'Contract', sourceId: 'K2', state: 'ACTIVE' };
  const amount = { amount: '100.00', currency: 'USD' };
  const o1: ImpactNode = { type: 'Order', sourceId: 'O1', state: 'PENDING', attributes: amount };
  const o2: ImpactNode = { type: 'Order', sourceId: 'O2', state: 'PENDING', attributes: amount };
  const sl1: ImpactNode = { type: 'SLA', sourceId: 'SL1', state: 'ACTIVE' };
  const sl2: ImpactNode = { type: 'SLA', sourceId: 'SL2', state: 'ACTIVE' };
  const nodes = [c1, c2, k1, k2, o1, o2, sl1, sl2];

  let app: INestApplication;
  let prisma: PrismaService;
  let repository: GraphRepository;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    repository = app.get<GraphRepository>(GRAPH_REPOSITORY);
    await resetDb(prisma);
    const report = await runImport(app, {
      format: 'json',
      content: JSON.stringify({
        entities: nodes.map(impactEntity),
        relationships: [
          impactRelationship('HAS', c1, k1),
          impactRelationship('HAS', c2, k2),
          impactRelationship('PLACED', c1, o1),
          impactRelationship('PLACED', c1, o2),
          impactRelationship('PLACED', c2, o2),
          impactRelationship('DEFINES', k1, sl1),
          impactRelationship('DEFINES', k1, sl2),
          impactRelationship('DEFINES', k2, sl2),
        ],
      }),
    });
    expect(report?.outcome).toBe('APPLIED');
  });

  afterAll(async () => {
    await app.close();
  });

  const idOf = (node: ImpactNode) => entityIdByKey(prisma, node.type, 'IMPACT', node.sourceId);

  it('returns [] without running a query for empty input', async () => {
    const spy = jest.spyOn(prisma, '$queryRaw');
    try {
      expect(await repository.findAttributedCustomers({ orderIds: [], slaIds: [] })).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('attributes an order to its customer through PLACED (1 hop)', async () => {
    const [orderId, customerId] = [await idOf(o1), await idOf(c1)];
    const rows = await repository.findAttributedCustomers({ orderIds: [orderId], slaIds: [] });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.attributedEntityId).toBe(orderId);
    expect(row?.customer.id).toBe(customerId);
    expect(row?.customer.displayName).toBe('C1');
    expect(row?.link.hops).toHaveLength(1);
    expect(row?.link.hops[0]?.relationshipType).toBe('PLACED');
    expect(row?.link.hops[0]?.target.id).toBe(customerId);
  });

  it('attributes an SLA through DEFINES then HAS, with the contract as the middle hop', async () => {
    const [slaId, contractId, customerId] = [await idOf(sl1), await idOf(k1), await idOf(c1)];
    const rows = await repository.findAttributedCustomers({ orderIds: [], slaIds: [slaId] });
    expect(rows).toHaveLength(1);
    const hops = rows[0]?.link.hops ?? [];
    expect(hops.map((hop) => hop.relationshipType)).toEqual(['DEFINES', 'HAS']);
    expect(hops.map((hop) => hop.target.id)).toEqual([contractId, customerId]);
    expect(hops[0]?.target.type).toBe('Contract');
  });

  it('returns one row per customer, sorted, without duplicating a shared contract assertion', async () => {
    const [o2Id, sl1Id, sl2Id] = [await idOf(o2), await idOf(sl1), await idOf(sl2)];
    const rows = await repository.findAttributedCustomers({
      orderIds: [o2Id],
      slaIds: [sl1Id, sl2Id],
    });

    const customerIds = new Map([
      ['C1', await idOf(c1)],
      ['C2', await idOf(c2)],
    ]);
    const expected: Array<[string, string]> = [
      [o2Id, 'C1'],
      [o2Id, 'C2'],
      [sl1Id, 'C1'],
      [sl2Id, 'C1'],
      [sl2Id, 'C2'],
    ];
    expected.sort(
      (a, b) =>
        compareCodeUnits(a[0], b[0]) ||
        compareCodeUnits(customerIds.get(a[1]) ?? '', customerIds.get(b[1]) ?? ''),
    );
    expect(rows.map((row) => [row.attributedEntityId, row.customer.displayName])).toEqual(expected);

    for (const row of rows) {
      for (const hop of row.link.hops) {
        const ids = hop.assertions.map((assertion) => assertion.relationshipId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});
