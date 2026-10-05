import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaClient, type Role } from '@prisma/client';
import argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { toPublicUser } from '../src/users/user.mapper';

const prisma = new PrismaClient();

const SEED_PASSWORD_DEFAULT = 'OpsGraph-Dev-2026!';

interface SeedUser {
  email: string;
  displayName: string;
  role: Role;
}

const SEED_USERS: SeedUser[] = [
  { email: 'admin@opsgraph.local', displayName: 'Admin', role: 'ADMIN' },
  { email: 'manager@opsgraph.local', displayName: 'Operations Manager', role: 'OPS_MANAGER' },
  { email: 'analyst@opsgraph.local', displayName: 'Operations Analyst', role: 'ANALYST' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const password = process.env.SEED_PASSWORD ?? SEED_PASSWORD_DEFAULT;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  for (const seedUser of SEED_USERS) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: seedUser.email } });

      const user = await tx.user.upsert({
        where: { email: seedUser.email },
        update: {
          displayName: seedUser.displayName,
          role: seedUser.role,
          passwordHash,
          status: 'ACTIVE',
          mustChangePassword: false,
        },
        create: {
          email: seedUser.email,
          displayName: seedUser.displayName,
          role: seedUser.role,
          passwordHash,
        },
      });

      if (!existing) {
        await tx.auditEntry.create({
          data: {
            action: 'user.created',
            actorType: 'system',
            targetType: 'user',
            targetId: user.id,
            after: toPublicUser(user),
            correlationId: randomUUID(),
          },
        });
      }
    });
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const report = await app.get(SeedService).seedScenario39();
    console.log(report === null ? '§39 scenario already present' : '§39 scenario seeded');
  } finally {
    await app.close();
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
