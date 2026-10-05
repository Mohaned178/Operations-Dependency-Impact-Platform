import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  AuthSessionSchema,
  ErrorResponseSchema,
  PublicUserSchema,
  UserListResponseSchema,
} from '@opsgraph/shared';
import type { User } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

const TEMPORARY_PASSWORD = 'OpsGraph-Temp-2026!';
const CHANGED_PASSWORD = 'OpsGraph-Changed-2026!';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let admin: User;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
  });

  beforeEach(async () => {
    await resetDb(prisma);
    admin = await createUser(prisma, { role: 'ADMIN', email: 'admin@test.local' });
    ({ accessToken: adminToken } = await login(app, 'admin@test.local', TEST_PASSWORD));
  });

  afterAll(async () => {
    await app.close();
  });

  function asAdmin(): { Authorization: string } {
    return { Authorization: `Bearer ${adminToken}` };
  }

  it('creates a user who must change the temporary password', async () => {
    const response = await request(server)
      .post('/api/users')
      .set(asAdmin())
      .send({
        email: 'New.User@test.local',
        displayName: 'New User',
        role: 'ANALYST',
        temporaryPassword: TEMPORARY_PASSWORD,
      })
      .expect(201);

    const body: unknown = response.body;
    const created = PublicUserSchema.parse(body);
    expect(created.email).toBe('new.user@test.local');
    expect(created.displayName).toBe('New User');
    expect(created.role).toBe('ANALYST');
    expect(created.status).toBe('ACTIVE');
    expect(created.mustChangePassword).toBe(true);

    const { accessToken } = await login(app, 'new.user@test.local', TEMPORARY_PASSWORD);
    const me = await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const meBody: unknown = me.body;
    expect(PublicUserSchema.parse(meBody).mustChangePassword).toBe(true);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'dup@test.local' });

    const response = await request(server)
      .post('/api/users')
      .set(asAdmin())
      .send({
        email: 'DUP@test.local',
        displayName: 'Duplicate',
        role: 'ANALYST',
        temporaryPassword: TEMPORARY_PASSWORD,
      })
      .expect(409);

    const body: unknown = response.body;
    expect(ErrorResponseSchema.parse(body).error.code).toBe('EMAIL_TAKEN');
  });

  it('lists, searches, filters and paginates users', async () => {
    const zoe = await createUser(prisma, { role: 'ANALYST', email: 'zoe@test.local' });
    await prisma.user.update({ where: { id: zoe.id }, data: { displayName: 'Zoe Keeper' } });
    const bob = await createUser(prisma, { role: 'OPS_MANAGER', email: 'bob@test.local' });
    await prisma.user.update({ where: { id: bob.id }, data: { displayName: 'Bob Manager' } });
    await createUser(prisma, { role: 'ANALYST', email: 'carl@test.local' });
    await createUser(prisma, { role: 'ANALYST', email: 'dana@test.local' });

    const search = await request(server).get('/api/users?q=ZOe').set(asAdmin()).expect(200);
    const searchBody: unknown = search.body;
    const searchPage = UserListResponseSchema.parse(searchBody);
    expect(searchPage.items.map((user) => user.email)).toEqual(['zoe@test.local']);

    const managers = await request(server)
      .get('/api/users?role=OPS_MANAGER')
      .set(asAdmin())
      .expect(200);
    const managersBody: unknown = managers.body;
    const managerPage = UserListResponseSchema.parse(managersBody);
    expect(managerPage.items).toHaveLength(1);
    expect(managerPage.items[0]?.email).toBe('bob@test.local');

    const first = await request(server).get('/api/users?limit=2').set(asAdmin()).expect(200);
    const firstBody: unknown = first.body;
    const firstPage = UserListResponseSchema.parse(firstBody);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const second = await request(server)
      .get(`/api/users?limit=2&cursor=${firstPage.nextCursor ?? ''}`)
      .set(asAdmin())
      .expect(200);
    const secondBody: unknown = second.body;
    const secondPage = UserListResponseSchema.parse(secondBody);
    expect(secondPage.items.length).toBeGreaterThan(0);

    const firstIds = new Set(firstPage.items.map((user) => user.id));
    expect(secondPage.items.some((user) => firstIds.has(user.id))).toBe(false);
  });

  it('audits a role change with before and after', async () => {
    const target = await createUser(prisma, { role: 'ANALYST', email: 'promote@test.local' });

    await request(server)
      .patch(`/api/users/${target.id}`)
      .set(asAdmin())
      .send({ role: 'OPS_MANAGER' })
      .expect(200);

    const entry = await prisma.auditEntry.findFirst({
      where: { action: AUDIT_ACTIONS.USER_ROLE_CHANGED, targetId: target.id },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin.id);
    expect(entry?.before).toEqual({ role: 'ANALYST' });
    expect(entry?.after).toEqual({ role: 'OPS_MANAGER' });
  });

  it('deactivates a user and revokes their sessions immediately', async () => {
    const target = await createUser(prisma, { role: 'ANALYST', email: 'gone@test.local' });
    const { accessToken, cookie } = await login(app, 'gone@test.local', TEST_PASSWORD);

    const response = await request(server)
      .post(`/api/users/${target.id}/deactivate`)
      .set(asAdmin())
      .expect(200);
    const body: unknown = response.body;
    expect(PublicUserSchema.parse(body).status).toBe('DEACTIVATED');

    await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await request(server).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'gone@test.local', password: TEST_PASSWORD })
      .expect(401);

    const reactivated = await request(server)
      .post(`/api/users/${target.id}/reactivate`)
      .set(asAdmin())
      .expect(200);
    const reactivatedBody: unknown = reactivated.body;
    expect(PublicUserSchema.parse(reactivatedBody).status).toBe('ACTIVE');
    await login(app, 'gone@test.local', TEST_PASSWORD);
  });

  it('refuses to demote or deactivate the last active administrator', async () => {
    const demote = await request(server)
      .patch(`/api/users/${admin.id}`)
      .set(asAdmin())
      .send({ role: 'ANALYST' })
      .expect(409);
    const demoteBody: unknown = demote.body;
    expect(ErrorResponseSchema.parse(demoteBody).error.code).toBe('LAST_ADMIN');

    const deactivate = await request(server)
      .post(`/api/users/${admin.id}/deactivate`)
      .set(asAdmin())
      .expect(409);
    const deactivateBody: unknown = deactivate.body;
    expect(ErrorResponseSchema.parse(deactivateBody).error.code).toBe('LAST_ADMIN');

    const stillAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stillAdmin.role).toBe('ADMIN');
    expect(stillAdmin.status).toBe('ACTIVE');
  });

  it('resets a password and forces a change at next sign-in', async () => {
    const target = await createUser(prisma, { role: 'ANALYST', email: 'reset@test.local' });

    await request(server)
      .post(`/api/users/${target.id}/reset-password`)
      .set(asAdmin())
      .send({ temporaryPassword: TEMPORARY_PASSWORD })
      .expect(204);

    await request(server)
      .post('/api/auth/login')
      .send({ email: 'reset@test.local', password: TEST_PASSWORD })
      .expect(401);

    const { accessToken } = await login(app, 'reset@test.local', TEMPORARY_PASSWORD);
    const me = await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const meBody: unknown = me.body;
    expect(PublicUserSchema.parse(meBody).mustChangePassword).toBe(true);

    const blocked = await request(server)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    const blockedBody: unknown = blocked.body;
    expect(ErrorResponseSchema.parse(blockedBody).error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: TEMPORARY_PASSWORD, newPassword: CHANGED_PASSWORD })
      .expect(200);
    const changedBody: unknown = changed.body;
    expect(AuthSessionSchema.parse(changedBody).user.mustChangePassword).toBe(false);
  });
});
