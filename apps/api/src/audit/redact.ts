const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'temporaryPassword',
  'token',
  'tokenHash',
  'refreshToken',
  'accessToken',
]);

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }

  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!REDACTED_KEYS.has(key)) {
        clone[key] = redact(entry);
      }
    }
    return clone;
  }

  return value;
}
