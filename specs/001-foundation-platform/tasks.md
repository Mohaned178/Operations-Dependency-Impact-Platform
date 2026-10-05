# Tasks: Foundation Platform

**Input**: `specs/001-foundation-platform/` (plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md)
**Tests**: REQUIRED (Constitution V, FR-023, FR-024).

## Rules for the implementer (read first)

1. Do tasks **in ID order** within a phase. `[P]` tasks touch different files and may be done in any order.
2. Before each task, re-read the referenced section of `research.md` (R#), `data-model.md` or `contracts/api.md`. **Do not invent alternatives.**
3. Only add the dependencies listed in `plan.md` → Technical Context. Anything else goes in `questions.md` first.
4. After each **phase**, run the phase's **Checkpoint** command. Fix all failures before moving on, then tick the boxes and commit (`feat(<scope>): …`).
5. If anything is ambiguous, stop and write the question to `specs/001-foundation-platform/questions.md`.
6. Never use `any`, never leave `TODO`s, and never log passwords or tokens.

---

## Phase 1: Setup (monorepo skeleton)

**Purpose**: an empty but buildable, lintable, typecheckable workspace.

- [x] T001 Create root `package.json` (`"private": true`, `"packageManager": "pnpm@9"`, `"engines": {"node": ">=22"}`). Add the scripts:
  - `dev`: `pnpm -r --parallel --filter ./apps/* --filter @opsgraph/shared dev`
  - `build`: `pnpm -r build`
  - `lint`: `eslint .`
  - `typecheck`: `pnpm -r typecheck`
  - `test`: `pnpm -r test`
  - `test:e2e`: `pnpm --filter api test:e2e`
  - `format`: `prettier --write .`

  Also create `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.nvmrc` (`22`), `.editorconfig` and `.gitignore` (node_modules, dist, coverage, .env, *.log).
- [x] T002 [P] Create `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride`, `forceConsistentCasingInFileNames`, `skipLibCheck`, `esModuleInterop`, `resolveJsonModule`, `target ES2022`.
- [x] T003 [P] Create `eslint.config.mjs` (flat config) at the root:
  - typescript-eslint `recommendedTypeChecked` with `parserOptions.projectService: true`
  - `eslint-plugin-react-hooks` for `apps/web/**`
  - ignores: `**/dist`, `**/coverage`, `**/*.config.*`, `apps/api/prisma/migrations`
  - the rule `@typescript-eslint/no-explicit-any: error`

  Also create `.prettierrc` (`singleQuote: true`, `printWidth: 100`, `trailingComma: all`) and `.prettierignore`. Add root devDeps: `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, `typescript`.
- [x] T004 [P] Create `docker-compose.yml` with service `db`:
  - image `postgres:16-alpine`; env `POSTGRES_USER/PASSWORD/DB=opsgraph`
  - ports `5432:5432`; named volume `pgdata`
  - mount `./docker/postgres/init.sql` to `/docker-entrypoint-initdb.d/init.sql`
  - healthcheck `pg_isready -U opsgraph`

  Create `docker/postgres/init.sql` containing `CREATE DATABASE opsgraph_test;`.
- [x] T005 [P] Scaffold `packages/shared`:
  - `package.json`: name `@opsgraph/shared`, `main: dist/index.cjs`, `module: dist/index.js`, `types: dist/index.d.ts`, `exports` with `import`/`require`/`types`
  - scripts: `build: tsup`, `dev: tsup --watch`, `typecheck: tsc --noEmit`, `test: vitest run`
  - deps `zod@3`; devDeps `tsup`, `vitest`, `typescript`
  - `tsconfig.json` extending the base
  - `tsup.config.ts`: entry `src/index.ts`, format `['cjs','esm']`, `dts: true`, `clean: true`
  - `vitest.config.ts`
  - `src/index.ts` exporting `{}` for now
- [x] T006 [P] Scaffold `apps/api` as a NestJS 11 app **by hand** (no Nest CLI generator, no example controller):
  - `package.json`: name `api`
  - scripts: `dev: nest start --watch`, `build: nest build`, `start: node dist/main.js`, `typecheck: tsc --noEmit`, `test: jest`, `test:e2e: jest --config test/jest-e2e.config.ts --runInBand`
  - `prisma.seed`: `ts-node prisma/seed.ts`
  - deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/jwt`, `@prisma/client`, `argon2`, `nestjs-cls`, `cookie-parser`, `reflect-metadata`, `rxjs`, `zod`, `@opsgraph/shared: workspace:*`
  - devDeps: `@nestjs/cli`, `@nestjs/testing`, `prisma`, `jest`, `ts-jest`, `@types/jest`, `supertest`, `@types/supertest`, `@types/cookie-parser`, `@types/express`, `ts-node`, `typescript`
  - `tsconfig.json` (extends base; `module commonjs`, `experimentalDecorators`, `emitDecoratorMetadata`, `outDir dist`), `tsconfig.build.json` (excludes test and `**/*.spec.ts`), `nest-cli.json`
  - `jest.config.ts` (ts-jest, `rootDir src`, `testRegex .*\.spec\.ts$`)
  - `src/main.ts` and `src/app.module.ts` as an empty module
- [x] T007 [P] Scaffold `apps/web` as Vite + React 19 + TS:
  - `package.json`: name `web`
  - scripts: `dev: vite`, `build: tsc --noEmit && vite build`, `typecheck: tsc --noEmit`, `test: vitest run`
  - deps: `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `@opsgraph/shared: workspace:*`
  - devDeps: `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@types/react`, `@types/react-dom`, `typescript`
  - `vite.config.ts`: react and tailwind plugins, `server.port 5173`, `server.proxy {'/api': 'http://localhost:3000'}`
  - `vitest.config.ts`: environment `jsdom`, setupFiles `src/test-setup.ts` importing `@testing-library/jest-dom/vitest`
  - `index.html`, `src/main.tsx` rendering `<h1>OpsGraph</h1>`, and `src/index.css` with `@import "tailwindcss";`

**Checkpoint**:
```bash
pnpm install && pnpm --filter @opsgraph/shared build && pnpm lint && pnpm typecheck && pnpm build
```
All pass.

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: DB schema, shared primitives, error handling, request context, the audit writer, the auth guards and the e2e harness.

### Shared primitives
- [x] T008 [P] Create `packages/shared/src/common.ts` with:
  - `RoleSchema`, `UserStatusSchema`, `EmailSchema`, `PasswordSchema`, `PageQuerySchema` (contracts/api.md, "Shared base schemas")
  - `ErrorCodeSchema` (the codes in research R12) and `ErrorResponseSchema`
  - `ROLE_LABELS: Record<Role,string>`
  - inferred types for every schema

  Re-export everything from `src/index.ts`.
- [x] T009 [P] Create `packages/shared/src/audit.ts`:
  - `AUDIT_ACTIONS` as a `const` object (keys like `USER_ROLE_CHANGED`, values `'user.role_changed'`) for all 13 codes in data-model.md
  - type `AuditAction`
  - `AuditEntryDtoSchema`, `ListAuditQuerySchema`, `AuditListResponseSchema` (contracts/api.md, Audit)

  Re-export from the index.
- [x] T010 [P] Write `packages/shared/src/common.spec.ts`:
  - `EmailSchema` lowercases and trims `'  A@B.COM '` to `'a@b.com'`
  - `PasswordSchema` rejects 11 characters and accepts 12
  - `PageQuerySchema` coerces `limit='20'` to 20 and rejects 201

### Database
- [x] T011 Create `apps/api/prisma/schema.prisma` exactly per data-model.md:
  - models `User`, `RefreshToken`, `AuditEntry`; enums `Role`, `UserStatus`
  - snake_case `@@map`/`@map`
  - all indexes listed; `AuditEntry.id BigInt @id @default(autoincrement())`; `before`/`after`/`metadata Json?`

  Create `apps/api/.env.example`:
  ```
  NODE_ENV=development
  PORT=3000
  DATABASE_URL=postgresql://opsgraph:opsgraph@localhost:5432/opsgraph
  JWT_ACCESS_SECRET=dev-only-secret-change-me-0123456789abcdef
  ACCESS_TOKEN_TTL_SECONDS=900
  REFRESH_TOKEN_TTL_DAYS=7
  COOKIE_SECURE=false
  SEED_PASSWORD=OpsGraph-Dev-2026!
  ```
  Also create `apps/api/.env.test` with the same values but `DATABASE_URL=.../opsgraph_test` and `NODE_ENV=test`.
- [x] T012 Generate the migration `init` (`pnpm --filter api prisma migrate dev --name init`). Then create the migration `audit_append_only` (`prisma migrate dev --create-only --name audit_append_only`) and paste the exact SQL from data-model.md ("DB enforcement") into its `migration.sql`. Apply it.
- [x] T013 Create `apps/api/src/prisma/prisma.service.ts` (extends `PrismaClient`, implements `OnModuleInit` → `$connect`) and `prisma.module.ts` (`@Global()`, exports `PrismaService`). Export the type `export type Tx = Prisma.TransactionClient;` from `prisma.service.ts`.

### Config, context, errors, validation
- [x] T014 [P] Create `apps/api/src/config/env.ts`: a zod schema per research R14, `export const env = EnvSchema.parse(process.env)` (throws on boot if invalid), and a derived `cookieSecure` (`COOKIE_SECURE` defaults to true when `NODE_ENV=production`).
- [x] T015 [P] Create `apps/api/src/common/errors/app-error.ts`:
  - `class AppError extends Error { constructor(code: ErrorCode, status: number, message: string, details?: {path:string;message:string}[]) }`
  - factory helpers `Errors.validation(details)`, `invalidCredentials()`, `unauthenticated()`, `passwordChangeRequired()`, `forbidden()`, `notFound(what)`, `emailTaken()`, `lastAdmin()`. Use the messages in quickstart; the last-admin message is "At least one active Administrator is required".
- [x] T016 [P] Create `apps/api/src/common/context/request-context.ts`:
  - nestjs-cls `ClsModule.forRoot({ global: true, middleware: { mount: true, setup } })`. `setup` sets `correlationId` (incoming `x-request-id` if it is a valid UUID, else `randomUUID()`) and `ip` (`req.ip`), and sets the response header `x-request-id`.
  - export a `RequestContext` injectable with typed getters `correlationId`, `ip`, `userId`, and the setter `setUserId(id)`
- [x] T017 Create `apps/api/src/common/errors/all-exceptions.filter.ts` (global `@Catch()`). Map:
  - `AppError` → its status and code
  - Nest `HttpException` 404 → `NOT_FOUND`, other `HttpException` → `INTERNAL` with its status
  - anything else → log with `Logger.error(err.stack)` and return 500 `INTERNAL`, message "Internal error"

  The body must be `{ error: { code, message, details?, correlationId } }`.
- [x] T018 [P] Create `apps/api/src/common/validation/zod-validation.pipe.ts`: `ZodValidationPipe<T>(schema: ZodType<T>)`. Its `transform` uses `safeParse`, and on failure throws `Errors.validation(issues.map(i => ({ path: i.path.join('.'), message: i.message })))`.
- [x] T019 Wire up `apps/api/src/main.ts` and `app.module.ts`:
  - `setGlobalPrefix('api')`, `app.use(cookieParser())`, `enableShutdownHooks()`, `app.set('trust proxy', 'loopback')`, global filter `AllExceptionsFilter`, listen on `env.PORT`
  - `AppModule` imports `ClsModule` config, `PrismaModule`

### Audit writer (reused by every later feature, FR-018)
- [x] T020 [P] Create `apps/api/src/audit/redact.ts`: `redact(value: unknown): unknown` deep-clones and removes the keys `password`, `passwordHash`, `currentPassword`, `newPassword`, `temporaryPassword`, `token`, `tokenHash`, `refreshToken`, `accessToken` at any depth. Write `redact.spec.ts` covering nested objects and arrays.
- [x] T021 Create `apps/api/src/audit/audit.service.ts` and `audit.module.ts` (`@Global()`, exports `AuditService`):
  - `record(tx: Tx, input: { action: AuditAction; targetType?: string; targetId?: string; before?: unknown; after?: unknown; metadata?: unknown; actorType?: 'user'|'system'|'anonymous'; actorId?: string })` inserts via `tx.auditEntry.create`
    - the actor defaults to `RequestContext.userId` (`actorType 'user'`), or `'anonymous'` when there is none
    - `correlationId` and `ip` come from `RequestContext`
    - `before`, `after` and `metadata` pass through `redact()`
  - `recordStandalone(input)` is the same thing using `this.prisma`
  - write `audit.service.spec.ts` (mocked tx) asserting redaction and context defaults

### Auth guards (deny-by-default)
- [x] T022 [P] Create the decorators in `apps/api/src/auth/decorators/`: `public.decorator.ts` (`@Public()`), `roles.decorator.ts` (`@Roles(...roles: Role[])`), `allow-password-change.decorator.ts` (`@AllowDuringPasswordChange()`), and `current-user.decorator.ts` (`@CurrentUser()` returns `request.user` typed as `AuthUser = { id, email, displayName, role, status, mustChangePassword }`).
- [x] T023 Create `apps/api/src/auth/token.service.ts`, part of `AuthModule`, which imports `JwtModule.register({ secret: env.JWT_ACCESS_SECRET, signOptions: { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS } })`. It provides:
  - `signAccess(userId)` and `verifyAccess(token): {sub}` (throws `Errors.unauthenticated()`)
  - `issueRefresh(tx, userId, familyId?, familyCreatedAt?)`: random 32 bytes base64url, stores the sha256 hex hash, `expiresAt` per data-model; returns `{ raw, expiresAt }`
  - `rotateRefresh(raw)`: implements data-model "RefreshToken rules" including reuse detection; returns `{ user, raw, expiresAt }` or throws `unauthenticated` after `recordStandalone(auth.refresh_refused)` with a reason
  - `revokeFamilyByRaw(raw)` and `revokeAllForUser(tx, userId, exceptFamilyId?)`
- [x] T024 Create `apps/api/src/auth/guards/jwt-auth.guard.ts` following plan.md design note 2 exactly. Then create `apps/api/src/auth/guards/roles.guard.ts`:
  - if there is no `@Roles`, allow
  - if the user's role is not in the list, call `audit.recordStandalone({ action: 'auth.forbidden', metadata: { method, path, role } })` and throw `Errors.forbidden()`

  Register both as `APP_GUARD` (Jwt first) in `apps/api/src/auth/auth.module.ts`, and import `AuthModule` and `AuditModule` in `AppModule`.
- [x] T025 Write `apps/api/src/auth/guards/jwt-auth.guard.spec.ts` covering:
  - a public route bypasses the guard
  - a missing or invalid token gives `UNAUTHENTICATED`
  - a deactivated user gives `UNAUTHENTICATED`
  - `mustChangePassword` on a non-allowed route gives `PASSWORD_CHANGE_REQUIRED`
  - a valid token sets `request.user`

### e2e harness
- [x] T026 Create the e2e harness in `apps/api/test/`:
  - `jest-e2e.config.ts`: `testRegex .e2e-spec.ts$`, `globalSetup ./global-setup.ts`, `setupFiles ['./load-env.ts']`
  - `load-env.ts`: loads `.env.test` into `process.env` using `node:fs` (no dotenv dependency)
  - `global-setup.ts`: runs `prisma migrate reset --force --skip-seed` against `opsgraph_test` via `execSync`
  - `helpers.ts` exports:
    - `createTestApp()`: builds `AppModule` with the same `main.ts` setup; refactor that setup into `apps/api/src/bootstrap.ts` (`configureApp(app)`) and use it from both
    - `resetDb(prisma)`: `TRUNCATE users, refresh_tokens CASCADE`, then for audit run `ALTER TABLE audit_entries DISABLE TRIGGER USER; DELETE FROM audit_entries; ALTER TABLE audit_entries ENABLE TRIGGER USER;` (**test helper only**)
    - `createUser(prisma, {role, email?, password?, mustChangePassword?, status?})`
    - `login(app, email, password) → { accessToken, cookie }`

**Checkpoint**:
```bash
docker compose up -d db && pnpm --filter @opsgraph/shared build && pnpm lint && pnpm typecheck && pnpm test
```
All pass. Also, `psql` → `DELETE FROM audit_entries` fails with "append-only".

---

## Phase 3: User Story 1 — Sign in and reach the role-appropriate workspace (P1) 🎯 MVP

**Goal**: login, refresh, logout, me, change-password and lockout, plus the web login and app shell.
**Independent test**: quickstart steps 1–3. Each seeded user signs in and sees the correct role and nav, and is redirected after logout.

### Shared and seed
- [x] T027 [P] [US1] Create `packages/shared/src/auth.ts`: `LoginRequestSchema`, `ChangePasswordRequestSchema` (with a refine that the new password differs from the current one), `PublicUserSchema` (moved here or in `users.ts`, exported once), `AuthSessionSchema`, per contracts/api.md. Re-export from the index.
- [x] T028 [P] [US1] Create `apps/api/prisma/seed.ts` per data-model.md "Seed":
  - refuse to run if `NODE_ENV=production`
  - upsert 3 users with argon2 hashes
  - write a `user.created` audit entry with actorType `system` for each newly created user, using `prisma.$transaction`

### API
- [x] T029 [P] [US1] Create `apps/api/src/auth/password.service.ts`: `hash(pw)` (argon2id), `verify(hash, pw)`, and a precomputed `DUMMY_HASH` used for unknown emails (research R7, plan note 4).
- [x] T030 [US1] Create `apps/api/src/auth/auth.service.ts`:
  - `login(email, password)`: implements R7 and plan note 4. In one transaction it updates the counters and audits `auth.login_failed` (plus `auth.account_locked` when the lock triggers), then throws `INVALID_CREDENTIALS` **after** the transaction. On success, in one transaction it resets the counters, issues a refresh token in a new family, and audits `auth.login_succeeded`.
  - `refresh(raw)` delegates to `TokenService.rotateRefresh`.
  - `logout(raw?)` revokes the family and audits `auth.logout` when the user is known.
  - `changePassword(user, current, next)`: verifies, hashes, sets `mustChangePassword=false` and `passwordChangedAt`, revokes all refresh tokens, issues a new family, and audits `auth.password_changed`, all in one transaction.
  - All methods return `AuthSession` built through `toPublicUser()`, which you create in `apps/api/src/users/user.mapper.ts`.
- [x] T031 [US1] Create `apps/api/src/auth/auth.controller.ts` with routes per contracts/api.md (Auth table):
  - `@Public()` on login, refresh and logout
  - `@AllowDuringPasswordChange()` on `me`, `change-password` and `logout`
  - read the cookie from `req.cookies.og_refresh`
  - set and clear it only via the helper `setRefreshCookie`/`clearRefreshCookie` in `apps/api/src/auth/refresh-cookie.ts` (`httpOnly`, `sameSite 'strict'`, `secure: cookieSecure`, `path '/api/auth'`, `expires`)
  - validate bodies with `ZodValidationPipe`
- [x] T032 [US1] Write `apps/api/test/auth.e2e-spec.ts` covering:
  - login success returns the session and sets the cookie
  - a wrong password and an unknown email give identical 401 bodies apart from `correlationId`
  - the 5-failure lockout: the 6th attempt with the correct password gets 401, and an `auth.account_locked` audit row exists
  - refresh rotates (the old cookie then fails with 401, and the whole family is revoked)
  - refresh more than 7 days after the family was created fails (set `familyCreatedAt` in the DB)
  - logout revokes the token
  - `me` without a token gives 401
  - `mustChangePassword` user: `me` succeeds, `/users` gets 403 `PASSWORD_CHANGE_REQUIRED`; change-password clears it and revokes other sessions
  - deactivated user: login 401, and an existing access token stops working (FR-006)
  - no audit row contains the string of the password used

### Web
- [x] T033 [P] [US1] Create `apps/web/src/lib/api-client.ts` per research R15:
  - `setAccessToken`, `apiFetch<T>(path, { method, body, schema? })`: adds the Bearer token and `credentials: 'same-origin'`, parses the response with the zod schema when given, throws `ApiError {status, code, message, details}` built from `ErrorResponseSchema`
  - single-flight refresh on 401 (not for `/auth/*` calls) with one retry
  - an `onAuthFailure` callback hook

  Also create `apps/web/src/lib/query-client.ts`.
- [x] T034 [US1] Create the auth state in `apps/web/src/auth/`:
  - `AuthProvider.tsx`: on mount calls `POST /api/auth/refresh` to restore the session; state `{ status: 'loading'|'authenticated'|'anonymous', user }`; methods `login`, `logout`, `changePassword`, `setSession`
  - `useAuth.ts`
  - `RequireAuth.tsx`: if loading, show a spinner; if anonymous, `<Navigate to={'/login?next='+encodeURIComponent(location.pathname)} />`; if `user.mustChangePassword`, navigate to `/change-password`
  - `RequireRole.tsx`: renders `ForbiddenPage` when the role does not match
- [x] T035 [P] [US1] Create `apps/web/src/pages/LoginPage.tsx`:
  - react-hook-form with `zodResolver(LoginRequestSchema)`
  - shows "Invalid email or password" on `INVALID_CREDENTIALS`
  - on success, navigates to the `next` query param if it starts with `/`, otherwise `/`
- [x] T036 [P] [US1] Create `apps/web/src/pages/ChangePasswordPage.tsx`: form with `ChangePasswordRequestSchema` plus a confirm field. On success it updates the session and navigates to `/`.
- [x] T037 [P] [US1] Create `apps/web/src/layout/AppShell.tsx`:
  - header with the app name, `user.displayName`, `ROLE_LABELS[user.role]` and a Sign out button
  - side nav: Home `/`, Investigations `/investigations`, Graph Explorer `/graph`, Exceptions `/exceptions`, and Admin (`/admin/users`, `/admin/audit`) only when the role is ADMIN
  - an `<Outlet/>`
- [x] T038 [P] [US1] Create `apps/web/src/pages/HomePage.tsx` ("Welcome, {name}"), `ForbiddenPage.tsx` ("You are not permitted to view this page"), `NotFoundPage.tsx` and `ComingSoonPage.tsx`.
- [x] T039 [US1] Create `apps/web/src/router.tsx` (`createBrowserRouter`) with the routes from plan.md design note 7. Admin child routes may temporarily point to `ComingSoonPage` until US2/US3. Update `main.tsx` to render `QueryClientProvider` > `AuthProvider` > `RouterProvider`.
- [x] T040 [US1] Write the web tests:
  - `apps/web/src/pages/LoginPage.test.tsx`: shows a validation error for a bad email; shows "Invalid email or password" for a mocked 401 (mock `fetch` with `vi.fn`)
  - `apps/web/src/layout/AppShell.test.tsx`: the Admin nav is hidden for ANALYST and shown for ADMIN

**Checkpoint**:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```
Then do quickstart steps 1–3 manually.

---

## Phase 4: User Story 2 — Administrator manages users and roles (P1)

**Goal**: user CRUD with role changes, deactivate/reactivate, reset password, and the last-admin guard, plus the admin UI.
**Independent test**: quickstart steps 4–7.

- [x] T041 [P] [US2] Create `packages/shared/src/users.ts`: `ListUsersQuerySchema`, `UserListResponseSchema`, `CreateUserRequestSchema`, `UpdateUserRequestSchema` (with a refine that at least one field is set), `ResetPasswordRequestSchema`, per contracts/api.md. Re-export from the index.
- [x] T042 [US2] Create `apps/api/src/users/users.service.ts`. Every mutation follows the plan.md design note 3 pattern.
  - `list(query)`: keyset pagination on `(createdAt DESC, id DESC)`; `q` does an ILIKE on email and displayName.
  - `create(input)`: 409 `EMAIL_TAKEN` on a unique violation (Prisma `P2002`); `mustChangePassword=true`; audits `user.created`.
  - `get(id)`: 404 if missing.
  - `update(id, input)`: audits `user.updated` for a displayName change and `user.role_changed` for a role change. When demoting an ADMIN, apply the R10 last-admin check.
  - `deactivate(id)`: if already deactivated, no-op. Otherwise apply the R10 check if the user is ADMIN, revoke all refresh tokens, and audit.
  - `reactivate(id)`: if already active, no-op; otherwise audit.
  - `resetPassword(id, temp)`: hash, set `mustChangePassword=true`, revoke tokens, audit `user.password_reset`.
  - Put the last-admin check in a private `assertNotLastAdmin(tx, userId)` that takes `pg_advisory_xact_lock` via `tx.$executeRaw`.
- [x] T043 [US2] Create `apps/api/src/users/users.controller.ts` (`@Roles('ADMIN')` at class level; routes per contracts/api.md Users table; `ParseUUIDPipe` on `:id`) and `users.module.ts`. Import it in `AppModule`.
- [x] T044 [P] [US2] Write `apps/api/src/users/users.service.spec.ts` (real test DB via helpers, or mocked Prisma). Cover:
  - demoting the last admin gives `LAST_ADMIN`
  - deactivating self while not the last admin is allowed
  - PATCH with both fields writes two audit entries
- [x] T045 [US2] Write `apps/api/test/users.e2e-spec.ts` covering:
  - create, then the new user can log in with `mustChangePassword=true`
  - duplicate email (in different case) gives 409
  - list with `q`, `role` and pagination (`nextCursor`)
  - role change audited with before/after
  - deactivate revokes sessions: the target's existing access token gets 401 on its next call
  - last admin demote/deactivate gives 409
  - reset-password forces a password change
- [x] T046 [P] [US2] Create `apps/web/src/pages/admin/UsersListPage.tsx`: a table (name, email, role label, status, created) with a search box (debounced 300 ms), role and status filters, a "Load more" button using `nextCursor`, and a "New user" button. Use `useInfiniteQuery`.
- [x] T047 [P] [US2] Create `apps/web/src/pages/admin/UserCreatePage.tsx`: a form with `CreateUserRequestSchema`; maps `EMAIL_TAKEN` to the email field error; navigates to the detail page on success.
- [x] T048 [P] [US2] Create `apps/web/src/pages/admin/UserDetailPage.tsx`:
  - edit displayName and role (select with `ROLE_LABELS`)
  - Deactivate/Reactivate button with a confirm dialog (`window.confirm` is acceptable)
  - a reset-password form
  - show `LAST_ADMIN` errors as a banner
  - invalidate the user queries on success
- [x] T049 [US2] Wire the admin routes in `apps/web/src/router.tsx` (`/admin/users`, `/admin/users/new`, `/admin/users/:id`) and add `UsersListPage.test.tsx` (renders rows from mocked fetch).

**Checkpoint**:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```
Then do quickstart steps 4–7.

---

## Phase 5: User Story 3 — Immutable audit trail (P1)

**Goal**: the Admin audit browser, with append-only and atomicity proven by tests.
**Independent test**: quickstart steps 8–9.

- [x] T050 [US3] Add `list(query)` to `apps/api/src/audit/audit.service.ts`:
  - keyset on `id DESC` (`cursor` is a bigint string; `where id < cursor`)
  - filters `actorId`, `action`, `targetType`, `targetId`, `from`/`to` on `occurredAt`
  - limit default 50, max 200
  - join the actor email via a second query (`users where id in [...]`), since there is no FK
  - map to `AuditEntryDto` (`id.toString()`)
- [x] T051 [US3] Create `apps/api/src/audit/audit.controller.ts`: `@Roles('ADMIN')`, `GET /audit` only, query validated with `ListAuditQuerySchema`. Register it in `audit.module.ts`.
- [x] T052 [US3] Write `apps/api/test/audit.e2e-spec.ts` covering:
  - the actions from quickstart step 8 produce exactly one matching row each, with correct before/after
  - each filter narrows the results, and pagination returns no duplicates or gaps across 3 pages (insert 120 rows)
  - raw `prisma.$executeRaw\`UPDATE audit_entries SET action='x'\`` and `DELETE` and `TRUNCATE` all reject with "append-only"
  - **atomicity**: use `jest.spyOn(auditService, 'record').mockRejectedValueOnce(new Error('boom'))` and call PATCH role; the response is 500 and the user's role is unchanged in the DB
  - no row contains a password, `passwordHash` or token value (scan `JSON.stringify(rows)`)
- [x] T053 [US3] Write `apps/api/test/authz-matrix.e2e-spec.ts`. Run a table-driven `it.each` over every route in contracts/api.md × {anonymous, ANALYST, OPS_MANAGER, ADMIN}, asserting the status from the "Authorization matrix" table. Each 403 must also produce an `auth.forbidden` audit row.
- [x] T054 [P] [US3] Create `apps/web/src/pages/admin/AuditPage.tsx`:
  - filters: actor (select from the users list), action (select from `Object.values(AUDIT_ACTIONS)`), target type/id, from/to (datetime-local)
  - a table of occurredAt (local time), actor email or "system"/"anonymous", action, target, and an expandable before/after/metadata view (pretty-printed JSON)
  - "Load more" via `nextCursor`
  - wire it to `/admin/audit` in `router.tsx`

**Checkpoint**:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```
Then do quickstart steps 8–9.

---

## Phase 6: User Story 4 — Health checks (P2)

**Goal**: liveness and readiness.
**Independent test**: quickstart step 10.

- [x] T055 [P] [US4] Create `packages/shared/src/health.ts`: `HealthLiveSchema` and `HealthReadySchema` per contracts/api.md. Re-export from the index.
- [x] T056 [US4] Create `apps/api/src/health/health.controller.ts` and `health.module.ts`:
  - `@Public()` on both routes
  - `ready` runs `prisma.$queryRaw\`SELECT 1\`` raced against a 2 s timeout, and returns 503 via `@Res({passthrough:true}) res.status(503)` on failure
  - `version` is read once from `apps/api/package.json` via `readFileSync`
  - import the module in `AppModule`
- [x] T057 [US4] Write `apps/api/test/health.e2e-spec.ts`:
  - live gives 200
  - ready gives 200 with `database: 'up'`
  - ready with `prisma.$queryRaw` mocked to reject gives 503 with `database: 'down'`
  - the response body contains no `postgresql://` and no secret

**Checkpoint**:
```bash
pnpm test:e2e
```
Then do quickstart step 10.

---

## Phase 7: User Story 5 — Local setup and CI gate (P2)

**Goal**: documented setup and a merge-blocking CI gate.
**Independent test**: quickstart "Local setup" on a clean clone, plus a failing-test PR that turns CI red.

- [x] T058 [US5] Create `.github/workflows/ci.yml` per research R18:
  - `postgres:16-alpine` service (`POSTGRES_USER/PASSWORD=opsgraph`, `POSTGRES_DB=opsgraph_test`, health-cmd `pg_isready`)
  - env `DATABASE_URL=postgresql://opsgraph:opsgraph@localhost:5432/opsgraph_test`, `JWT_ACCESS_SECRET` set to a 40-character dummy, `NODE_ENV=test`
  - steps in this order: checkout, pnpm setup, node 22 with pnpm cache, `pnpm install --frozen-lockfile`, shared build, `prisma generate`, `prisma migrate deploy`, lint, typecheck, test, test:e2e, build
  - `timeout-minutes: 10`
  - make `test/load-env.ts` **not** override variables that are already set, so the CI env wins
- [x] T059 [P] [US5] Create the root `README.md`: a one-paragraph product summary linking to `Product Overview.md`, then "Prerequisites", "Local setup" (copied from quickstart.md), "Quality gate", "Seeded users (dev only)", "Project structure", and "Workflow" (link to CLAUDE.md).
- [x] T060 [US5] Verify on a clean state:
  ```bash
  docker compose down -v
  ```
  Then run the quickstart "Local setup" verbatim, time it, and record the result in `specs/001-foundation-platform/questions.md` under "Verification notes".

**Checkpoint**: CI is green on the PR for this branch.

---

## Phase 8: Polish & cross-cutting

- [x] T061 [P] Do a sweep: `grep -rn "any\b\|TODO\|console.log" apps packages --include=*.ts --include=*.tsx` must return nothing relevant. Remove any unused dependencies.
- [x] T062 [P] Create `apps/api/test/perf-audit.e2e-spec.ts`:
  - insert 100,000 audit rows with a single `INSERT ... SELECT generate_series`
  - assert that `GET /api/audit?action=user.role_changed` returns in under 2000 ms (SC-006)
  - skip it unless `RUN_PERF=1`, and document that in the README
- [x] T063 Run the full quickstart manual validation (steps 1–11) and tick each step in `quickstart.md` notes inside `questions.md`.

---

## Phase 9: Review fixes (from `/code-review high`, 2026-10-05)

**Goal**: Fix the concurrency, security and contract bugs found in review before feature 002 starts.

**Rules for this phase**: For each task, **write the test first, run it, and confirm that it fails** on the current code. Then apply the fix and confirm that the test passes. If a test passes before the fix, write that in `questions.md` and stop. Don't change the fix to make a test pass. Commit one task per commit with the `fix(<scope>): …` prefix.

### API

- [x] T064 [US1] Make refresh-token rotation atomic in `apps/api/src/auth/token.service.ts` → `rotateRefresh`.
  - **Bug**: the token is read outside the transaction and revoked with `update({ where: { id } })`. Two concurrent refreshes with the same cookie both succeed and create two live children in one family.
  - **Fix**: inside the existing `$transaction`, replace the `update` with
    `const { count } = await tx.refreshToken.updateMany({ where: { id: token.id, revokedAt: null }, data: { revokedAt: new Date() } });`
    If `count !== 1`, throw `Errors.unauthenticated()` from inside the transaction so nothing is issued. Catch that case **outside** the transaction, call `this.refuse('concurrent_rotation', token.userId)`, and rethrow. Do **not** revoke the family in this case. The winning request's new token must stay valid, and a later reuse of the old token is still caught by the existing `token.revokedAt` branch.
  - **Test** (`apps/api/test/auth.e2e-spec.ts`): log in, then fire two `POST /api/auth/refresh` with the same cookie via `Promise.all`. Expect exactly one 200 and one 401. Expect that the 200 response's new cookie still refreshes successfully, and that one `auth.refresh_refused` audit row has `metadata.reason = 'concurrent_rotation'`.

- [x] T065 [US1] Make the failed-login counter atomic in `apps/api/src/auth/auth.service.ts` → `handleBadPassword` (FR-005).
  - **Bug**: `failedLoginCount` is computed from the `user` row read before the transaction, so parallel bad guesses overwrite each other and the account never locks.
  - **Fix**: at the start of the transaction, lock the row with
    ``await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;``
    then re-read it with `const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });`. Compute `withinWindow` and `failedLoginCount` from `fresh`, not from `user`. Lock only on the transition into the locked state:
    `const alreadyLocked = fresh.lockedUntil !== null && fresh.lockedUntil.getTime() > now.getTime();`
    `const locked = failedLoginCount >= MAX_FAILED_LOGINS && !alreadyLocked;`
    This way, attempts that were already in flight when the lock was set don't extend `lockedUntil` or write another `auth.account_locked` row. Leave the rest unchanged.
  - **Test** (`auth.e2e-spec.ts`): create a user, then send 10 wrong-password logins at once with `Promise.all`. Afterwards the DB row has `lockedUntil` set in the future, there is **exactly one** `auth.account_locked` audit row for that user, and a login with the **correct** password returns 401 `INVALID_CREDENTIALS`.

- [x] T066 [US1] Reject access tokens issued before the last password change (FR-025).
  - **Bug**: `passwordChangedAt` is written but never read, so an old access token keeps working for up to 15 minutes after a password change.
  - **Fix**:
    1. `token.service.ts` → `verifyAccess` returns `{ sub: string; iat: number }`. Reject the token if `iat` is missing (same `Errors.unauthenticated()`).
    2. `jwt-auth.guard.ts`: after loading the user, if `iat < Math.floor(user.passwordChangedAt.getTime() / 1000)`, throw `Errors.unauthenticated()`. Use `<`, not `<=`, so the access token returned by `change-password` in the same second stays valid.
    3. `apps/api/src/users/users.service.ts` → `resetPassword`: also set `passwordChangedAt: new Date()`, and move `this.passwords.hash(...)` to **before** `$transaction`, like `create` does.
  - **Tests**: in `jwt-auth.guard.spec.ts`, a token with `iat` 10 s before `passwordChangedAt` → `UNAUTHENTICATED`, and a token with `iat` equal to it → allowed. In `auth.e2e-spec.ts`, log in to get token A, wait 1100 ms, call change-password, then `GET /api/auth/me` with token A → 401, and with the newly returned token → 200. In `users.e2e-spec.ts`, after an admin resets a user's password, that user's old token → 401.

- [ ] T067 [US1] Record the signed-in user as the actor of `auth.login_succeeded` (FR-012, FR-013).
  - **Bug**: login is a public route, so the request context has no user and the row is written with `actorType = 'anonymous'` and `actorId = null`.
  - **Fix**: in `auth.service.ts` → `login`, pass `actorType: 'user', actorId: user.id` to that `audit.record` call. Make no other changes.
  - **Test** (`auth.e2e-spec.ts`): after a successful login, the `auth.login_succeeded` row has `actorType = 'user'` and `actorId = <user id>`, and `GET /api/audit?actorId=<user id>` returns it.

- [ ] T068 [P] Map built-in Nest HTTP errors to the correct error code in `apps/api/src/common/errors/all-exceptions.filter.ts` (FR-021).
  - **Bug**: every `HttpException` except 404 gets code `INTERNAL`. For example, `ParseUUIDPipe` returns 400 with code `INTERNAL`.
  - **Fix**: map by status. 400, 413, 415 and 422 → `VALIDATION_FAILED`. 401 → `UNAUTHENTICATED`. 403 → `FORBIDDEN`. 404 → `NOT_FOUND`. Any other status below 500 → `VALIDATION_FAILED`, keeping the original status. 500 and above → status 500, code `INTERNAL`, message `'Internal error'`, and log the stack the same way the unknown-error branch does. Don't add new error codes.
  - **Test** (`users.e2e-spec.ts`): as an admin, `GET /api/users/not-a-uuid` → 400, `error.code = 'VALIDATION_FAILED'`, and the body has a `correlationId`.

- [ ] T069 [P] [US2] Make the users list cursor exact (data-model.md, `User.createdAt`).
  - **Bug**: `createdAt` is `timestamptz(6)` (microseconds), but the cursor comparison uses a JavaScript `Date` (milliseconds), so a row in the same millisecond as the cursor can be skipped.
  - **Test first** (`users.e2e-spec.ts`): create 3 users. With `prisma.$executeRaw`, set their `created_at` to `'2026-01-01 00:00:00.123100+00'`, `'…123400+00'` and `'…123700+00'`. Page through `GET /api/users?limit=1` (adding the other seeded or created users to the expected count) and assert that every user id appears exactly once.
  - **Fix**: in `schema.prisma`, change `User.createdAt` to `@db.Timestamptz(3)`. Generate the migration with `pnpm --filter api prisma migrate dev --name users_created_at_ms`. Don't hand-edit the generated SQL. Leave `users.service.ts` unchanged.

### Web

- [ ] T070 [US1] Route session restore through the single-flight refresh.
  - **Bug**: `AuthProvider` calls `apiFetch('/auth/refresh')` directly. Under `StrictMode` the effect runs twice and sends two refreshes with the same cookie.
  - **Fix**:
    1. In `apps/web/src/lib/api-client.ts`, change `refreshAccessToken` to return `Promise<AuthSession | null>`; it still stores `accessToken` itself. Make `singleFlightRefresh` share that promise.
    2. Export `restoreSession(): Promise<AuthSession | null>`, which returns `singleFlightRefresh()`. In `apiFetch`, use `(await singleFlightRefresh())?.accessToken`.
    3. In `AuthProvider.tsx`, `restore()` calls `restoreSession()`. If it returns `null`, call it **once more**, because another tab may have just rotated the cookie (see T064). If that also returns `null`, call `clearSession()`. Keep the `cancelled` flag.
  - **Test** (`apps/web/src/auth/AuthProvider.test.tsx`): render `<StrictMode><AuthProvider>…</AuthProvider></StrictMode>` with a mocked `fetch` that resolves the refresh after a tick. Assert that `fetch` was called with `/api/auth/refresh` exactly **once**, and that the provider ends in the authenticated state.

- [ ] T071 [P] [US1] Only skip the silent refresh for the token endpoints in `api-client.ts` → `apiFetch`.
  - **Bug**: `!path.startsWith('/auth/')` also skips the refresh for `/auth/me` and `/auth/change-password`.
  - **Fix**: `const NO_REFRESH_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);` and use `!NO_REFRESH_PATHS.has(path)`.
  - **Test** (`apps/web/src/lib/api-client.test.ts`): with a mocked `fetch`, `/auth/me` returns 401, then refresh returns 200 with a session, then `/auth/me` returns 200 → `apiFetch('/auth/me')` resolves. Also, `apiFetch('/auth/login')` returning 401 must **not** call `/api/auth/refresh`.

- [ ] T072 [P] [US1] Block open redirects in `apps/web/src/pages/LoginPage.tsx`.
  - **Fix**: add `function isSafeNext(next: string | null): next is string` that returns true only if `next` starts with `/` and does **not** start with `//` or `/\`. Navigate to `next` only when `isSafeNext(next)`, otherwise to `/`.
  - **Test** (`LoginPage.test.tsx`): `?next=//evil.example` → navigates to `/`. `?next=/\evil.example` → `/`. `?next=/admin/users` → `/admin/users`.

- [ ] T073 [P] [US1] Restore the "new password must differ" check in `apps/web/src/pages/ChangePasswordPage.tsx`.
  - **Bug**: `.innerType()` drops the shared schema's `refine`.
  - **Fix**: chain a second `.refine((d) => d.newPassword !== d.currentPassword, { path: ['newPassword'], message: 'New password must differ from the current password' })` onto `ChangePasswordFormSchema`, using the same message as `packages/shared/src/auth.ts`.
  - **Test** (`ChangePasswordPage.test.tsx`): entering the same current and new password shows that message under the new-password field and sends no request.

**Checkpoint**: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` all pass. Every new test failed before its fix (record any exceptions in `questions.md`). Then `/code-review medium` by the orchestrator.

---

## Dependencies & Execution Order

- **Phase 1** comes first.
- **Phase 2** depends on Phase 1 and blocks all stories.
- **US1 (Phase 3)** depends on Phase 2, and is required before US2 and US3 because the e2e tests use `login()` and the web shell.
- **US2 (Phase 4)** and **US4 (Phase 6)** can run in parallel after US1.
- **US3 (Phase 5)** depends on US2, because its e2e tests exercise the user mutations.
- **US5 (Phase 7)** can start after Phase 2. T058 is best done right after Phase 2 so CI guards every later phase.
- **Polish** comes last.

Recommended order for a single implementer: P1 → P2 → T058 (CI early) → US1 → US2 → US3 → US4 → rest of US5 → Polish.

## Parallel examples

- Phase 1: T002, T003, T004, T005, T006, T007 together after T001.
- Phase 2: T008, T009, T010, T014, T015, T016, T018, T020 and T022 together; then T011 → T012 → T013 → T017/T019 → T021 → T023 → T024 → T025/T026.
- US1: T027, T028, T029 together; the web tasks T033, T035, T036, T037, T038 together once T027 is done.
- US2: T046, T047, T048 together after T041.

## Implementation Strategy

1. **MVP = Phases 1–3 (US1)**: users can sign in, the shell is role-aware, and every auth event is audited. Stop and validate.
2. Add US2, then US3. Together with US1 these complete all P1 stories, which is the reviewable milestone for `/code-review`.
3. Add US4 and US5, then Polish. Open the PR to `main` once CI is green.
