import { z } from 'zod';
import { PageQuerySchema } from './common';

export const AUDIT_ACTIONS = {
  AUTH_LOGIN_SUCCEEDED: 'auth.login_succeeded',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_ACCOUNT_LOCKED: 'auth.account_locked',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REFRESH_REFUSED: 'auth.refresh_refused',
  AUTH_FORBIDDEN: 'auth.forbidden',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_DEACTIVATED: 'user.deactivated',
  USER_REACTIVATED: 'user.reactivated',
  USER_PASSWORD_RESET: 'user.password_reset',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AuditEntryDtoSchema = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  actorType: z.enum(['user', 'system', 'anonymous']),
  actorId: z.string().uuid().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  metadata: z.unknown(),
  correlationId: z.string().uuid(),
  ipAddress: z.string().nullable(),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDtoSchema>;

export const ListAuditQuerySchema = PageQuerySchema.extend({
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListAuditQuery = z.infer<typeof ListAuditQuerySchema>;

export const AuditListResponseSchema = z.object({
  items: z.array(AuditEntryDtoSchema),
  nextCursor: z.string().nullable(),
});
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;
