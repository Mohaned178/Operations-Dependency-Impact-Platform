# Quickstart: Production Hardening and Free-Tier Deployment

**Feature**: `011-production-hardening`

Use this to check the feature by hand after implementation. Features 004–010 must already be merged (plan.md § Prerequisites). Exact contracts are in [contracts/](./contracts/). The automated gate covers sections 1–3; sections 4–6 need the real server.

## 1. Gates (local)

```bash
pnpm install
pnpm --filter @opsgraph/shared build
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e     # includes rate-limit, headers, CORS, metrics, logging, error-reporter suites
pnpm check:migrations                                         # "0 violations" (baseline = newest migration at merge time)
shellcheck deploy/bin/*.sh
```

## 2. Production-like stack on your machine

```bash
docker build -f docker/api/Dockerfile --build-arg APP_VERSION=$(git rev-parse HEAD) -t opsgraph-api:ci .
docker build -f docker/web/Dockerfile -t opsgraph-web:ci .
export OPSGRAPH_ROOT=$PWD/.local-ops                          # git-ignored throwaway root
deploy/bin/dev-root.sh                                        # creates the CI-style root: env files, random secrets, edge network
deploy/bin/deploy.sh ci "$(git rev-parse HEAD)" --no-pull --apply-edge
docker compose -p opsgraph-ci -f docker-compose.prod.yml -f docker-compose.ci.yml run --rm migrate node dist-seed/prisma/seed.js

curl -s localhost:8080/api/health/live | jq                   # { status: "ok", version: "<sha>", environment: "ci" }
curl -sI localhost:8080/ | grep -iE 'content-security|x-frame|referrer|permissions'
curl -sI localhost:8080/api/health/live | grep -iE 'content-security|x-content-type|cache-control'
curl -s localhost:8080/metrics | head -3                      # the SPA's HTML, NOT metrics (not routed)
docker compose -p opsgraph-ci exec api-blue node -e "fetch('http://127.0.0.1:3000/metrics').then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>l.startsWith('opsgraph_build_info'))))"

# Rate limit: the 11th login in a minute is refused
for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code} ' localhost:8080/api/auth/login \
  -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"wrong-password-1"}'; done; echo
# 401 ×10, then 429; the 429 body has "RATE_LIMITED" and retryAfterSeconds

# Logs: JSON, correlation id, no secrets
docker compose -p opsgraph-ci logs api-blue --no-log-prefix | tail -3 | jq -c '{level,msg,correlationId,http}'
```

`deploy/bin/dev-root.sh` is the helper the CI `stack` job uses to prepare `OPSGRAPH_ROOT` (it generates random secrets and never touches `/opt/opsgraph`).

## 3. Browser journey, smoke load, zero-downtime and backup checks

```bash
E2E_BASE_URL=http://localhost:8080 E2E_SEED_PASSWORD=<seed password from the dev root> pnpm test:browser
docker run --rm --network host -v "$PWD/loadtest:/scripts" -e BASE_URL=http://localhost:8080 -e MODE=smoke \
  -e LOADTEST_PASSWORD=<seed password> grafana/k6 run /scripts/k6/opsgraph-load.js
# zero downtime: in one terminal run availability.js, in another redeploy twice
docker run --rm --network host -v "$PWD/loadtest:/scripts" -e BASE_URL=http://localhost:8080 grafana/k6 run /scripts/k6/availability.js &
deploy/bin/deploy.sh ci "$(git rev-parse HEAD)" --no-pull && deploy/bin/deploy.sh ci "$(git rev-parse HEAD)" --no-pull; wait
# k6 reports http_req_failed 0.00%
deploy/bin/backup.sh ci manual && deploy/bin/restore-drill.sh --env ci        # outcome "passed"
```

## 4. Load test at 50,000 entities (on demand)

Run the `load-test` workflow (Actions → load-test → Run workflow), or locally with `DEPLOY_ENV=perf`:

```bash
docker compose -p opsgraph-ci … run --rm -e DEPLOY_ENV=perf migrate node dist/cli/perf-dataset.js > loadtest/results/manifest.json
# trigger one risk evaluation and one overview snapshot as the admin (009 / 010 routes), then:
docker run --rm --network host -v "$PWD/loadtest:/scripts" -e BASE_URL=http://localhost:8080 -e MODE=full \
  -e MANIFEST=/scripts/results/manifest.json -e LOADTEST_PASSWORD=<pw> grafana/k6 run /scripts/k6/opsgraph-load.js
```

| Measurement (20 VUs, 5 min, 50k entities) | Target (SC-010) | GitHub runner | Free ARM server (`opsgraph-perf`, staging stopped) |
|---|---|---|---|
| `GET /api/overview` p95 | < 2 s | _fill in_ | _fill in_ |
| `GET /api/entities/:id/blockers` p95 | < 1 s | _fill in_ | _fill in_ |
| `GET /api/entities/:id/dependencies` first page p95 | < 2 s | _fill in_ | _fill in_ |
| `GET /api/entities/:id/root-cause` p95 | < 1.5 s | _fill in_ | _fill in_ |
| `GET /api/entities/:id/impact` p95 | < 2 s | _fill in_ | _fill in_ |
| failed requests | < 1% | _fill in_ | _fill in_ |
| full restore of the 50k database (SC-004) | < 30 min | _fill in_ | _fill in_ |

## 5. First deployment on the free server (manual, once)

Follow `docs/operations/server-setup.md`. Expected checkpoints:

1. Oracle Cloud: instance `VM.Standard.A1.Flex` 4 OCPU / 24 GB, Ubuntu 24.04 aarch64, ingress 80/tcp, 443/tcp, 443/udp, 22/tcp; `ssh ubuntu@<ip>` works.
2. DNS: `dig +short ops.example.com` and `staging.ops.example.com` return the server IP.
3. `sudo ./setup-vm.sh --deploy-user deploy --ci-pubkey ci_deploy.pub` ends with "setup complete"; `systemctl list-timers 'opsgraph-*'` lists 4 timers.
4. Fill `/opt/opsgraph/env/*.env` from `deploy/env/*.env.example`; secrets were generated by the setup script.
5. GitHub: environments `staging` and `production` with the 4 SSH secrets; variables `STAGING_URL`, `PRODUCTION_URL`; packages public (recommended) after the first `publish`.
6. Merge to `main`: CI green, then `cd-staging` deploys; `curl -s https://staging.ops.example.com/api/health/live` shows the commit. Load the demo seed on staging (runbook § Staging data).
7. Run `deploy-production` with that sha; production shows the same version. `ls /opt/opsgraph/backups/production` shows a `pre-deploy` backup.
8. Create the first Administrator: `docker compose -p opsgraph-production run --rm migrate node dist/cli/create-admin.js --email you@example.com --name "You"`; sign in, change the password; the audit page shows `user.created` by System.
9. A public security-header scanner rates `https://ops.example.com` A or better (SC-006).

## 6. Runbook drills on the server (SC-003, SC-004, SC-012)

- Roll back production with the `rollback` workflow: previous version serving in < 10 minutes.
- `sudo -u deploy /opt/opsgraph/bin/backup.sh production manual`, then `restore.sh staging --backup latest --from-env production --confirm staging`: staging shows production's data; the audit page shows `ops.database_restored`.
- Rotate the JWT secret (runbook): a user signed in before the rotation is not signed out.
- After a Sunday, `tail -1 /opt/opsgraph/logs/restore-drill.jsonl | jq .outcome` → `"passed"`.
- Optional: `docker compose -p opsgraph-monitoring -f docker-compose.monitoring.yml up -d`, tunnel `ssh -L 3001:127.0.0.1:3001 deploy@<server>`, open Grafana, dashboard "OpsGraph API" shows data on every panel.
