import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorResponseSchema,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type ImportReport,
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

const T1 = '2026-09-29T08:05:00Z';
const T2 = '2026-09-29T08:10:00Z';
const T3 = '2026-09-29T08:15:00Z';

function lines(...rows: string[]): string {
  return rows.join('\n');
}

const ENTITIES_CSV = lines(
  'type,source_system,source_id,display_name,observed_at,attr.amount,attr.currency',
  `Order,DemoOMS,ORD-1,Order #1,${T1},12480.00,USD`,
  `Payment,DemoPay,PAY-1,Payment #1,${T2},12480.00,USD`,
);

const RELATIONSHIPS_CSV = lines(
  'type,source_system,source_id,from_type,from_source_system,from_source_id,to_type,to_source_system,to_source_id,origin,confidence,basis,observed_at',
  `REQUIRES,DemoPay,REL-1,Order,DemoOMS,ORD-1,Payment,DemoPay,PAY-1,INFERRED,MEDIUM,The payment is required,${T3}`,
);

const EVENTS_CSV = lines(
  'type,source_system,source_id,occurred_at,observed_at,subject_type,subject_source_system,subject_source_id,related,description',
  `order.created,DemoOMS,EVT-1,${T1},${T1},Order,DemoOMS,ORD-1,Payment|DemoPay|PAY-1,Order #1 created`,
);

const DOCUMENT = {
  entities: [
    {
      type: 'Customer',
      sourceSystem: 'CRM',
      sourceId: 'acme',
      displayName: 'Acme Corp',
      observedAt: T1,
    },
    {
      type: 'Order',
      sourceSystem: 'OMS',
      sourceId: '18492',
      displayName: 'Order #18492',
      observedAt: T1,
      state: 'BLOCKED',
      sourceStatus: 'BLOCKED',
      attributes: { amount: '12480.00', currency: 'USD' },
      customField: 'kept in the raw payload',
    },
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

function toReport(body: unknown): ImportReport {
  return body as ImportReport;
}

function expectInvariant(report: ImportReport): void {
  for (const kind of ['entities', 'relationships', 'events'] as const) {
    const counts = report.counts[kind];
    expect(counts.received).toBe(
      counts.created + counts.updated + counts.unchanged + counts.rejected,
    );
  }
}

jest.setTimeout(60_000);

describe('Imports (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let admin: User;
  let analyst: User;
  let manager: User;
  let adminToken: string;
  let analystToken: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    admin = await createUser(prisma, { role: 'ADMIN', email: 'imports-admin@test.local' });
    analyst = await createUser(prisma, { role: 'ANALYST', email: 'analyst@test.local' });
    manager = await createUser(prisma, { role: 'OPS_MANAGER', email: 'manager@test.local' });
    adminToken = (await login(app, admin.email, TEST_PASSWORD)).accessToken;
    analystToken = (await login(app, analyst.email, TEST_PASSWORD)).accessToken;
    managerToken = (await login(app, manager.email, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies a JSON document through HTTP and returns its report', async () => {
    const response = await importFile(app, adminToken, JSON.stringify(DOCUMENT), {
      format: 'json',
    });
    expect(response.status).toBe(201);
    const report = toReport(response.body);

    expect(report.outcome).toBe('APPLIED');
    expect(report.format).toBe('json');
    expect(report.kind).toBeNull();
    expect(report.submittedBy).toEqual({ id: admin.id, email: admin.email });
    expect(report.counts.entities.created).toBe(2);
    expect(report.counts.relationships.created).toBe(1);
    expect(report.counts.events.created).toBe(1);
    expectInvariant(report);

    const stored = await prisma.import.findUnique({ where: { id: report.id } });
    expect(stored?.outcome).toBe('APPLIED');
    expect(await prisma.entity.count()).toBe(2);
  });

  it('applies one CSV file for each kind', async () => {
    const entities = await importFile(app, adminToken, ENTITIES_CSV, {
      format: 'csv',
      kind: 'entities',
    });
    expect(entities.status).toBe(201);
    expect(toReport(entities.body).outcome).toBe('APPLIED');
    expect(toReport(entities.body).kind).toBe('entities');
    expect(toReport(entities.body).counts.entities.created).toBe(2);

    const relationships = await importFile(app, adminToken, RELATIONSHIPS_CSV, {
      format: 'csv',
      kind: 'relationships',
    });
    expect(relationships.status).toBe(201);
    expect(toReport(relationships.body).outcome).toBe('APPLIED');
    expect(toReport(relationships.body).counts.relationships.created).toBe(1);

    const events = await importFile(app, adminToken, EVENTS_CSV, {
      format: 'csv',
      kind: 'events',
    });
    expect(events.status).toBe(201);
    expect(toReport(events.body).outcome).toBe('APPLIED');
    expect(toReport(events.body).counts.events.created).toBe(1);

    expect(await prisma.entity.count()).toBe(2);
    expect(await prisma.relationship.count()).toBe(1);
    expect(await prisma.event.count()).toBe(1);
  });

  it('saves nothing for a dry run', async () => {
    const response = await importFile(app, adminToken, ENTITIES_CSV, {
      format: 'csv',
      kind: 'entities',
      dryRun: true,
    });
    expect(response.status).toBe(201);
    const report = toReport(response.body);

    expect(report.outcome).toBe('DRY_RUN');
    expect(report.countsAreProjected).toBe(true);
    expect(report.counts.entities.created).toBe(2);
    expect(await prisma.entity.count()).toBe(0);
  });

  it('reports static CSV problems with the column name and row number', async () => {
    const csv = lines(
      'type,source_system,source_id,display_name,observed_at,attr.amount,attr.currency',
      `Widget,Demo,W-1,Widget,${T1},,`,
      'Order,Demo,O-1,Order #1,2026-09-29T08:00:00,,',
      `Order,Demo,O-2,Order #2,${T1},"12,480.00",USD`,
      `Customer,Demo,C-1,Acme,${T1},,`,
    );

    const response = await importFile(app, adminToken, csv, {
      format: 'csv',
      kind: 'entities',
    });
    expect(response.status).toBe(201);
    const report = toReport(response.body);

    expect(report.outcome).toBe('REJECTED');
    expect(report.countsAreProjected).toBe(true);
    expect(await prisma.entity.count()).toBe(0);

    const byRow = new Map(report.rowErrors.map((error) => [error.row, error]));
    expect(byRow.get(2)?.field).toBe('type');
    expect(byRow.get(2)?.message).toContain('Customer');
    expect(
      report.rowErrors.some((error) => error.row === 3 && error.field === 'observed_at'),
    ).toBe(true);
    expect(byRow.get(4)?.field).toBe('attr.amount');
    expect(report.counts.entities.rejected).toBe(3);
    expect(report.counts.entities.created).toBe(1);
    expectInvariant(report);
  });

  it('reports disallowed pairs, self-loops and missing relationship fields', async () => {
    const setup = await importFile(
      app,
      adminToken,
      lines(
        'type,source_system,source_id,display_name,observed_at,attr.amount,attr.currency',
        `Customer,Demo,C-1,Customer,${T1},,`,
        `Order,Demo,O-1,Order,${T1},12480.00,USD`,
        `Supplier,Demo,S-1,Supplier,${T1},,`,
      ),
      { format: 'csv', kind: 'entities' },
    );
    expect(toReport(setup.body).outcome).toBe('APPLIED');

    const csv = lines(
      'type,source_system,source_id,from_type,from_source_system,from_source_id,to_type,to_source_system,to_source_id,origin,confidence,basis,observed_at',
      `PLACED,Demo,R-1,Supplier,Demo,S-1,Order,Demo,O-1,SOURCE,HIGH,,${T3}`,
      `REQUIRES,Demo,R-2,Customer,Demo,C-1,Customer,Demo,C-1,SOURCE,HIGH,,${T3}`,
      `REQUIRES,Demo,R-3,Customer,,C-1,Order,Demo,O-1,SOURCE,HIGH,,${T3}`,
      `REQUIRES,Demo,R-4,Customer,Demo,C-1,Order,Demo,O-1,INFERRED,MEDIUM,,${T3}`,
    );

    const response = await importFile(app, adminToken, csv, {
      format: 'csv',
      kind: 'relationships',
    });
    const report = toReport(response.body);

    expect(report.outcome).toBe('REJECTED');
    expect(await prisma.relationship.count()).toBe(0);

    const byRow = new Map(report.rowErrors.map((error) => [error.row, error]));
    expect(byRow.get(2)?.message).toBe(
      'PLACED requires from Customer → to Order; got Supplier → Order',
    );
    expect(byRow.get(3)?.message).toBe('A relationship cannot connect an entity to itself');
    expect(byRow.get(4)?.field).toBe('from_source_system');
    expect(byRow.get(5)?.field).toBe('basis');
    expect(byRow.get(5)?.message).toContain('basis is required');
    expectInvariant(report);
  });

  it('counts a CSV row that mixes both reference forms twice as one rejected row', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const csv = lines(
      'type,source_system,source_id,from_id,from_type,from_source_system,from_source_id,to_id,to_type,to_source_system,to_source_id,origin,confidence,basis,observed_at',
      `REQUIRES,Demo,R-1,${id},Customer,Demo,C-1,${id},Order,Demo,O-1,SOURCE,HIGH,,${T3}`,
    );

    const response = await importFile(app, adminToken, csv, {
      format: 'csv',
      kind: 'relationships',
    });
    const report = toReport(response.body);

    expect(report.outcome).toBe('REJECTED');
    expect(report.rowErrors.map((error) => error.field)).toEqual(['from_id', 'to_id']);
    expect(report.counts.relationships).toMatchObject({ received: 1, rejected: 1 });
    expectInvariant(report);
  });

  it('rejects a row that depends on a rejected entity row', async () => {
    const document = {
      entities: [
        { ...DOCUMENT.entities[0] },
        { ...DOCUMENT.entities[1], displayName: '' },
      ],
      relationships: DOCUMENT.relationships,
    };

    const response = await importFile(app, adminToken, JSON.stringify(document), {
      format: 'json',
    });
    const report = toReport(response.body);

    expect(report.outcome).toBe('REJECTED');
    const dependent = report.rowErrors.find((error) => error.dependsOn !== null);
    expect(dependent?.kind).toBe('relationships');
    expect(dependent?.row).toBe(1);
    expect(dependent?.dependsOn).toEqual({ kind: 'entities', row: 2 });
    expect(dependent?.message).toBe('Depends on rejected entities row 2');
    expect(await prisma.relationship.count()).toBe(0);
  });

  it('reports a short CSV row without failing the other rows', async () => {
    const csv = lines(
      'type,source_system,source_id,display_name,observed_at',
      'Order,DemoOMS,ORD-1',
    );

    const response = await importFile(app, adminToken, csv, {
      format: 'csv',
      kind: 'entities',
    });
    const report = toReport(response.body);

    expect(report.outcome).toBe('REJECTED');
    expect(report.rowErrors).toEqual([
      { kind: 'entities', row: 2, field: null, message: 'Expected 5 columns, found 3', dependsOn: null },
    ]);
  });

  it('reports invalid JSON, unknown sections and non-UTF-8 files', async () => {
    const invalidJson = await importFile(app, adminToken, '{ not json', { format: 'json' });
    expect(invalidJson.status).toBe(201);
    expect(toReport(invalidJson.body).outcome).toBe('REJECTED');
    expect(toReport(invalidJson.body).fileErrors).toHaveLength(1);
    expect(toReport(invalidJson.body).counts.entities.received).toBe(0);

    const unknownSection = await importFile(
      app,
      adminToken,
      JSON.stringify({ entities: [], widgets: [] }),
      { format: 'json' },
    );
    expect(toReport(unknownSection.body).outcome).toBe('REJECTED');
    expect(toReport(unknownSection.body).fileErrors).toEqual([
      'Unknown top-level section "widgets"',
    ]);

    const notUtf8 = await importFile(app, adminToken, new Uint8Array([0xc3, 0x28]), {
      format: 'json',
    });
    expect(toReport(notUtf8.body).outcome).toBe('REJECTED');
    expect(toReport(notUtf8.body).fileErrors).toEqual(['File is not valid UTF-8']);
  });

  it('stores unknown JSON row fields in the raw payload', async () => {
    await importFile(app, adminToken, JSON.stringify(DOCUMENT), { format: 'json' });

    const record = await prisma.sourceRecord.findFirst({
      where: { kind: 'ENTITY', sourceId: '18492' },
    });
    expect(record?.rawPayload).toMatchObject({ customField: 'kept in the raw payload' });
  });

  it('returns 413 and audits a file over the byte limit', async () => {
    const response = await importFile(
      app,
      adminToken,
      Buffer.alloc(IMPORT_MAX_BYTES + 1, 0x61),
      { format: 'json', fileName: 'too-big.json' },
    );

    expect(response.status).toBe(413);
    const body: unknown = response.body;
    expect(ErrorResponseSchema.parse(body).error.code).toBe('IMPORT_TOO_LARGE');

    const audit = await prisma.auditEntry.findFirst({
      where: { action: AUDIT_ACTIONS.IMPORT_REFUSED },
    });
    expect(audit?.metadata).toMatchObject({ reason: 'bytes', limit: IMPORT_MAX_BYTES });
    expect(await prisma.import.count()).toBe(0);
  });

  it('returns 413 and audits more than the row limit', async () => {
    const document = {
      entities: Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_value, index) => ({
        type: 'Customer',
        sourceSystem: 'Demo',
        sourceId: `C-${index}`,
        displayName: `Customer ${index}`,
        observedAt: T1,
      })),
    };

    const response = await importFile(app, adminToken, JSON.stringify(document), {
      format: 'json',
    });

    expect(response.status).toBe(413);
    const body: unknown = response.body;
    expect(ErrorResponseSchema.parse(body).error.code).toBe('IMPORT_TOO_LARGE');

    const audit = await prisma.auditEntry.findFirst({
      where: { action: AUDIT_ACTIONS.IMPORT_REFUSED },
    });
    expect(audit?.metadata).toMatchObject({
      reason: 'rows',
      limit: IMPORT_MAX_ROWS,
      actual: IMPORT_MAX_ROWS + 1,
    });
    expect(await prisma.import.count()).toBe(0);
  });

  it('returns 400 for a missing file or invalid form fields', async () => {
    const noFile = await request(server)
      .post('/api/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('format', 'json');
    expect(noFile.status).toBe(400);
    expect(ErrorResponseSchema.parse(noFile.body as unknown).error.details?.[0]?.path).toBe('file');

    const noFormat = await request(server)
      .post('/api/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(JSON.stringify(DOCUMENT), 'utf8'), 'import.json');
    expect(noFormat.status).toBe(400);
    expect(ErrorResponseSchema.parse(noFormat.body as unknown).error.details?.[0]?.path).toBe(
      'format',
    );

    const jsonWithKind = await importFile(app, adminToken, JSON.stringify(DOCUMENT), {
      format: 'json',
      kind: 'entities',
    });
    expect(jsonWithKind.status).toBe(400);
    expect(
      ErrorResponseSchema.parse(jsonWithKind.body as unknown).error.details?.[0]?.path,
    ).toBe('kind');

    const csvWithoutKind = await importFile(app, adminToken, ENTITIES_CSV, { format: 'csv' });
    expect(csvWithoutKind.status).toBe(400);
    expect(
      ErrorResponseSchema.parse(csvWithoutKind.body as unknown).error.details?.[0]?.path,
    ).toBe('kind');
  });

  it('forbids non-admins and audits the attempts', async () => {
    const anonymous = await request(server).post('/api/imports');
    expect(anonymous.status).toBe(401);

    const asAnalyst = await importFile(app, analystToken, ENTITIES_CSV, {
      format: 'csv',
      kind: 'entities',
    });
    expect(asAnalyst.status).toBe(403);
    expect(ErrorResponseSchema.parse(asAnalyst.body as unknown).error.code).toBe('FORBIDDEN');

    const asManager = await importFile(app, managerToken, ENTITIES_CSV, {
      format: 'csv',
      kind: 'entities',
    });
    expect(asManager.status).toBe(403);
    expect(ErrorResponseSchema.parse(asManager.body as unknown).error.code).toBe('FORBIDDEN');

    const forbidden = await prisma.auditEntry.findMany({
      where: { action: AUDIT_ACTIONS.AUTH_FORBIDDEN },
    });
    expect(forbidden).toHaveLength(2);
    expect(forbidden.map((entry) => entry.actorId).sort()).toEqual([analyst.id, manager.id].sort());
    expect(await prisma.entity.count()).toBe(0);
  });

  it('lists imports newest first and returns one report by id', async () => {
    const first = toReport(
      (await importFile(app, adminToken, ENTITIES_CSV, { format: 'csv', kind: 'entities' })).body,
    );
    const second = toReport(
      (await importFile(app, adminToken, JSON.stringify(DOCUMENT), { format: 'json' })).body,
    );

    const list = await request(server)
      .get('/api/imports?limit=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const firstPage = list.body as { items: { id: string; errorCount: number }[]; nextCursor: string | null };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.id).toBe(second.id);
    expect(firstPage.nextCursor).not.toBeNull();

    const next = await request(server)
      .get(`/api/imports?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const secondPage = next.body as { items: { id: string }[]; nextCursor: string | null };
    expect(secondPage.items.map((item) => item.id)).toEqual([first.id]);
    expect(secondPage.nextCursor).toBeNull();

    const one = await request(server)
      .get(`/api/imports/${first.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(one.status).toBe(200);
    expect((one.body as ImportReport).id).toBe(first.id);
    expect((one.body as ImportReport).counts.entities.created).toBe(2);

    const missing = await request(server)
      .get('/api/imports/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(ErrorResponseSchema.parse(missing.body as unknown).error.code).toBe('NOT_FOUND');

    const nonUuid = await request(server)
      .get('/api/imports/nope')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(nonUuid.status).toBe(400);
  });
});
