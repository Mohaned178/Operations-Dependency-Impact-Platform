# Data Model: Foundation Platform

PostgreSQL 16 via Prisma. Table names are snake_case (`@@map`) and column names snake_case (`@map`). All timestamps are `timestamptz` in UTC.

## Enums

```prisma
enum Role       { ADMIN  OPS_MANAGER  ANALYST }
enum UserStatus { ACTIVE  DEACTIVATED }
```

Display labels live in `@opsgraph/shared` (`ROLE_LABELS`): ADMIN → "Administrator", OPS_MANAGER → "Operations Manager", ANALYST → "Operations Analyst".

## User (`users`)

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | `@default(uuid())` |
| email | text, unique | stored lowercased and trimmed; unique index on `email` |
| displayName | text | 1–100 chars |
| passwordHash | text | argon2id; never returned by the API or written to audit |
| role | Role | exactly one |
| status | UserStatus | default ACTIVE |
| mustChangePassword | boolean | default false; true when set by an Admin (create or reset) |
| failedLoginCount | int | default 0 |
| lastFailedLoginAt | timestamptz? | |
| lockedUntil | timestamptz? | login refused while `> now()` |
| passwordChangedAt | timestamptz | default now() |
| createdAt / updatedAt | timestamptz | `@default(now())` / `@updatedAt` |

**State transitions**: ACTIVE → DEACTIVATED (Admin, not the last active ADMIN, revokes all refresh tokens) → ACTIVE (Admin).

**Invariant**: count(role=ADMIN, status=ACTIVE) ≥ 1 after every transaction (R10).

## RefreshToken (`refresh_tokens`)

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK → users.id | `onDelete: Cascade` |
| tokenHash | text, unique | SHA-256 hex of the raw token |
| familyId | uuid | shared across rotations of one sign-in |
| familyCreatedAt | timestamptz | the sign-in time; absolute expiry = this + 7 days |
| expiresAt | timestamptz | min(now + 7d, familyCreatedAt + 7d) |
| revokedAt | timestamptz? | set on rotation, logout, deactivation, password change/reset |
| createdAt | timestamptz | |

Indexes: `(user_id)`, `(family_id)`.

**Rules**:
- **Valid** means `revokedAt IS NULL AND expiresAt > now()` and the user is ACTIVE.
- **Reuse**: presenting a revoked token revokes every token in its family and is audited as `auth.refresh_refused` with reason `reuse_detected`.

## AuditEntry (`audit_entries`) — append-only

| Field | Type | Rules |
|---|---|---|
| id | bigint PK | `@default(autoincrement())` (identity); the pagination cursor |
| occurredAt | timestamptz | default now() |
| actorType | text | `'user'` or `'system'` or `'anonymous'` (failed login with unknown email) |
| actorId | uuid? | user id when actorType=user; **no FK** (survives user changes) |
| action | text | an action code (see below), max 64 |
| targetType | text? | e.g. `'user'`, `'session'` |
| targetId | text? | |
| before | jsonb? | redacted (R9) |
| after | jsonb? | redacted (R9) |
| metadata | jsonb? | e.g. `{ email, reason }` for failed logins |
| correlationId | uuid | |
| ipAddress | text? | |

Indexes: `(actor_id, id DESC)`, `(action, id DESC)`, `(target_type, target_id, id DESC)`, `(occurred_at)`.

**DB enforcement**: a raw-SQL migration `audit_append_only`:
```sql
CREATE FUNCTION audit_entries_block_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_entries is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_entries_no_update_delete BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_block_mutation();
CREATE TRIGGER audit_entries_no_truncate BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_block_mutation();
```

### Action codes (exported as `AUDIT_ACTIONS` const in shared)

| Code | Target | before/after/metadata |
|---|---|---|
| `auth.login_succeeded` | user | — |
| `auth.login_failed` | user or none | metadata `{ email, reason: 'bad_password'|'unknown_email'|'locked'|'deactivated' }` |
| `auth.account_locked` | user | after `{ lockedUntil }` |
| `auth.logout` | user | — |
| `auth.refresh_refused` | user or none | metadata `{ reason: 'expired'|'revoked'|'reuse_detected'|'deactivated'|'unknown' }` |
| `auth.forbidden` | none | metadata `{ method, path, role }` |
| `auth.password_changed` | user | — (self-service) |
| `user.created` | user | after = public user |
| `user.updated` | user | before/after = changed fields (displayName) |
| `user.role_changed` | user | before `{role}` after `{role}` |
| `user.deactivated` | user | before `{status}` after `{status}` |
| `user.reactivated` | user | before `{status}` after `{status}` |
| `user.password_reset` | user | — (Admin set a temporary password) |

A PATCH that changes both displayName and role writes two entries (`user.updated` and `user.role_changed`) in the same transaction.

## Seed (`apps/api/prisma/seed.ts`)

It refuses to run when `NODE_ENV=production` and is idempotent (upsert by email). It writes one `user.created` audit entry per newly created user with actorType `system`.

| email | role | password |
|---|---|---|
| admin@opsgraph.local | ADMIN | `SEED_PASSWORD` env, default `OpsGraph-Dev-2026!` |
| manager@opsgraph.local | OPS_MANAGER | same |
| analyst@opsgraph.local | ANALYST | same |

Seeded users have `mustChangePassword=false`.
