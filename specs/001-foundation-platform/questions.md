# Questions & Verification Notes

## Open questions

None.

## Verification notes

### T060 — Clean-state local setup (2026-10-05)

**Environment**: Windows 11, Node v25.8.1, pnpm v11.23.0, Docker Desktop (`postgres:16-alpine`).
The spec targets Node 22 LTS + pnpm 9; CI pins those. The local machine runs newer versions; all
steps below passed anyway.

**Procedure**: `docker compose down -v` (removed the `pgdata` volume), then the quickstart
"Local setup" steps. **Setup time: 10 seconds** (`pnpm install` → `db seed`), well under the
15-minute target (SC-004).

| Step | Result |
|---|---|
| `pnpm install` | OK |
| `docker compose up -d db` | OK, healthy |
| `cp apps/api/.env.example apps/api/.env` | OK |
| `pnpm --filter @opsgraph/shared build` | OK |
| `pnpm --filter api prisma migrate dev` | OK (`init`, `audit_append_only`) |
| `pnpm --filter api prisma db seed` | OK (3 users) |
| `pnpm dev` | api :3000 + web :5173 |

Post-boot checks: `GET /api/health/live` → 200 both directly and through the Vite `/api`
proxy; seeded `admin@opsgraph.local` login → 200 with session; `GET /api/users` with that
token → 200 (seeded users listed); `http://localhost:5173` serves `<title>OpsGraph</title>`.

**Local deviations (environment only; no spec or committed code change besides the fix below)**

1. This machine has a native PostgreSQL listening on host port 5432 alongside the Docker
   container, so `localhost:5432` does not reach the container. The repo's
   `docker-compose.override.yml` publishes the same container on 5433; the local (git-ignored)
   `apps/api/.env` was pointed at 5433. On a machine without that conflict the quickstart works
   exactly as written.
2. `pnpm dev` failed on the first clean run: `tsup --watch` cleaned `packages/shared/dist` at
   startup while `nest start --watch` was resolving `@opsgraph/shared`, so the API compiled
   against a missing `dist/index.d.ts` (TS7016 ×14) and never started. Fixed by changing only
   the shared **dev** script to `tsup --watch --no-clean` (`build` still cleans). Re-verified
   after `docker compose down -v`: setup 10 s, API boots, 0 TS7016 errors, all checks above pass.
3. `test/load-env.ts` already skips keys that are present in `process.env`, so the CI
   environment wins over `.env.test`; no change was needed.

**CI (T058)**: this working copy has no Git remote, so the phase checkpoint ("CI is green on
the PR for this branch") cannot be executed here. `.github/workflows/ci.yml` implements R18
(Postgres service, env, step order, `timeout-minutes: 10`). Every step was run locally against
the same service database and passed: shared build, `prisma generate`, `prisma migrate deploy`,
lint, typecheck, unit tests (30), e2e tests (86), build.

### T063 — Quickstart manual validation, steps 1–11 (2026-10-05)

Run on the dev database (reset + seeded, `pnpm --filter api start`, `postgres:16-alpine`).
Steps 1–8 were driven through the real HTTP API with the exact quickstart payloads; the web UI
itself was not clicked (no browser automation in this environment — the shell/header rendering
is covered by the phase 3 web tests).

- [x] 1. Sign in. All three seeded users sign in with the expected role (`ADMIN`,
  `OPS_MANAGER`, `ANALYST`).
- [x] 2. Sign out. Logout 204; the revoked refresh cookie can no longer refresh (401). The
  `/login?next=…` redirect is client routing (not exercised without a browser).
- [x] 3. Wrong password. 5 failures lock the account; the 6th attempt with the correct password
  returns 401 `INVALID_CREDENTIALS`.
- [x] 4. Create a user. `test@opsgraph.local` created (201, `mustChangePassword=true`); a
  protected route returns 403 until the password is changed; after changing it the user reaches
  the app.
- [x] 5. Role change. PATCH to `OPS_MANAGER`; the next `GET /auth/me` already reports the new
  role (guard reloads the user from the DB).
- [x] 6. Deactivate. The target's next call is 401 and sign-in is refused.
- [x] 7. Last admin. Demote and deactivate of the only administrator both give 409 with
  "At least one active Administrator is required".
- [x] 8. Audit trail. `GET /api/audit?action=user.role_changed` shows before
  `{role: ANALYST}` / after `{role: OPS_MANAGER}`; no password value or `passwordHash` appears
  anywhere in the response.
- [x] 9. Database enforcement. `DELETE FROM audit_entries` fails with
  "audit_entries is append-only".
- [x] 10. Health. `ready` 200 `database:"up"`; after `docker compose stop db` `ready` is 503
  `database:"down"` while `live` stays 200; after `docker compose start db` `ready` is 200 again.
- [ ] 11. CI gate. Blocked: this working copy has no Git remote, so no PR can be opened.
  Every CI step was run locally instead and passed (see T058 above).

Perf (T062): `RUN_PERF=1 pnpm test:e2e` inserts 100,000 audit rows in one
`INSERT … SELECT generate_series` and the filtered `GET /api/audit?action=user.role_changed`
page is returned within the 2 s budget (SC-006). The test is skipped unless `RUN_PERF=1` and is
documented in the README.

