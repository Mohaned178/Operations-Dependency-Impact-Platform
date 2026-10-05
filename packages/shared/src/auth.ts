import { z } from 'zod';
import { EmailSchema, PasswordSchema, RoleSchema, UserStatusSchema } from './common';

export const PublicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  status: UserStatusSchema,
  mustChangePassword: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: PasswordSchema,
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password',
  });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const AuthSessionSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  user: PublicUserSchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;
