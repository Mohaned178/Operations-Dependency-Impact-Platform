import type { Server } from 'node:http';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  AuthSessionSchema,
  ErrorResponseSchema,
  type AuthSession,
} from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, resetDb, TEST_PASSWORD } from './helpers';

const NEW_PASSWORD = 'OpsGraph-Changed-2026!';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Controller('users')
class ProtectedProbeController {
  @Get()
  list(): { items: unknown[] } {
    return { items: [] };
  }
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp([ProtectedProbeController]);
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function setCookies(response: { get(field: string): unknown }): string[] {
    const header = response.get('Set-Cookie');
    if (Array.isArray(header)) {
      return header.filter((value): value is string => typeof value === 'string');
    }
    return typeof header === 'string' && header.length > 0 ? [header] : [];
  }

  function readCookie(response: { get(field: string): unknown }, name: string): string {
    const match = setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
    if (!match) {
      throw new Error(`Cookie ${name} is missing`);
    }
    return match.split(';')[0] ?? '';
  }

  async function signIn(
    email: string,
    password: string,
  ): Promise<{ session: AuthSession; cookie: string }> {
    const response = await request(server)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const body: unknown = response.body;
    return { session: AuthSessionSchema.parse(body), cookie: readCookie(response, 'og_refresh') };
  }

  it('signs in and sets the refresh cookie', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'analyst@test.local' });

    const { session, cookie } = await signIn('analyst@test.local', TEST_PASSWORD);

    expect(session.user.email).toBe('analyst@test.local');
    expect(session.user.role).toBe('ANALYST');
    expect(session.user.mustChangePassword).toBe(false);
    expect(session.expiresIn).toBe(900);
    expect(cookie).toMatch(/^og_refresh=/);
  });

  it('returns identical 401 bodies for a wrong password and an unknown email', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'analyst@test.local' });

    const unknownResponse = await request(server)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.local', password: 'Unknown-Password-1' })
      .expect(401);
    const wrongResponse = await request(server)
      .post('/api/auth/login')
      .send({ email: 'analyst@test.local', password: 'Wrong-Password-123' })
      .expect(401);

    const unknownBody: unknown = unknownResponse.body;
    const wrongBody: unknown = wrongResponse.body;
    const unknownError = ErrorResponseSchema.parse(unknownBody);
    const wrongError = ErrorResponseSchema.parse(wrongBody);

    expect(unknownError.error.code).toBe('INVALID_CREDENTIALS');
    const { correlationId: unknownCorrelation, ...unknownRest } = unknownError.error;
    const { correlationId: wrongCorrelation, ...wrongRest } = wrongError.error;
    expect(unknownRest).toEqual(wrongRest);
    expect(unknownCorrelation).not.toBe(wrongCorrelation);
  });

  it('locks the account for 15 minutes after 5 failures', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'lock@test.local' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/api/auth/login')
        .send({ email: 'lock@test.local', password: 'Wrong-Password-123' })
        .expect(401);
    }

    await request(server)
      .post('/api/auth/login')
      .send({ email: 'lock@test.local', password: TEST_PASSWORD })
      .expect(401);

    const lockedUser = await prisma.user.findUniqueOrThrow({ where: { email: 'lock@test.local' } });
    expect(lockedUser.lockedUntil).not.toBeNull();
    expect(lockedUser.failedLoginCount).toBe(5);

    const lockAudit = await prisma.auditEntry.findFirst({
      where: { action: AUDIT_ACTIONS.AUTH_ACCOUNT_LOCKED, targetId: lockedUser.id },
    });
    expect(lockAudit).not.toBeNull();
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'rotate@test.local' });
    const { cookie: firstCookie } = await signIn('rotate@test.local', TEST_PASSWORD);

    const rotated = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(200);
    const secondCookie = readCookie(rotated, 'og_refresh');
    expect(secondCookie).not.toBe(firstCookie);

    await request(server).post('/api/auth/refresh').set('Cookie', firstCookie).expect(401);
    await request(server).post('/api/auth/refresh').set('Cookie', secondCookie).expect(401);
  });

  it('serializes concurrent failed logins and locks the account exactly once', async () => {
    const user = await createUser(prisma, { role: 'ANALYST', email: 'parallel@test.local' });

    const attempts = Array.from({ length: 10 }, () =>
      request(server)
        .post('/api/auth/login')
        .send({ email: 'parallel@test.local', password: 'Wrong-Password-123' }),
    );
    const responses = await Promise.all(attempts);
    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(401));

    const lockedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(lockedUser.lockedUntil?.getTime() ?? 0).toBeGreaterThan(Date.now());
    expect(lockedUser.failedLoginCount).toBeGreaterThanOrEqual(5);

    const lockAudits = await prisma.auditEntry.findMany({
      where: { action: AUDIT_ACTIONS.AUTH_ACCOUNT_LOCKED, targetId: user.id },
    });
    expect(lockAudits).toHaveLength(1);

    await request(server)
      .post('/api/auth/login')
      .send({ email: 'parallel@test.local', password: TEST_PASSWORD })
      .expect(401);
  });

  it('handles two concurrent refreshes with the same cookie atomically', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'race@test.local' });
    await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);
    const { cookie } = await signIn('race@test.local', TEST_PASSWORD);

    const [first, second] = await Promise.all([
      request(server).post('/api/auth/refresh').set('Cookie', cookie),
      request(server).post('/api/auth/refresh').set('Cookie', cookie),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 401]);

    const winner = first.status === 200 ? first : second;
    const newCookie = readCookie(winner, 'og_refresh');
    await request(server).post('/api/auth/refresh').set('Cookie', newCookie).expect(200);

    const refused = await prisma.auditEntry.findMany({
      where: { action: AUDIT_ACTIONS.AUTH_REFRESH_REFUSED },
    });
    const concurrent = refused.filter(
      (row) => (row.metadata as { reason?: string } | null)?.reason === 'concurrent_rotation',
    );
    expect(concurrent).toHaveLength(1);
  });

  it('refuses to rotate a family older than 7 days', async () => {
    const user = await createUser(prisma, { role: 'ANALYST', email: 'old@test.local' });
    const { cookie } = await signIn('old@test.local', TEST_PASSWORD);

    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { familyCreatedAt: new Date(Date.now() - 8 * MS_PER_DAY) },
    });

    await request(server).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('revokes the refresh family on logout', async () => {
    const user = await createUser(prisma, { role: 'ANALYST', email: 'bye@test.local' });
    const { cookie } = await signIn('bye@test.local', TEST_PASSWORD);

    await request(server).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await request(server).post('/api/auth/refresh').set('Cookie', cookie).expect(401);

    const logoutAudit = await prisma.auditEntry.findFirst({
      where: { action: AUDIT_ACTIONS.AUTH_LOGOUT, actorId: user.id },
    });
    expect(logoutAudit).not.toBeNull();
  });

  it('rejects unauthenticated calls to me', async () => {
    await request(server).get('/api/auth/me').expect(401);
  });

  it('forces a password change before other routes', async () => {
    await createUser(prisma, {
      role: 'ANALYST',
      email: 'mcp@test.local',
      mustChangePassword: true,
    });

    const first = await signIn('mcp@test.local', TEST_PASSWORD);
    const second = await signIn('mcp@test.local', TEST_PASSWORD);
    expect(first.session.user.mustChangePassword).toBe(true);

    await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${first.session.accessToken}`)
      .expect(200);

    const forbidden = await request(server)
      .get('/api/users')
      .set('Authorization', `Bearer ${first.session.accessToken}`)
      .expect(403);
    const forbiddenBody: unknown = forbidden.body;
    expect(ErrorResponseSchema.parse(forbiddenBody).error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${first.session.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    const changedBody: unknown = changed.body;
    const changedSession = AuthSessionSchema.parse(changedBody);
    expect(changedSession.user.mustChangePassword).toBe(false);

    await request(server).post('/api/auth/refresh').set('Cookie', second.cookie).expect(401);
    await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', readCookie(changed, 'og_refresh'))
      .expect(200);
  });

  it('refuses login and access tokens for a deactivated user', async () => {
    const user = await createUser(prisma, { role: 'ANALYST', email: 'off@test.local' });
    const { session } = await signIn('off@test.local', TEST_PASSWORD);

    await prisma.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED' } });

    await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'off@test.local', password: TEST_PASSWORD })
      .expect(401);
  });

  it('rejects access tokens issued before the last password change', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'stale@test.local' });
    const { session } = await signIn('stale@test.local', TEST_PASSWORD);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const changed = await request(server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    const changedBody: unknown = changed.body;
    const changedSession = AuthSessionSchema.parse(changedBody);

    await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${changedSession.accessToken}`)
      .expect(200);
  });

  it('never stores passwords in the audit trail', async () => {
    await createUser(prisma, { role: 'ANALYST', email: 'audit@test.local' });
    await signIn('audit@test.local', TEST_PASSWORD);
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'audit@test.local', password: 'Wrong-Password-123' })
      .expect(401);

    const rows = await prisma.auditEntry.findMany();
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows.map((row) => ({ ...row, id: row.id.toString() })));
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain('passwordHash');
  });
});
