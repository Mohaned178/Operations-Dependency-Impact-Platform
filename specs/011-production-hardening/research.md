# Research: Production Hardening and Free-Tier Deployment

**Feature**: `011-production-hardening` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

The spec has no clarification markers; its defaults are listed in its Assumptions. This document records the **design decisions**. They are binding for the implementer. Each one gives the decision, the rationale and the alternatives rejected. Section numbers (R1–R21) are referenced from plan.md, data-model.md and contracts/.

Codebase facts this research relies on (state of `011-production-hardening`, branched from `010-home-dashboard-search`: 001–003 implemented; 004–010 specified and planned and **must be merged before this feature starts**, see plan.md):

- **No container images, no production compose, no CD exist.** `docker-compose.yml` runs only `postgres:16-alpine` for development (user/password `opsgraph`, volume `pgdata`, `docker/postgres/init.sql` creates `opsgraph_test`); `docker-compose.override.yml` maps it to host port 5433. `.dockerignore` excludes `.git`, `node_modules`, `dist`, `coverage`, `.env*`, `*.log`.
- **CI** (`.github/workflows/ci.yml`): one `quality` job on `ubuntu-latest` with a Postgres 16 service: `pnpm install --frozen-lockfile`, shared build, `prisma generate`, `prisma migrate deploy`, lint, typecheck, unit tests, e2e tests, build. Triggered on `pull_request` and `push` to `main`.
- **API bootstrap**: `main.ts` creates the Nest app and calls `configureApp` (`bootstrap.ts`): global prefix `api`, `cookie-parser`, `enableShutdownHooks()`, `trust proxy = 'loopback'`. No CORS, no security headers, no rate limiting, no metrics. Logging is Nest's default `ConsoleLogger`; `AllExceptionsFilter` logs stacks of unexpected errors and returns `{ error: { code, message, details?, correlationId } }`.
- **Correlation ids**: `RequestContextModule` (`nestjs-cls`) accepts an incoming `x-request-id` only if it is a UUID, otherwise generates one, and echoes it in the response; `RequestContext.runDetached` gives background jobs their own id.
- **Settings**: `config/env.ts` parses `process.env` with zod once at import: `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET` (min 32), `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE` (defaults to `NODE_ENV === 'production'`). Features 009/010 add `RISK_SCHEDULER_ENABLED`, `RISK_EVALUATION_INTERVAL_MS`, `RISK_EVALUATION_INITIAL_DELAY_MS`, `OVERVIEW_SNAPSHOT_AUTO`, `OVERVIEW_ANALYSIS_CONCURRENCY`.
- **Health**: `GET /api/health/live` → `{ status: 'ok', version }` (version read from `apps/api/package.json`, `0.0.0`); `GET /api/health/ready` → database probe with a 2 s timeout, 503 when down. Schemas `HealthLiveSchema`, `HealthReadySchema` in `packages/shared/src/health.ts`.
- **Auth** (001): public `POST /api/auth/login`, `/refresh`, `/logout`; `change-password`; per-account lockout after 5 failures in 15 minutes (audited `auth.account_locked`); refresh token in cookie `og_refresh` (HttpOnly, SameSite=Strict, `Secure` from `env.cookieSecure`, path `/api/auth`). Guards `JwtAuthGuard` then `RolesGuard` are registered as `APP_GUARD` in `AuthModule`. Access tokens are JWTs signed with `JWT_ACCESS_SECRET` (TTL 900 s); refresh tokens are opaque and stored hashed, independent of the JWT secret.
- **Audit**: `AuditService.record(tx, …)`/`recordStandalone(…)`; `audit_entries` is append-only by triggers (`BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` raise). `audit/redact.ts` removes password and token keys from audited values.
- **Seed**: `prisma/seed.ts` (run with `ts-node`) refuses when `NODE_ENV === 'production'`, creates three users with `SEED_PASSWORD` (default `OpsGraph-Dev-2026!`) and loads the §39/§40 scenarios (plus 007–009 seed rows once those land). There is **no way to create the first Administrator** without the seed.
- **Web**: Vite SPA; `apiFetch` calls same-origin `/api/...` and refreshes on 401; the dev server proxies `/api` to `:3000`. `index.html` has no inline script.
- **Performance suites** (`RUN_PERF=1`) build 50,000-entity graphs with set-based SQL (`generate_series`, `md5('perf-' || g)::uuid` ids) inside the e2e process.
- **Package manager**: `packageManager: "pnpm@9"`, Node 22 (`.nvmrc`), `@opsgraph/shared` is built with tsup into `dist/` (git-ignored).

---

## R1. Hosting topology on one free ARM server

**Decision**:
- **Server**: one Oracle Cloud Always Free `VM.Standard.A1.Flex` instance, **4 OCPU / 24 GB** (the whole free Ampere allowance), Ubuntu 24.04 LTS (aarch64), boot volume 100–150 GB (free block storage is 200 GB in total), public IPv4, region = the tenancy's home region.
- **Three Compose projects** on that server, sharing one Docker network `opsgraph-edge` (bridge, fixed subnet `172.30.0.0/24`, created once by the setup script):

  | Project | Services | Purpose |
  |---|---|---|
  | `opsgraph-edge` | `caddy` (fixed IP `172.30.0.2`) | the only service publishing ports (80/tcp, 443/tcp, 443/udp); TLS, routing by host name, HSTS |
  | `opsgraph-production` | `db`, `api-blue`, `api-green`, `web`, `migrate` (tools profile) | production |
  | `opsgraph-staging` | same services | staging |
  | `opsgraph-monitoring` *(optional, off by default)* | `prometheus`, `grafana` | R12 |

  Each environment project has its own **internal** network (`internal: true`, database only reachable there), its own named volume (`pgdata`), its own settings and secret files, and per-service memory limits. `api-*` and `web` also join `opsgraph-edge` with aliases `<env>-api-blue`, `<env>-api-green`, `<env>-web` so the edge can reach them.
- **Default memory limits** (sum ≈ 11 GB of 24 GB, leaving room for the page cache, the monitoring profile and build-free operation):

  | Service | production | staging |
  |---|---|---|
  | `db` | 4 GB (`shared_buffers=1GB`, `effective_cache_size=3GB`, `work_mem=16MB`, `maintenance_work_mem=256MB`, `max_connections=100`) | 2 GB (`shared_buffers=512MB`, `effective_cache_size=1GB`) |
  | `api-blue`, `api-green` (each) | 1.5 GB (`NODE_OPTIONS=--max-old-space-size=1024`) | 1 GB (`--max-old-space-size=768`) |
  | `web` | 128 MB | 128 MB |
  | `caddy` (shared) | 256 MB | — |
  | `prometheus` / `grafana` (optional) | 1 GB / 512 MB | — |

  All limits and Postgres settings are variables in the env files, so a smaller server (for example a 4 GB VPS) runs production only with halved values (documented "small server" profile in the setup guide).
- **Portability** (FR-004): nothing in the compose files, Caddyfile or scripts refers to Oracle. Oracle-specific steps (account, VCN, security list, host iptables, idle reclamation, Object Storage keys) live only in `docs/operations/server-setup.md` § "Oracle Cloud". The same guide has a § "Any other VPS" (Hetzner, etc.): install Ubuntu, run `deploy/bin/setup-vm.sh`, copy env/secret files, point DNS.

**Rationale**: the user's binding decision (free, Docker, Caddy, Oracle ARM). One edge for both environments is forced by one public IP (only one process can bind 443). Separate projects give each environment its own lifecycle (`docker compose -p opsgraph-staging down` never touches production) and its own database. The Always Free A1 allowance (3,000 OCPU-hours and 18,000 GB-hours per month) equals one 4/24 VM running all month.

**Alternatives rejected**:
- **One compose project with both environments**: one `down` or a bad edit stops both; variable collisions.
- **Separate VMs for staging and production**: the free allowance would be split (2/12 each), halving production capacity; still free but no isolation gain worth the operational cost at MVP stage. Documented as an option.
- **Kubernetes (k3s)**: memory and operational overhead for a single node; spec out of scope.
- **Managed database**: not free at useful sizes.
- **Oracle Autonomous Database (Always Free)**: not PostgreSQL.

---

## R2. Container images

**Decision**: two Dockerfiles, `docker/api/Dockerfile` and `docker/web/Dockerfile` (build context: repository root), BuildKit syntax, multi-stage, published as `ghcr.io/<owner>/opsgraph-api` and `ghcr.io/<owner>/opsgraph-web` for `linux/amd64` and `linux/arm64`.

**API image** (`docker/api/Dockerfile`):
1. `base` (target platform): `node:22-bookworm-slim` + `openssl` and `ca-certificates` (Prisma's engines need libssl on slim images) + pnpm 9 activated with corepack (`corepack enable && corepack prepare pnpm@9 --activate`).
2. `deps`: copy only `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/api/package.json`, `packages/shared/package.json`; `pnpm install --frozen-lockfile --filter api...` with a BuildKit cache mount for the pnpm store. Native modules (`argon2`) and Prisma engines are installed for the **target** platform here.
3. `build`: copy `tsconfig.base.json`, `packages/shared`, `apps/api`; `pnpm --filter @opsgraph/shared build`; `pnpm --filter api exec prisma generate`; `pnpm --filter api build` (nest build → `dist/`); `pnpm --filter api build:seed` (`tsc -p tsconfig.seed.json` → `dist-seed/`, R15); then `pnpm --filter api deploy --prod /out` and `cd /out && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma` (the deployed tree gets its own generated client).
   - `apps/api/package.json` gains `"files": ["dist", "dist-seed", "prisma"]` and `packages/shared/package.json` gains `"files": ["dist"]`, because `pnpm deploy` copies a package's packed file list and both `dist` folders are git-ignored.
   - `prisma` (CLI) moves from `devDependencies` to `dependencies` (it is already in the lockfile): the runtime image runs `prisma migrate deploy` (R6) and nothing else needs the build toolchain.
4. `runtime`: `node:22-bookworm-slim` + `openssl`, `ca-certificates`; a dedicated user `opsgraph` with **uid/gid 10001** (`useradd --system --uid 10001`); `WORKDIR /app`; `COPY --from=build --chown=10001:10001 /out /app`; `ENV NODE_ENV=production`; `ARG APP_VERSION` → `ENV APP_VERSION` and OCI labels `org.opencontainers.image.revision`/`source`/`version`; `USER 10001:10001`; `EXPOSE 3000`; `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`; `CMD ["node", "dist/main.js"]`. The last build step runs `node -e "require('@prisma/client'); require('argon2')"` as a smoke check so a broken native module fails the build, not the deploy.
   - No source maps (`sourceMap: false` in `tsconfig.build.json` is already the Nest default for build; the Dockerfile deletes `*.map` defensively), no `.env` files (`.dockerignore`), no tests (`tsconfig.build.json` excludes specs).

**Web image** (`docker/web/Dockerfile`):
1. `build` on `--platform=$BUILDPLATFORM` (static assets are platform-independent, so this stage never runs under emulation): install with `--filter web...`, build shared, `pnpm --filter web build` (tsc + vite).
2. `runtime`: `nginxinc/nginx-unprivileged:1.27-alpine` (multi-arch, runs as uid 101, listens on 8080); `COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf`; `COPY --from=build /repo/apps/web/dist /usr/share/nginx/html`; `HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1`.
   - `nginx.conf`: `server_tokens off`; `location /assets/` → `Cache-Control: public, max-age=31536000, immutable`; `location /` → `try_files $uri /index.html` with `Cache-Control: no-cache`; `location = /healthz` → 200; the web security headers of contracts/http.md § Headers (CSP etc.) with `add_header … always`.

**Version stamping**: CI passes `--build-arg APP_VERSION=<git sha>`; `HealthLive.version` returns `env.APP_VERSION` (falls back to the package version locally). Tags: `sha-<40-char sha>` (immutable) and `main` (moving) for pushes to `main`; PR builds are local only (`ci` tag, never pushed).

**Multi-arch builds**: `docker/setup-qemu-action` + `docker/setup-buildx-action`, `platforms: linux/amd64,linux/arm64`, GitHub Actions cache (`cache-from/to: type=gha,scope=<image>`), `provenance: false` (avoids `unknown/unknown` attestation entries in GHCR and keeps private-package storage small). If the repository is public, the arm64 half may instead run natively on the free `ubuntu-24.04-arm` runner and be merged with `docker buildx imagetools create` (documented optimisation, not required).

**Rationale**: `bookworm-slim` (glibc) avoids musl edge cases with Prisma engines and `argon2` prebuilt binaries on arm64. A dedicated high uid avoids clashing with host users when secret files are bind-mounted (R7). Building web assets on the build platform removes the slowest emulated step.

**Alternatives rejected**:
- **Alpine Node images**: musl + Prisma engine selection and native modules are a frequent source of arm64 breakage.
- **Distroless**: no shell for `docker compose exec` diagnostics and the healthcheck; the gain is small next to slim + non-root.
- **Serving the SPA from the API** (`@nestjs/serve-static`): couples web and API releases and adds a dependency.
- **Serving the SPA from the edge Caddy directly** (files on the host): the web release would no longer be an image, breaking "same digest on staging and production" (FR-010).
- **A separate migration image**: one more image to build and promote; the runtime image already has everything once `prisma` is a runtime dependency.

---

## R3. Compose files and server layout

**Decision**:
- Repository files (the **deployment bundle**):
  - `docker-compose.prod.yml`: one environment (services of R1). Parameterised only by variables: `DEPLOY_ENV`, `API_IMAGE`, `WEB_IMAGE`, `API_BLUE_TAG`, `API_GREEN_TAG`, `WEB_TAG`, memory limits, Postgres settings, `SECRETS_DIR`, `APP_ENV_FILE`.
  - `docker-compose.edge.yml`: the shared Caddy; mounts `docker/caddy/Caddyfile` and `docker/caddy/opsgraph-site.caddy`; volumes `caddy_data` (certificates, must persist) and `caddy_config`.
  - `docker-compose.monitoring.yml`: optional (R12).
  - `docker-compose.ci.yml`: override used by CI and local production-like runs (local `:ci` images, `docker/caddy/Caddyfile.ci` on `http://localhost:8080`, generated throwaway secrets).
  - The existing `docker-compose.yml` and `docker-compose.override.yml` stay the **development** files, unchanged.
- Common service settings (YAML anchors `x-service-defaults`): `restart: unless-stopped`; `init: true` (tini as PID 1, correct signal forwarding); `logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }`; `security_opt: [no-new-privileges:true]`; `cap_drop: [ALL]` for `api-*` and `web`; `read_only: true` with a `tmpfs: /tmp` for `api-*` and `web` (nginx-unprivileged needs `/tmp` and `/var/cache/nginx` as tmpfs); `stop_grace_period: 35s` for `api-*`.
- `db`: `postgres:16-alpine`, `POSTGRES_USER=opsgraph`, `POSTGRES_DB=opsgraph`, `POSTGRES_PASSWORD_FILE=/run/secrets/db_password`, the R1 settings as `command: postgres -c …`, no `ports:`, only the internal network, healthcheck `pg_isready`. (The official image starts as root and drops to `postgres`; this is the image's documented behaviour and is accepted.)
- `api-blue` / `api-green`: same definition (anchor), different image tag variable and network alias; `env_file: ${APP_ENV_FILE}`; `secrets:` (R7); `depends_on: db (service_healthy)`.
- `migrate`: `profiles: ["tools"]`, the API image at the **target** tag, `command: ["node", "dist/cli/migrate.js"]` (R6), internal network only, `restart: "no"`.
- Server directory layout (created by `deploy/bin/setup-vm.sh`, owned by the `deploy` user unless noted):

  ```text
  /opt/opsgraph/
  ├── bundle/<sha>/            # extracted deployment bundles (last 5 kept)
  ├── env/production.env  production.app.env  staging.env  staging.app.env  edge.env  backup.env  rclone.conf   # 0600 deploy (compose variables / API settings)
  ├── secrets/production/  secrets/staging/   # 0700 root; files 0400 owned 10001:10001 (db_password: 0400 root, read by the postgres entrypoint)
  ├── state/<env>/active.env  releases.jsonl  # R6, data-model §4
  ├── backups/<env>/                          # R14
  ├── locks/<env>.lock
  └── logs/jobs.jsonl  restore-drill.jsonl
  ```
- Docker daemon (`/etc/docker/daemon.json` by the setup script): `log-driver json-file` with the same rotation as default, `live-restore: true`.

**Rationale**: variables only, so the same files serve staging, production, CI and another provider. `read_only`, `cap_drop` and `no-new-privileges` are free hardening for stateless services. Log rotation prevents the commonest single-server outage (full disk).

**Alternatives rejected**:
- **Docker Swarm** (for rolling updates and native secrets): an orchestrator for one node; Compose can mount secret files without Swarm.
- **Publishing the database port on localhost for backups**: `docker compose exec db pg_dump` needs no port.

---

## R4. Edge proxy and TLS (Caddy)

**Decision**: `caddy:2` (official, multi-arch) in project `opsgraph-edge`, run as `user: "10002:10002"` (the data volumes are pre-created with that owner by the setup script; Docker sets `net.ipv4.ip_unprivileged_port_start=0` in containers, so a non-root process can bind 80/443), ports `80:80`, `443:443`, `443:443/udp`.

- `docker/caddy/Caddyfile`:
  - global options: `email {$ACME_EMAIL}`; JSON access logs to stdout; `servers { protocols h1 h2 h3 }`;
  - one site block per environment host, `{$PRODUCTION_HOST}` and `{$STAGING_HOST}`, each `import opsgraph-site <env>` (snippet file `opsgraph-site.caddy` with `{args[0]}` = `production` | `staging`), so both environments and CI share **one** routing definition.
- The snippet:
  - `encode zstd gzip`;
  - `header Strict-Transport-Security "max-age=31536000"` and `-Server`; staging adds `X-Robots-Tag "noindex, nofollow"` (FR-007);
  - `handle /api/*` → `reverse_proxy {args[0]}-api-blue:3000 {args[0]}-api-green:3000` with `lb_policy first`, `lb_try_duration 15s`, `lb_try_interval 250ms`, `health_uri /api/health/ready`, `health_interval 2s`, `health_timeout 2s`, `fail_duration 10s`, `header_up X-Request-Id {http.request.uuid}`;
  - `handle` (everything else) → `reverse_proxy {args[0]}-web:8080` with `lb_try_duration 10s`;
  - `/metrics` is never routed: it is outside `/api/*`, so it reaches the web container, which serves the SPA (no metrics exposure, FR-005).
- Plain HTTP is redirected to HTTPS automatically by Caddy; certificates come from Let's Encrypt (HTTP-01/TLS-ALPN-01) and are renewed automatically; they persist in `caddy_data`.
- Caddy replaces any client-sent `X-Forwarded-For` (clients are not trusted proxies), so the API's trusted-proxy rule (R8) sees the real client address.
- The edge config is **applied only by production promotions and the setup script** (`caddy validate` then `caddy reload`, zero downtime). A staging deployment whose bundle carries a different edge config logs a warning and leaves the running edge untouched, so a staging change can never break production routing.
- CI validates the Caddyfile with `caddy validate --adapter caddyfile` in a container, using dummy host names.

**Rationale**: automatic certificates with no extra tool (the user's choice). Active health checks plus `lb_try_duration` are what make the blue/green switch (R6) and the `web` container replacement invisible to clients. `X-Request-Id` from the edge makes the edge's access log line (which records response headers) and the API's lines share one id (FR-029, SC-008).

**Alternatives rejected**:
- **Traefik** with Docker labels: needs the Docker socket inside an internet-facing container.
- **nginx + certbot**: two moving parts and a renewal timer for what Caddy does alone.
- **Host-level Caddy (apt)**: not a container, less portable, harder to pin.

---

## R5. CI/CD pipeline

**Decision**: three workflows (GitHub Actions, free minutes), plus one on-demand load test (R17).

1. **`.github/workflows/ci.yml`** (existing, extended; triggers unchanged: `pull_request`, `push` to `main`):
   - `quality` (existing steps) **+** `pnpm check:migrations` (R6) **+** `shellcheck deploy/bin/*.sh` (preinstalled on `ubuntu-latest`) **+** config validation in containers: `docker compose -f … config -q` for every file combination, `caddy validate`, `nginx -t`, `promtool check config`, `k6 inspect`. Timeout raised to 20 minutes.
   - `stack` (new, parallel to `quality`): build the two images for `linux/amd64` with `load: true` (GHA cache), then run the **production-like stack** with the real deployment script in a temporary root (`OPSGRAPH_ROOT=$RUNNER_TEMP/opsgraph`, `--no-pull`, `docker-compose.ci.yml`), load the demo seed (`DEPLOY_ENV=ci`), and run, in order: Playwright (R16), the k6 smoke run (R17), the availability-during-redeploy check (R6), the backup and restore-drill check (R14). On failure upload: Playwright report and traces, `docker compose logs`, k6 summary. Timeout 30 minutes.
   - `publish` (new, `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`, `needs: [quality, stack]`, `permissions: { contents: read, packages: write }`): multi-arch build and push of both images with tags `sha-<sha>` and `main`; writes both digests to the job summary and to an artifact `release-<sha>.json`.
2. **`.github/workflows/cd-staging.yml`** (new): `on: workflow_run: { workflows: [CI], types: [completed], branches: [main] }`, `if: conclusion == 'success' && event == 'push'`; `concurrency: { group: deploy-staging, cancel-in-progress: false }`; `environment: staging`; `permissions: { contents: read, packages: read, actions: read }`. Steps: checkout `head_sha`; check both image manifests exist for both platforms (`docker buildx imagetools inspect`); build the bundle tarball (compose files, `docker/caddy`, `docker/prometheus`, `docker/grafana`, `deploy/`); open SSH with the environment's key and pinned `known_hosts` (plain `ssh`, no third-party action); stream the bundle to `receive-bundle <sha>`; stream `GITHUB_TOKEN` to `registry-login` (R7); run `deploy staging <sha>`; on any failure, print the remote deploy log and fail.
3. **`.github/workflows/deploy-production.yml`** (new): `workflow_dispatch` with input `release` (40-char sha); `environment: production` (required reviewers when the plan allows it, see R7); `concurrency: deploy-production`. Steps: SSH `status staging --has-succeeded <sha>` (refuses if that release did not succeed on staging); `deploy production <sha> --digests-from staging` (the exact digests staging ran, FR-010). Edge config is applied in this workflow only (R4).
4. **`.github/workflows/rollback.yml`** (new): `workflow_dispatch` with inputs `environment` and optional `release` (default: previous successful); runs `rollback <env> [<sha>]` over SSH. The same command is available on the server for when GitHub is unavailable.

- **Server-side entry point**: the `deploy` user's `authorized_keys` entry for the CI key has `command="/opt/opsgraph/bin/remote-entry.sh",restrict`. `remote-entry.sh` reads `$SSH_ORIGINAL_COMMAND` and allows only `receive-bundle <sha>`, `registry-login`, `deploy <env> <sha> [--digests-from <env>]`, `rollback <env> [<sha>]`, `status <env> [--has-succeeded <sha>]`; anything else exits 2. A leaked CI key can therefore only deploy already-built images, not open a shell.
- **Registry storage**: GHCR is free for public packages; private packages on the Free plan have a small storage and transfer allowance. The setup guide recommends making the two packages public (they contain no secrets, FR-025) or pruning old versions by hand; automatic deletion of untagged versions is **not** used because multi-arch child manifests are untagged.

**Rationale**: `workflow_run` is the literal "after CI passes" trigger and keeps CD permissions separate from PR code. Building amd64 images in the `stack` job tests the real images on every PR; publishing multi-arch only on `main` keeps PRs fast. The forced-command SSH entry is the cheapest strong control over a deploy key that must be reachable from GitHub's changing IP ranges.

**Alternatives rejected**:
- **Deploy job inside `ci.yml`**: works, but the user asked for a CD workflow after CI; `workflow_run` also lets CD be re-run alone.
- **Pull-based deploy (Watchtower or a cron on the server polling `main`)**: no gate on migrations, no pre-deploy backup ordering, no feedback in GitHub.
- **Third-party SSH actions**: unnecessary supply-chain surface; `ssh` is on the runner.
- **Self-hosted runner on the VM**: runs untrusted PR code on the production server.

---

## R6. Zero-downtime deployments, migrations and rollback

**Decision**:
- **Blue/green API on one server**: two services, `api-blue` and `api-green`; `state/<env>/active.env` records the active colour, both tags, the web tag and the release. `deploy/bin/deploy.sh <env> <sha>` (all steps logged as JSON lines to `logs/jobs.jsonl` and to stdout):
  1. take `flock locks/<env>.lock` (shared with backups; a second deployment waits up to 10 minutes, then fails);
  2. resolve images (`sha-<sha>` or the given digests), `docker compose pull` (skipped with `--no-pull` in CI); a missing platform fails here, before any change;
  3. production only: `backup.sh <env> pre-deploy` (R14); failure stops the deployment;
  4. `docker compose up -d db` and wait healthy;
  5. `docker compose run --rm migrate` at the **new** tag: `dist/cli/migrate.js` resolves settings (R7) and runs `prisma migrate deploy`; failure stops the deployment (traffic never moved);
  6. start the **idle** colour with the new tag (`up -d --no-deps api-<idle>`), wait until `/api/health/ready` answers 200 from inside the container network (timeout 120 s); failure → stop the idle colour, exit 1 (the active colour never stopped);
  7. `up -d --no-deps web` with the new web tag (nginx starts in < 1 s; Caddy retries dial failures for 10 s);
  8. stop the old colour with `docker compose stop -t 35 api-<old>` (graceful drain, below);
  9. check `https://<host>/api/health/live` returns the new version within 60 s; failure → **automatic revert**: start the old colour again (its image is still local), wait ready, stop the new one, restore the previous web tag, exit 1;
  10. write `active.env` and append the release record (data-model §4); release the lock; prune bundles and images older than the last 5 releases.
- **Graceful drain** (FR-016): on SIGTERM, `ShutdownService.beforeApplicationShutdown` sets `draining = true` (readiness returns 503 with `checks.shutdown: 'draining'`), waits `SHUTDOWN_DRAIN_MS` (default 5,000 ms, more than two edge health intervals) while still serving, then Nest closes the HTTP server, which stops accepting connections, closes idle keep-alive sockets and lets in-flight requests finish; `PrismaService.onApplicationShutdown` disconnects afterwards. A watchdog exits with code 1 after `SHUTDOWN_TIMEOUT_MS` (default 25,000 ms). Background jobs (009 scheduler, 010 snapshot trigger) stop in their existing `onModuleDestroy` hooks. Docker's `stop_grace_period: 35s` exceeds drain + timeout.
- **Two colours at once**: during steps 6–8 both colours run. Features 009 and 010 already guarantee one evaluation or snapshot run at a time across instances (unique running-slot claims), so duplicated schedulers are safe. Rate-limit counters are per instance (R8, accepted).
- **SPA chunk changes**: when the web container is replaced, a page loaded from the old release may request a lazy chunk that no longer exists. The web app listens for Vite's `vite:preloadError` event and reloads the page once (guarded by a `sessionStorage` flag, wrapped in try/catch).
- **Expand-then-contract** (FR-014), documented in `docs/operations/migrations.md` with worked examples (add a column; rename a column in three releases; make a column required; drop a table; change an enum):
  - every migration must work with the code of the **previous** release: only add tables, nullable columns or columns with defaults, indexes, enum values, constraints added `NOT VALID` then validated in a later release;
  - removals happen in a later **contract** migration, once the release before it no longer uses the removed object;
  - long-running statements on large tables set `SET lock_timeout = '5s';` first so they fail fast instead of blocking traffic.
- **Gate check** `scripts/check-migrations.mjs` (Node, no dependencies, run as `pnpm check:migrations`): scans every `apps/api/prisma/migrations/*/migration.sql` whose directory name sorts after the baseline in `scripts/migration-baseline.json` (`{ "baseline": "<name of the newest migration when 011 merges>" }`; everything up to the first production release, including 004–010, is exempt). Statements are matched case-insensitively after stripping comments and string literals:

  | Refused pattern | Example |
  |---|---|
  | `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`, `DROP SCHEMA` | contract only |
  | `RENAME TO`, `RENAME COLUMN`, `RENAME CONSTRAINT` (except on indexes) | Prisma enum changes also rename (`_old`) |
  | `ALTER COLUMN … TYPE`, `ALTER COLUMN … SET NOT NULL` | |
  | `ADD COLUMN … NOT NULL` without `DEFAULT` | |
  | `TRUNCATE` | |

  A migration whose first line is `-- opsgraph:contract after=<sha or migration name> reason="…"` is allowed (the marker is reported in the job summary). Warnings (not failures): `CREATE INDEX` without `CONCURRENTLY` on an existing table, `ALTER TABLE` without a preceding `lock_timeout`. The script has its own tests (`scripts/check-migrations.test.mjs`, `node --test`, fixtures in `scripts/fixtures/migrations/`).
- **Rollback** (FR-013): `deploy/bin/rollback.sh <env> [<sha>]` = deploy of a previous successful release with `--skip-migrations` (the schema is ahead and backward compatible). It refuses to roll back over a release whose migrations include a contract marker (the older code may need what was removed), naming that release and pointing to the restore procedure. Rollbacks are recorded with `action: "rollback"`.
- **Availability check in CI** (SC-002): `loadtest/k6/availability.js` sends 5 requests per second (alternating `/api/health/live`, an authenticated `GET /api/entities`, and a static page) while the `stack` job runs `deploy.sh` twice more on the same images (forcing two colour switches); the check passes only with 0 failed requests and 0 non-2xx responses.

**Rationale**: on one server, blue/green behind a health-checking proxy is the only way to replace the API process without refusing requests; it needs no orchestrator. Applying migrations before the switch is only safe if the old code tolerates the new schema, so the expand-then-contract rule is enforced mechanically, not by review. Readiness-based draining avoids the race where the proxy sends a request to a process that is closing its sockets.

**Alternatives rejected**:
- **Recreate-in-place (`docker compose up -d api`)**: several seconds of refused connections per release.
- **Rolling `--scale api=2`**: Compose cannot replace replicas one by one with health gating.
- **Migrations at application start**: two colours would race to migrate, and a failed migration would crash-loop the new colour.
- **Destructive-change review by hand**: the implementer is a lower-cost model (Constitution V); a mechanical gate is required.

---

## R7. Configuration and secrets

**Decision**:
- **`config/env.ts`** becomes a pure `parseEnv(source: NodeJS.ProcessEnv, readFile)` (unit-testable) plus the existing exported `env` singleton. New and changed settings are listed in contracts/configuration.md; the rules:
  - **`DEPLOY_ENV`** ∈ `development | test | ci | perf | staging | production`; defaults to `development`/`test` from `NODE_ENV` and is **required** when `NODE_ENV=production` (all images). It drives guards (seed, dataset generator, load test), log and metric labels, and HSTS.
  - **`*_FILE` variants** for every secret (`DATABASE_URL_FILE`, `JWT_ACCESS_SECRET_FILE`, `JWT_ACCESS_SECRET_PREVIOUS_FILE`, `METRICS_TOKEN_FILE`, `ERROR_TRACKING_DSN_FILE`, `SEED_PASSWORD_FILE`): the file's content with one trailing newline removed. Setting both `X` and `X_FILE` is a startup error. After resolution, `process.env.DATABASE_URL` is set so Prisma reads it.
  - `DATABASE_URL` gets `application_name=opsgraph-api` and `connection_limit=10` appended when absent (R11 needs both).
  - On `staging`/`production`: refuse a JWT secret equal to the committed development value or containing `change-me`; refuse the database password `opsgraph`; refuse `COOKIE_SECURE=false`. In every environment, refuse a `CORS_ORIGINS` entry that is `*`, has a path, or is not `https://` (only `http://localhost:<port>` is accepted, and only when `DEPLOY_ENV` is `development` or `test`).
  - Errors name the variable and the rule, **never the value**; the process exits with code 1 before listening.
- **Secret storage on the server**: secret files under `/opt/opsgraph/secrets/<env>/` (dir 0700 root; files 0400 owned by uid 10001, the API user; `db_password` 0400 root, read by the Postgres entrypoint), mounted with Compose `secrets:` at `/run/secrets/<name>`. Non-secret settings in `/opt/opsgraph/env/<env>.env` (0600 `deploy`). Templates without values are committed: `deploy/env/production.env.example`, `staging.env.example`, `edge.env.example`, `backup.env.example`, plus `deploy/secrets.example/README.md` listing each secret file. The setup script generates the initial secrets with `openssl rand` (database password 32 bytes hex, JWT 48 bytes base64url).
- **Registry credentials**: the server keeps **no** long-lived registry token. Each CD run streams its short-lived `GITHUB_TOKEN` (`packages: read`) to `registry-login`, which runs `docker login ghcr.io --password-stdin`, and `deploy.sh` runs `docker logout ghcr.io` after pulling. Manual rollbacks use images already on the server (last 5 releases kept). If packages are public, no login is needed at all.
- **GitHub secrets** (per environment `staging`, `production`): `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY` (ed25519, dedicated, forced command), `DEPLOY_SSH_KNOWN_HOSTS`. Variables: `STAGING_URL`, `PRODUCTION_URL`. Nothing else; application secrets never enter GitHub (FR-025). Required reviewers on the `production` environment are used when the repository plan supports them (public repositories, or paid plans); otherwise the manual `workflow_dispatch` is the gate (documented).
- **JWT rotation without sign-outs** (FR-026): `TokenService.verifyAccess` tries `JWT_ACCESS_SECRET`, then `JWT_ACCESS_SECRET_PREVIOUS` when set; signing always uses the current one. Runbook: write the new secret, move the old one to `jwt_access_secret_previous`, deploy (blue/green), wait at least `ACCESS_TOKEN_TTL_SECONDS` (15 minutes), remove the previous file, deploy again. Refresh tokens are opaque and unaffected.
- **Database password rotation** (runbook): `ALTER ROLE opsgraph PASSWORD …` via `docker compose exec db psql`, update `db_password` and `database_url` files, redeploy the active release (blue/green picks up new secret files). Existing connections are unaffected until recycled.
- **Documentation**: `docs/operations/configuration.md` = contracts/configuration.md in operator language (meaning, default, required in production, secret or not, where it is stored, how to rotate).

**Rationale**: `*_FILE` keeps secrets out of `docker inspect` and process environment listings of other tools; refusing development defaults at startup turns a common misconfiguration into a failed deployment that never takes traffic (step 6 of R6). The forced-command key and the short-lived registry token keep GitHub's blast radius to "deploy a built image".

**Alternatives rejected**:
- **SOPS/age-encrypted secrets in the repository**: a key still has to live on the server; adds tooling for no gain on one server.
- **A secrets manager (OCI Vault, Doppler)**: extra integration and possible cost; out of scope.
- **Secrets in GitHub, pushed at deploy time**: secrets would transit and be stored in a third place.

---

## R8. Rate limiting

**Decision**: `@nestjs/throttler` (v6, Nest 11 compatible) with its default in-memory storage, through a project guard `RateLimitGuard extends ThrottlerGuard` registered as `APP_GUARD` in a new `SecurityModule`, **after** `AuthModule`'s guards (so `req.user` is known).

- **Policies** (named throttlers; values from settings, defaults from spec FR-017):

  | Policy | Applies to | Key | Limit / period |
  |---|---|---|---|
  | `login-minute`, `login-hour` | `POST /api/auth/login` | client IP | 10 / 60 s and 50 / 3,600 s |
  | `refresh` | `POST /api/auth/refresh` | client IP | 30 / 60 s |
  | `password-change` | `POST /api/auth/change-password` | user id | 5 / 900 s |
  | `import` | `POST /api/imports` (and 002's other import write routes) | user id | 10 / 60 s |
  | `write` | every other `POST`, `PUT`, `PATCH`, `DELETE` under `/api` | user id, else client IP | 120 / 60 s |
  | none | `GET`, `HEAD`, `OPTIONS`, `/api/health/*`, `/metrics`, `POST /api/auth/logout` | — | — |

  Route-specific policies are attached with a `@RateLimit('login')`-style decorator (metadata) that the guard reads; methods without the decorator fall back to `write` or none by HTTP method. The policy table lives in one file (`common/security/rate-limit.policies.ts`) and is unit-tested for completeness against the router (an e2e test lists every mutating route and asserts its policy).
- **Refusal**: the guard throws `AppError(429, 'RATE_LIMITED', 'Too many requests. Try again in N seconds.', { retryAfterSeconds })`; `AllExceptionsFilter` adds `retryAfterSeconds` to the error body and the `Retry-After` header. `opsgraph_rate_limited_total{policy}` is incremented and a `warn` log line written (policy, key kind, route). **No audit row** (spec FR-018, Assumptions).
- **Client address**: `bootstrap.ts` sets `trust proxy` from `TRUST_PROXY` (default `loopback`; production compose sets the edge's fixed address `172.30.0.2`). Express then takes `req.ip` from `X-Forwarded-For` only when the connection comes from that address; Caddy overwrites client-supplied forwarding headers (R4).
- **Tests**: `RATE_LIMIT_ENABLED=false` in `apps/api/.env.test` so the existing suites (many logins from one address) are unaffected; `rate-limit.e2e-spec.ts` builds the app with a `RateLimitConfig` provider override (small limits, enabled) instead of mutating `process.env`.
- **Web**: `apiFetch` maps 429 to a typed error carrying `retryAfterSeconds`; `LoginPage` shows "Too many attempts. Try again in N seconds."; other pages show the shared non-blocking error message.

**Rationale**: Nest-ecosystem package, guard-based (fits the existing guard chain), per-route configuration by metadata. In-memory counters are exact for one instance per environment (spec Assumptions). The existing per-account lockout stays the audited control; the IP limit adds protection against spraying many accounts.

**Alternatives rejected**:
- **`express-rate-limit`**: middleware runs before guards, so user-keyed limits are awkward; not Nest-native.
- **Rate limiting only at the edge** (Caddy has no built-in limiter; a plugin requires a custom Caddy build): breaks portability and cannot key by user.
- **Redis-backed storage**: a new service for a single-instance deployment.
- **Limiting reads**: not requested; dashboards and the load test would need exemptions.

---

## R9. Security headers and CORS

**Decision**:
- **API** (`SecurityModule`, applied in `configureApp`): `helmet` v8 configured for a JSON API: `contentSecurityPolicy` `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`; `crossOriginResourcePolicy: same-origin`; `crossOriginOpenerPolicy: same-origin`; `referrerPolicy: no-referrer`; `frameguard: deny`; `noSniff`; `hsts` `max-age=31536000` only when `DEPLOY_ENV` is `staging` or `production`; `x-powered-by` removed. Plus `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` and `Cache-Control: no-store` on every `/api` response (helmet sets neither). Headers are applied before routing, so 401/404/429/500 responses carry them too.
- **Web** (`docker/web/nginx.conf`, `add_header … always`): `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` as above, `Cross-Origin-Opener-Policy: same-origin`. `'unsafe-inline'` for styles is required by React Flow (004), which sets inline `style` attributes; scripts stay strict (no inline script in `index.html`).
- **Edge**: HSTS for every response on both hosts (R4); `-Server`.
- **CORS** (FR-022): production is same-origin (web and API under one host), so CORS stays **off** by default: no `Access-Control-*` headers, so browsers refuse cross-origin reads. If `CORS_ORIGINS` is set (comma-separated exact `https://` origins), `app.enableCors({ origin: allowlist-function, credentials: true, methods: GET,POST,PUT,PATCH,DELETE, allowedHeaders: content-type,authorization,x-request-id, exposedHeaders: x-request-id,retry-after, maxAge: 600 })` (Nest's built-in, backed by the `cors` package already installed with `@nestjs/platform-express`). Unlisted origins get no CORS headers. A wildcard is refused at startup (R7).
- **Cookies**: unchanged from 001 (`HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS environments, path `/api/auth`); R7 refuses `COOKIE_SECURE=false` on staging/production.

**Rationale**: every layer sets the headers for what it serves, so the API stays protected behind any proxy (FR-021, portability) and the SPA's CSP is owned by the image that knows its assets. Same-origin deployment makes "strict CORS" the simplest possible rule: none.

**Alternatives rejected**:
- **All headers at the edge only**: the API image would be unsafe behind another proxy.
- **Hand-written header middleware instead of `helmet`**: possible (about 15 headers), but `helmet` tracks browser changes and is the standard Express choice; the user allowed it.
- **CSP nonces**: needs server-side HTML rendering; static nginx cannot inject nonces.

---

## R10. Structured logging

**Decision**: no logging library. A `JsonLogger` (`common/observability/json-logger.ts`) implementing Nest's `LoggerService`, installed with `NestFactory.create(AppModule, { bufferLogs: true })` then `app.useLogger(app.get(JsonLogger))`.

- One JSON object per line on stdout (errors included; Docker collects both streams): fields in contracts/http.md § Log records (`time`, `level`, `msg`, `component`, `correlationId`, `userId`, `env`, `version`, `err`, `http`).
- `correlationId` and `userId` come from `RequestContext` (CLS) when available; jobs use `runDetached`'s id.
- `LOG_LEVEL` (`error | warn | info | debug`, default `info`); `LOG_FORMAT` (`json | pretty`, default `pretty` when `DEPLOY_ENV=development`, else `json`; `pretty` delegates to Nest's `ConsoleLogger`).
- **Access log**: `HttpObservabilityMiddleware` (applied to all routes in `ObservabilityModule.configure`, after the CLS middleware) records start time and, on the response `finish` (or `close` for aborted requests), writes one `info` line `msg: "request"` with `http.method`, `http.route` (the matched route pattern `req.baseUrl + req.route.path`, or `UNMATCHED`), `http.status`, `http.durationMs`, `http.ip`, `http.bytes`. Never the query string, body, cookies or headers. The same listener records the HTTP metrics (R11), so logs and metrics see the same requests.
- **Scrubbing** (`common/observability/scrub.ts`, pure, unit-tested): structured values go through 001's `redact` (key-based) extended with log-only keys (`authorization`, `cookie`, `set-cookie`, `secret`, `dsn`, `databaseUrl`); every string (message, error message, stack) is then passed through **value scrubbing**: each configured secret value (JWT current and previous, database password, metrics token, DSN key, seed password) and any `scheme://user:password@` credential in a URL is replaced with `[REDACTED]`. Prisma query logging stays off.
- Unexpected errors: the filter logs `level: error` with `err.stack`; expected errors (4xx) log at `warn` without stack (validation details are not logged).
- `process.on('unhandledRejection' | 'uncaughtException')` in `main.ts`: log `fatal`-as-`error` with stack, report (R13), and for `uncaughtException` exit 1 after flushing.

**Rationale**: request volume is small (tens of users), so a synchronous `process.stdout.write` of one JSON line is fast enough; the redaction rules already exist (001) and must be shared, not re-implemented in a library's config. No new dependency (Constitution, CLAUDE.md).

**Alternatives rejected**:
- **`nestjs-pino` + `pino-http`**: three new packages; its redaction is path-based and would duplicate `redact.ts`; value scrubbing would still be custom.
- **`winston`**: heavier, slower, same duplication.
- **Logging request bodies at debug level**: too easy to leak passwords; forbidden by FR-030.

---

## R11. Metrics

**Decision**: `prom-client` v15 with a **non-global** `Registry` provided by `ObservabilityModule` (tests can create isolated apps).

- **Endpoint**: `GET /metrics`, excluded from the `api` prefix (`setGlobalPrefix('api', { exclude: [{ path: 'metrics', method: RequestMethod.GET }] })`), `@Public()`, not rate-limited. When `METRICS_TOKEN` is set, requires `Authorization: Bearer <token>` (constant-time comparison) and answers 401 otherwise. `METRICS_ENABLED=false` removes the route (404). Content type `text/plain; version=0.0.4; charset=utf-8`.
- **Metrics** (names fixed in `packages/shared/src/observability.ts` `METRIC_NAMES`, used by the dashboard JSON and tests; full table in contracts/http.md):
  - `opsgraph_http_requests_total{method, route, status}` counter;
  - `opsgraph_http_request_duration_seconds{method, route, status_class}` histogram, buckets `0.025, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 10`;
  - `opsgraph_http_server_errors_total{route}` counter (status ≥ 500);
  - `opsgraph_rate_limited_total{policy}` counter;
  - `opsgraph_error_reports_total{outcome}` counter (`sent | dropped | failed`, R13);
  - `opsgraph_db_connections{state}` gauge (`active`, `idle`, `idle_in_transaction`, `waiting`), `opsgraph_db_pool_max` gauge, `opsgraph_db_up` gauge, `opsgraph_db_probe_seconds` gauge;
  - `opsgraph_build_info{version, env}` gauge = 1;
  - prom-client default process and Node.js metrics (prefix `opsgraph_`: CPU, resident memory, heap, event-loop lag, GC).
- **Bounded labels**: `route` is the route pattern or `UNMATCHED`; `method` is one of 7 values, else `OTHER`; `status` is the numeric code (finite set).
- **Database pool**: Prisma's own pool metrics are a preview feature that Prisma has deprecated, so pool usage is measured **from the database side** at scrape time: `SELECT state, wait_event_type, count(*) FROM pg_stat_activity WHERE application_name = 'opsgraph-api' AND pid <> pg_backend_pid() GROUP BY 1, 2` (state `active` with `wait_event_type = 'Lock'` counts as `waiting`), with a 1 s timeout; on timeout or error `opsgraph_db_up = 0` and the connection gauges are left unset. `opsgraph_db_pool_max` = `connection_limit` from the resolved URL (R7). Each colour has its own pool; Prometheus sums by instance. This query is fixed-shape, non-recursive SQL (not traversal) in `observability/db-pool.collector.ts`.

**Rationale**: `prom-client` is the de-facto Node exporter (no Nest wrapper needed; the wrapper `@willsoto/nestjs-prometheus` would be a second dependency for a 30-line module). Measuring connections in Postgres works on any Prisma version and shows exactly what the database sees.

**Alternatives rejected**:
- **Prisma `metrics` preview feature**: deprecated; adding a preview flag to production builds for it is not worth it.
- **OpenTelemetry SDK + collector**: several packages and a collector process; overkill for one service.
- **Metrics under `/api/metrics`**: would be routed by the edge to the internet (FR-005).

---

## R12. Optional monitoring stack and dashboard

**Decision**:
- `docker-compose.monitoring.yml` (project `opsgraph-monitoring`, started only on request: `docker compose -p opsgraph-monitoring -f docker-compose.monitoring.yml up -d`):
  - `prom/prometheus` with `docker/prometheus/prometheus.yml` scraping `production-api-blue:3000`, `production-api-green:3000`, `staging-api-blue:3000`, `staging-api-green:3000` every 15 s on the edge network (a stopped colour shows `up = 0`, which the dashboard ignores), retention `15d` and `--storage.tsdb.retention.size=2GB`, bound to `127.0.0.1:9090`;
  - `grafana/grafana-oss` with provisioning (`docker/grafana/provisioning/datasources/prometheus.yml`, `…/dashboards/opsgraph.yml`) and the dashboard `docker/grafana/dashboards/opsgraph-api.json`, bound to `127.0.0.1:3001`, admin password from a secret file; anonymous access off;
  - access through an SSH tunnel (`ssh -L 3001:127.0.0.1:3001 deploy@<server>`), documented.
- **Dashboard** `opsgraph-api.json` (Grafana schema, datasource as a `${DS_PROMETHEUS}` input so it imports anywhere), with an `env` variable: request rate by route; 5xx ratio; p50/p95/p99 latency by route (`histogram_quantile` over `rate(…_bucket[5m])`) with threshold lines at the SC-010 targets; 429s by policy; DB connections by state vs `opsgraph_db_pool_max`; `opsgraph_db_up`; event-loop lag p99; resident memory; `opsgraph_build_info` table (which version runs where); error reports by outcome.
- **Alternative documented** in `docs/operations/monitoring.md`: Grafana Cloud's free tier with a remote-write agent instead of local Prometheus/Grafana (no server memory used; check its current free limits).

**Rationale**: monitoring tools cost about 1.5 GB of memory; the free server has room, but smaller providers may not, so they stay optional (spec Assumptions). Binding to localhost keeps them off the internet without another login system.

**Alternatives rejected**: exposing Grafana through the edge with its own login (another internet-facing login to protect); node-exporter/cAdvisor by default (useful, but optional extras listed in the guide).

---

## R13. Error-tracking integration point

**Decision**: an `ErrorReporter` provider (`common/observability/error-reporter.ts`) with `capture(error, context)`, called by `AllExceptionsFilter` for unexpected errors (the two existing `logger.error` paths: unknown exceptions and `HttpException` ≥ 500) and by the process-level handlers (R10).

- **Off by default**: with no `ERROR_TRACKING_DSN`, `capture` does nothing: no network call, no metric (the error is already logged by the filter).
- **When configured**: a built-in sender for the **Sentry envelope protocol**, which hosted Sentry, self-hosted GlitchTip and Bugsink all accept, using Node's global `fetch` (no SDK):
  - DSN `https://<publicKey>@<host>/<projectId>` → `POST https://<host>/api/<projectId>/envelope/`, header `X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<publicKey>, sentry_client=opsgraph/<version>`;
  - event: `event_id` (uuid without dashes), `timestamp`, `platform: node`, `level: error`, `environment` (`DEPLOY_ENV`), `release` (`APP_VERSION`), `transaction` (route pattern), `tags { correlationId, route, method }`, `user { id }` when known, `exception.values[0] { type, value (scrubbed), stacktrace.frames }` (frames parsed from the V8 stack by a pure function, oldest first);
  - never request bodies, headers, cookies, query strings or settings; message and stack go through value scrubbing (R10);
  - `ERROR_TRACKING_TIMEOUT_MS` (default 2,000) with `AbortSignal.timeout`; fire-and-forget (the response is never delayed); at most `ERROR_TRACKING_MAX_PER_MINUTE` (default 30) events, excess `dropped`; `ERROR_TRACKING_SAMPLE_RATE` (default 1.0, deterministic sampling is not needed for errors). Failures increment `failed` and log `warn` once per minute.
- Web-side error tracking: out of scope (spec).

**Rationale**: the spec asks for an integration point, off by default. A 100-line sender for a widely accepted open protocol gives a working integration with free options (GlitchTip self-hosted, Sentry's free developer tier) without adding an SDK that instruments the whole process.

**Alternatives rejected**:
- **`@sentry/nestjs` / `@sentry/node`**: large dependency, auto-instrumentation and monkey-patching enabled by default; can replace the sender later behind the same interface.
- **Only an interface with no implementation**: "integration point" would not be testable end to end (FR-043).

---

## R14. Backups, off-site copies and restore

**Decision**: host-side shell scripts run by **systemd timers** (not containers, so they survive a broken Compose project), all under `deploy/bin/`, sharing `deploy/bin/lib.sh` (logging as JSON lines, locking, Compose wrappers, heartbeat).

- **`backup.sh <env> <kind>`** (`kind` ∈ `daily | weekly | pre-deploy | manual`; the daily timer passes `weekly` on Sundays):
  1. take the environment lock (re-entrant when called from `deploy.sh`);
  2. refuse if free space on the backup filesystem is below 15% (FR-034);
  3. `docker compose -p opsgraph-<env> exec -T db pg_dump -U opsgraph -d opsgraph --format=custom --compress=6 --no-owner --no-privileges` to `backups/<env>/<env>-<UTC yyyymmddTHHMMSSZ>-<kind>.dump.partial`, then rename;
  4. verify: `pg_restore --list` (run in a throwaway `postgres:16-alpine` container) exits 0 and lists `audit_entries` data;
  5. `sha256sum` → `.sha256`; manifest `.json` (data-model §3: environment, kind, times, size, sha256, release sha, applied migration names from `_prisma_migrations`, Postgres server version);
  6. retention: production keeps 7 newest `daily`, 4 newest `weekly`, 5 newest `pre-deploy`, 5 newest `manual`; staging keeps 3 `daily` (no weekly, no pre-deploy);
  7. production with `OFFBOX_ENABLED=true`: copy the dump and its manifest with **rclone** (`rclone/rclone` image, multi-arch) to a **crypt** remote layered on the S3-compatible endpoint of the object store (OCI: `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`, Customer Secret Key). Content and file names are encrypted on the server before upload; `rclone delete --min-age 30d` enforces off-site retention (an object-store lifecycle rule is the documented belt-and-braces). rclone's config (with the obscured crypt passwords) lives in `/opt/opsgraph/env/rclone.conf` (0600); the crypt passphrase and salt must **also** be stored outside the server (password manager), or off-site copies are unreadable after a server loss (runbook);
  8. heartbeat: on success `curl -fsS -m 10 --retry 3 "$HEARTBEAT_URL_BACKUP_<ENV>"`; on failure `…/fail` (healthchecks-style URLs; any free cron monitor works); unset = no call;
  9. append a JSON line to `logs/jobs.jsonl` (job, env, kind, outcome, duration, file, size).
- **Timers** (`deploy/systemd/`, installed by the setup script, all `Persistent=true`, UTC): `opsgraph-backup@production.timer` daily 02:30, `opsgraph-backup@staging.timer` daily 03:15, `opsgraph-restore-drill.timer` Sundays 04:00, `opsgraph-prune.timer` daily 05:00 (prunes bundles, images and build cache beyond the last 5 releases, and Docker logs are already rotated). Each `.service` runs as `deploy` with `Nice=10`, `IOSchedulingClass=idle`.
- **`restore-drill.sh`** (FR-036): picks the newest production backup, checks its checksum, starts `postgres:16-alpine` named `opsgraph-restore-drill` with `--network none`, an anonymous volume and a random password, `pg_restore --exit-on-error --no-owner` into it, then checks: every migration in the manifest is present in `_prisma_migrations` with `finished_at` set and `rolled_back_at` null; tables `users`, `entities`, `relationships`, `source_records`, `audit_entries` exist and are non-empty; the `audit_entries_no_update_delete` and `audit_entries_no_truncate` triggers exist. Removes the container and volume (`docker rm -fv`) in a `trap`. Appends the result (data-model §3) to `logs/restore-drill.jsonl`, heartbeat as above. Exit code 0 only if every check passes.
- **`restore.sh <env> --backup <file|latest> [--from-env <env>] --confirm <env>`** (FR-037): checksum; refuse when the backup's migration list contains a migration absent from the target's current release bundle (backup is newer); lock; `docker compose stop api-blue api-green` (users see the API unavailable: restoring is not zero-downtime by nature); `dropdb`/`createdb` (dropping avoids the append-only `TRUNCATE` trigger and leftover objects) then `pg_restore --exit-on-error --no-owner --single-transaction`; `run --rm migrate` (forward to the release's migrations); start the active colour, wait ready; `docker compose run --rm migrate node dist/cli/record-restore.js --backup <name> --sha256 <hash> --taken-at <ts> --operator "$SUDO_USER|$USER"` writes the `ops.database_restored` audit row (actor type `system`, metadata includes operator name, source environment, backup file, checksum, taken-at, restored-at); log line and heartbeat. Restoring a production backup into staging requires `--from-env production` and prints a data-exposure warning (staging is less protected).
- **CI coverage**: the `stack` job runs `backup.sh ci manual`, then `restore-drill.sh` against that backup (drill target overridable with `--env ci`), and a negative check (a truncated copy must make the drill fail).

**Rationale**: logical `pg_dump` backups are portable across hosts and Postgres minor versions and small at MVP sizes (tens of MB for 50k entities). systemd timers are always present on Ubuntu, persistent across reboots, and log to journald. rclone crypt gives client-side encryption to any S3-compatible free store with one container image.

**Alternatives rejected**:
- **WAL archiving / point-in-time recovery (pgBackRest, wal-g)**: more moving parts, continuous storage traffic; RPO 24 h accepted (spec).
- **Block-volume snapshots**: provider-specific (breaks FR-004) and not application-consistent without coordination.
- **A backup sidecar container with cron**: dies with the Compose project; host timers are more robust and visible.
- **Encrypting with gpg/age before rclone**: works, but rclone crypt does it in the same step with no extra tool.

---

## R15. First Administrator, demo seed and server commands

**Decision**: commands compiled into the API image under `dist/cli/` (from `apps/api/src/cli/`), each a small standalone script using the settings parser (R7) and Prisma (not the Nest HTTP app):

| Command | Purpose | Guard |
|---|---|---|
| `node dist/cli/migrate.js` | resolve settings (incl. `*_FILE`), run `prisma migrate deploy` with `DATABASE_URL` in the child environment, print the applied migration names | — |
| `node dist/cli/create-admin.js --email <e> --name <n>` | create an `ADMIN` with a generated one-time password (24 chars, printed once to stdout), `mustChangePassword = true`; audit `user.created` (actor `system`, metadata `{ via: 'cli' }`) in the same transaction | refuses an existing email (exit 3) |
| `node dist/cli/record-restore.js …` | write the `ops.database_restored` audit row (R14) | — |
| `node dist-seed/prisma/seed.js` | the existing demo seed, compiled (`tsconfig.seed.json`, `build:seed` script) | R15 seed guard |
| `node dist/cli/perf-dataset.js` | R17 dataset generator | `DEPLOY_ENV` ∈ `development, test, ci, perf` |

- **Seed guard** (FR-027) replaces `NODE_ENV === 'production'` in `prisma/seed.ts`: refuse when `DEPLOY_ENV` is `production`; when `DEPLOY_ENV` is `staging` or `ci`, require `SEED_PASSWORD` (or `_FILE`) to be set and different from the default. The local `ts-node` seed (`pnpm --filter api prisma db seed`) keeps working unchanged in development.
- Commands run via `docker compose -p opsgraph-<env> run --rm migrate node dist/cli/<command>.js …` (the `migrate` service has the secrets and internal network).

**Rationale**: production must never contain demo accounts (001 spec), so the first Administrator needs its own audited path. Compiling the seed avoids shipping `ts-node` and the TypeScript sources in the runtime image.

**Alternatives rejected**:
- **Bootstrap admin from environment variables at startup**: credentials in settings files, and a hidden mutation at every start.
- **Running the seed with `ts-node` in the image**: ships dev dependencies and sources.

---

## R16. Browser journey tests (Playwright)

**Decision**:
- New workspace package `e2e/` (`@opsgraph/e2e`, added to `pnpm-workspace.yaml`), devDependency `@playwright/test`; `playwright.config.ts` with `baseURL` from `E2E_BASE_URL` (default `http://localhost:8080`, the CI edge), one project `chromium`, `retries: process.env.CI ? 1 : 0`, `workers: 1` (one shared database), `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`, `timeout: 60_000`. Script `test:browser` (not `test`, so `pnpm -r test` does not start browsers). Root script `test:browser` → `pnpm --filter @opsgraph/e2e test:browser`. Browsers installed in CI with `pnpm --filter @opsgraph/e2e exec playwright install --with-deps chromium`.
- **Journey** `e2e/tests/core-journey.spec.ts` (one serial `describe`, two browser contexts: analyst and manager), values taken from 005/006/007 fixtures (referenced, not invented):
  1. analyst signs in (`analyst@opsgraph.local`, `E2E_SEED_PASSWORD`);
  2. opens **Entities**, searches `18492`, opens **Order #18492** (Entity 360);
  3. reads the Blockers/Root cause section: blocked, root cause **Budget Code Missing** on "Budget code for Order #18492", confidence **HIGH** (005 fixture R5) and the path text;
  4. reads the Impact section: the affected counts and exposure of 006's fixture for Order #18492's root cause;
  5. creates an exception from the root cause (007 story 1): the form lists the existing unresolved EX-10001 first (007 seed); title prefilled; severity Critical; submits; a new `EX-1000N` page opens with status **Open**;
  6. **Assign** to themselves; status still Open, owner = analyst;
  7. **Start work** then **Resolve** with note "Budget code BC-7781 supplied (e2e)"; status **Resolved**;
  8. manager context signs in, opens the exception, **Verify**; status **Verified**;
  9. **History** tab lists created (analyst), assigned (analyst), status changes (analyst), resolved (analyst), verified (manager) in order.
- **Selectors**: accessible roles, labels and visible text only (`getByRole`, `getByLabel`, `getByText`); no CSS selectors. If a needed element has no accessible name in 004–007's UI, add an `aria-label` (not test ids) and note it in the task.
- **Environment**: the `stack` job (R5) on the production images behind the CI edge, after `migrate` and the compiled seed with `DEPLOY_ENV=ci`. The risk scheduler stays on (production-like). Locally: `docker compose -p opsgraph-local -f docker-compose.prod.yml -f docker-compose.ci.yml …` (quickstart).
- **Artifacts on failure**: `e2e/playwright-report/`, `e2e/test-results/` (traces, screenshots, videos), `docker compose logs --no-color` for all services.

**Rationale**: the user asked for Playwright. Running against the production images and edge config proves the deployable artefacts, not the dev server (FR-039). Role-based selectors keep the test aligned with accessibility.

**Alternatives rejected**: Cypress (single-browser-context model makes the two-user step awkward); running Playwright against `vite dev` (would not test images, CSP or routing).

---

## R17. Load test and 50k dataset

**Decision**:
- **Tool**: **k6**, run from the official `grafana/k6` container image (no npm dependency; JavaScript scenarios; built-in thresholds and percentiles). Scripts in `loadtest/k6/` (ES modules for k6's runtime, excluded from ESLint and TypeScript; validated with `k6 inspect` in CI).
- **`loadtest/k6/opsgraph-load.js`** (FR-040, SC-010):
  - `setup()`: `GET /api/health/live` and **abort when `environment` is `production`** (US7 AS2); log in once per user listed in `LOADTEST_USERS` (default the three seeded accounts, password from `LOADTEST_PASSWORD`), so only 3 sign-ins happen (within the login limit); load the dataset manifest (`MANIFEST` path, `open()`), or in smoke mode resolve Order #18492's id through `GET /api/search`.
  - `full` mode: `ramping-vus` 0 → 20 in 1 min, 20 for 5 min, down in 30 s; each iteration picks a request by weight and sleeps 1 s ± 0.5 s:

    | Kind (tag `kind`) | Request | Weight | Threshold p(95) |
    |---|---|---|---|
    | `overview` | `GET /api/overview` | 20% | < 2,000 ms (010 SC-005) |
    | `blockers` | `GET /api/entities/:id/blockers` (chain heads, 6 hops) | 25% | < 1,000 ms (003 SC-003) |
    | `dependencies` | `GET /api/entities/:id/dependencies` first page, default depth | 15% | < 2,000 ms (003 SC-004) |
    | `root_cause` | `GET /api/entities/:id/root-cause` (chain heads) | 20% | < 1,500 ms (005 SC-003) |
    | `impact` | `GET /api/entities/:id/impact` (the 2,000-entity hub and others) | 20% | < 2,000 ms (006 SC-003) |

    plus `http_req_failed < 1%` and `checks > 99%`. `handleSummary` writes `summary.json` and a Markdown table (kind, p50, p95, target, pass/fail) for the release notes.
  - `smoke` mode (CI): 2 VUs for 30 s on the seeded reference data; thresholds: `http_req_failed < 1%` only.
- **`loadtest/k6/availability.js`** (R6): constant 5 requests per second during redeploys; thresholds `http_req_failed == 0`.
- **Dataset generator** `apps/api/src/cli/perf-dataset.ts` (compiled, R15): deterministic set-based SQL in one transaction per table group, ids `md5('perf-…' || g)::uuid`, reusing the shapes of the existing `perf-graph`/`perf-tracing` e2e suites and of 005/006/010's performance plans: 50,000 entities across the MVP types with provenance (source records, identifiers, state observations), ≥ 150,000 relationships, 500 blocking chains 6 hops deep, a supplier hub whose impact reaches ≥ 2,000 entities, 10,000 exceptions, 10,000 investigations, 10,000 open risks plus one completed risk evaluation; refuses unless `DEPLOY_ENV` ∈ `development, test, ci, perf` and refuses a database that already contains non-generated entities (unless `--allow-existing`); prints the manifest JSON (chain heads, hub ids, counts) to stdout. It inserts rows only (no traversal SQL; Constitution: traversal stays in `GraphRepository`). After generation, the operator triggers a risk evaluation and an overview snapshot through the API (quickstart).
- **Where the full test runs** (spec Assumptions): `.github/workflows/load-test.yml` (`workflow_dispatch`) on an `ubuntu-latest` runner with the production-like stack (`DEPLOY_ENV=perf`), uploading the summary; or on the server in a throwaway project `opsgraph-perf` (staging stopped during the run to avoid sharing CPU with it; production keeps running and is never targeted). Results are recorded in quickstart.md § 4.

**Rationale**: k6 is free, runs anywhere Docker runs, and expresses percentile targets as pass/fail thresholds. Reusing the perf suites' SQL shapes keeps "50k entities" consistent across features.

**Alternatives rejected**: `autocannon` (single-URL focus, no scenario mix or per-tag thresholds); Artillery (npm dependency, heavier); Locust (Python toolchain); JMeter (heavy, GUI-oriented).

---

## R18. Health and version

**Decision**:
- `HealthLive` gains `environment` (`DEPLOY_ENV`); `version` becomes `APP_VERSION` when set (the commit sha), else the package version.
- `HealthReady` gains `checks.shutdown: 'running' | 'draining'`; status 503 when the database is down **or** draining.
- Docker healthcheck uses `/api/health/live` (a draining instance must not be restarted); the edge and `deploy.sh` use `/api/health/ready`.

**Rationale**: the deployment's final check (R6 step 9) and the load test's production guard (R17) both need version and environment from outside; readiness must reflect draining for the zero-downtime switch.

**Alternatives rejected**: a separate `/api/version` route (one more endpoint for data the health page already carries).

---

## R19. Documentation deliverables

**Decision**: `docs/operations/` (operator language, every procedure with "expected result" and "check"):
- `server-setup.md`: Oracle Cloud (account and home region, Pay-As-You-Go upgrade recommended to avoid idle reclamation of Always Free instances while staying within free limits, budget alert, VCN wizard, security list ingress 80/tcp, 443/tcp, 443/udp and 22/tcp, A1 instance 4/24, Ubuntu 24.04 aarch64, "out of host capacity" retries, host `iptables` rules on Oracle's Ubuntu images, Object Storage bucket + Customer Secret Key + lifecycle rule); any other VPS; DNS (A/AAAA records for both hosts, optional CAA); running `setup-vm.sh`; first secrets; GitHub environments, secrets and package visibility; first deployment; first Administrator.
- `configuration.md`: every setting and secret (contracts/configuration.md), storage, rotation.
- `runbook.md`: deploy, promote, roll back, restore (staging, production, from off-site), review restore drills, rotate each secret (JWT, database password, rclone/object-store keys, GitHub deploy key, Grafana admin, error-tracking DSN), certificates (normally automatic; what to check when issuance fails), disk space, server reboot, moving providers, incident checklist (site down, 5xx spike, slow responses, database down, disk full, certificate expiry, suspected credential leak, data corruption) with the exact commands and the dashboard panels to look at.
- `monitoring.md`: metrics list, starting the optional stack, tunnel, dashboard import, Grafana Cloud alternative, heartbeat monitors.
- `migrations.md`: expand-then-contract rules and examples (R6).
- `README.md` (root): a short "Production" section linking these.

---

## R20. Testing strategy

| Level | What | Where |
|---|---|---|
| Vitest (shared) | `ErrorCodeSchema` has `RATE_LIMITED`; error body `retryAfterSeconds`; health schemas; `METRIC_NAMES`; `AUDIT_ACTIONS.OPS_DATABASE_RESTORED` | `packages/shared/src/*.spec.ts` |
| Jest unit (api) | `parseEnv` (every rule of R7, `*_FILE`, conflicts, production refusals, URL parameters); `scrub`; `JsonLogger` output shape; route-label and status-class derivation; rate-limit policy table and tracker; error-event builder, DSN parser, V8 stack parser, per-minute cap; DB-pool row mapping; `ShutdownService` (fake timers); `create-admin` argument parsing | next to the code |
| Jest e2e (api) | `rate-limit.e2e-spec.ts` (each policy, 429 body + `Retry-After`, no audit row, separate addresses, reads never limited); `proxy-trust.e2e-spec.ts`; `security-headers.e2e-spec.ts` (2xx, 401, 404, 429, 500 via a test-only controller registered in the testing module); `cors.e2e-spec.ts`; `metrics.e2e-spec.ts` (content after requests, token, not under `/api`, bounded `UNMATCHED`); `logging.e2e-spec.ts` (stdout capture during login, refresh, a 500: no secret, password, token, cookie or authorization value; one access line per request with the response's correlation id); `error-reporter.e2e-spec.ts` (local HTTP sink as DSN: one event for a 500, none for 400/404/429; none without DSN); `health.e2e-spec.ts` (+ version, environment, draining); `create-admin.e2e-spec.ts`; `authz-matrix` + `/metrics` row | `apps/api/test/` |
| Vitest (web) | `apiFetch` 429 mapping; `LoginPage` message; preload-error reload guard | next to the code |
| Node test | `scripts/check-migrations.mjs` against fixtures (each refused pattern, marker, baseline, warnings) | `scripts/` |
| Playwright | core journey (R16) | `e2e/` |
| Stack checks (CI) | k6 smoke; availability during two colour switches; backup + restore drill + negative drill; `docker compose config`, `caddy validate`, `nginx -t`, `promtool`, `shellcheck`, `k6 inspect` | `ci.yml` |
| Manual (quickstart) | first deploy on the real server, promotion, rollback, restore into staging, JWT rotation, header scanner grade, full load test | quickstart.md |

---

## R21. Dependencies

**Decision** (each one justified; nothing else may be added):

| Package / artefact | Where | Why it is required | Alternatives |
|---|---|---|---|
| `@nestjs/throttler` ^6 | `apps/api` dependencies | Rate limiting as a Nest guard with per-route policies (R8) | `express-rate-limit` (not guard-aware), custom limiter (re-implements storage and windows) |
| `helmet` ^8 | `apps/api` dependencies | Standard, maintained security headers (R9) | hand-written middleware (accepted alternative, rejected for maintenance) |
| `prom-client` ^15 | `apps/api` dependencies | Prometheus exposition format, histograms, default process metrics (R11) | Nest wrapper (extra package), OpenTelemetry (several packages + collector) |
| `prisma` (moved, not new) | `apps/api` dependencies (was devDependencies) | `prisma migrate deploy` from the runtime image (R2, R6) | separate tools image |
| `@playwright/test` ^1 | `e2e` devDependencies | Browser journey (R16), requested by the user | Cypress |
| Container images (not npm): `node:22-bookworm-slim`, `nginxinc/nginx-unprivileged:1.27-alpine`, `caddy:2`, `postgres:16-alpine` (existing), `rclone/rclone`, `grafana/k6`, `prom/prometheus` and `grafana/grafana-oss` (optional) | compose files, CI | runtime and tooling; all free, multi-arch | — |
| GitHub Actions: `docker/setup-qemu-action@v3`, `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/build-push-action@v6`, `docker/metadata-action@v5`, `actions/upload-artifact@v4` | workflows | multi-arch builds and artifacts (R5) | — |

No logging library, no Sentry SDK, no SSH action, no load-test npm package.
