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
