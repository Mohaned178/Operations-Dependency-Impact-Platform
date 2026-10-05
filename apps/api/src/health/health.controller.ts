import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, Res } from '@nestjs/common';
import type { HealthLive, HealthReady } from '@opsgraph/shared';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

const DATABASE_CHECK_TIMEOUT_MS = 2000;

function readVersion(): string {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
  );
  if (typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string') {
    return raw.version;
  }
  return '0.0.0';
}

const version = readVersion();

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  live(): HealthLive {
    return { status: 'ok', version };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthReady> {
    const databaseUp = await this.isDatabaseUp();
    if (!databaseUp) {
      res.status(503);
      return { status: 'error', version, checks: { database: 'down' } };
    }
    return { status: 'ok', version, checks: { database: 'up' } };
  }

  private async isDatabaseUp(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), DATABASE_CHECK_TIMEOUT_MS);
      });
      const probe = this.prisma.$queryRaw`SELECT 1`.then(() => true);
      return await Promise.race([probe, timeout]);
    } catch {
      return false;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
