# API Contract: Foundation Platform

- **Base path**: `/api`. JSON only.
- **Schemas**: every schema named below MUST be exported from `@opsgraph/shared` (`packages/shared/src/<area>.ts`) together with its inferred type (`export type X = z.infer<typeof XSchema>`).
- **Auth**: every route requires `Authorization: Bearer <accessToken>` unless marked **Public**. Routes marked **Admin** require role ADMIN.
- **Password changes**: users with `mustChangePassword=true` get `403 PASSWORD_CHANGE_REQUIRED` on every authenticated route except `GET /auth/me`, `POST /auth/change-password` and `POST /auth/logout`.
- **Errors** (`ErrorResponseSchema`): `{ error: { code: string, message: string, details?: { path: string, message: string }[], correlationId: string } }`
- **Correlation id**: every response carries an `x-request-id` header.

## Shared base schemas (`packages/shared/src/common.ts`, `users.ts`)

```ts
RoleSchema = z.enum(['ADMIN','OPS_MANAGER','ANALYST'])
UserStatusSchema = z.enum(['ACTIVE','DEACTIVATED'])
EmailSchema = z.string().trim().toLowerCase().email().max(254)
PasswordSchema = z.string().min(12).max(128)
PublicUserSchema = z.object({ id: z.string().uuid(), email: z.string(), displayName: z.string(),
  role: RoleSchema, status: UserStatusSchema, mustChangePassword: z.boolean(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime() })
PageQuerySchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
```

## Auth (`packages/shared/src/auth.ts`)

| Method & path | Access | Request | Success | Errors |
|---|---|---|---|---|
| POST `/auth/login` | Public | `LoginRequestSchema {email: EmailSchema, password: z.string().min(1).max(128)}` | 200 `AuthSessionSchema {accessToken, expiresIn: number, user: PublicUser}`, plus the `og_refresh` cookie | 400, 401 `INVALID_CREDENTIALS` (bad password, unknown email, locked, deactivated: all identical) |
| POST `/auth/refresh` | Public (cookie) | — | 200 `AuthSessionSchema`, plus a rotated cookie | 401 `UNAUTHENTICATED` (clears the cookie) |
| POST `/auth/logout` | Auth (works even when the access token is expired: the cookie alone is enough; Public route) | — | 204, cookie cleared, refresh family revoked | — |
| GET `/auth/me` | Auth | — | 200 `PublicUserSchema` | 401 |
| POST `/auth/change-password` | Auth | `ChangePasswordRequestSchema {currentPassword: z.string().min(1), newPassword: PasswordSchema}` with a refine that the new password differs from the current one | 200 `AuthSessionSchema`. Revokes all other refresh tokens, issues a new session, sets `mustChangePassword=false` | 400, 401 `INVALID_CREDENTIALS` (wrong current password) |

## Users (`packages/shared/src/users.ts`). All routes are Admin.

| Method & path | Request | Success | Errors |
|---|---|---|---|
| GET `/users` | query `ListUsersQuerySchema = PageQuery.extend({ q?: string (matches email/displayName, case-insensitive), role?: Role, status?: UserStatus })`. The cursor is the last user id, ordered by `createdAt DESC, id DESC` | 200 `UserListResponseSchema {items: PublicUser[], nextCursor: string \| null}` | 400 |
| POST `/users` | `CreateUserRequestSchema {email, displayName: z.string().trim().min(1).max(100), role, temporaryPassword: PasswordSchema}` | 201 `PublicUser` (`mustChangePassword=true`) | 400, 409 `EMAIL_TAKEN` |
| GET `/users/:id` | — | 200 `PublicUser` | 404 |
| PATCH `/users/:id` | `UpdateUserRequestSchema {displayName?, role?}` with a refine that at least one field is present | 200 `PublicUser` | 400, 404, 409 `LAST_ADMIN` |
| POST `/users/:id/deactivate` | — | 200 `PublicUser`. Revokes all of that user's refresh tokens | 404, 409 `LAST_ADMIN` |
| POST `/users/:id/reactivate` | — | 200 `PublicUser` | 404 |
| POST `/users/:id/reset-password` | `ResetPasswordRequestSchema {temporaryPassword: PasswordSchema}` | 204. Sets `mustChangePassword=true` and revokes refresh tokens | 400, 404 |

Deactivating or reactivating a user who is already in that status is a no-op: it returns 200 and writes no audit entry.

## Audit (`packages/shared/src/audit.ts`). Admin only.

| Method & path | Request | Success |
|---|---|---|
| GET `/audit` | query `ListAuditQuerySchema = PageQuery.extend({ actorId?: uuid, action?: string, targetType?: string, targetId?: string, from?: datetime, to?: datetime })`. The cursor is the last `id` as a string | 200 `AuditListResponseSchema {items: AuditEntryDto[], nextCursor: string \| null}` |

`AuditEntryDto = { id: string, occurredAt, actorType, actorId: string|null, actorEmail: string|null (joined for display), action, targetType, targetId, before: unknown, after: unknown, metadata: unknown, correlationId, ipAddress }`

There is deliberately **no** POST/PUT/PATCH/DELETE on `/audit`.

## Health (`packages/shared/src/health.ts`). Public.

| Method & path | Success | Failure |
|---|---|---|
| GET `/health/live` | 200 `{status:'ok', version}` | — |
| GET `/health/ready` | 200 `{status:'ok', version, checks:{database:'up'}}` | 503 `{status:'error', version, checks:{database:'down'}}` |

## Authorization matrix (e2e tests MUST cover each cell)

| Route group | anonymous | ANALYST | OPS_MANAGER | ADMIN |
|---|---|---|---|---|
| `/health/*`, `/auth/login`, `/auth/refresh`, `/auth/logout` | ✅ | ✅ | ✅ | ✅ |
| `/auth/me`, `/auth/change-password` | 401 | ✅ | ✅ | ✅ |
| `/users/*`, `/audit` | 401 | 403 + audit `auth.forbidden` | 403 + audit | ✅ |
