import { z } from 'zod';
import { PublicUserSchema } from './auth';
import {
  EmailSchema,
  PageQuerySchema,
  PasswordSchema,
  RoleSchema,
  UserStatusSchema,
} from './common';

export const ListUsersQuerySchema = PageQuerySchema.extend({
  q: z.string().optional(),
  role: RoleSchema.optional(),
  status: UserStatusSchema.optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export const UserListResponseSchema = z.object({
  items: z.array(PublicUserSchema),
  nextCursor: z.string().nullable(),
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const CreateUserRequestSchema = z.object({
  email: EmailSchema,
  displayName: z.string().trim().min(1).max(100),
  role: RoleSchema,
  temporaryPassword: PasswordSchema,
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    role: RoleSchema.optional(),
  })
  .refine((data) => data.displayName !== undefined || data.role !== undefined, {
    message: 'At least one field must be provided',
  });
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  temporaryPassword: PasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
