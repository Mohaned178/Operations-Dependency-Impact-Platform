import type { ZodType } from 'zod';
import { Errors } from '../errors/app-error';

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(schema: ZodType<T>, cursor: string): T {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw Errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw Errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
  return result.data;
}
