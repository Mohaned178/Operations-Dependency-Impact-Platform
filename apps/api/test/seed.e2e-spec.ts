import type { INestApplication } from '@nestjs/common';
import type { Entity, EntityType } from '@prisma/client';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDb } from './helpers';

interface TableCounts {
  entities: number;
  identifiers: number;
  sourceRecords: number;
  stateObservations: number;
  relationships: number;
  events: number;
  eventEntities: number;
  imports: number;
  audits: number;
}

describe('SeedService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: SeedService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    seed = app.get(SeedService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function entityByKey(
    entityType: EntityType,
    sourceSystem: string,
    sourceId: string,
  ): Promise<Entity> {
    const identifier = await prisma.entityIdentifier.findUnique({
      where: { entityType_sourceSystem_sourceId: { entityType, sourceSystem, sourceId } },
    });
    if (identifier === null) {
      throw new Error(`No identifier ${entityType}/${sourceSystem}/${sourceId}`);
    }
    const entity = await prisma.entity.findUnique({ where: { id: identifier.entityId } });
    if (entity === null) {
      throw new Error(`No entity for identifier ${entityType}/${sourceSystem}/${sourceId}`);
    }
    return entity;
  }

  async function countTables(): Promise<TableCounts> {
    const [
      entities,
      identifiers,
      sourceRecords,
      stateObservations,
      relationships,
      events,
      eventEntities,
      imports,
      audits,
    ] = await Promise.all([
      prisma.entity.count(),
      prisma.entityIdentifier.count(),
      prisma.sourceRecord.count(),
      prisma.stateObservation.count(),
      prisma.relationship.count(),
      prisma.event.count(),
      prisma.eventEntity.count(),
      prisma.import.count(),
      prisma.auditEntry.count(),
    ]);
    return {
      entities,
      identifiers,
      sourceRecords,
      stateObservations,
      relationships,
      events,
      eventEntities,
      imports,
      audits,
    };
  }

  async function seedOnce(): Promise<void> {
    const report = await seed.seedScenario39();
    expect(report).not.toBeNull();
    expect(report?.outcome).toBe('APPLIED');
    expect(report?.trigger).toBe('SEED');
  }

  it('loads the §39 scenario with the documented counts', async () => {
    await seedOnce();

    expect(await prisma.entity.count()).toBe(44);
    expect(await prisma.entityIdentifier.count()).toBe(46);
    expect(await prisma.sourceRecord.count()).toBe(160);
    expect(await prisma.stateObservation.count()).toBe(48);
    expect(await prisma.relationship.count()).toBe(102);
    expect(await prisma.event.count()).toBe(10);
  });

  it('projects Order #18492, the budget requirement and the approval correctly', async () => {
    await seedOnce();

    const order = await entityByKey('Order', 'OMS', '18492');
    expect(order.currentState).toBe('BLOCKED');

    const observations = await prisma.stateObservation.findMany({
      where: { entityId: order.id },
      orderBy: [{ observedAt: 'asc' }, { seq: 'asc' }],
    });
    expect(observations).toHaveLength(4);
    const latestBySource = new Map<string, string>();
    for (const observation of observations) {
      latestBySource.set(observation.sourceSystem, observation.state);
    }
    expect(latestBySource.get('OMS')).toBe('BLOCKED');
    expect(latestBySource.get('ERP')).toBe('PENDING');
    expect(order.currentState).toBe(latestBySource.get('OMS'));

    const budgetRequirement = await entityByKey(
      'BudgetRequirement',
      'FinanceApprovals',
      'BR-18492',
    );
    expect(budgetRequirement.currentState).toBe('MISSING');
    const approval = await entityByKey('Approval', 'FinanceApprovals', 'APR-2291');
    expect(approval.currentState).toBe('BLOCKED');
  });

  it('is idempotent: a second run writes no rows and no audit entries', async () => {
    await seedOnce();
    const before = await countTables();

    const second = await seed.seedScenario39();

    expect(second).toBeNull();
    expect(await countTables()).toEqual(before);
  });

  it('keeps provenance complete and covers every origin and confidence', async () => {
    await seedOnce();

    const missing = await prisma.$queryRaw<Array<{ table_name: string; missing: bigint }>>`
      SELECT 'source_records' AS table_name, count(*) AS missing
        FROM source_records
        WHERE source_system IS NULL OR source_id IS NULL OR observed_at IS NULL OR import_id IS NULL
      UNION ALL
      SELECT 'state_observations', count(*)
        FROM state_observations
        WHERE source_system IS NULL OR source_id IS NULL OR observed_at IS NULL OR import_id IS NULL
      UNION ALL
      SELECT 'relationships', count(*)
        FROM relationships
        WHERE source_system IS NULL OR source_id IS NULL OR observed_at IS NULL OR import_id IS NULL
      UNION ALL
      SELECT 'events', count(*)
        FROM events
        WHERE source_system IS NULL OR source_id IS NULL OR observed_at IS NULL OR import_id IS NULL
      ORDER BY table_name
    `;
    expect(missing).toHaveLength(4);
    for (const row of missing) {
      expect(row.missing).toBe(0n);
    }

    const origins = await prisma.relationship.findMany({
      distinct: ['origin'],
      select: { origin: true },
    });
    expect(origins.map((row) => row.origin).sort()).toEqual(['INFERRED', 'MANUAL', 'SOURCE']);

    const confidences = await prisma.relationship.findMany({
      distinct: ['confidence'],
      select: { confidence: true },
    });
    expect(confidences.map((row) => row.confidence).sort()).toEqual(['HIGH', 'LOW', 'MEDIUM']);
  });
});
