# Operations Contract: Production Hardening

**Feature**: `011-production-hardening` | Design: research R1–R6, R12, R14–R17 | Formats: data-model §4–§5

This file fixes the interfaces operators, CI and scripts depend on: images, Compose services, edge routing, server commands, scripts, timers, workflows, the browser journey and the load test.

## Images

| Image | Platforms | Tags | User | Port | Healthcheck | Entrypoint |
|---|---|---|---|---|---|---|
| `ghcr.io/<owner>/opsgraph-api` | `linux/amd64`, `linux/arm64` | `sha-<40-char sha>` (immutable), `main` (moving); CI-local `ci` | `10001:10001` | 3000 | `GET /api/health/live` | `node dist/main.js` |
| `ghcr.io/<owner>/opsgraph-web` | same | same | `101` (nginx-unprivileged) | 8080 | `GET /healthz` | nginx |

Labels: `org.opencontainers.image.source`, `.revision` (sha), `.version` (sha), `.created`. The API image contains `dist/`, `dist-seed/`, `prisma/` (schema + migrations), production `node_modules` (including the `prisma` CLI) and nothing else from the repository.

## Compose services (`docker-compose.prod.yml`, one project per environment)

| Service | Image | Networks (aliases) | Volumes / secrets | Restart | Notes |
|---|---|---|---|---|---|
| `db` | `postgres:16-alpine` | `internal` | `pgdata:/var/lib/postgresql/data`; `db_password` | unless-stopped | no ports; tuned via `-c` flags |
| `api-blue` | API `${API_BLUE_TAG}` | `internal`, `opsgraph-edge` (`<env>-api-blue`) | `database_url`, `jwt_access_secret`, optional secrets | unless-stopped | `read_only`, tmpfs `/tmp`, `cap_drop: ALL`, `stop_grace_period: 35s` |
| `api-green` | API `${API_GREEN_TAG}` | `internal`, `opsgraph-edge` (`<env>-api-green`) | same | unless-stopped | same |
| `web` | web `${WEB_TAG}` | `opsgraph-edge` (`<env>-web`) | — | unless-stopped | `read_only`, tmpfs `/tmp`, `/var/cache/nginx` |
| `migrate` | API (target tag) | `internal` | same secrets as API (+ `seed_password` on staging) | no | `profiles: [tools]`; default command `node dist/cli/migrate.js` |

Networks: `internal` (`internal: true`, per project), `opsgraph-edge` (external, `172.30.0.0/24`). `docker-compose.edge.yml`: service `caddy` (`caddy:2`, user `10002:10002`, `ipv4_address: 172.30.0.2`, ports `80`, `443`, `443/udp`, volumes `caddy_data`, `caddy_config`). `docker-compose.ci.yml`: `DEPLOY_ENV=ci`, images `opsgraph-api:ci`/`opsgraph-web:ci`, secrets from `$RUNNER_TEMP`, edge on `http://localhost:8080` with `docker/caddy/Caddyfile.ci` and environment name `ci`.

## Edge routing (`docker/caddy/opsgraph-site.caddy`, imported per host)

| Host | Path | Upstream | Options |
|---|---|---|---|
| `$PRODUCTION_HOST` / `$STAGING_HOST` / CI `:8080` | `/api/*` | `<env>-api-blue:3000`, `<env>-api-green:3000` | `lb_policy first`, `lb_try_duration 15s`, `lb_try_interval 250ms`, active health `GET /api/health/ready` every 2 s (timeout 2 s), `fail_duration 10s`, `header_up X-Request-Id {http.request.uuid}` |
| same | everything else | `<env>-web:8080` | `lb_try_duration 10s` |

All HTTPS sites: automatic certificates, HTTP→HTTPS redirect, `encode zstd gzip`, HSTS, `-Server`, JSON access log; staging adds `X-Robots-Tag: noindex, nofollow`. Nothing routes to `/metrics` on the API.

## Server commands (inside the API image; run as `docker compose -p opsgraph-<env> run --rm migrate node <cmd> …`)

| Command | Arguments | Output | Exit codes |
|---|---|---|---|
| `dist/cli/migrate.js` | — | applied migration names (JSON line) | 0 ok, 1 migration failed, 2 configuration invalid |
| `dist/cli/create-admin.js` | `--email <email> --name <display name>` | one line: `Created <email>. One-time password: <pw> (must be changed at first sign-in)` | 0 created, 2 invalid arguments/configuration, 3 email exists |
| `dist/cli/record-restore.js` | `--backup <file> --sha256 <hash> --taken-at <iso> --source-env <env> --operator <name> --release <sha>` | audit row id | 0, 2 |
| `dist-seed/prisma/seed.js` | — | as the dev seed | 0, 1 refused/failed |
| `dist/cli/perf-dataset.js` | `[--allow-existing]` | manifest JSON on stdout | 0, 1 refused/failed |

## Scripts (`deploy/bin/`, installed to `/opt/opsgraph/bin/` from each bundle)

Common: `bash`, `set -Eeuo pipefail`, `OPSGRAPH_ROOT` (default `/opt/opsgraph`), JSON-line logging to stdout and `logs/jobs.jsonl`, exit 0 success, 1 failure, 2 usage error, 3 refused by a guard, 4 lock timeout. All pass `shellcheck`.

| Script | Usage | Behaviour (research) |
|---|---|---|
| `setup-vm.sh` | `sudo setup-vm.sh --deploy-user deploy --ci-pubkey <file>` | idempotent server setup: packages, unattended-upgrades, Docker Engine + Compose plugin from Docker's repository, `daemon.json`, `deploy` user (docker group, key-only SSH, forced command for the CI key), sshd hardening, host firewall rules for 80/443/22, directories and permissions, edge network, edge volumes owner `10002`, systemd units and timers, logrotate, initial secret generation (R1, R3, R7) |
| `remote-entry.sh` | SSH forced command | allow-list of `receive-bundle <sha>`, `registry-login`, `deploy <env> <sha> [--digests-from <env>]`, `rollback <env> [<sha>]`, `status <env> [--has-succeeded <sha>]`; anything else exit 2 (R5) |
| `deploy.sh` | `deploy.sh <env> <sha> [--digests-from <env>] [--skip-migrations] [--no-pull] [--apply-edge]` | state machine of data-model §5 (R6); `--apply-edge` only from production promotion and setup |
| `rollback.sh` | `rollback.sh <env> [<sha>]` | previous succeeded release, `--skip-migrations`; refuses over a contract migration (exit 3) |
| `status.sh` | `status.sh <env> [--has-succeeded <sha>]` | prints `active.env` and the last 10 release records; with `--has-succeeded` exit 0/3 |
| `backup.sh` | `backup.sh <env> <daily|weekly|pre-deploy|manual>` | R14 steps 1–9 |
| `restore-drill.sh` | `restore-drill.sh [--env production] [--backup <file>]` | R14 drill; exit 0 only if all checks pass |
| `restore.sh` | `restore.sh <env> --backup <file|latest> [--from-env <env>] --confirm <env>` | R14 restore; refuses a newer backup (exit 3) or a missing/incorrect `--confirm` (exit 2) |
| `offsite-fetch.sh` | `offsite-fetch.sh --list | --get <name>` | lists or downloads and decrypts an off-site backup into `backups/<env>/` (for disaster recovery on a new server) |
| `dev-root.sh` | `OPSGRAPH_ROOT=<dir> dev-root.sh` | prepares a throwaway CI/local root (environment `ci` or `perf`): env files from the examples, random secrets, the edge network if missing; refuses `/opt/opsgraph` (exit 3). Used by the `stack` and `load-test` jobs and quickstart §2 |
| `prune.sh` | `prune.sh` | keeps the last 5 bundles and their images per environment; removes dangling images and build cache |

## systemd units (`deploy/systemd/`)

| Unit | Schedule (UTC) | Runs |
|---|---|---|
| `opsgraph-backup@production.timer` | daily 02:30 (Sundays: kind `weekly`) | `backup.sh production daily|weekly` |
| `opsgraph-backup@staging.timer` | daily 03:15 | `backup.sh staging daily` |
| `opsgraph-restore-drill.timer` | Sunday 04:00 | `restore-drill.sh` |
| `opsgraph-prune.timer` | daily 05:00 | `prune.sh` |

All `Persistent=true`; services run as `deploy` with `Nice=10`, `IOSchedulingClass=idle`; failures are visible with `systemctl --failed` and `journalctl -u opsgraph-*`.

## Workflows

| File | Trigger | Jobs | Needs secrets |
|---|---|---|---|
| `.github/workflows/ci.yml` | `pull_request`, `push` to `main` | `quality` (+ migrations check, shellcheck, config validation), `stack` (amd64 images, deploy script in temp root, Playwright, k6 smoke, availability check, backup + drill), `publish` (main only: multi-arch push) | `GITHUB_TOKEN` (`packages: write` in `publish`) |
| `.github/workflows/cd-staging.yml` | `workflow_run` of CI, completed, `main`, success, push | `deploy-staging` (environment `staging`) | environment `staging` SSH secrets |
| `.github/workflows/deploy-production.yml` | `workflow_dispatch` (`release`) | `deploy-production` (environment `production`), applies edge config | environment `production` SSH secrets |
| `.github/workflows/rollback.yml` | `workflow_dispatch` (`environment`, `release?`) | `rollback` | matching environment |
| `.github/workflows/load-test.yml` | `workflow_dispatch` (`mode`: `full` default) | builds amd64 images, `DEPLOY_ENV=perf` stack, dataset, evaluation + snapshot, k6 full, uploads summary | none |

Job outputs: `publish` writes `release-<sha>.json` (`{ sha, apiDigest, webDigest, platforms }`) as an artifact and in the job summary; CD jobs print the remote release record.

## Migration safety check

`pnpm check:migrations` (`node scripts/check-migrations.mjs`): exit 0 when every migration after `scripts/migration-baseline.json`'s `baseline` passes; exit 1 listing each violation as `<migration>: <statement excerpt>: <rule>`; warnings printed with `warning:` and never fail. Contract marker (first line of `migration.sql`): `-- opsgraph:contract after=<sha|migration> reason="<text>"`.

## Browser journey (`e2e/tests/core-journey.spec.ts`)

Inputs: `E2E_BASE_URL` (default `http://localhost:8080`), `E2E_SEED_PASSWORD`. Preconditions: fresh database, migrations applied, compiled seed run with `DEPLOY_ENV=ci`. Steps and assertions: research R16 (sign in → Order #18492 → root cause "Budget Code Missing", HIGH → impact per 006 fixture → create exception (EX-10001 listed first) → assign to self → start work → resolve → manager verifies → history order and actors). Command: `pnpm test:browser`. Artifacts on failure: `e2e/playwright-report/`, `e2e/test-results/`.

## Load test (`loadtest/k6/`)

| Script | Mode | Load | Pass criteria |
|---|---|---|---|
| `opsgraph-load.js` | `full` (`MODE=full`, default) | 20 VUs for 5 min after a 1 min ramp; mix and thresholds of research R17 | every `p(95)` threshold per `kind`, `http_req_failed < 1%`, `checks > 99%` |
| `opsgraph-load.js` | `smoke` (`MODE=smoke`) | 2 VUs, 30 s, seeded data | `http_req_failed < 1%` |
| `availability.js` | — | 5 requests/s during two redeploys | `http_req_failed == 0`, all statuses 2xx |

Environment: `BASE_URL`, `LOADTEST_USERS` (comma-separated emails), `LOADTEST_PASSWORD`, `MANIFEST` (full mode). Run: `docker run --rm --network host -v "$PWD/loadtest:/scripts" -e … grafana/k6 run /scripts/k6/opsgraph-load.js`. Refuses (setup abort, exit ≠ 0) when `/api/health/live` reports `environment: "production"`. Output: `loadtest/results/summary.json` and `summary.md`.
