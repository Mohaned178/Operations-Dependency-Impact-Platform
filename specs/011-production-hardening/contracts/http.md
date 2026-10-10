# HTTP Contracts: Production Hardening

**Feature**: `011-production-hardening` | Schemas live in `packages/shared/src/{common,health,observability,audit}.ts` (data-model §1). Every new or changed payload is parsed with its shared schema in the e2e tests.

## Routes (new and changed)

| # | Method | Path | Auth | Success | Errors |
|---|---|---|---|---|---|
| 1 | GET | `/metrics` (no `/api` prefix) | public; `Authorization: Bearer <METRICS_TOKEN>` when the token is set | 200 `text/plain; version=0.0.4; charset=utf-8` | 401 `UNAUTHENTICATED` (token set, missing or wrong), 404 (`METRICS_ENABLED=false`) |
| 2 | GET | `/api/health/live` | public | 200 `HealthLive` (+ `environment`, version = commit) | — |
| 3 | GET | `/api/health/ready` | public | 200 `HealthReady` (+ `checks.shutdown`) | 503 `HealthReady` with `status: 'error'` when the database is down or the instance is draining |
| — | every mutating `/api` route | unchanged | unchanged | unchanged | + 429 `RATE_LIMITED` per the policy table |

Route 1 is not routed by the edge (contracts/operations.md § Edge routing); it is reachable only on the private networks.

## Rate limiting

| Policy | Routes | Key | Default |
|---|---|---|---|
| `login-minute` | `POST /api/auth/login` | client IP | 10 per 60 s |
| `login-hour` | `POST /api/auth/login` | client IP | 50 per 3,600 s |
| `refresh` | `POST /api/auth/refresh` | client IP | 30 per 60 s |
| `password-change` | `POST /api/auth/change-password` | user id | 5 per 900 s |
| `import` | `POST /api/imports` (and every other import write route of 002) | user id | 10 per 60 s |
| `write` | every other `POST`/`PUT`/`PATCH`/`DELETE` under `/api` | user id, else client IP | 120 per 60 s |
| — | `GET`, `HEAD`, `OPTIONS`, `/api/health/*`, `/metrics`, `POST /api/auth/logout` | not limited | — |

Both login policies apply; the first exhausted one refuses. Counters are in memory per instance and use fixed windows (`@nestjs/throttler` semantics).

**Refusal** (status 429):

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 37
X-Request-Id: 6f0c…
Content-Type: application/json; charset=utf-8

{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Try again in 37 seconds.",
             "retryAfterSeconds": 37, "correlationId": "6f0c…" } }
```

Nothing is changed, no audit row is written, `opsgraph_rate_limited_total{policy}` increases by 1, one `warn` log line (`msg: "rate limited"`, `data: { policy, keyKind }`).

**Client address**: `req.ip` from `X-Forwarded-For` only when the TCP peer matches `TRUST_PROXY` (production: the edge `172.30.0.2`); otherwise the peer address.

## Correlation reference

- The edge sets `X-Request-Id` to a fresh UUID on every proxied API request (client values are replaced).
- The API uses an incoming UUID `X-Request-Id`, else generates one (001 behaviour, unchanged); it is returned in the `X-Request-Id` response header, in every error body (`correlationId`), in every log line of the request (`correlationId`) and in error events (`tags.correlationId`).
- The edge's JSON access log records the response headers, so the same id links edge and API lines.

## Security headers

`✓` = must be present with exactly this value (tests compare values; Caddy/nginx/helmet defaults that are not listed are allowed).

| Header | API responses (all statuses) | Web responses (HTML, assets, SPA fallback) | Added by edge (both hosts) |
|---|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | — |
| `X-Content-Type-Options` | `nosniff` | `nosniff` | — |
| `X-Frame-Options` | `DENY` | `DENY` | — |
| `Referrer-Policy` | `no-referrer` | `strict-origin-when-cross-origin` | — |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | same | — |
| `Cross-Origin-Opener-Policy` | `same-origin` | `same-origin` | — |
| `Cross-Origin-Resource-Policy` | `same-origin` | — | — |
| `Cache-Control` | `no-store` | `index.html` and fallback: `no-cache`; `/assets/*`: `public, max-age=31536000, immutable` | — |
| `Strict-Transport-Security` | `max-age=31536000` when `DEPLOY_ENV` ∈ {staging, production} | — | `max-age=31536000` |
| `X-Robots-Tag` | — | — | staging host only: `noindex, nofollow` |
| `X-Powered-By`, `Server` | absent | `Server` without version (`server_tokens off`) | `Server` removed |

## CORS

- Default (`CORS_ORIGINS` empty): no `Access-Control-*` header on any response, including preflight `OPTIONS` (which answers 404). Browsers therefore refuse cross-origin reads.
- With `CORS_ORIGINS=https://a.example,https://b.example`:
  - request `Origin` exactly in the list → `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`; preflight answers 204 with `Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE`, `Access-Control-Allow-Headers: content-type,authorization,x-request-id`, `Access-Control-Max-Age: 600`; `Access-Control-Expose-Headers: x-request-id,retry-after`;
  - any other origin → no `Access-Control-*` headers.
- `*`, non-`https://` origins (except `http://localhost:<port>` when `DEPLOY_ENV` is `development` or `test`) and origins with a path are refused at startup.

## Metrics (route 1)

| Name | Type | Labels | Meaning |
|---|---|---|---|
| `opsgraph_http_requests_total` | counter | `method`, `route`, `status` | completed requests |
| `opsgraph_http_request_duration_seconds` | histogram (buckets 0.025 … 10) | `method`, `route`, `status_class` | time from request start to `finish` |
| `opsgraph_http_server_errors_total` | counter | `route` | responses with status ≥ 500 |
| `opsgraph_rate_limited_total` | counter | `policy` | 429 refusals |
| `opsgraph_error_reports_total` | counter | `outcome` ∈ `sent`, `dropped`, `failed` | error-tracker sends (only when configured) |
| `opsgraph_db_connections` | gauge | `state` ∈ `active`, `idle`, `idle_in_transaction`, `waiting` | this instance's connections seen in `pg_stat_activity` |
| `opsgraph_db_pool_max` | gauge | — | configured `connection_limit` |
| `opsgraph_db_up` | gauge | — | 1 if the scrape-time probe succeeded within 1 s |
| `opsgraph_db_probe_seconds` | gauge | — | probe duration |
| `opsgraph_build_info` | gauge (= 1) | `version`, `env` | running release |
| `opsgraph_process_*`, `opsgraph_nodejs_*` | prom-client defaults | — | CPU, memory, heap, event-loop lag, GC |

Label values: `method` ∈ {GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, OTHER}; `route` = matched route pattern including the prefix (e.g. `/api/entities/:id/blockers`) or `UNMATCHED`; `status` = numeric code; `status_class` ∈ {1xx, 2xx, 3xx, 4xx, 5xx}. `/metrics` itself is not recorded.

## Log records

One JSON object per line on stdout (data-model §3b). Examples:

```json
{"time":"2026-10-08T10:42:01.123Z","level":"info","msg":"request","component":"http","env":"production","version":"9f2c…","correlationId":"6f0c…","userId":"1d2e…","http":{"method":"GET","route":"/api/overview","status":200,"durationMs":412,"ip":"203.0.113.7","bytes":18342}}
{"time":"2026-10-08T10:42:05.004Z","level":"error","msg":"Unhandled exception","component":"AllExceptionsFilter","env":"production","version":"9f2c…","correlationId":"8a1b…","userId":"1d2e…","err":{"type":"TypeError","message":"Cannot read properties of undefined (reading 'id')","stack":"TypeError: …"}}
{"time":"2026-10-08T10:43:00.000Z","level":"warn","msg":"rate limited","component":"RateLimitGuard","env":"production","version":"9f2c…","correlationId":"77aa…","data":{"policy":"login-minute","keyKind":"ip"}}
```

Never present in any record: request or response bodies, query strings, `authorization`, `cookie` or `set-cookie` values, passwords, tokens, configured secret values (replaced by `[REDACTED]`), credentials inside URLs.

## Error events (only when `ERROR_TRACKING_DSN` is set)

`POST https://<host>/api/<projectId>/envelope/` with headers `Content-Type: application/x-sentry-envelope` and `X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<publicKey>, sentry_client=opsgraph/<version>`. Body: three newline-separated JSON lines: `{"event_id":"…","sent_at":"…"}`, `{"type":"event"}`, the event (data-model §3d). Sent for: unknown exceptions and `HttpException` ≥ 500 in `AllExceptionsFilter`, `unhandledRejection`, `uncaughtException`. Never for `AppError` 4xx, validation, 401/403/404/409/429. Timeout 2 s, at most 30 per minute, fire-and-forget.

## Acceptance fixtures

### P1. Rate limits (fresh app, defaults, `RATE_LIMIT_ENABLED=true`)

| Step | Request | Expected |
|---|---|---|
| 1 | 10 × `POST /api/auth/login` (wrong password) from IP A within 60 s | 401 `INVALID_CREDENTIALS` each (001 lockout may lock the account after 5: still 401 generic) |
| 2 | 11th from IP A | 429 `RATE_LIMITED`, `retryAfterSeconds` 1–60, `Retry-After` equal; no new `audit_entries` row for this request |
| 3 | 1 × from IP B (via trusted proxy `X-Forwarded-For: B`) | not 429 |
| 4 | 1 × from untrusted peer with `X-Forwarded-For: B` | counted as the peer's address, not B |
| 5 | 121 × `POST` to a write route as user U within 60 s | 121st → 429; as user V at the same time → not 429 |
| 6 | 500 × `GET /api/entities` as U within 60 s | none 429 |
| 7 | `GET /metrics` | `opsgraph_rate_limited_total{policy="login-minute"} 1`, `{policy="write"} 1` |

### P2. Headers

For each of: `GET /api/health/live` (200), `GET /api/auth/me` without token (401), `GET /api/entities/<random uuid>` (404), a 429 from P1, a 500 from the test-only throwing controller, `GET /` and `GET /assets/<file>` through the CI edge: every header of § Security headers for that column is present with the exact value.

### P3. Logs (stdout captured during the run)

Login with password `P@ss-e2e-<random>`, a refresh with its cookie, an authenticated request, a 500, with `JWT_ACCESS_SECRET`, `METRICS_TOKEN` and a DSN set to known random values. Expected: every captured line parses as JSON with the §3b fields; one `msg: "request"` line per request whose `correlationId` equals the response's `X-Request-Id`; none of the password, the access token, the refresh token, the cookie header, the JWT secret, the metrics token or the DSN key appears anywhere.

### P4. Metrics

After `GET /api/health/live` × 3 and one 404 on `/api/nope`: `opsgraph_http_requests_total{method="GET",route="/api/health/live",status="200"} 3`, `{route="UNMATCHED",status="404"} 1`; `opsgraph_db_up 1`; `opsgraph_db_pool_max 10`; `opsgraph_build_info{version="<APP_VERSION>",env="test"} 1`; `GET /api/metrics` → 404.

### P5. Error reporter

With the DSN pointing at a local sink: a 500 → exactly one envelope within 2 s with `tags.correlationId` = the response's id, `environment`, `release`, `transaction` = route pattern, no `request` field; a 400, 404, 429 → none. Without DSN → no outbound request.
