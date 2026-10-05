import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  AuditListResponseSchema,
  ErrorResponseSchema,
  PublicUserSchema,
  type AuditListResponse,
} from '@opsgraph/shared';
import request from 'supertest';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

const TEMPORARY_PASSWORD = 'OpsGraph-Temp-2026!';

describe('Audit (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await createUser(prisma, { role: 'ADMIN', email: 'admin@test.local' });
    ({ accessToken: adminToken } = await login(app, 'admin@test.local', TEST_PASSWORD));
  });

  afterAll(async () => {
    await app.close();
  });

  function asAdmin(): { Authorization: string } {
    return { Authorization: `Bearer ${adminToken}` };
  }

  async function getAudit(query: string): Promise<AuditListResponse> {
    const response = await request(server)
      .get(`/api/audit?${query}`)
      .set(asAdmin())
      .expect(200);
    const body: unknown = response.body;
    return AuditListResponseSchema.parse(body);
  }

  it('records exactly one row per user action with the right before/after', async () => {
    const createdResponse = await request(server)
      .post('/api/users')
      .set(asAdmin())
      .send({
        email: 'workflow@test.local',
        displayName: 'Workflow User',
        role: 'ANALYST',
        temporaryPassword: TEMPORARY_PASSWORD,
      })
      .expect(201);
    const createdBody: unknown = createdResponse.body;
    const created = PublicUserSchema.parse(createdBody);

    await request(server)
      .patch(`/api/users/${created.id}`)
      .set(asAdmin())
      .send({ role: 'OPS_MANAGER' })
      .expect(200);
    await request(server)
      .post(`/api/users/${created.id}/deactivate`)
      .set(asAdmin())
      .expect(200);
    await request(server)
      .post(`/api/users/${created.id}/reactivate`)
      .set(asAdmin())
      .expect(200);
    await request(server)
      .post(`/api/users/${created.id}/reset-password`)
      .set(asAdmin())
      .send({ temporaryPassword: TEMPORARY_PASSWORD })
      .expect(204);

    const rows = await prisma.auditEntry.findMany({ where: { targetId: created.id } });
    expect(rows).toHaveLength(5);

    const createdRow = rows.find((row) => row.action === AUDIT_ACTIONS.USER_CREATED);
    expect(createdRow?.before).toBeNull();
    expect(createdRow?.after).toEqual(created);

    const roleRow = rows.find((row) => row.action === AUDIT_ACTIONS.USER_ROLE_CHANGED);
    expect(roleRow?.before).toEqual({ role: 'ANALYST' });
    expect(roleRow?.after).toEqual({ role: 'OPS_MANAGER' });

    const deactivatedRow = rows.find((row) => row.action === AUDIT_ACTIONS.USER_DEACTIVATED);
    expect(deactivatedRow?.before).toEqual({ status: 'ACTIVE' });
    expect(deactivatedRow?.after).toEqual({ status: 'DEACTIVATED' });

    const reactivatedRow = rows.find((row) => row.action === AUDIT_ACTIONS.USER_REACTIVATED);
    expect(reactivatedRow?.before).toEqual({ status: 'DEACTIVATED' });
    expect(reactivatedRow?.after).toEqual({ status: 'ACTIVE' });

    const resetRow = rows.find((row) => row.action === AUDIT_ACTIONS.USER_PASSWORD_RESET);
    expect(resetRow).toBeDefined();
    expect(resetRow?.before).toBeNull();
    expect(resetRow?.after).toBeNull();
  });

  it('applies every filter and paginates without duplicates or gaps', async () => {
    const actor = await createUser(prisma, { role: 'ANALYST', email: 'filter-actor@test.local' });
    await prisma.auditEntry.createMany({
      data: [
        {
          actorType: 'user',
          actorId: actor.id,
          action: 'test.filtered',
          targetType: 'user',
          targetId: 'alpha',
          occurredAt: new Date('2026-01-15T10:00:00.000Z'),
          correlationId: randomUUID(),
        },
        {
          actorType: 'system',
          action: 'test.other',
          targetType: 'widget',
          targetId: 'beta',
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
          correlationId: randomUUID(),
        },
      ],
    });

    const byActor = await getAudit(`actorId=${actor.id}&action=test.filtered`);
    expect(byActor.items).toHaveLength(1);
    expect(byActor.items[0]?.targetId).toBe('alpha');
    expect(byActor.items[0]?.actorEmail).toBe(actor.email);

    const byTargetType = await getAudit('targetType=widget');
    expect(byTargetType.items).toHaveLength(1);
    expect(byTargetType.items[0]?.targetId).toBe('beta');

    const byTargetId = await getAudit('targetId=beta');
    expect(byTargetId.items).toHaveLength(1);
    expect(byTargetId.items[0]?.action).toBe('test.other');

    const byRange = await getAudit('from=2026-05-01T00:00:00.000Z&to=2026-07-01T00:00:00.000Z');
    expect(byRange.items).toHaveLength(1);
    expect(byRange.items[0]?.targetId).toBe('beta');

    await prisma.auditEntry.createMany({
      data: Array.from({ length: 120 }, (_, index) => ({
        actorType: 'system',
        action: 'test.pagination',
        targetType: 'batch',
        targetId: `row-${index}`,
        correlationId: randomUUID(),
      })),
    });

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const query =
        cursor === null
          ? 'action=test.pagination&limit=50'
          : `action=test.pagination&limit=50&cursor=${cursor}`;
      const parsed = await getAudit(query);
      collected.push(...parsed.items.map((item) => item.id));
      cursor = parsed.nextCursor;
    }

    expect(collected).toHaveLength(120);
    expect(new Set(collected).size).toBe(120);
    expect(cursor).toBeNull();

    const ids = collected.map((id) => BigInt(id));
    expect(ids.every((id, index) => index === 0 || id < (ids[index - 1] ?? 0n))).toBe(true);
  });

  it('rejects every raw mutation of the audit table', async () => {
    await expect(prisma.$executeRaw`UPDATE audit_entries SET action = 'x'`).rejects.toThrow(
      'append-only',
    );
    await expect(prisma.$executeRaw`DELETE FROM audit_entries`).rejects.toThrow('append-only');
    await expect(prisma.$executeRaw`TRUNCATE audit_entries`).rejects.toThrow('append-only');
  });

  it('rolls back the mutation when the audit write fails', async () => {
    const target = await createUser(prisma, { role: 'ANALYST', email: 'atomic@test.local' });
    const auditService = app.get(AuditService);
    const recordSpy = jest
      .spyOn(auditService, 'record')
      .mockRejectedValueOnce(new Error('boom'));

    const response = await request(server)
      .patch(`/api/users/${target.id}`)
      .set(asAdmin())
      .send({ role: 'OPS_MANAGER' })
      .expect(500);
    recordSpy.mockRestore();

    const body: unknown = response.body;
    expect(ErrorResponseSchema.parse(body).error.code).toBe('INTERNAL');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.role).toBe('ANALYST');
  });

  it('never stores a password or token in the audit trail', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'scan@test.local' });
    await request(server)
      .post('/api/users')
      .set(asAdmin())
      .send({
        email: 'scan-target@test.local',
        displayName: 'Scan Target',
        role: 'ANALYST',
        temporaryPassword: TEMPORARY_PASSWORD,
      })
      .expect(201);
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'scan@test.local', password: 'Wrong-Password-123' })
      .expect(401);

    const rows = await prisma.auditEntry.findMany();
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows.map((row) => ({ ...row, id: row.id.toString() })));
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain(TEMPORARY_PASSWORD);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('tokenHash');
  });
});
