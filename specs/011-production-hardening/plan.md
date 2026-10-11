# Implementation Plan: Production Hardening and Free-Tier Deployment

**Branch**: `011-production-hardening` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-production-hardening/spec.md`

## Summary

OpsGraph becomes operable in production at zero hosting cost: one Oracle Cloud Always Free Ampere VM (4 OCPU / 24 GB, Ubuntu 24.04 arm64) runs **production** and **staging** as two isolated Docker Compose projects behind one shared **Caddy** edge with automatic Let's Encrypt TLS; the same bundle runs on any Docker VPS by changing env files and DNS only.

- **Images**: multi-stage, non-root Dockerfiles for the API (`node:22-bookworm-slim`, uid 10001) and the web app (`nginx-unprivileged`), built for `linux/amd64` and `linux/arm64` in GitHub Actions and pushed to GHCR, stamped with the commit.
- **Delivery**: CI gains a production-like `stack` job (images + real deploy script + Playwright + k6 smoke + zero-downtime check + backup/restore drill) and a `publish` job; a `workflow_run` CD deploys `main` to staging after CI passes; production is a manual promotion of a staging release (same digests); rollback is one command.
- **Zero downtime**: blue/green API colours behind Caddy's active health checks, readiness-based draining on SIGTERM, migrations applied before the switch and kept backward compatible by an **expand-then-contract gate** (`pnpm check:migrations`).
- **Protection**: `@nestjs/throttler` policies on sign-in, refresh, password change, imports and all writes (429 `RATE_LIMITED`, not audited); `helmet` + edge/nginx headers; CORS off by default with an exact-origin allow-list; trusted-proxy client addresses; `*_FILE` secrets, startup refusal of development defaults, JWT rotation with a previous secret; first Administrator by an audited command.
- **Visibility**: JSON logs with correlation ids and value-level secret scrubbing (no library); `/metrics` with `prom-client` (HTTP, rate limits, DB connections from `pg_stat_activity`), private to the server; optional Prometheus + Grafana with an example dashboard; optional Sentry-protocol error reporter over `fetch`.
- **Data safety**: systemd-timed `pg_dump` backups (daily + pre-deploy), checksummed, rotated, optionally rclone-crypt copied to OCI Object Storage's free tier; weekly automated restore drill; audited restore procedure.
- **Proof**: Playwright core journey (§39) and a k6 load test on a deterministic 50k-entity dataset with the 003/005/006/010 targets.
- **Docs**: server setup (Oracle + any VPS), configuration and secrets, runbook, monitoring, migrations.

**Approach** (research R1–R21): no database change; three new API runtime dependencies (`@nestjs/throttler`, `helmet`, `prom-client`), `prisma` moved to runtime dependencies, `@playwright/test` in a new `e2e` package; everything else is container images, shell scripts and configuration. All design decisions are in [research.md](./research.md) and are binding.

## Prerequisites

- **Features 004–010 must be merged into this branch before implementation starts** (rebase `011-production-hardening` onto `main` once they land). This feature uses:
  - 004–007's web pages (Entity 360 blockers/root cause/impact sections, exception create/assign/transition/history) for the browser journey;
  - 003/005/006/010's routes (`/blockers`, `/dependencies`, `/root-cause`, `/impact`, `/overview`) for the load test;
  - 007–009's tables (exceptions, investigations, risks, risk evaluations) for the dataset generator, and 009/010's settings and single-run guarantees for the blue/green overlap.

  If any of them is missing, stop and write the question in `questions.md`.
- No migration is added. `scripts/migration-baseline.json` is set to the **newest migration directory present when this feature merges** (expected 010's `<timestamp>_overview_search`).
- The manual steps on Oracle Cloud, DNS and GitHub (quickstart §5) are done by a human; the implementer delivers the scripts and documentation for them.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS; Bash (scripts, `shellcheck`-clean); k6 JavaScript (load test); YAML (Compose, Actions); Caddyfile; nginx config.

**Primary Dependencies**: existing NestJS 11, Prisma 6, zod 3, `nestjs-cls`, React 19, Vite 6. **New** (research R21): `@nestjs/throttler` ^6, `helmet` ^8, `prom-client` ^15 (API runtime); `@playwright/test` ^1 (new `e2e` workspace package). `prisma` moves from devDependencies to dependencies. Container images: `node:22-bookworm-slim`, `nginxinc/nginx-unprivileged:1.27-alpine`, `caddy:2`, `postgres:16-alpine`, `rclone/rclone`, `grafana/k6`, optional `prom/prometheus`, `grafana/grafana-oss`. Actions: `docker/*` (qemu, buildx, login, build-push, metadata), `actions/upload-artifact`.

**Storage**: PostgreSQL 16 in a container with a named volume per environment. **No schema change, no migration** (data-model §0). New audit uses: `user.created` via CLI, `ops.database_restored`. Server files with fixed formats (data-model §4).

**Testing**:
- **Vitest (shared)**: error code and `retryAfterSeconds` refinement, health schemas, `METRIC_NAMES`, audit action.
- **Jest unit**: `parseEnv`, `scrub`, `JsonLogger`, route labels, rate-limit policy table and tracker, error-event builder/DSN/stack parser/cap, DB-pool collector mapping, `ShutdownService`, CLI argument parsing.
- **Jest + supertest e2e**: rate limits (fixture P1), proxy trust, headers (P2), CORS, logging (P3), metrics (P4), error reporter (P5), health additions, `create-admin`, authz row for `/metrics`; all existing suites unchanged (`RATE_LIMIT_ENABLED=false` in `.env.test`).
- **Vitest (web)**: 429 mapping, login message, preload-error reload.
- **node --test**: `scripts/check-migrations.mjs`.
- **Playwright**: core journey on the production images (CI `stack` job).
- **CI stack checks**: k6 smoke, availability during two colour switches, backup + restore drill (+ negative), config validation (`docker compose config`, `caddy validate`, `nginx -t`, `promtool`, `k6 inspect`), `shellcheck`.
- **Manual**: server deployment, promotion, rollback, restore, JWT rotation, header-scanner grade, full load test (quickstart §4–§6).

**Target Platform**: Linux containers on `linux/arm64` (Oracle Ampere A1, Ubuntu 24.04) and `linux/amd64` (CI, other VPS); evergreen browsers.

**Project Type**: Web application (pnpm monorepo: api + web + shared) plus deployment bundle, CI/CD workflows and an `e2e` test package.

**Performance Goals** (SC-010, 20 concurrent users, 50k entities, p95): Home < 2 s, blockers < 1 s, dependencies first page < 2 s, root cause < 1.5 s, impact < 2 s, < 1% failures. Overheads of this feature: access log + metrics < 1 ms per request; `/metrics` scrape < 100 ms; rate-limit guard < 1 ms.

**Constraints**:
- $0 monthly hosting on the reference VM; everything also runs on any Docker host (FR-004);
- no `any`; only the dependencies of research R21;
- no traversal or recursive SQL anywhere (the only new SQL: the `pg_stat_activity` query and the dataset generator's inserts);
- 001–010 behaviour unchanged except: 429 on excess writes, response headers, health fields, seed guard by `DEPLOY_ENV`;
- secrets never in the repository, images, CI logs or application logs;
- CLAUDE.md and AGENTS.md unchanged.

**Scale/Scope**:
- 1 changed route set (health), 1 new route (`/metrics`), 429 on every mutating route;
- 4 new API modules/areas under `common/` and `lifecycle/` (security, observability, shutdown, CLI);
- 2 Dockerfiles, 4 compose files, 2 Caddyfiles + 1 snippet, 1 nginx config, Prometheus/Grafana provisioning + 1 dashboard;
- 11 shell scripts, 4 systemd timers (+ services), 5 workflows (1 changed, 4 new);
- 1 Playwright spec, 2 k6 scripts, 1 dataset generator;
- 5 operations documents.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | No change to entities, relationships, states, events or their provenance. Backups preserve every source record and payload; the restore drill verifies the provenance tables are restored non-empty; a restore is itself recorded with its source (backup file, checksum, taken-at). Logs never alter data. |
| II. Fact vs Inference | ✅ | No inference is added. Metrics and logs are operational telemetry, never shown as product conclusions. |
| III. Explainability & Determinism | ✅ | Root-cause, impact and risk computations are untouched; the load test only measures them. Rate limits, retention and drill checks are published rules (contracts). The dataset generator is deterministic (fixed ids). |
| IV. Auditability | ✅ with justified exceptions | New data mutations are audited: first-Administrator creation (`user.created`, System, `via: cli`) and database restore (`ops.database_restored`). Audit stays append-only (restore recreates the database rather than truncating). Not audited, by design: rate-limit refusals (no mutation; auditing them would let attackers flood the append-only table), and deployments/backups/drills (infrastructure actions recorded in the server's release and job logs, data-model §4). See Complexity Tracking. |
| V. Test-Gated Changes | ✅ with deviation | The gate grows (browser journey, migration safety, stack checks). Changed JSON payloads (error body, health) have zod schemas in `packages/shared` and e2e tests. `/metrics` returns the Prometheus text format: its query schema and metric names are in shared, and its content is verified by parsing in e2e (see Complexity Tracking). No traversal logic changes. |
| VI. MVP Scope Discipline | ✅ | Answers no §65 question by itself; it is the enabling work 001's spec deferred to "the later production hardening feature", without which no question can be answered for real users. Nothing in §62 is built (no workflow engine, BI or AI). Scope boundaries in spec Assumptions (no HA, SSO, paging, log search). |
| Tech constraints | ✅ with deviations | Strict TS, no `any`, traversal untouched. New runtime dependencies are listed and justified (research R21). New cross-cutting modules under `common/` and `lifecycle/` rather than bounded contexts, and a new top-level `e2e` workspace package: see Complexity Tracking. |

**Post-design re-check**: ✅ No unjustified violations. The deliberate choices are listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/011-production-hardening/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/
│   ├── http.md              # /metrics, health, 429, headers, CORS, metrics, logs, error events, fixtures P1–P5
│   ├── configuration.md     # every setting, compose variable, secret file, GitHub secret
│   └── operations.md        # images, services, edge routing, CLI commands, scripts, timers, workflows, journey, load test
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (new and changed files only)

```text
.dockerignore                              # + specs, .specify, .claude, .opencode, .private, docs, e2e, loadtest, deploy, .local-ops, "Product Overview.md"
.gitignore                                 # + deploy/env/*.env, .local-ops/, e2e/playwright-report/, e2e/test-results/, loadtest/results/
package.json                               # + scripts check:migrations, test:browser
pnpm-workspace.yaml                        # + 'e2e'
eslint.config.mjs                          # + ignore loadtest/**
README.md                                  # + "Production" section linking docs/operations

docker/
├── postgres/init.sql                      # unchanged (development)
├── api/Dockerfile                         # NEW (R2)
├── web/Dockerfile  web/nginx.conf         # NEW (R2, R9)
├── caddy/Caddyfile  Caddyfile.ci  opsgraph-site.caddy   # NEW (R4)
├── prometheus/prometheus.yml              # NEW (R12)
└── grafana/provisioning/{datasources,dashboards}/*.yml  grafana/dashboards/opsgraph-api.json   # NEW (R12)

docker-compose.yml  docker-compose.override.yml   # unchanged (development)
docker-compose.prod.yml                    # NEW: one environment (R3)
docker-compose.edge.yml                    # NEW: shared Caddy (R4)
docker-compose.monitoring.yml              # NEW: optional (R12)
docker-compose.ci.yml                      # NEW: CI/local override (R5)

deploy/
├── bin/ lib.sh setup-vm.sh remote-entry.sh deploy.sh rollback.sh status.sh backup.sh
│        restore.sh restore-drill.sh offsite-fetch.sh prune.sh dev-root.sh       # NEW (R5, R6, R14)
├── systemd/ opsgraph-backup@.service opsgraph-backup@.timer opsgraph-restore-drill.{service,timer}
│            opsgraph-prune.{service,timer}                                     # NEW
├── logrotate/opsgraph                                                          # NEW
├── env/ production.env.example staging.env.example production.app.env.example staging.app.env.example
│        edge.env.example backup.env.example rclone.conf.example                # NEW (no values)
└── secrets.example/README.md                                                   # NEW: list of secret files

scripts/
├── check-migrations.mjs  check-migrations.test.mjs  fixtures/migrations/…      # NEW (R6)
└── migration-baseline.json                                                     # NEW

.github/workflows/
├── ci.yml                                 # + quality checks, stack job, publish job (R5)
├── cd-staging.yml  deploy-production.yml  rollback.yml  load-test.yml           # NEW

packages/shared/
├── package.json                           # + "files": ["dist"]
└── src/
    ├── common.ts                          # + RATE_LIMITED, retryAfterSeconds (data-model §1a)
    ├── health.ts                          # + DEPLOY_ENVS, environment, checks.shutdown (§1b)
    ├── observability.ts                   # NEW (§1c)
    ├── audit.ts                           # + OPS_DATABASE_RESTORED (§1d)
    ├── *.spec.ts                          # + observability.spec.ts, common/health additions
    └── index.ts                           # + export observability

apps/api/
├── package.json                           # + 3 deps, prisma → dependencies, "files", build:seed script
├── tsconfig.seed.json                     # NEW: compiles prisma/seed.ts (+ src) → dist-seed/
├── .env.test                              # + DEPLOY_ENV=test, RATE_LIMIT_ENABLED=false
├── .env.example                           # + new settings with development values
├── prisma/seed.ts                         # guard by DEPLOY_ENV (R15)
├── src/
│   ├── main.ts                            # bufferLogs + JsonLogger, process handlers, shutdown watchdog
│   ├── bootstrap.ts                       # trust proxy from env, helmet + extra headers, CORS, prefix exclude /metrics
│   ├── app.module.ts                      # + SecurityModule, ObservabilityModule, LifecycleModule
│   ├── config/env.ts (+ env.spec.ts)      # parseEnv, *_FILE, DEPLOY_ENV, new settings (R7)
│   ├── auth/token.service.ts              # verify with previous secret (R7)
│   ├── auth/auth.controller.ts            # @RateLimit decorators (login, refresh, password-change)
│   ├── ingestion/imports.controller.ts    # @RateLimit('import')
│   ├── health/health.controller.ts        # version from APP_VERSION, environment, draining (R18)
│   ├── prisma/prisma.service.ts           # onApplicationShutdown → $disconnect
│   ├── common/errors/all-exceptions.filter.ts   # 429 retryAfterSeconds + Retry-After; ErrorReporter calls
│   ├── common/security/                   # NEW
│   │   ├── security.module.ts  rate-limit.guard.ts  rate-limit.decorator.ts
│   │   ├── rate-limit.policies.ts (+ .spec.ts)  security-headers.ts (+ .spec.ts)  cors.ts (+ .spec.ts)
│   ├── common/observability/              # NEW
│   │   ├── observability.module.ts  json-logger.ts (+ .spec.ts)  scrub.ts (+ .spec.ts)
│   │   ├── http-observability.middleware.ts  route-label.ts (+ .spec.ts)
│   │   ├── metrics.registry.ts  metrics.controller.ts  db-pool.collector.ts (+ .spec.ts)
│   │   └── error-reporter.ts  error-event.ts (+ .spec.ts)  dsn.ts (+ .spec.ts)  stack-frames.ts (+ .spec.ts)
│   ├── lifecycle/                         # NEW
│   │   ├── lifecycle.module.ts  shutdown.service.ts (+ .spec.ts)
│   └── cli/                               # NEW (R15, R17)
│       ├── cli-env.ts  migrate.ts  create-admin.ts (+ .spec.ts)  record-restore.ts  perf-dataset.ts
└── test/
    ├── rate-limit.e2e-spec.ts  proxy-trust.e2e-spec.ts  security-headers.e2e-spec.ts  cors.e2e-spec.ts
    ├── metrics.e2e-spec.ts  logging.e2e-spec.ts  error-reporter.e2e-spec.ts  create-admin.e2e-spec.ts   # NEW
    ├── support/throwing.controller.ts     # NEW: test-only 500 source (registered in the testing module only)
    ├── health.e2e-spec.ts                 # + version, environment, draining
    └── authz-matrix.e2e-spec.ts           # + /metrics row

apps/web/src/
├── lib/api-client.ts (+ test)             # 429 → RateLimitedError with retryAfterSeconds
├── pages/LoginPage.tsx (+ test)           # "Too many attempts. Try again in N seconds."
└── main.tsx                               # vite:preloadError → reload once (+ lib/preload-reload.ts + test)

e2e/                                       # NEW workspace package @opsgraph/e2e
├── package.json  tsconfig.json  playwright.config.ts
├── fixtures/users.ts
└── tests/core-journey.spec.ts

loadtest/k6/
├── opsgraph-load.js  availability.js  lib/summary.js                            # NEW (R17)

docs/operations/
├── server-setup.md  configuration.md  runbook.md  monitoring.md  migrations.md  # NEW (R19)
```

**Structure Decision**: the existing pnpm monorepo plus a deployment bundle at the repository root.
- Development stays on `docker-compose.yml` (unchanged); production files are new `docker-compose.*.yml` siblings and build on the existing `docker/` folder.
- Cross-cutting server concerns go in `common/security`, `common/observability` and `lifecycle` (infrastructure, not bounded contexts); server commands in `src/cli`.
- Browser tests get their own workspace package `e2e/` so Playwright never enters the api or web dependency trees.

## Key Design Notes (for the implementer)

1. **Build order.** Each step is independently testable. Do not start a step before the previous one's checks pass.
   1. **Shared**: `observability.ts`, `RATE_LIMITED` + `retryAfterSeconds`, health fields, audit action; `"files"` in `package.json`. Rebuild shared; existing tests green.
   2. **Settings**: `parseEnv` with every rule of contracts/configuration.md and its unit tests; `.env.test`/`.env.example` updates; `token.service` previous secret.
   3. **Observability**: `scrub`, `JsonLogger`, route labels, middleware, metrics registry + controller + DB collector, prefix exclusion; `logging`, `metrics` e2e. Then `ErrorReporter` + `error-reporter.e2e-spec.ts`.
   4. **Security**: headers (helmet + extras), CORS, trust proxy; `security-headers`, `cors`, `proxy-trust` e2e. Then the rate-limit guard, decorators, policy table; `rate-limit.e2e-spec.ts` (P1); 429 in the filter.
   5. **Lifecycle**: `ShutdownService`, health additions, Prisma disconnect order, process handlers.
   6. **CLI**: `cli-env`, `migrate`, `create-admin` (+ e2e), `record-restore`, seed guard + `tsconfig.seed.json`, `perf-dataset`.
   7. **Web**: 429 mapping, login message, preload reload.
   8. **Images**: both Dockerfiles, `.dockerignore`; build locally for amd64 and (with QEMU) arm64; run the image smoke checks.
   9. **Compose + edge**: the four compose files, Caddyfiles, nginx config; `dev-root.sh`, `deploy.sh`, `status.sh`, `rollback.sh`; bring the stack up locally (quickstart §2).
   10. **Migration gate**: `check-migrations.mjs` + tests + baseline; `pnpm check:migrations`.
   11. **Backups**: `backup.sh`, `restore-drill.sh`, `restore.sh`, `offsite-fetch.sh`, `prune.sh`, systemd units, logrotate; run them against the local stack.
   12. **Browser journey**: `e2e/` package and spec against the local stack.
   13. **Load test**: k6 scripts; smoke against the local stack; full run against the dataset (record in quickstart §4).
   14. **CI/CD**: extend `ci.yml` (`quality` checks, `stack`, `publish`), then `cd-staging.yml`, `deploy-production.yml`, `rollback.yml`, `load-test.yml`; `setup-vm.sh`, `remote-entry.sh`.
   15. **Monitoring**: Prometheus/Grafana compose, provisioning, dashboard JSON (import check in CI with `promtool` for the config; the dashboard JSON is validated as JSON and its metric names are checked against `METRIC_NAMES` by a small unit test).
   16. **Docs**: the five `docs/operations/*.md` and the README section.
2. **Never weaken existing behaviour.**
   - 001's lockout, cookies, refresh flow and audit rows stay exactly as they are; the IP limit is in addition.
   - Rate limits are off only in `.env.test`; production refuses `RATE_LIMIT_ENABLED=false`.
   - Headers must also be present on error responses (they are set before routing).
3. **Secrets.**
   - Never log a settings object; `JsonLogger` scrubs values listed in `env.secretValues`.
   - Never echo a secret in a script (`set +x` around secret handling; no secrets in command-line arguments; `docker login --password-stdin`).
   - CI generates throwaway secrets at runtime (`dev-root.sh`); no secret-looking value is committed except the existing development ones in `apps/api/.env.example`/`.env.test`.
4. **Zero downtime details.**
   - The edge uses `/api/health/ready`; Docker uses `/api/health/live`.
   - `SHUTDOWN_DRAIN_MS` must exceed two edge health intervals (2 s each).
   - Start the new colour before stopping the old one; never `docker compose up -d` the whole project during a deployment (it would recreate the active colour).
   - Use `--no-deps` for single-service operations.
5. **Shell scripts.**
   - `set -Eeuo pipefail`, `trap` cleanup, quote every variable, `shellcheck` clean.
   - All timestamps `date -u +%Y%m%dT%H%M%SZ`.
   - Use the Compose CLI plugin (`docker compose`), never `docker-compose`.
   - Every script must work with `OPSGRAPH_ROOT` pointing to a temp directory (CI).
6. **Images.**
   - Build the web stage on `$BUILDPLATFORM`; build the API stages on the target platform.
   - The runtime image must not contain `src/`, tests, `.env*`, source maps or the pnpm store.
   - Smoke step: `node -e "require('@prisma/client'); require('argon2')"`.
7. **Pitfalls**:
   - `pnpm deploy` copies only a package's packed files; both `dist` folders are git-ignored, hence the `"files"` fields. With pnpm 10 it would also need `--legacy`; the repo pins pnpm 9.
   - Prisma on `bookworm-slim` needs `openssl` installed or engine detection fails.
   - `trust proxy` must be the edge's address: with the default `loopback`, every user behind Caddy would share one rate-limit bucket.
   - Caddy's `{args[0]}` placeholders work only inside imported snippets/files.
   - GHCR private storage is small on the Free plan; recommend public packages and do not auto-delete untagged versions (multi-arch children).
   - Oracle's Ubuntu images ship restrictive host `iptables` rules; opening ports in the cloud security list alone is not enough (setup guide).
   - Oracle may reclaim idle Always Free instances; the setup guide recommends the Pay-As-You-Go upgrade (still $0 within free limits) and a budget alert.
   - `pg_restore` into a database with the audit triggers: restore into a freshly created database (never `TRUNCATE audit_entries`).
   - k6 scripts are not Node: no imports from the workspace; keep them out of ESLint/TypeScript.
   - Playwright's `workers: 1`: the journey shares one database.
8. **Do not**:
   - add a migration, change the Prisma schema, or touch traversal code;
   - add dependencies beyond research R21 (no pino, no Sentry SDK, no SSH actions, no npm load-test tools);
   - expose `/metrics`, the database, Prometheus or Grafana to the internet;
   - add auditing to rate-limit refusals, or seed demo users in production;
   - edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, the constitution, CLAUDE.md or AGENTS.md.

   Ambiguities go to `questions.md`.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Three new runtime dependencies (`@nestjs/throttler`, `helmet`, `prom-client`) and `@playwright/test` | Rate limiting with per-route, per-user policies; maintained security headers; Prometheus exposition and histograms; the requested browser tests | Hand-written limiter/metrics re-implement windows, storage and exposition format; logging, error tracking and load testing were kept dependency-free |
| `prisma` moved to runtime dependencies | The runtime image runs `prisma migrate deploy` (one image promoted from staging to production) | A separate migration image doubles builds, tags and promotion logic |
| Cross-cutting modules in `common/security`, `common/observability`, `lifecycle`, `cli` (not in CLAUDE.md's bounded-context list) | They serve every context and own no domain data | Putting them in `auth` or `audit` would couple unrelated concerns |
| New `e2e/` workspace package | Keeps Playwright and browsers out of the api/web dependency trees and `pnpm -r test` | Placing it in `apps/web` would make every web install pull Playwright |
| `/metrics` returns Prometheus text, not a zod-validated JSON DTO (Constitution V) | Prometheus scrapes only the text exposition format | A JSON endpoint would need a converter or exporter; the metric names and the empty query schema are in shared, and e2e parses the text |
| Infrastructure actions (deploy, rollback, backup, drill) recorded in server logs, not `audit_entries`; rate-limit refusals not audited (Constitution IV) | They are not data mutations; the app may be down when they run; auditing refusals would let attackers flood the append-only table | Writing audit rows from shell scripts during outages is unreliable; data-level restores and admin creation **are** audited |
| Blue/green API colours with two services per environment | Zero failed requests during deployments on one server (FR-015) | Recreate-in-place refuses connections; Compose has no health-gated rolling update |
| Staging and production on one VM sharing one edge | Free tier allows one useful VM; one public IP | Two VMs halve production capacity; separate edges need two IPs |
