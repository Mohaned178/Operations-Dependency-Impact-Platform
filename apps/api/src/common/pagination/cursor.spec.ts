import { z } from 'zod';
import { AppError } from '../errors/app-error';
import { decodeCursor, encodeCursor } from './cursor';

const CURSOR_SCHEMA = z.object({ name: z.string(), id: z.string() });

describe('cursor', () => {
  it('round-trips a value', () => {
    const value = { name: 'Order #18492', id: '6f1b3c2a-4d5e-4f60-8a9b-1c2d3e4f5a6b' };
    expect(decodeCursor(CURSOR_SCHEMA, encodeCursor(value))).toEqual(value);
  });

  it('encodes as base64url without padding', () => {
    const encoded = encodeCursor({ name: 'a', id: 'b' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects a cursor that is not base64url JSON', () => {
    expect(() => decodeCursor(CURSOR_SCHEMA, 'not-a-cursor')).toThrow(AppError);
  });

  it('rejects JSON that does not match the schema', () => {
    expect(() => decodeCursor(CURSOR_SCHEMA, encodeCursor({ other: 1 }))).toThrow(AppError);
  });

  it('reports the failure on the cursor field', () => {
    expect.assertions(3);
    try {
      decodeCursor(CURSOR_SCHEMA, '%%%');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe('VALIDATION_FAILED');
      expect(appError.status).toBe(400);
      expect(appError.details).toEqual([{ path: 'cursor', message: 'Invalid cursor' }]);
    }
  });
});
