import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  ImportKind,
  ImportReport,
  Role,
  UserStatus,
} from '@opsgraph/shared';
import { Prisma, type User } from '@prisma/client';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { RequestContext } from '../src/common/context/request-context';
import { ImportService } from '../src/ingestion/import.service';
import { PrismaService } from '../src/prisma/prisma.service';

export const TEST_PASSWORD = 'OpsGraph-Test-2026!';

export async function createTestApp(
  controllers: Type<unknown>[] = [],
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`ALTER TABLE audit_entries DISABLE TRIGGER USER`;
  await prisma.$executeRaw`ALTER TABLE source_records DISABLE TRIGGER USER`;
  await prisma.$executeRaw`ALTER TABLE state_observations DISABLE TRIGGER USER`;
  await prisma.$executeRaw`TRUNCATE users, refresh_tokens, imports, entities, entity_identifiers, source_records, state_observations, relationships, events, event_entities CASCADE`;
  await prisma.$executeRaw`DELETE FROM audit_entries`;
  await prisma.$executeRaw`ALTER TABLE source_records ENABLE TRIGGER USER`;
  await prisma.$executeRaw`ALTER TABLE state_observations ENABLE TRIGGER USER`;
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

const IMPORT_ADMIN_EMAIL = 'imports-admin@test.local';

async function ensureImportAdmin(prisma: PrismaService): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: IMPORT_ADMIN_EMAIL } });
  if (existing) {
    return existing;
  }
  try {
    return await createUser(prisma, { role: 'ADMIN', email: IMPORT_ADMIN_EMAIL });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const created = await prisma.user.findUnique({ where: { email: IMPORT_ADMIN_EMAIL } });
      if (created) {
        return created;
      }
    }
    throw error;
  }
}

export interface RunImportOptions {
  format: 'json' | 'csv';
  kind?: ImportKind;
  content: string | Uint8Array;
  dryRun?: boolean;
  skipIfNoChanges?: boolean;
  trigger?: 'API' | 'SEED';
}

export async function runImport(
  app: INestApplication,
  options: RunImportOptions,
): Promise<ImportReport | null> {
  const prisma = app.get(PrismaService);
  const importService = app.get(ImportService);
  const requestContext = app.get(RequestContext);
  const admin = await ensureImportAdmin(prisma);
  const content =
    typeof options.content === 'string' ? Buffer.from(options.content, 'utf8') : options.content;

  return requestContext.runDetached(() =>
    importService.run({
      format: options.format,
      kind: options.kind,
      fileName: `test.${options.format}`,
      byteSize: content.byteLength,
      content,
      dryRun: options.dryRun,
      skipIfNoChanges: options.skipIfNoChanges,
      trigger: options.trigger,
      actor: { type: 'user', id: admin.id },
    }),
  );
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
