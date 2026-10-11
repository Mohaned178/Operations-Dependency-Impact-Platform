# Configuration Contract: Production Hardening

**Feature**: `011-production-hardening` | Parser: `apps/api/src/config/env.ts` (`parseEnv`, data-model §3a, research R7). Operator version: `docs/operations/configuration.md`.

Rules for every setting:
- validated once at startup; an invalid value stops the process with exit code 1 and the line `Invalid configuration: <NAME>: <rule>` (the value is never printed);
- a **secret** may be given as `NAME` or as `NAME_FILE` (path to a file whose content, minus one trailing newline, is the value), never both;
- "prod" below means `DEPLOY_ENV` ∈ {`staging`, `production`}.

## 1. API settings

### Existing (001, 009, 010): unchanged names, defaults and meaning

| Name | Default | Secret | Notes for production |
|---|---|---|---|
| `NODE_ENV` | `development` | no | `production` in the image |
| `PORT` | `3000` | no | keep 3000 (edge and healthcheck use it) |
| `DATABASE_URL` | — (required) | **yes** (`_FILE`) | `postgresql://opsgraph:<pw>@db:5432/opsgraph?schema=public`; `application_name=opsgraph-api` and `connection_limit=10` are appended when absent; prod refuses password `opsgraph` |
| `JWT_ACCESS_SECRET` | — (required, ≥ 32 chars) | **yes** (`_FILE`) | prod refuses the committed development value and any value containing `change-me` |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | no | |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | no | |
| `COOKIE_SECURE` | `true` when `NODE_ENV=production` | no | prod refuses `false` |
| `SEED_PASSWORD` | `OpsGraph-Dev-2026!` (dev only) | **yes** (`_FILE`) | used only by the seed; required and non-default when `DEPLOY_ENV` ∈ {`staging`, `ci`}; seed refused in `production` |
| `RISK_SCHEDULER_ENABLED`, `RISK_EVALUATION_INTERVAL_MS`, `RISK_EVALUATION_INITIAL_DELAY_MS` (009) | per 009 | no | enabled in prod |
| `OVERVIEW_SNAPSHOT_AUTO`, `OVERVIEW_ANALYSIS_CONCURRENCY` (010) | per 010 | no | enabled in prod |

### New

| Name | Default | Secret | Rule / meaning |
|---|---|---|---|
| `DEPLOY_ENV` | `development` (NODE_ENV=development), `test` (NODE_ENV=test) | no | one of `development, test, ci, perf, staging, production`; **required** when `NODE_ENV=production` |
| `APP_VERSION` | unset (baked into images from the commit) | no | shown in health, logs, metrics, error events |
| `TRUST_PROXY` | `loopback` | no | Express `trust proxy` value: `loopback`, an IP, or comma-separated IPs/CIDRs; production compose: `172.30.0.2` (the edge) |
| `CORS_ORIGINS` | empty (CORS off) | no | comma-separated exact origins; `*`, paths and non-`https://` refused (`http://localhost:<port>` allowed only in `development`/`test`) |
| `LOG_LEVEL` | `info` | no | `error`, `warn`, `info`, `debug` |
| `LOG_FORMAT` | `pretty` in `development`, else `json` | no | `json` or `pretty`; prod refuses `pretty` |
| `RATE_LIMIT_ENABLED` | `true` | no | `false` only in `apps/api/.env.test` (the rate-limit suite overrides it) and refused in prod |
| `RATE_LIMIT_LOGIN_PER_MINUTE` | `10` | no | integer 1–1000 |
| `RATE_LIMIT_LOGIN_PER_HOUR` | `50` | no | integer ≥ the per-minute value |
| `RATE_LIMIT_REFRESH_PER_MINUTE` | `30` | no | integer 1–1000 |
| `RATE_LIMIT_PASSWORD_CHANGE_PER_15_MINUTES` | `5` | no | integer 1–100 |
| `RATE_LIMIT_IMPORT_PER_MINUTE` | `10` | no | integer 1–1000 |
| `RATE_LIMIT_WRITE_PER_MINUTE` | `120` | no | integer 1–10000 |
| `METRICS_ENABLED` | `true` | no | `false` removes `/metrics` |
| `METRICS_TOKEN` | unset (no auth on `/metrics`) | **yes** (`_FILE`) | ≥ 24 chars when set |
| `ERROR_TRACKING_DSN` | unset (off) | **yes** (`_FILE`) | `https://<key>@<host>/<projectId>` (Sentry-compatible); anything else refused |
| `ERROR_TRACKING_TIMEOUT_MS` | `2000` | no | 100–10000 |
| `ERROR_TRACKING_MAX_PER_MINUTE` | `30` | no | 1–1000 |
| `ERROR_TRACKING_SAMPLE_RATE` | `1` | no | 0–1 |
| `JWT_ACCESS_SECRET_PREVIOUS` | unset | **yes** (`_FILE`) | ≥ 32 chars, different from the current secret; accepted for verification only |
| `SHUTDOWN_DRAIN_MS` | `5000` | no | 0–30000 |
| `SHUTDOWN_TIMEOUT_MS` | `25000` | no | 1000–60000; `SHUTDOWN_DRAIN_MS + SHUTDOWN_TIMEOUT_MS` must be < 35000 (compose `stop_grace_period`) |
| `NODE_OPTIONS` | image default | no | prod compose sets `--max-old-space-size` per R1 |

## 2. Compose variables (`/opt/opsgraph/env/<env>.env` + `state/<env>/active.env`)

| Name | Example | Meaning |
|---|---|---|
| `DEPLOY_ENV` | `production` | also passed to the API |
| `COMPOSE_PROJECT_NAME` | `opsgraph-production` | set by the scripts |
| `API_IMAGE`, `WEB_IMAGE` | `ghcr.io/<owner>/opsgraph-api` | image repositories |
| `API_BLUE_TAG`, `API_GREEN_TAG`, `WEB_TAG` | `sha-<sha>` or `@sha256:…` | from `active.env` (written by `deploy.sh`) |
| `APP_ENV_FILE` | `/opt/opsgraph/env/production.app.env` | the API settings file (section 1, non-secret values) |
| `SECRETS_DIR` | `/opt/opsgraph/secrets/production` | secret files (section 4) |
| `DB_MEM_LIMIT`, `API_MEM_LIMIT`, `WEB_MEM_LIMIT` | `4g`, `1536m`, `128m` | memory limits (R1) |
| `PG_SHARED_BUFFERS`, `PG_EFFECTIVE_CACHE_SIZE`, `PG_WORK_MEM`, `PG_MAINTENANCE_WORK_MEM`, `PG_MAX_CONNECTIONS` | `1GB`, `3GB`, `16MB`, `256MB`, `100` | Postgres settings |
| `API_NODE_MAX_OLD_SPACE_MB` | `1024` | heap limit |

Edge (`/opt/opsgraph/env/edge.env`): `PRODUCTION_HOST` (e.g. `ops.example.com`), `STAGING_HOST` (e.g. `staging.ops.example.com`), `ACME_EMAIL` (certificate expiry notices).

## 3. Backup settings (`/opt/opsgraph/env/backup.env`)

| Name | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `/opt/opsgraph/backups` | local backups |
| `BACKUP_MIN_FREE_PERCENT` | `15` | refuse below |
| `BACKUP_RETENTION_PRODUCTION` | `daily=7 weekly=4 pre-deploy=5 manual=5` | newest kept per kind |
| `BACKUP_RETENTION_STAGING` | `daily=3 manual=3` | |
| `OFFBOX_ENABLED` | `false` | production off-site copies |
| `OFFBOX_REMOTE` | `opsgraph-crypt:` | rclone crypt remote name in `rclone.conf` |
| `OFFBOX_RETENTION_DAYS` | `30` | `rclone delete --min-age` |
| `RCLONE_CONFIG_PATH` | `/opt/opsgraph/env/rclone.conf` | 0600; contains the S3 keys and the obscured crypt passwords |
| `HEARTBEAT_URL_BACKUP_PRODUCTION`, `HEARTBEAT_URL_BACKUP_STAGING`, `HEARTBEAT_URL_RESTORE_DRILL` | unset | success ping; `<url>/fail` on failure |

## 4. Secret files (`/opt/opsgraph/secrets/<env>/`, mounted at `/run/secrets/<name>`)

| File | Used by | Mapped to | Generated by setup | Rotation (runbook) |
|---|---|---|---|---|
| `db_password` | `db` | `POSTGRES_PASSWORD_FILE` | `openssl rand -hex 32` | `ALTER ROLE`, update with `database_url`, redeploy |
| `database_url` | `api-*`, `migrate` | `DATABASE_URL_FILE` | from `db_password` | with `db_password` |
| `jwt_access_secret` | `api-*` | `JWT_ACCESS_SECRET_FILE` | `openssl rand -base64 48` | move to `jwt_access_secret_previous`, new value, deploy, wait 15 min, remove previous, deploy |
| `jwt_access_secret_previous` | `api-*` (optional) | `JWT_ACCESS_SECRET_PREVIOUS_FILE` | — | — |
| `metrics_token` | `api-*`, Prometheus (optional) | `METRICS_TOKEN_FILE` | optional | replace in both, redeploy, restart Prometheus |
| `error_tracking_dsn` | `api-*` (optional) | `ERROR_TRACKING_DSN_FILE` | — | revoke key in the tracker, replace, redeploy |
| `seed_password` | `migrate` on staging only | `SEED_PASSWORD_FILE` | staging only | re-run seed (resets demo users' passwords) |
| `grafana_admin_password` | Grafana (optional) | `GF_SECURITY_ADMIN_PASSWORD__FILE` | optional | replace, restart Grafana |

Ownership: directory `0700 root`; API-read files `0400`, owner `10001:10001`; `db_password` `0400 root`.

## 5. GitHub configuration

| Kind | Name | Scope | Value |
|---|---|---|---|
| Environment | `staging` | — | no reviewers |
| Environment | `production` | — | required reviewers when the plan supports it |
| Secret | `DEPLOY_SSH_HOST` | both environments | server public IP or DNS name |
| Secret | `DEPLOY_SSH_USER` | both | `deploy` |
| Secret | `DEPLOY_SSH_KEY` | both | private ed25519 key whose public half is in `authorized_keys` with `command="/opt/opsgraph/bin/remote-entry.sh",restrict` |
| Secret | `DEPLOY_SSH_KNOWN_HOSTS` | both | output of `ssh-keyscan -t ed25519 <host>` verified against the server's fingerprint |
| Variable | `STAGING_URL`, `PRODUCTION_URL` | repository | `https://staging.ops.example.com`, `https://ops.example.com` |
| Built-in | `GITHUB_TOKEN` | workflows | `packages: write` in `ci.yml` `publish`; `packages: read` in CD (streamed to `registry-login`) |

## 6. Files that must never be committed

`.env`, `*.env` (except `*.env.example` under `deploy/env/` and the existing `apps/api/.env.example`, `apps/api/.env.test` which contain only development values), anything under `/opt/opsgraph/secrets`, `rclone.conf`, private keys. `.gitignore` gains `deploy/env/*.env`, `!deploy/env/*.env.example`, `e2e/playwright-report/`, `e2e/test-results/`, `loadtest/results/`.
