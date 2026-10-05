import { z } from 'zod';

export const RoleSchema = z.enum(['ADMIN', 'OPS_MANAGER', 'ANALYST']);
export type Role = z.infer<typeof RoleSchema>;

export const UserStatusSchema = z.enum(['ACTIVE', 'DEACTIVATED']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);
export type Email = z.infer<typeof EmailSchema>;

export const PasswordSchema = z.string().min(12).max(128);
export type Password = z.infer<typeof PasswordSchema>;

export const PageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const ErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'INVALID_CREDENTIALS',
  'UNAUTHENTICATED',
  'PASSWORD_CHANGE_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_TAKEN',
  'LAST_ADMIN',
  'IMPORT_TOO_LARGE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    correlationId: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  OPS_MANAGER: 'Operations Manager',
  ANALYST: 'Operations Analyst',
};
