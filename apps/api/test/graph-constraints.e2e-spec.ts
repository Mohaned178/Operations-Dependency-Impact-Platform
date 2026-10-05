import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDb } from './helpers';

describe('Graph constraints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createImport(): Promise<string> {
    const id = randomUUID();
    const counts = { received: 0, created: 0, updated: 0, unchanged: 0, rejected: 0 };
    await prisma.import.create({
      data: {
        id,
        trigger: 'API',
        format: 'JSON',
        dryRun: false,
        outcome: 'APPLIED',
        actorType: 'system',
        fileName: 'constraints.json',
        byteSize: 0,
        receivedAt: new Date(),
        counts: { entities: counts, relationships: counts, events: counts },
        fileErrors: [],
        rowErrors: [],
        correlationId: randomUUID(),
      },
    });
    return id;
  }

  async function createEntity(): Promise<string> {
    const id = randomUUID();
    await prisma.entity.create({
      data: { id, type: 'Order', displayName: `Order ${id}`, lastObservedAt: new Date() },
    });
    return id;
  }

  async function createSourceRecord(importId: string, entityId: string): Promise<string> {
    const id = randomUUID();
    await prisma.sourceRecord.create({
      data: {
        id,
        kind: 'ENTITY',
        sourceSystem: 'OMS',
        sourceId: id,
        observedAt: new Date(),
        receivedAt: new Date(),
        rawPayload: { source: 'constraints' },
        payloadHash: 'a'.repeat(64),
        normalized: {},
        importId,
        entityId,
      },
    });
    return id;
  }

  it('rejects UPDATE, DELETE and TRUNCATE on source_records', async () => {
    const importId = await createImport();
    const entityId = await createEntity();
    const recordId = await createSourceRecord(importId, entityId);

    await expect(
      prisma.sourceRecord.update({ where: { id: recordId }, data: { sourceId: 'changed' } }),
    ).rejects.toThrow(/is append-only/);
    await expect(prisma.sourceRecord.delete({ where: { id: recordId } })).rejects.toThrow(
      /is append-only/,
    );
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE source_records CASCADE')).rejects.toThrow(
      /is append-only/,
    );
  });

  it('rejects UPDATE, DELETE and TRUNCATE on state_observations', async () => {
    const importId = await createImport();
    const entityId = await createEntity();
    const sourceRecordId = await createSourceRecord(importId, entityId);
    const observationId = randomUUID();
    await prisma.stateObservation.create({
      data: {
        id: observationId,
        entityId,
        sourceRecordId,
        state: 'BLOCKED',
        sourceSystem: 'OMS',
        sourceId: 'obs-1',
        observedAt: new Date(),
        receivedAt: new Date(),
        importId,
      },
    });

    await expect(
      prisma.stateObservation.update({
        where: { id: observationId },
        data: { state: 'ACTIVE' },
      }),
    ).rejects.toThrow(/is append-only/);
    await expect(
      prisma.stateObservation.delete({ where: { id: observationId } }),
    ).rejects.toThrow(/is append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE state_observations')).rejects.toThrow(
      /is append-only/,
    );
  });

  it('rejects a self-loop relationship', async () => {
    const importId = await createImport();
    const entityId = await createEntity();

    await expect(
      prisma.relationship.create({
        data: {
          id: randomUUID(),
          type: 'RELATES_TO',
          fromEntityId: entityId,
          toEntityId: entityId,
          origin: 'SOURCE',
          confidence: 'HIGH',
          sourceSystem: 'OPSGRAPH',
          sourceId: 'self-loop',
          observedAt: new Date(),
          importId,
        },
      }),
    ).rejects.toThrow(/relationships_no_self_loop/);
  });

  it('rejects a source record with two owners', async () => {
    const importId = await createImport();
    const fromEntityId = await createEntity();
    const toEntityId = await createEntity();
    const relationshipId = randomUUID();
    await prisma.relationship.create({
      data: {
        id: relationshipId,
        type: 'RELATES_TO',
        fromEntityId,
        toEntityId,
        origin: 'SOURCE',
        confidence: 'HIGH',
        sourceSystem: 'OPSGRAPH',
        sourceId: 'two-owners',
        observedAt: new Date(),
        importId,
      },
    });

    await expect(
      prisma.sourceRecord.create({
        data: {
          id: randomUUID(),
          kind: 'ENTITY',
          sourceSystem: 'OMS',
          sourceId: 'two-owners',
          observedAt: new Date(),
          receivedAt: new Date(),
          rawPayload: {},
          payloadHash: 'b'.repeat(64),
          normalized: {},
          importId,
          entityId: fromEntityId,
          relationshipId,
        },
      }),
    ).rejects.toThrow(/source_records_owner_matches_kind/);
  });

  it('rejects two SUBJECT rows for one event', async () => {
    const importId = await createImport();
    const subjectId = await createEntity();
    const otherId = await createEntity();
    const eventId = randomUUID();
    await prisma.event.create({
      data: {
        id: eventId,
        type: 'order.blocked',
        occurredAt: new Date(),
        observedAt: new Date(),
        sourceSystem: 'OMS',
        sourceId: 'evt-1',
        importId,
      },
    });

    await prisma.eventEntity.create({
      data: { eventId, entityId: subjectId, role: 'SUBJECT' },
    });
    await expect(
      prisma.eventEntity.create({ data: { eventId, entityId: otherId, role: 'SUBJECT' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
