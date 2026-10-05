import { redact } from './redact';

describe('redact', () => {
  it('removes sensitive keys at the top level', () => {
    expect(redact({ email: 'analyst@opsgraph.local', password: 'super-secret' })).toEqual({
      email: 'analyst@opsgraph.local',
    });
  });

  it('removes sensitive keys in nested objects', () => {
    expect(
      redact({
        user: {
          tokenHash: 'hash',
          profile: { newPassword: 'next', displayName: 'Ada' },
        },
      }),
    ).toEqual({ user: { profile: { displayName: 'Ada' } } });
  });

  it('removes sensitive keys inside arrays at any depth', () => {
    expect(redact([{ accessToken: 'token', ok: true }, [{ refreshToken: 'raw', id: 1 }]])).toEqual([
      { ok: true },
      [{ id: 1 }],
    ]);
  });

  it('returns primitives unchanged', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});
