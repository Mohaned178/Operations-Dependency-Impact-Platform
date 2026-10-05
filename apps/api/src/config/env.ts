import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const parsed = EnvSchema.parse(process.env);

export const env = {
  ...parsed,
  cookieSecure: parsed.COOKIE_SECURE ?? (parsed.NODE_ENV === 'production'),
};

export type Env = typeof env;
