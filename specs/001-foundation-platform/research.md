# Research: Foundation Platform

All Technical Context items are resolved. Each decision is final for the implementer: **do not substitute alternatives**.

## R1. Runtime, language, package manager
- **Decision**: Node.js 22 LTS, TypeScript 5.x (`strict: true`, `noUncheckedIndexedAccess: true`), pnpm 9 workspaces.
- **Rationale**: These are the current LTS versions. pnpm workspaces give fast, strict monorepo installs.
- **Alternatives**: npm/yarn workspaces (looser hoisting), Nx/Turborepo (unneeded tooling at 3 packages).

## R2. Shared contracts package
- **Decision**: `packages/shared` (`@opsgraph/shared`) holds the zod 3 schemas and inferred types. It is built with `tsup` to dual CJS+ESM in `dist/`. The api (CJS, Nest) and web (ESM, Vite) import the built output. Root `pnpm build` builds shared first (pnpm topological order). In dev, `tsup --watch` runs.
- **Rationale**: A single source of truth for payloads (FR-020). The dual build avoids CJS/ESM interop issues between Nest and Vite.
- **Alternatives**: TS path aliases to the source (break Nest's runtime resolution), `nestjs-zod` (extra dependency for something a ~20-line pipe does).

## R3. Validation in Nest
- **Decision**: a custom `ZodValidationPipe(schema)` applied per route parameter (`@Body(new ZodValidationPipe(LoginRequestSchema))`). On failure it throws `ValidationError`, which maps to `400 VALIDATION_FAILED` with `details: [{ path, message }]`.
- **Alternatives**: class-validator DTOs (duplicate the zod schemas, violating the single source of truth).

## R4. Authentication tokens
- **Decision**:
  - **Access token**: JWT HS256 signed with `JWT_ACCESS_SECRET`, TTL 900 s. The payload is only `{ sub: userId }`. The web app keeps it in memory and sends it as `Authorization: Bearer`.
  - **Refresh token**: 32 random bytes, base64url. It is sent as an `httpOnly; Secure (prod); SameSite=Strict; Path=/api/auth` cookie named `og_refresh`. Only its SHA-256 hash is stored in `refresh_tokens`.
  - **Rotation**: every refresh revokes the used token and issues a new one in the same `familyId`. Reusing a revoked token revokes the whole family (theft detection).
  - **Absolute lifetime**: the 7-day limit counts from `familyCreatedAt`, so rotation never extends a session past 7 days after sign-in (FR-003).
- **Rationale**: In-memory access tokens plus httpOnly refresh cookies is the standard SPA pattern, and resists XSS theft of long-lived credentials. Same-origin (via the Vite proxy) means no CORS.
- **Alternatives**: server sessions with connect-pg-simple (stateful, but also valid; rejected to keep API stateless for later service extraction), refresh token in localStorage (XSS risk).

## R5. Enforcing deactivation/role change within 1 minute (FR-006)
- **Decision**: `JwtAuthGuard` verifies the JWT, then loads the user by primary key from the DB on **every** request and uses the DB's `role`, `status` and `mustChangePassword`. The JWT carries no role.
- **Rationale**: The primary-key lookup is about 1 ms, and it makes revocation immediate with no cache invalidation logic. This is the simplest correct option for a weak implementer.
- **Alternatives**: a role in the JWT plus a denylist (complex), a 30 s in-memory cache (premature).

## R6. Password hashing
- **Decision**: `argon2` (argon2id, library defaults). Minimum length is 12 and maximum is 128 (enforced in the zod schema).
- **Alternatives**: bcrypt (72-byte limit, older).

## R7. Account lockout (FR-005)
- **Decision**: `users.failedLoginCount` and `users.lockedUntil`. On failure, if `lastFailedLoginAt` is older than 15 minutes, the counter resets to 1; otherwise it increments. When it reaches 5, set `lockedUntil = now + 15 min` and audit `auth.account_locked`. A successful login resets the counter. While locked, the user gets the same generic 401 `INVALID_CREDENTIALS`.

## R8. Request context (actor, IP, correlation id)
- **Decision**: `nestjs-cls`. Middleware sets `correlationId` (from the `x-request-id` header if it is a valid UUID, otherwise `randomUUID()`) and `ip`. `JwtAuthGuard` sets `userId`. The correlation id is echoed in the `x-request-id` response header.
- **Alternatives**: hand-rolled AsyncLocalStorage (more code for the implementer to get wrong).

## R9. Atomic, append-only audit (FR-013–FR-018)
- **Decision**:
  - `AuditService.record(tx, input)` takes a **Prisma transaction client**. Every state-changing service method wraps its mutation and its audit write in `prisma.$transaction(async (tx) => { ... })`. The actor, IP and correlation id come from CLS automatically.
  - For events with no other state change (`auth.forbidden`, `auth.refresh_refused`), `AuditService.recordStandalone(input)` uses the base client.
  - **DB enforcement**: a migration adds a `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger on `audit_entries`, both calling a function that `RAISE EXCEPTION 'audit_entries is append-only'`. Triggers apply even to the table owner, unlike REVOKE.
  - **Redaction**: `AuditService` strips the keys `password`, `passwordHash`, `token`, `tokenHash`, `refreshToken` and `accessToken` (deep) from `before`/`after` before insert (FR-016).
- **Alternatives**: Prisma middleware/extension auto-audit (too magical, cannot capture semantic action codes), REVOKE-based enforcement (does not bind the owner role used in dev/CI).

## R10. Last-Administrator guard (FR-010)
- **Decision**: inside the transaction, `SELECT pg_advisory_xact_lock(hashtext('opsgraph:last-admin'))` before counting active ADMINs whenever an operation would deactivate or demote an ADMIN. If the count after the change would be 0, throw `409 LAST_ADMIN`.
- **Rationale**: Serializes concurrent demotions without raising the isolation level everywhere.

## R11. Audit query performance (SC-006)
- **Decision**: keyset pagination on `id` (bigint identity, monotonic), `ORDER BY id DESC`, cursor = last id, default limit 50, max 200. Indexes: `(actor_id, id DESC)`, `(action, id DESC)`, `(target_type, target_id, id DESC)`, `(created_at)`.

## R12. Error format (FR-021)
- **Decision**: a global `AllExceptionsFilter` returns `{ error: { code, message, details?, correlationId } }`. Known codes: `VALIDATION_FAILED`(400), `INVALID_CREDENTIALS`(401), `UNAUTHENTICATED`(401), `PASSWORD_CHANGE_REQUIRED`(403), `FORBIDDEN`(403), `NOT_FOUND`(404), `EMAIL_TAKEN`(409), `LAST_ADMIN`(409), `INTERNAL`(500). Unknown errors are logged with their stack server-side and return `INTERNAL` with no details.

## R13. Health (FR-019)
- **Decision**: a hand-written `HealthController` (no terminus). `GET /api/health/live` returns `200 {status:"ok", version}`. `GET /api/health/ready` runs `SELECT 1` with a 2 s timeout and returns 200 or 503 `{status, version, checks:{database:"up"|"down"}}`. Both are `@Public()`. The version is read from `apps/api/package.json`.

## R14. Config
- **Decision**: `apps/api/src/config/env.ts` parses `process.env` with zod at boot and fails fast. Variables: `NODE_ENV`, `PORT` (3000), `DATABASE_URL`, `JWT_ACCESS_SECRET` (min 32 chars), `ACCESS_TOKEN_TTL_SECONDS` (900), `REFRESH_TOKEN_TTL_DAYS` (7), `COOKIE_SECURE` (bool, default true when production).

## R15. Web stack
- **Decision**: React 19, Vite 6, React Router 7 (`createBrowserRouter`), TanStack Query 5, Tailwind CSS 4 (`@tailwindcss/vite`), react-hook-form 7 with `@hookform/resolvers/zod`. The dev server proxies `/api` to `http://localhost:3000`.
- **API client**: `apiFetch` holds the access token in a module variable. On 401 it performs a single-flight `POST /api/auth/refresh` and retries once. On refresh failure it clears the auth state and redirects to `/login?next=…`. On app boot it calls refresh to restore the session.
- **Alternatives**: axios (unneeded), Redux (TanStack Query plus a small auth context is enough).

## R16. Testing
- **Decision**:
  - **api**: Jest + ts-jest. Unit tests live next to their code as `*.spec.ts`. e2e tests in `apps/api/test/*.e2e-spec.ts` use supertest against a real Postgres database (`opsgraph_test`). `test/setup-e2e.ts` runs `prisma migrate reset --force --skip-seed` once and truncates non-audit tables between files. The audit table is cleared with `ALTER TABLE audit_entries DISABLE TRIGGER USER` in the test helper only.
  - **web**: Vitest + @testing-library/react + jsdom.
  - **shared**: Vitest.
- **Rationale**: e2e tests against a real DB are required by the constitution (Principle V) and the spec (FR-023).

## R17. Lint/format
- **Decision**: ESLint 9 flat config at the root, using `typescript-eslint` (recommended-type-checked), `eslint-plugin-react-hooks` for web, and Prettier 3. Root scripts: `lint`, `typecheck` (`pnpm -r typecheck` → `tsc --noEmit`), `test`, `test:e2e`, `build`, `format`.

## R18. CI
- **Decision**: `.github/workflows/ci.yml` runs on `pull_request` and on `push` to `main`. Job: ubuntu-latest, `postgres:16-alpine` service with a health check, `pnpm/action-setup`, `actions/setup-node` (node 22, pnpm cache), `pnpm install --frozen-lockfile`, `pnpm --filter @opsgraph/shared build`, `pnpm --filter api prisma generate`, `pnpm --filter api prisma migrate deploy`, then `lint`, `typecheck`, `test`, `test:e2e`, `build`. It has a 10-minute timeout (SC-005).

## R19. Local DB
- **Decision**: a root `docker-compose.yml` with the `db` service `postgres:16-alpine`, port 5432, user/password/db `opsgraph`/`opsgraph`/`opsgraph`, and a named volume. `docker/postgres/init.sql` creates `opsgraph_test`.
