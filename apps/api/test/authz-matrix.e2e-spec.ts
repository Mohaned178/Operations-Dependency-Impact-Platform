import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { AUDIT_ACTIONS, ErrorResponseSchema } from '@opsgraph/shared';
import type { User } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, login, resetDb, TEST_PASSWORD } from './helpers';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const ACTORS = ['anonymous', 'ANALYST', 'OPS_MANAGER', 'ADMIN'] as const;
type ActorKey = (typeof ACTORS)[number];
type ExpectedCell = 'public' | 'authenticated' | '401' | '403';

interface RouteProbe {
  name: string;
  method: 'get' | 'post' | 'patch';
  path: string;
  body?: Record<string, unknown>;
  expected: Record<ActorKey, ExpectedCell>;
}

const PUBLIC: Record<ActorKey, ExpectedCell> = {
  anonymous: 'public',
  ANALYST: 'public',
  OPS_MANAGER: 'public',
  ADMIN: 'public',
};

const AUTHENTICATED: Record<ActorKey, ExpectedCell> = {
  anonymous: '401',
  ANALYST: 'authenticated',
  OPS_MANAGER: 'authenticated',
  ADMIN: 'authenticated',
};

const ADMIN_ONLY: Record<ActorKey, ExpectedCell> = {
  anonymous: '401',
  ANALYST: '403',
  OPS_MANAGER: '403',
  ADMIN: 'authenticated',
};

const PROBES: RouteProbe[] = [
  { name: 'GET /health/live', method: 'get', path: '/api/health/live', expected: PUBLIC },
  { name: 'GET /health/ready', method: 'get', path: '/api/health/ready', expected: PUBLIC },
  {
    name: 'POST /auth/login',
    method: 'post',
    path: '/api/auth/login',
    body: {},
    expected: PUBLIC,
  },
  { name: 'POST /auth/refresh', method: 'post', path: '/api/auth/refresh', expected: PUBLIC },
  { name: 'POST /auth/logout', method: 'post', path: '/api/auth/logout', expected: PUBLIC },
  { name: 'GET /auth/me', method: 'get', path: '/api/auth/me', expected: AUTHENTICATED },
  {
    name: 'POST /auth/change-password',
    method: 'post',
    path: '/api/auth/change-password',
    body: {},
    expected: AUTHENTICATED,
  },
  { name: 'GET /users', method: 'get', path: '/api/users', expected: ADMIN_ONLY },
  { name: 'POST /users', method: 'post', path: '/api/users', body: {}, expected: ADMIN_ONLY },
  {
    name: 'GET /users/:id',
    method: 'get',
    path: `/api/users/${MISSING_ID}`,
    expected: ADMIN_ONLY,
  },
  {
    name: 'PATCH /users/:id',
    method: 'patch',
    path: `/api/users/${MISSING_ID}`,
    body: {},
    expected: ADMIN_ONLY,
  },
  {
    name: 'POST /users/:id/deactivate',
    method: 'post',
    path: `/api/users/${MISSING_ID}/deactivate`,
    expected: ADMIN_ONLY,
  },
  {
    name: 'POST /users/:id/reactivate',
    method: 'post',
    path: `/api/users/${MISSING_ID}/reactivate`,
    expected: ADMIN_ONLY,
  },
  {
    name: 'POST /users/:id/reset-password',
    method: 'post',
    path: `/api/users/${MISSING_ID}/reset-password`,
    body: {},
    expected: ADMIN_ONLY,
  },
  { name: 'GET /audit', method: 'get', path: '/api/audit', expected: ADMIN_ONLY },
  { name: 'GET /imports', method: 'get', path: '/api/imports', expected: ADMIN_ONLY },
  { name: 'POST /imports', method: 'post', path: '/api/imports', body: {}, expected: ADMIN_ONLY },
  {
    name: 'GET /imports/:id',
    method: 'get',
    path: `/api/imports/${MISSING_ID}`,
    expected: ADMIN_ONLY,
  },
  { name: 'GET /entities', method: 'get', path: '/api/entities', expected: AUTHENTICATED },
  {
    name: 'GET /entities/:id',
    method: 'get',
    path: `/api/entities/${MISSING_ID}`,
    expected: AUTHENTICATED,
  },
  {
    name: 'GET /entities/:id/neighbors',
    method: 'get',
    path: `/api/entities/${MISSING_ID}/neighbors`,
    expected: AUTHENTICATED,
  },
  {
    name: 'GET /entities/:id/timeline',
    method: 'get',
    path: `/api/entities/${MISSING_ID}/timeline`,
    expected: AUTHENTICATED,
  },
  {
    name: 'GET /entities/:id/states',
    method: 'get',
    path: `/api/entities/${MISSING_ID}/states`,
    expected: AUTHENTICATED,
  },
  {
    name: 'GET /entities/:id/source-records',
    method: 'get',
    path: `/api/entities/${MISSING_ID}/source-records`,
    expected: AUTHENTICATED,
  },
  { name: 'GET /source-systems', method: 'get', path: '/api/source-systems', expected: AUTHENTICATED },
];

const CASES = PROBES.flatMap((probe) =>
  ACTORS.map((actor) => ({ probe, actor, label: `${probe.name} as ${actor}` })),
);

describe('Authorization matrix (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const users: Partial<Record<ActorKey, User>> = {};
  const tokens: Partial<Record<ActorKey, string>> = {};

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    for (const role of ['ANALYST', 'OPS_MANAGER', 'ADMIN'] as const) {
      const user = await createUser(prisma, {
        role,
        email: `${role.toLowerCase()}@test.local`,
      });
      users[role] = user;
      const { accessToken } = await login(app, user.email, TEST_PASSWORD);
      tokens[role] = accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(CASES)('$label', async ({ probe, actor }) => {
    const token = tokens[actor];
    const base =
      probe.method === 'post'
        ? request(server).post(probe.path)
        : probe.method === 'patch'
          ? request(server).patch(probe.path)
          : request(server).get(probe.path);
    const withAuth = token ? base.set('Authorization', `Bearer ${token}`) : base;
    const response = probe.body !== undefined ? await withAuth.send(probe.body) : await withAuth;

    const expected = probe.expected[actor];

    if (expected === '401') {
      expect(response.status).toBe(401);
      const body: unknown = response.body;
      expect(ErrorResponseSchema.parse(body).error.code).toBe('UNAUTHENTICATED');
      return;
    }

    if (expected === '403') {
      expect(response.status).toBe(403);
      const body: unknown = response.body;
      expect(ErrorResponseSchema.parse(body).error.code).toBe('FORBIDDEN');

      const actorUser = users[actor];
      expect(actorUser).toBeDefined();
      const entry = await prisma.auditEntry.findFirst({
        where: {
          action: AUDIT_ACTIONS.AUTH_FORBIDDEN,
          actorId: actorUser?.id,
          metadata: {
            equals: {
              method: probe.method.toUpperCase(),
              path: probe.path,
              role: actor,
            },
          },
        },
      });
      expect(entry).not.toBeNull();
      return;
    }

    expect(response.status).not.toBe(403);
    if (expected === 'authenticated') {
      expect(response.status).not.toBe(401);
    }
  });
});
