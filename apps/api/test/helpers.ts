import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Role, UserStatus } from '@opsgraph/shared';
import type { User } from '@prisma/client';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import type { PrismaService } from '../src/prisma/prisma.service';

export const TEST_PASSWORD = 'OpsGraph-Test-2026!';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`TRUNCATE users, refresh_tokens CASCADE`;
  await prisma.$executeRaw`ALTER TABLE audit_entries DISABLE TRIGGER USER`;
  await prisma.$executeRaw`DELETE FROM audit_entries`;
  await prisma.$executeRaw`ALTER TABLE audit_entries ENABLE TRIGGER USER`;
}

export interface CreateUserOptions {
  role: Role;
  email?: string;
  password?: string;
  mustChangePassword?: boolean;
  status?: UserStatus;
}

export function createUser(prisma: PrismaService, options: CreateUserOptions): Promise<User> {
  return (async () => {
    const email = (
      options.email ?? `${options.role.toLowerCase()}-${randomUUID()}@test.local`
    ).toLowerCase();

    return prisma.user.create({
      data: {
        email,
        displayName: email,
        passwordHash: await argon2.hash(options.password ?? TEST_PASSWORD),
        role: options.role,
        status: options.status ?? 'ACTIVE',
        mustChangePassword: options.mustChangePassword ?? false,
      },
    });
  })();
}

export async function login(
  app: INestApplication,
  email: string,
  password: string,
): Promise<{ accessToken: string; cookie: string }> {
  const response = await request(app.getHttpServer() as Server)
    .post('/api/auth/login')
    .send({ email, password });

  const body = response.body as { accessToken?: unknown };
  const cookie = response.get('Set-Cookie')?.[0];

  if (typeof body.accessToken !== 'string' || !cookie) {
    throw new Error(`Login failed for ${email} with status ${response.status}`);
  }

  return { accessToken: body.accessToken, cookie };
}
