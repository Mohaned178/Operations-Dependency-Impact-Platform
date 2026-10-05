import type { Request, Response } from 'express';
import { env } from '../config/env';

export const REFRESH_COOKIE_NAME = 'og_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: env.cookieSecure,
  path: REFRESH_COOKIE_PATH,
} as const;

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, { ...COOKIE_OPTIONS, expires: expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, COOKIE_OPTIONS);
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
