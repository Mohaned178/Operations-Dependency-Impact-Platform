import type { INestApplication } from '@nestjs/common';
import { AUDIT_ACTIONS, type ImportReport } from '@opsgraph/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDb, runImport } from './helpers';

const T1 = '2026-09-14T08:00:00+00:00';

const ORDER_ROW = {
  type: 'Order',
  sourceSystem: 'OMS',
  sourceId: '18492',
  displayName: 'Order #18492',
  observedAt: T1,
  state: 'BLOCKED',
  sourceStatus: 'BLOCKED',
  attributes: { amount: '12480.00', currency: 'USD' },
  customField: 'kept in the raw payload',
};

const DOCUMENT = {
  entities: [
    {
      type: 'Customer',
      sourceSystem: 'CRM',
      sourceId: 'acme',
      displayName: 'Acme Corp',
      observedAt: T1,
    },
    ORDER_ROW,
  ],
  relationships: [
    {
      type: 'PLACED',
      sourceSystem: 'OPSGRAPH',
      sourceId: 'placed-1',
      from: { entityType: 'Customer', sourceSystem: 'CRM', sourceId: 'acme' },
      to: { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
      origin: 'SOURCE',
      confidence: 'HIGH',
      observedAt: T1,
    },
  ],
  events: [
    {
      type: 'order.blocked',
      sourceSystem: 'OMS',
      sourceId: 'evt-1',
      occurredAt: T1,
      observedAt: T1,
      subject: { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
    },
  ],
};

function document(): string {
  return JSON.stringify(DOCUMENT);
}

function expectInvariant(report: ImportReport): void {
  for (const kind of ['entities', 'relationships', 'events'] as const) {
    const counts = report.counts[kind];
    expect(counts.received).toBe(
      counts.created + counts.updated + counts.unchanged + counts.rejected,
    );
  }
}

describe('ImportService (e2e)', () => {
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

  it('applies a valid 3-section JSON and audits every created row', async () => {
    const report = await runImport(app, { format: 'json', content: document() });
    expect(report).not.toBeNull();
    const result = report as ImportReport;

    expect(result.outcome).toBe('APPLIED');
    expect(result.countsAreProjected).toBe(false);
    expect(result.trigger).toBe('API');
    expect(result.format).toBe('json');
    expect(result.kind).toBeNull();
    expect(result.submittedBy?.email).toBe('imports-admin@test.local');
    expect(result.rowErrors).toEqual([]);
    expect(result.fileErrors).toEqual([]);
    expect(result.counts.entities).toEqual({
      received: 2,
      created: 2,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });
    expect(result.counts.relationships).toEqual({
      received: 1,
      created: 1,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });
    expect(result.counts.events).toEqual({
      received: 1,
      created: 1,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });
    expectInvariant(result);

    expect(await prisma.entity.count()).toBe(2);
    expect(await prisma.entityIdentifier.count()).toBe(2);
    expect(await prisma.relationship.count()).toBe(1);
    expect(await prisma.event.count()).toBe(1);
    expect(await prisma.eventEntity.count()).toBe(1);
    expect(await prisma.sourceRecord.count()).toBe(4);
    expect(await prisma.stateObservation.count()).toBe(1);

    const audits = await prisma.auditEntry.findMany({ orderBy: { id: 'asc' } });
    const summary = audits.find((audit) => audit.action === AUDIT_ACTIONS.IMPORT_APPLIED);
    expect(summary?.targetType).toBe('import');
    expect(summary?.targetId).toBe(result.id);

    const rowAudits = audits.filter((audit) => audit.action !== AUDIT_ACTIONS.IMPORT_APPLIED);
    expect(rowAudits.map((audit) => audit.action).sort()).toEqual([
      'entity.created',
      'entity.created',
      'entity.state_observed',
      'event.created',
      'relationship.created',
    ]);
    for (const audit of rowAudits) {
      expect(audit.metadata).toMatchObject({ importId: result.id });
    }
  });

  it('stores unknown row fields in the raw payload', async () => {
    await runImport(app, { format: 'json', content: document() });

    const record = await prisma.sourceRecord.findFirst({
      where: { kind: 'ENTITY', sourceId: '18492' },
    });
    expect(record?.rawPayload).toMatchObject({ customField: 'kept in the raw payload' });
    expect(record?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks the same file again as unchanged and writes no graph rows', async () => {
    await runImport(app, { format: 'json', content: document() });
    const second = await runImport(app, { format: 'json', content: document() });
    const result = second as ImportReport;

    expect(result.outcome).toBe('APPLIED');
    expect(result.counts.entities.unchanged).toBe(2);
    expect(result.counts.relationships.unchanged).toBe(1);
    expect(result.counts.events.unchanged).toBe(1);
    expectInvariant(result);

    expect(await prisma.entity.count()).toBe(2);
    expect(await prisma.sourceRecord.count()).toBe(4);
    expect(await prisma.import.count()).toBe(2);
  });

  it('rejects the whole import when one row is invalid, writing no graph rows', async () => {
    const invalid = {
      ...DOCUMENT,
      entities: [DOCUMENT.entities[0], { ...ORDER_ROW, displayName: '' }],
    };
    const report = await runImport(app, { format: 'json', content: JSON.stringify(invalid) });
    const result = report as ImportReport;

    expect(result.outcome).toBe('REJECTED');
    expect(result.countsAreProjected).toBe(true);
    expect(result.counts.entities.rejected).toBe(1);
    expect(result.counts.entities.created).toBe(1);
    expect(result.rowErrors).toHaveLength(3);
    const staticError = result.rowErrors.find((error) => error.kind === 'entities');
    expect(staticError).toMatchObject({ row: 2, field: 'displayName' });
    const dependentErrors = result.rowErrors.filter((error) => error.dependsOn !== null);
    expect(dependentErrors).toHaveLength(2);
    for (const error of dependentErrors) {
      expect(error.dependsOn).toEqual({ kind: 'entities', row: 2 });
      expect(error.message).toBe('Depends on rejected entities row 2');
    }
    expectInvariant(result);

    expect(await prisma.entity.count()).toBe(0);
    expect(await prisma.relationship.count()).toBe(0);
    expect(await prisma.sourceRecord.count()).toBe(0);
    expect(await prisma.import.count()).toBe(1);

    const audits = await prisma.auditEntry.findMany();
    expect(audits.map((audit) => audit.action)).toEqual([AUDIT_ACTIONS.IMPORT_REJECTED]);
  });

  it('writes nothing but the report and audit for a dry run', async () => {
    const report = await runImport(app, { format: 'json', content: document(), dryRun: true });
    const result = report as ImportReport;

    expect(result.outcome).toBe('DRY_RUN');
    expect(result.countsAreProjected).toBe(true);
    expect(result.counts.entities.created).toBe(2);
    expectInvariant(result);

    expect(await prisma.entity.count()).toBe(0);
    expect(await prisma.sourceRecord.count()).toBe(0);
    expect(await prisma.import.count()).toBe(1);

    const audits = await prisma.auditEntry.findMany();
    expect(audits.map((audit) => audit.action)).toEqual([AUDIT_ACTIONS.IMPORT_DRY_RUN]);
  });

  it('returns null when skipIfNoChanges finds no change', async () => {
    await runImport(app, { format: 'json', content: document() });
    const importsBefore = await prisma.import.count();

    const report = await runImport(app, {
      format: 'json',
      content: document(),
      skipIfNoChanges: true,
    });

    expect(report).toBeNull();
    expect(await prisma.import.count()).toBe(importsBefore);
  });

  it('serializes two concurrent runs so the second sees the first as unchanged', async () => {
    const [first, second] = await Promise.all([
      runImport(app, { format: 'json', content: document() }),
      runImport(app, { format: 'json', content: document() }),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const reports = [first as ImportReport, second as ImportReport];
    expectInvariant(reports[0] as ImportReport);
    expectInvariant(reports[1] as ImportReport);

    const created = reports.filter((report) => report.counts.entities.created === 2);
    const unchanged = reports.filter(
      (report) => report.counts.entities.unchanged === 2 && report.counts.entities.created === 0,
    );
    expect(created).toHaveLength(1);
    expect(unchanged).toHaveLength(1);

    expect(await prisma.entity.count()).toBe(2);
    expect(await prisma.sourceRecord.count()).toBe(4);
    expect(await prisma.import.count()).toBe(2);
  });
});
