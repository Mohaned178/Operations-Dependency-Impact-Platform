import { z } from 'zod';

export const HealthLiveSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});
export type HealthLive = z.infer<typeof HealthLiveSchema>;

export const HealthReadySchema = z.object({
  status: z.enum(['ok', 'error']),
  version: z.string(),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
});
export type HealthReady = z.infer<typeof HealthReadySchema>;
