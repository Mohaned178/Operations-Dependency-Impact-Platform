import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import './load-env';

export default function globalSetup(): void {
  execSync('pnpm exec prisma migrate reset --force --skip-seed', {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
  });
}
