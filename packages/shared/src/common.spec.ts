import { describe, expect, it } from 'vitest';
import { EmailSchema, PageQuerySchema, PasswordSchema } from './common';

describe('EmailSchema', () => {
  it('lowercases and trims input', () => {
    expect(EmailSchema.parse('  A@B.COM ')).toBe('a@b.com');
  });

  it('rejects a value that is not an email', () => {
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('PasswordSchema', () => {
  it('rejects 11 characters', () => {
    expect(PasswordSchema.safeParse('a'.repeat(11)).success).toBe(false);
  });

  it('accepts 12 characters', () => {
    expect(PasswordSchema.parse('a'.repeat(12))).toBe('a'.repeat(12));
  });
});

describe('PageQuerySchema', () => {
  it("coerces limit='20' to 20", () => {
    expect(PageQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
  });

  it('rejects a limit of 201', () => {
    expect(PageQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });
});
