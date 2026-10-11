# Data Model: Production Hardening and Free-Tier Deployment

**Feature**: `011-production-hardening` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## §0 Summary

**No database schema change and no migration.** This feature adds no table, column, enum or index. Everything it persists in the database goes through existing tables:

- `audit_entries`: two new uses (§2c), written with the existing `AuditService`.
- `_prisma_migrations`: read (backups record the applied migration names; the restore drill checks them).

What it adds:
- shared schema and constant changes (§1, §2);
- internal types of the new server modules (§3);
- **files on the server** with fixed formats: backup manifests, release records, active state, job and drill logs (§4);
- the deployment state machine (§5).

Because no migration is added, the expand-then-contract baseline (research R6) is the newest migration present when this feature merges (expected: the 010 migration `<timestamp>_overview_search`).

---

## §1 Shared schemas (`packages/shared/src`)

### §1a `common.ts`

```ts
export const ErrorCodeSchema = z.enum([
  'VALIDATION_FAILED', 'INVALID_CREDENTIALS', 'UNAUTHENTICATED', 'PASSWORD_CHANGE_REQUIRED',
  'FORBIDDEN', 'NOT_FOUND', 'EMAIL_TAKEN', 'LAST_ADMIN', 'IMPORT_TOO_LARGE', 'INTERNAL',
  // … codes added by 004–010 stay as they are …
  'RATE_LIMITED',                                     // NEW (429)
]);

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    retryAfterSeconds: z.number().int().positive().optional(),   // NEW: only with RATE_LIMITED
    correlationId: z.string(),
  }),
});
```

Rule (unit-tested): `retryAfterSeconds` is present **iff** `code === 'RATE_LIMITED'` (a `superRefine`).

### §1b `health.ts`

```ts
export const DEPLOY_ENVS = ['development', 'test', 'ci', 'perf', 'staging', 'production'] as const;
export const DeployEnvSchema = z.enum(DEPLOY_ENVS);

export const HealthLiveSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),            // APP_VERSION (commit sha) or package version
  environment: DeployEnvSchema,   // NEW
});

export const HealthReadySchema = z.object({
  status: z.enum(['ok', 'error']),
  version: z.string(),
  checks: z.object({
    database: z.enum(['up', 'down']),
    shutdown: z.enum(['running', 'draining']),   // NEW
  }),
});
```

`status = 'ok'` iff `database = 'up'` and `shutdown = 'running'`; HTTP 200 for `ok`, 503 otherwise.

### §1c `observability.ts` (NEW, exported from `index.ts`)

```ts
export const METRIC_NAMES = {
  HTTP_REQUESTS_TOTAL: 'opsgraph_http_requests_total',
  HTTP_REQUEST_DURATION_SECONDS: 'opsgraph_http_request_duration_seconds',
  HTTP_SERVER_ERRORS_TOTAL: 'opsgraph_http_server_errors_total',
  RATE_LIMITED_TOTAL: 'opsgraph_rate_limited_total',
  ERROR_REPORTS_TOTAL: 'opsgraph_error_reports_total',
  DB_CONNECTIONS: 'opsgraph_db_connections',
  DB_POOL_MAX: 'opsgraph_db_pool_max',
  DB_UP: 'opsgraph_db_up',
  DB_PROBE_SECONDS: 'opsgraph_db_probe_seconds',
  BUILD_INFO: 'opsgraph_build_info',
} as const;

export const METRICS_DEFAULT_PREFIX = 'opsgraph_';
export const HTTP_DURATION_BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 10] as const;
export const UNMATCHED_ROUTE = 'UNMATCHED';

export const RATE_LIMIT_POLICIES = ['login-minute', 'login-hour', 'refresh', 'password-change', 'import', 'write'] as const;
export const RateLimitPolicySchema = z.enum(RATE_LIMIT_POLICIES);

export const MetricsQuerySchema = z.object({}).strict();   // GET /metrics takes no parameters
```

The response of `/metrics` is Prometheus text, not JSON; its content is checked by parsing in `metrics.e2e-spec.ts` (Complexity Tracking in plan.md).

### §1d `audit.ts`

```ts
OPS_DATABASE_RESTORED: 'ops.database_restored',   // NEW
```

`user.created` is reused by `create-admin` (metadata `{ via: 'cli' }`).

---

## §2 Audit rows

| Action | Written by | actorType / actorId | targetType / targetId | before | after | metadata |
|---|---|---|---|---|---|---|
| `user.created` | `dist/cli/create-admin.js`, same transaction as the insert | `system` / null | `user` / new id | null | public user (redacted) | `{ via: 'cli' }` |
| `ops.database_restored` | `dist/cli/record-restore.js`, after the restore, migrations and restart | `system` / null | `database` / `<DEPLOY_ENV>` | null | `{ backup, sha256, takenAt, sourceEnvironment, migrationCount }` | `{ operator, restoredAt, release }` |

Rate-limit refusals, deployments, rollbacks, backups and drills write **no** audit row (spec FR-018, FR-042): they are recorded in the server's logs (§4).

---

## §3 Internal types (`apps/api/src`)

### §3a Settings (`config/env.ts`)

```ts
interface EnvConfig {
  // existing (001, 009, 010) … unchanged names and defaults
  NODE_ENV: 'development' | 'test' | 'production';
  DEPLOY_ENV: DeployEnv;                 // required when NODE_ENV = production
  APP_VERSION: string | undefined;
  DATABASE_URL: string;                  // after *_FILE resolution and parameter completion
  databasePoolMax: number;               // connection_limit from the URL (default appended: 10)
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_SECRET_PREVIOUS: string | undefined;
  TRUST_PROXY: string;                   // 'loopback' | IP | CIDR list, passed to Express
  CORS_ORIGINS: readonly string[];       // exact https:// origins; empty = CORS off
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
  LOG_FORMAT: 'json' | 'pretty';
  rateLimit: { enabled: boolean; policies: Record<RateLimitPolicy, { limit: number; ttlMs: number }> };
  METRICS_ENABLED: boolean;
  METRICS_TOKEN: string | undefined;
  errorTracking: { dsn: ParsedDsn | undefined; timeoutMs: number; maxPerMinute: number; sampleRate: number };
  SHUTDOWN_DRAIN_MS: number;
  SHUTDOWN_TIMEOUT_MS: number;
  hstsEnabled: boolean;                  // DEPLOY_ENV ∈ {staging, production}
  secretValues: readonly string[];       // for log value scrubbing (never logged themselves)
}
```

`parseEnv(source, readFile): EnvConfig` is pure (no `process.exit`); `env.ts` calls it once and on failure prints `Invalid configuration: <VAR>: <rule>` lines (no values) and exits 1. Every rule is in contracts/configuration.md.

### §3b Log record (`common/observability/log-record.ts`)

```ts
interface LogRecord {
  time: string;            // ISO-8601 UTC with milliseconds
  level: 'error' | 'warn' | 'info' | 'debug';
  msg: string;             // scrubbed
  component: string;       // Nest context, e.g. 'AuthService', 'http', 'RiskScheduler'
  env: DeployEnv;
  version: string;
  correlationId?: string;
  userId?: string;
  err?: { type: string; message: string; stack?: string };   // stack only for unexpected errors
  http?: { method: string; route: string; status: number; durationMs: number; ip: string; bytes: number };
  data?: Record<string, JsonValue>;                           // redacted structured context
}
```

### §3c Rate-limit policy (`common/security/rate-limit.policies.ts`)

```ts
interface RateLimitPolicyDef {
  name: RateLimitPolicy;
  key: 'ip' | 'user' | 'user-or-ip';
  limit: number;   // from settings
  ttlMs: number;
}
// Route assignment: decorator metadata first; otherwise 'write' for POST/PUT/PATCH/DELETE under /api;
// none for GET/HEAD/OPTIONS, /api/health/*, /metrics, POST /api/auth/logout.
```

### §3d Error event (`common/observability/error-event.ts`)

```ts
interface ParsedDsn { publicKey: string; host: string; projectId: string; envelopeUrl: string }
interface ErrorEvent {
  event_id: string;               // 32 hex chars
  timestamp: number;              // seconds, fractional
  platform: 'node';
  level: 'error';
  environment: DeployEnv;
  release: string;
  transaction?: string;           // route pattern
  tags: { correlationId?: string; route?: string; method?: string };
  user?: { id: string };
  exception: { values: [{ type: string; value: string; stacktrace?: { frames: StackFrame[] } }] };
}
interface StackFrame { filename: string; function?: string; lineno?: number; colno?: number; in_app: boolean }
```

### §3e Shutdown state (`lifecycle/shutdown.service.ts`)

`running → draining → closed`. `draining` starts at SIGTERM/SIGINT; readiness reports it; after `SHUTDOWN_DRAIN_MS` Nest closes the HTTP server; a watchdog exits 1 at `SHUTDOWN_TIMEOUT_MS`.

---

## §4 Server files (formats are contracts; scripts in `deploy/bin/`)

All timestamps UTC ISO-8601. All JSON files are written atomically (write to `.partial`, then rename).

### §4a Backup files (`/opt/opsgraph/backups/<env>/`)

- `<env>-<yyyymmddTHHMMSSZ>-<kind>.dump` (pg_dump custom format), `.sha256` (`sha256sum` format), `.json` manifest:

```json
{
  "format": 1,
  "environment": "production",
  "kind": "daily | weekly | pre-deploy | manual",
  "file": "production-20261008T023000Z-daily.dump",
  "startedAt": "2026-10-08T02:30:00Z",
  "finishedAt": "2026-10-08T02:30:41Z",
  "sizeBytes": 48211234,
  "sha256": "…",
  "release": "<40-char sha of the active release>",
  "postgresVersion": "16.x",
  "migrations": ["20261005122904_init", "…"],
  "verified": true,
  "offsite": { "enabled": true, "outcome": "uploaded | failed | skipped", "remotePath": "…" }
}
```

Retention (newest kept per kind): production `daily` 7, `weekly` 4, `pre-deploy` 5, `manual` 5; staging `daily` 3, `manual` 3. Off-site: 30 days. A backup is refused when free space < 15%.

### §4b Active state (`/opt/opsgraph/state/<env>/active.env`)

```text
RELEASE=<sha>
ACTIVE_COLOR=blue|green
API_BLUE_TAG=sha-<sha>|@sha256:<digest>
API_GREEN_TAG=…
WEB_TAG=…
API_DIGEST=sha256:…
WEB_DIGEST=sha256:…
UPDATED_AT=2026-10-08T10:12:03Z
```

Sourced by Compose (`--env-file`) together with `/opt/opsgraph/env/<env>.env`.

### §4c Release record (`/opt/opsgraph/state/<env>/releases.jsonl`, append-only)

```json
{ "time": "…", "environment": "staging", "action": "deploy | rollback | promote",
  "release": "<sha>", "apiDigest": "sha256:…", "webDigest": "sha256:…",
  "fromRelease": "<sha|null>", "color": "green", "migrationsApplied": ["…"],
  "contractMigration": false, "actor": "github:<run id>:<actor> | <unix user>",
  "outcome": "succeeded | failed | reverted", "failedStep": null, "durationMs": 81234 }
```

`status <env> --has-succeeded <sha>` searches this file for `outcome = succeeded` and `release = <sha>`. Rollback picks the newest `succeeded` record before the current one and refuses if any later record has `contractMigration = true`.

### §4d Job log (`/opt/opsgraph/logs/jobs.jsonl`) and drill log (`restore-drill.jsonl`)

```json
{ "time": "…", "job": "backup | deploy | rollback | restore | prune | offsite", "environment": "production",
  "step": "pg_dump", "level": "info | warn | error", "msg": "…", "durationMs": 1234 }
```

```json
{ "time": "…", "backup": "production-20261011T023000Z-weekly.dump", "durationMs": 95321,
  "outcome": "passed | failed",
  "checks": [ { "name": "checksum", "passed": true }, { "name": "pg_restore", "passed": true },
              { "name": "migrations", "passed": true, "detail": "18/18" },
              { "name": "tables_non_empty", "passed": true },
              { "name": "audit_append_only_triggers", "passed": true } ] }
```

Both files are rotated by `logrotate` (weekly, 12 kept), installed by the setup script.

---

## §5 Deployment state machine (`deploy.sh`, research R6)

```text
LOCKED → IMAGES_RESOLVED → [production: BACKED_UP] → DB_READY → MIGRATED → IDLE_COLOR_READY
       → WEB_SWITCHED → OLD_COLOR_STOPPED → VERIFIED → RECORDED (succeeded)

failure before OLD_COLOR_STOPPED       → stop idle colour, keep old → RECORDED (failed, failedStep)
failure at VERIFIED                    → start old colour, wait ready, stop new, restore web tag → RECORDED (reverted)
rollback                               = deploy with --skip-migrations (no MIGRATED step), action = rollback
```

The lock is held from `LOCKED` to `RECORDED`; backups use the same lock.

---

## §6 Entities (spec Key Entities → this model)

| Spec entity | Representation |
|---|---|
| Environment | Compose project `opsgraph-<env>` + `/opt/opsgraph/{env,secrets,state,backups}/<env>` + edge site block |
| Release | image tags/digests + `active.env` + `releases.jsonl` records |
| Backup | dump + `.sha256` + manifest (§4a), optional off-site copy |
| Restore Drill Result | `restore-drill.jsonl` line (§4d) |
| Rate-limit Policy | `RATE_LIMIT_POLICIES` (§1c) + `RateLimitPolicyDef` (§3c) |
| Log Record | §3b |
| Metric | `METRIC_NAMES` (§1c), contracts/http.md |
| Error Event | §3d |
