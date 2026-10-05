# Implementation Plan: Foundation Platform

**Branch**: `001-foundation-platform` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-foundation-platform/spec.md`

## Summary

This plan sets up the OpsGraph monorepo skeleton:
- **Backend**: a NestJS API on PostgreSQL via Prisma, with email/password auth. Access tokens are short-lived JWTs held in memory; refresh tokens are rotating httpOnly cookies.
- **Roles**: three fixed roles behind a deny-by-default guard. The user is reloaded from the DB on every request, so revocation is immediate.
- **Audit log**: append-only, enforced by a DB trigger, and written in the same transaction as every mutation.
- **Health**: liveness and readiness endpoints.
- **Frontend**: a React shell with sign-in, role-aware navigation, admin Users and Audit screens, and a forced password change.
- **Contracts**: all payloads are zod schemas in `@opsgraph/shared`.
- **CI**: GitHub Actions runs lint, typecheck, unit tests and e2e tests against a Postgres service.

Decisions and rationale are in [research.md](./research.md). They are binding for the implementer.

## Technical Context

**Language/Version**: TypeScript 5.x (strict) on Node.js 22 LTS
**Primary Dependencies**:
- **api**: NestJS 11, Prisma 6, @nestjs/jwt, argon2, nestjs-cls, cookie-parser, zod 3
- **web**: React 19, Vite 6, React Router 7, TanStack Query 5, Tailwind 4, react-hook-form 7, @hookform/resolvers
- **shared**: zod 3, tsup

**Storage**: PostgreSQL 16 (Docker locally, service container in CI)
**Testing**: Jest + ts-jest + supertest (api unit/e2e against real Postgres); Vitest + Testing Library + jsdom (web); Vitest (shared)
**Target Platform**: Linux server (API), evergreen browsers (web)
**Project Type**: Web application (pnpm monorepo: api + web + shared)
**Performance Goals**: first audit page < 2 s at 100k rows (SC-006); health < 1 s (SC-007); CI < 10 min (SC-005)
**Constraints**:
- no `any`
- no dependencies beyond those listed above, plus dev tooling (eslint, prettier, typescript-eslint, @types/*, jsdom, @testing-library/*, supertest, ts-jest, @vitejs/plugin-react, @tailwindcss/vite)
**Scale/Scope**: tens of internal users; 3 roles; ~14 endpoints; ~9 screens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ N/A-safe | There is no operational data yet. Audit entries carry the actor, IP and correlation id (the provenance of the actions themselves). |
| II. Fact vs Inference | ✅ N/A | There are no inferred data or conclusions in this feature. |
| III. Explainability & Determinism | ✅ N/A | There are no computed conclusions. Errors are structured and deterministic. |
| IV. Auditability | ✅ | `AuditService.record(tx, …)` runs in the same transaction as each mutation. The DB trigger blocks UPDATE, DELETE and TRUNCATE. Payloads are redacted. The pattern is reusable by later features (FR-018). |
| V. Test-Gated Changes | ✅ | The CI workflow gates merges. Every endpoint has zod schemas in shared and e2e tests. The authorization matrix is fully covered. |
| VI. MVP Scope Discipline | ✅ | It answers §65 Q9 ("Who owns the problem?"), since identity and roles are a prerequisite for ownership and audit. It touches none of the §62 non-goals. SSO, MFA, multi-tenancy and rate limiting are deferred. |
| Tech constraints | ✅ | Strict TS, pnpm monorepo, NestJS+Prisma+PostgreSQL, React+Vite. `GraphRepository` is not applicable yet (no traversal). |

**Post-design re-check**: ✅ No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-foundation-platform/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
package.json                 # root scripts: dev, build, lint, typecheck, test, test:e2e, format
pnpm-workspace.yaml          # apps/*, packages/*
tsconfig.base.json           # strict, noUncheckedIndexedAccess
eslint.config.mjs  .prettierrc  .editorconfig  .gitignore  .nvmrc (22)
docker-compose.yml
docker/postgres/init.sql     # CREATE DATABASE opsgraph_test
README.md                    # local setup (mirrors quickstart.md)
.github/workflows/ci.yml

packages/shared/
├── package.json  tsconfig.json  tsup.config.ts  vitest.config.ts
└── src/
    ├── index.ts             # re-exports everything
    ├── common.ts            # Email/Password/PageQuery/ErrorResponse schemas, ROLE_LABELS
    ├── auth.ts  users.ts  audit.ts  health.ts
    └── *.spec.ts

apps/api/
├── package.json  tsconfig.json  tsconfig.build.json  nest-cli.json  jest.config.ts  .env.example
├── prisma/
│   ├── schema.prisma
│   ├── migrations/          # init + audit_append_only (raw SQL trigger)
│   └── seed.ts
├── src/
│   ├── main.ts              # prefix /api, cookie-parser, shutdown hooks
│   ├── app.module.ts
│   ├── config/env.ts        # zod-parsed env (R14)
│   ├── prisma/prisma.module.ts  prisma.service.ts
│   ├── common/
│   │   ├── context/request-context.ts      # nestjs-cls setup + typed accessors (R8)
│   │   ├── errors/app-error.ts             # AppError(code, status, message, details?)
│   │   ├── errors/all-exceptions.filter.ts # (R12)
│   │   └── validation/zod-validation.pipe.ts
│   ├── auth/
│   │   ├── auth.module.ts  auth.controller.ts  auth.service.ts
│   │   ├── token.service.ts                 # sign JWT, create/rotate/revoke refresh tokens
│   │   ├── password.service.ts              # argon2 hash/verify
│   │   ├── guards/jwt-auth.guard.ts         # global; loads user from DB (R5); enforces mustChangePassword
│   │   ├── guards/roles.guard.ts            # global; audits auth.forbidden
│   │   ├── decorators/public.decorator.ts  roles.decorator.ts  current-user.decorator.ts  allow-password-change.decorator.ts
│   │   └── *.spec.ts
│   ├── users/  users.module.ts  users.controller.ts  users.service.ts  users.service.spec.ts
│   ├── audit/  audit.module.ts  audit.controller.ts  audit.service.ts  redact.ts  redact.spec.ts
│   └── health/ health.module.ts  health.controller.ts
└── test/
    ├── jest-e2e.config.ts  setup-e2e.ts  helpers.ts   # app bootstrap, login helper, DB reset
    ├── auth.e2e-spec.ts  users.e2e-spec.ts  audit.e2e-spec.ts  health.e2e-spec.ts  authz-matrix.e2e-spec.ts

apps/web/
├── package.json  tsconfig.json  vite.config.ts (proxy /api → :3000)  vitest.config.ts  index.html
└── src/
    ├── main.tsx  router.tsx  index.css (tailwind)
    ├── lib/api-client.ts     # apiFetch + single-flight refresh (R15), ApiError
    ├── lib/query-client.ts
    ├── auth/AuthProvider.tsx  useAuth.ts  RequireAuth.tsx  RequireRole.tsx
    ├── layout/AppShell.tsx   # header (name, role label, sign out) + role-filtered nav
    ├── pages/
    │   ├── LoginPage.tsx  ChangePasswordPage.tsx  HomePage.tsx  ForbiddenPage.tsx  NotFoundPage.tsx  ComingSoonPage.tsx
    │   └── admin/UsersListPage.tsx  UserCreatePage.tsx  UserDetailPage.tsx  AuditPage.tsx
    └── **/*.test.tsx
```

**Structure Decision**: pnpm monorepo with `apps/api`, `apps/web` and `packages/shared`, as fixed by the constitution and CLAUDE.md.

## Key Design Notes (for the implementer)

1. **Global guard order**: `JwtAuthGuard`, then `RolesGuard`, both registered as `APP_GUARD` in `AuthModule`.
   - `@Public()` skips both.
   - `@Roles('ADMIN')` is applied at the controller class level for `UsersController` and `AuditController`.
   - No `@Roles` means any authenticated user may call the route.
2. **JwtAuthGuard flow**:
   1. Verify the bearer token; if it is invalid, return `UNAUTHENTICATED`.
   2. Load the user by `sub`. If the user is missing or DEACTIVATED, return `UNAUTHENTICATED`.
   3. Attach the user to the request and set `userId` in CLS.
   4. If `mustChangePassword` is set and the route lacks `@AllowDuringPasswordChange()`, return `403 PASSWORD_CHANGE_REQUIRED`.
3. **Every mutating service method** has this shape:
   ```ts
   return this.prisma.$transaction(async (tx) => {
     const before = await tx.user.findUniqueOrThrow(...);
     const after = await tx.user.update(...);
     await this.audit.record(tx, { action: AUDIT_ACTIONS.USER_ROLE_CHANGED, targetType: 'user',
       targetId: after.id, before: { role: before.role }, after: { role: after.role } });
     return toPublicUser(after);
   });
   ```
4. **Login uses one code path for all failures.** On failure:
   1. Update the counters and write the `auth.login_failed` audit in one transaction.
   2. Only after that transaction commits, throw `INVALID_CREDENTIALS`. Throwing inside the transaction would roll back the counter update.

   Always run `argon2.verify`, using a dummy hash when the email is unknown, so timing does not reveal whether an email exists.
5. **Refresh cookie**: set and clear it only in `AuthController`, through one helper, `setRefreshCookie(res, token, expiresAt)`. Use `@Res({ passthrough: true })`.
6. **`toPublicUser()`** is the only way users leave the API. It strips `passwordHash` and the counters.
7. **Web routing**:
   - `/login` and `/change-password` are public.
   - Everything else sits under `<RequireAuth><AppShell/></RequireAuth>`.
   - `/admin/*` is wrapped in `<RequireRole role="ADMIN">`, which renders `ForbiddenPage` for other roles.
   - Placeholder nav entries `/investigations`, `/graph` and `/exceptions` render `ComingSoonPage`.
8. **Web forms**: all of them use react-hook-form with `zodResolver(<SharedSchema>)`. Server `VALIDATION_FAILED` details are mapped onto form fields.

## Complexity Tracking

No violations.
