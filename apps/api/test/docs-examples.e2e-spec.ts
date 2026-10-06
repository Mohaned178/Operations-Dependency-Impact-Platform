import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { ImportKind, ImportReport } from '@opsgraph/shared';
import type { User } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  createUser,
  importFile,
  login,
  resetDb,
  TEST_PASSWORD,
} from './helpers';

const EXAMPLES_DIR = join(__dirname, '..', '..', '..', 'docs', 'examples', 'import');

function example(fileName: string): Buffer {
  return readFileSync(join(EXAMPLES_DIR, fileName));
}

describe('Documentation examples (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: User;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    admin = await createUser(prisma, { role: 'ADMIN', email: 'examples-admin@test.local' });
    token = (await login(app, admin.email, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('imports every example file in the documented order', async () => {
    const files: { name: string; kind: ImportKind }[] = [
      { name: 'entities.csv', kind: 'entities' },
      { name: 'relationships.csv', kind: 'relationships' },
      { name: 'events.csv', kind: 'events' },
    ];

    for (const file of files) {
      const response = await importFile(app, token, example(file.name), {
        format: 'csv',
        kind: file.kind,
        fileName: file.name,
      });
      expect(response.status).toBe(201);
      const report = response.body as ImportReport;
      expect({ file: file.name, outcome: report.outcome }).toEqual({
        file: file.name,
        outcome: 'APPLIED',
      });
    }

    const json = await importFile(app, token, example('import.json'), {
      format: 'json',
      fileName: 'import.json',
    });
    expect(json.status).toBe(201);
    expect((json.body as ImportReport).outcome).toBe('APPLIED');

    expect(await prisma.entity.count()).toBe(6);
    expect(await prisma.relationship.count()).toBe(4);
    expect(await prisma.event.count()).toBe(2);
  });
});
