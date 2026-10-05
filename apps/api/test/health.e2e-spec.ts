import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { HealthLiveSchema, HealthReadySchema } from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness', async () => {
    const response = await request(server).get('/api/health/live').expect(200);
    const body: unknown = response.body;
    const parsed = HealthLiveSchema.parse(body);
    expect(parsed.status).toBe('ok');
    expect(parsed.version).not.toBe('');
  });

  it('reports readiness with the database up', async () => {
    const response = await request(server).get('/api/health/ready').expect(200);
    const body: unknown = response.body;
    const parsed = HealthReadySchema.parse(body);
    expect(parsed.status).toBe('ok');
    expect(parsed.checks.database).toBe('up');
  });

  it('reports 503 when the database is down', async () => {
    const querySpy = jest.spyOn(prisma, '$queryRaw') as jest.Mock;
    querySpy.mockRejectedValueOnce(new Error('database is down'));

    const response = await request(server).get('/api/health/ready').expect(503);
    querySpy.mockRestore();

    const body: unknown = response.body;
    const parsed = HealthReadySchema.parse(body);
    expect(parsed.status).toBe('error');
    expect(parsed.checks.database).toBe('down');
  });

  it('never leaks the connection string or secrets', async () => {
    const live = await request(server).get('/api/health/live').expect(200);
    const ready = await request(server).get('/api/health/ready').expect(200);
    const serialized = JSON.stringify({ live: live.body as unknown, ready: ready.body as unknown });
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain(process.env.JWT_ACCESS_SECRET ?? 'JWT_ACCESS_SECRET');
  });
});
