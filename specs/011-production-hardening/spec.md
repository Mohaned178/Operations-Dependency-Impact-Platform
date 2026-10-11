# Feature Specification: Production Hardening and Free-Tier Deployment

**Feature Branch**: `011-production-hardening`
**Created**: 2026-10-07
**Status**: Draft
**Input**: User description: "Production readiness for OpsGraph, deployed to a free-tier Oracle Cloud Always Free ARM VM using Docker Compose with Caddy (automatic TLS); the setup must stay portable to any cheap Docker VPS. Add: rate limiting on auth and write endpoints; security headers and strict CORS; structured JSON logging with correlation IDs and no secrets; metrics endpoint (request rate, latency, errors, DB pool) with an example dashboard; error-tracking integration point; multi-stage non-root Dockerfiles for api and web plus a production compose with reverse proxy and TLS; environment config and secret-handling docs; automated daily PostgreSQL backups with a tested restore procedure; zero-downtime migration strategy; Playwright end-to-end tests for the core journey (login → open blocked order → see root cause and impact → create exception → assign → resolve → verify) running in CI; a load-test script proving the dashboard, tracing and impact targets at 50k entities; a runbook (deploy, rollback, restore, rotate secrets, incident checklist); and a CD workflow that deploys main to staging after CI passes."

## Overview

Features 001 to 010 make OpsGraph answer its twelve questions (Product Overview §65) on a developer's laptop. Nobody outside that laptop can use it yet: there is no way to run it on a server, reach it securely over the internet, keep its data safe, see whether it is healthy, or change it without breaking it. Product Overview §37 and §55 promise that every conclusion can be traced and audited; that promise means little if the database can be lost in a disk failure, if an attacker can guess passwords at full speed, or if a failed release takes the service down.

This feature makes OpsGraph **operable in production at zero hosting cost**, on infrastructure the team already chose:

- **One free virtual machine** (an Oracle Cloud "Always Free" ARM server) runs everything: a **production** environment and a **staging** environment, each with its own database, behind one shared entry point that serves both over **HTTPS with automatically issued and renewed certificates**. The same deployment bundle runs unchanged on any other low-cost container host; moving means changing configuration values and DNS records, nothing else.
- **Every change to `main` that passes the automated gate is deployed to staging automatically.** Production receives the exact same, already-tested release when an operator promotes it. A release that fails its health check never takes traffic, and the previous release keeps serving.
- **Schema changes never cause downtime.** Releases follow an expand-then-contract rule that the gate enforces, so the running release and the next one can share the database, and a rollback never needs a database restore.
- **The data is protected.** A full database backup is taken every day and before every production release, kept on the server and optionally copied, encrypted, to free off-site storage. A restore drill proves every week that the latest backup can actually be restored.
- **The service defends itself.** Sign-in and every data-changing request are rate limited, every response carries protective security headers, cross-origin access is refused unless explicitly allowed, and secrets never appear in logs, responses, images or the repository.
- **Operators can see what is happening.** Every log line is structured and carries the request's correlation id; a metrics endpoint reports request rate, latency, errors and database connection use, with a ready-made dashboard; unexpected errors can be sent to an error-tracking service when one is configured.
- **The product is proven, not assumed.** A browser test runs the core journey from Product Overview §39 on every change: sign in, open blocked Order #18492, read its root cause and impact, create an exception, assign it, resolve it and have a second person verify it. A load test proves the dashboard, tracing, root-cause and impact performance targets of features 003, 005, 006 and 010 on a 50,000-entity graph under concurrent use.
- **Operators have a runbook**: first-time server setup, deploy, promote, roll back, restore, rotate every secret, and an incident checklist.

It does **not** deliver high availability across several servers, automatic failover, managed databases, Kubernetes, single sign-on, alerting through paging services, a web-app error tracker, log search infrastructure, a status page, or data-retention policies for business data. Those are later decisions (see Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ship every passing change to staging and promote it safely (Priority: P1)

A developer merges a pull request into `main`. The automated gate runs lint, type checks, unit and end-to-end tests, the browser journey test and the migration-safety check, and builds the server and web images for both the ARM server and ordinary x86 machines. When everything passes, the release is deployed to **staging** on its own: the new images are fetched on the server, pending database changes are applied, the new release is started next to the old one, and traffic moves to it only once it reports healthy. The old one is then stopped. The team opens `https://staging.<domain>` and sees the new version number on the health page. Later, an operator promotes that same release to **production** with one manual action; a backup is taken first, then the same steps run against production.

**Why this priority**: Without a repeatable, gated path from `main` to a running server there is no production at all, and every other capability of this feature has nothing to protect.

**Independent Test**: On a fresh server prepared with the setup guide, merge a trivial change to `main` and check that staging reports the new version within the target time without any manual step. Then promote it and check production reports it too, and that a pre-release backup exists.

**Acceptance Scenarios**:

1. **Given** a change merged to `main`, **When** the gate passes, **Then** staging is deployed automatically with the images built from that exact commit, and its health page reports that commit's version.
2. **Given** a change whose gate fails (any check), **When** the pipeline ends, **Then** nothing is deployed and staging keeps its current release.
3. **Given** a new release whose server does not become healthy within the allowed time, **When** it is deployed, **Then** it never receives traffic, it is stopped, the previous release keeps serving, and the deployment is reported as failed.
4. **Given** a release running on staging, **When** an operator promotes it, **Then** production first takes a full backup, then runs the same release (same image digests) with the same steps; if the backup fails, the promotion stops before any change.
5. **Given** two deployments started for the same environment at the same time, **When** they run, **Then** the second waits for or refuses the first; they never interleave.
6. **Given** production and staging on one server, **When** either is deployed, restarted or overloaded, **Then** the other keeps its own database, configuration, secrets and resource limits and keeps serving.
7. **Given** the server is restarted, **When** it comes back, **Then** both environments and the entry point start on their own and serve HTTPS again without manual action.

---

### User Story 2 - Change the database schema without downtime and roll back safely (Priority: P1)

A release adds a column that the new code reads. While it is deployed, a user keeps working in the Exceptions area and never sees an error: the schema change is applied while the old release is still serving, both releases work with the new schema, and traffic moves to the new release only once it is healthy. Two days later a defect is found. An operator rolls back to the previous release in a few minutes, without restoring the database, because every schema change is additive until a later release removes what is no longer used.

**Why this priority**: Every feature from 004 to 010 adds migrations. If each release interrupts users or makes rollback require a restore, the team will stop releasing.

**Independent Test**: While a client sends one request per second to production-like environments, deploy a release that contains a migration three times in a row and roll it back once; count failed requests and measure rollback time.

**Acceptance Scenarios**:

1. **Given** a release with a schema change, **When** it is deployed, **Then** no request fails or is refused during the deployment because of it, measured by a client polling every second.
2. **Given** a new migration that removes, renames or narrows something (drops a table or column, renames, changes a type, adds a required column without a default), **When** the gate runs, **Then** it fails with a message naming the migration and the expand-then-contract rule, unless the migration is explicitly marked as the contract step of an earlier expand release.
3. **Given** a release currently running, **When** an operator rolls back to the previous release, **Then** the previous release serves traffic again without a database restore, within the target time, and the rollback is recorded with who did it and when.
4. **Given** a migration that fails while being applied, **When** the deployment runs, **Then** the deployment stops before any traffic moves, the running release keeps serving, and the runbook gives the recovery steps.
5. **Given** a server that is stopped for a deployment, **When** it receives the stop signal, **Then** it finishes the requests already in progress (up to a bounded time) before exiting.

---

### User Story 3 - Recover the data after a loss (Priority: P1)

The production disk is damaged. The operator follows the runbook: provisions a fresh server with the setup guide, fetches the latest encrypted off-site backup, restores it, deploys the release matching it, and checks the restore with the provided verification. Users lose at most the changes made since the last backup. Every week, without anyone asking, the server restores the latest backup into a throwaway database and checks it, so the team knows the backups work before they need them.

**Why this priority**: OpsGraph's value is the history and evidence it preserves (Product Overview §37, Constitution IV). Losing the audit trail or the investigations is unrecoverable for users.

**Independent Test**: Run the backup, delete the production data volume on a test server, restore from the backup with the runbook, and compare row counts and the latest audit entries with values recorded before the deletion. Check that the weekly drill reports success and that a corrupted backup file makes it report failure.

**Acceptance Scenarios**:

1. **Given** a running environment, **When** the daily backup time arrives, **Then** a complete, compressed backup of the database is written with a checksum, verified readable, and older backups are removed according to the retention rule (7 daily and 4 weekly for production).
2. **Given** off-site copying is configured, **When** a backup completes, **Then** an encrypted copy is uploaded to the configured object store; if the upload fails, the local backup is kept and the failure is reported.
3. **Given** the weekly restore drill, **When** it runs, **Then** it restores the latest production backup into a temporary database, checks that it is complete (all migrations recorded, core tables present and non-empty, audit records intact), removes the temporary database, and records success or failure with the time taken.
4. **Given** an operator restores a backup into an environment, **When** the restore completes, **Then** an audit record states that the database was restored, from which backup, by whom and when, and the restored environment serves the data as it was at backup time.
5. **Given** the disk holding backups is nearly full, **When** a backup runs, **Then** it refuses to start rather than filling the disk, and reports why.
6. **Given** any backup job, restore drill or off-site copy fails, **When** an optional heartbeat address is configured, **Then** that address is not notified (so an external monitor raises the alarm); when it succeeds it is notified.

---

### User Story 4 - Keep attackers and accidents out (Priority: P1)

An attacker scripts password guesses against the sign-in page. After ten attempts in a minute from the same address, further attempts are refused with "Too many attempts, try again in N seconds", on top of the existing per-account lockout (001). A buggy integration that sends hundreds of change requests per minute is slowed down the same way, while normal users never notice a limit. Every response carries headers that stop the pages from being framed, stop content-type sniffing, force HTTPS and restrict where scripts may load from. A page on another website cannot call the API with the user's session. Nothing secret, not a password, a token, a cookie or a connection string, appears in any log line, error response or container image.

**Why this priority**: The service becomes reachable from the whole internet. Without these protections, the first exposure risks account takeover, data tampering and leaked credentials.

**Independent Test**: Send 11 sign-in attempts in a minute from one address and check that the 11th is refused with the published response; repeat from a second address and check it is not affected. Scan every response type for the required headers. Make a cross-origin request with credentials and check it is refused. Run the whole automated suite while capturing logs and search them for every configured secret value and every password used.

**Acceptance Scenarios**:

1. **Given** the published limits, **When** a client exceeds the sign-in limit, the token-refresh limit, the password-change limit, the import limit or the general write limit, **Then** the excess requests are refused with a "too many requests" error that says when to retry, and nothing is changed.
2. **Given** requests that stay within the limits, **When** they are made, **Then** none of them is refused; reading data is never rate limited.
3. **Given** requests that arrive through the entry point, **When** limits are counted, **Then** they are counted per real client address (for sign-in and refresh) or per signed-in user (for writes), and a client cannot change its counted address by sending forged forwarding headers.
4. **Given** any response (page, static asset, API success, API error), **When** it is inspected, **Then** it carries every required security header in the contracts table.
5. **Given** a request from an origin that is not on the allowed list, **When** it is made with credentials, **Then** the browser is not permitted to read the response; by default no other origin is allowed.
6. **Given** any request, including failed sign-ins and server errors, **When** the logs are examined, **Then** they contain no password, token, cookie, authorization header, secret value or connection-string password.
7. **Given** the server is started with a missing or invalid required setting (for example a secret shorter than its minimum), **When** it starts, **Then** it refuses to start and names the setting without printing its value.
8. **Given** the demo seed with known passwords, **When** anyone tries to load it into production, **Then** it is refused.

---

### User Story 5 - See what the service is doing (Priority: P2)

A user reports "the Home page failed at 10:42" and quotes the error reference shown on screen. The operator finds every log line of that request, at the entry point and in the server, by that one reference, and sees which route, which user, how long it took and the error, without any secret in the output. The operator opens the dashboard: request rate, latency percentiles per route, error rate, rejected-by-rate-limit counts and database connections in use for the last hours. When an error-tracking service is configured, unexpected server errors also appear there with the same reference.

**Why this priority**: Without visibility, every incident starts with guessing. It ranks below P1 because the service can run safely without it for a short time, but not be operated well.

**Independent Test**: Make a request that fails, read the correlation reference from the response, and find its log lines; check each line's fields against the contracts. Scrape the metrics endpoint before and after a burst of requests and check the counters, histograms and connection gauges change as expected. Load the example dashboard into a monitoring tool and check every panel shows data. Configure a test error-tracking address and check one event arrives for a server error and none for a validation error.

**Acceptance Scenarios**:

1. **Given** any request, **When** it completes, **Then** exactly one structured access log line is written with time, level, correlation reference, method, route pattern, status, duration, user (if signed in) and environment, and the same reference is returned to the client.
2. **Given** an incoming request that already carries a valid correlation reference from the entry point, **When** it is processed, **Then** the server uses it, so the entry point's and the server's log lines share it.
3. **Given** the metrics endpoint, **When** it is read, **Then** it reports total requests, request duration distribution and errors per method, route pattern and status, rate-limited requests, database connections by state with the configured maximum, database reachability, process health and the running version.
4. **Given** the metrics endpoint, **When** it is requested from the internet through the entry point, **Then** it is not reachable; it is reachable only from the server's private network (and, if configured, requires a token).
5. **Given** an error-tracking address is configured, **When** an unexpected server error occurs, **Then** one event is sent with the error, the route, the correlation reference, the environment and the version, without request bodies, headers or secrets. Expected errors (validation, not found, refused, rate limited) are never sent. With no address configured, nothing is sent anywhere.
6. **Given** the optional monitoring tools are not running, **When** the service runs, **Then** it works normally; the metrics endpoint simply is not scraped.

---

### User Story 6 - Prove the core journey works on every change (Priority: P2)

On every pull request and every change to `main`, the gate starts the production images with the reference data and drives a real browser through the journey of Product Overview §39: an analyst signs in, opens Order #18492, reads that it is blocked, that its root cause is the missing budget code with HIGH confidence, and what it affects; creates an exception from the root cause; assigns it to themselves; resolves it with a note; then an Operations Manager signs in and verifies it. The test checks the exception's history shows each step with the right person. If anything breaks, the gate fails and keeps screenshots, a trace and the server logs.

**Why this priority**: Unit and API tests prove each part; only a browser test proves the parts work together as users experience them, on the images that will actually be deployed.

**Independent Test**: Run the browser suite locally against the production-like stack; then break one step deliberately (for example hide the root-cause label) and check the suite fails at that step with its artifacts.

**Acceptance Scenarios**:

1. **Given** the production images started with the reference data, **When** the browser suite runs, **Then** it completes the journey sign in → open blocked Order #18492 → see root cause and impact → create exception → assign → resolve → verify, and checks the values shown at each step against features 005, 006 and 007's published fixtures.
2. **Given** the journey completes, **When** the exception's history is opened, **Then** it lists creation, assignment, resolution and verification with the analyst and the manager as actors, in order.
3. **Given** any step fails, **When** the gate ends, **Then** it fails and keeps a screenshot, a step trace and the server logs for that run.
4. **Given** the browser suite, **When** it runs in the gate, **Then** it uses only the production images and configuration (no development server), so a broken image or proxy configuration fails the gate.

---

### User Story 7 - Prove the performance targets at 50,000 entities (Priority: P2)

Before promoting a release that touches the graph, an operator runs the load test. It builds a 50,000-entity graph with the shapes the performance targets name (long blocking chains, an entity whose impact reaches thousands of others, thousands of exceptions, investigations and open risks), signs in as several users, and for several minutes sends a realistic mix of requests from 20 concurrent users: Home, blockers, dependencies, root cause and impact. It ends with a pass or fail per target and a summary to attach to the release.

**Why this priority**: The performance targets of features 003, 005, 006 and 010 were proven one request at a time; production has many users at once on a small server.

**Independent Test**: Run the load test against the production-like stack and check that the summary lists each target with its measured 95th percentile and a pass or fail; then lower a threshold below the measured value and check the run fails.

**Acceptance Scenarios**:

1. **Given** the 50,000-entity dataset and 20 concurrent users for at least 5 minutes, **When** the load test runs, **Then** it reports, per request kind, the 95th percentile and the error rate, and passes only if every target in Success Criteria SC-010 is met.
2. **Given** the load test, **When** it is pointed at production, **Then** it refuses to run.
3. **Given** the dataset generator, **When** it is run twice, **Then** it produces the same dataset (same identifiers and shapes), and it refuses to run against staging or production data.

---

### User Story 8 - Operate from a runbook (Priority: P3)

A new team member is on call. Using only the runbook and the configuration guide, they set up a server from scratch, create the first Administrator, deploy, promote, roll back, restore a backup into staging, rotate the sign-in signing secret without signing anyone out, rotate the database password, and walk through the incident checklist for "the site is down".

**Why this priority**: Operations knowledge that lives only in one person's head is a single point of failure. It ranks P3 because the procedures it documents are delivered by the stories above.

**Independent Test**: Hand the runbook to someone who did not build the feature and have them perform each procedure on a test server; every procedure completes without outside help, and every gap found is fixed in the runbook.

**Acceptance Scenarios**:

1. **Given** the runbook, **When** it is read, **Then** it has step-by-step procedures, each with the expected result and how to check it, for: first-time server setup, first Administrator, deploy, promote, roll back, restore (to staging and to production), restore drill review, rotate each secret, renew or replace certificates, free disk space, and an incident checklist.
2. **Given** a fresh production environment, **When** the operator runs the first-Administrator command, **Then** an Administrator account is created with a one-time password that must be changed at first sign-in, and the creation is audited as a system action. The command refuses to create an account that already exists.
3. **Given** the sign-in signing secret is rotated, **When** the new secret is deployed with the old one kept as "previous" for one access-token lifetime, **Then** no signed-in user is signed out.
4. **Given** the configuration guide, **When** it is read, **Then** every setting is listed with its meaning, default, whether it is required in production, whether it is secret, and how secrets are stored and never committed.

---

### Edge Cases

- **Certificate cannot be issued** (DNS not yet pointing at the server, ports 80/443 closed in the cloud firewall or on the server): the entry point keeps retrying; the runbook's checklist tells the operator what to check. Existing valid certificates keep being served while renewal is retried.
- **Free-tier capacity or reclamation**: the cloud provider may have no ARM capacity when creating the server, or may reclaim an idle free server. The setup guide explains how to retry and how to avoid reclamation; backups off the server make reclamation recoverable.
- **Image built only for one processor type**: the deployment fails at the image fetch step, before any change, and says so.
- **Migration fails halfway**: traffic never moves; the running release keeps serving; the runbook explains how to inspect, fix forward or mark the migration and retry.
- **A required setting is missing** on the new release: the new release refuses to start, never takes traffic, and the old release keeps serving.
- **Deployment while a backup runs**: they share a per-environment lock; one waits for the other.
- **Restore of a backup taken by an older release**: the runbook restores, then applies the pending migrations of the current release (forward only), or deploys the release recorded with the backup.
- **Restore of a backup taken by a newer release than the one running**: refused with a message naming both migration levels.
- **Disk nearly full**: backups refuse to start below the free-space threshold; logs and images are rotated and pruned automatically; the runbook lists what can be removed.
- **Clock differences**: the server uses network time; all logs and backups use UTC.
- **Rate limits and shared addresses**: users behind one office address share the sign-in limit; the limit is sized so a team signing in together is not refused (10 per minute per address, with lockout per account still applying).
- **Forged forwarding headers**: only the entry point's address is trusted to state the client address; anything a client sends is replaced.
- **Rate-limit counters after a restart**: counters are kept in memory and start again from zero after a release; this is accepted (see Assumptions).
- **Two releases running during a switch**: both may run background jobs for a short time; jobs from features 009 and 010 already guarantee a single run at a time across instances.
- **Error-tracking service unreachable**: events are dropped after a short timeout; requests are never slowed down or failed because of it.
- **Metrics labels**: unknown routes are grouped under one label, so random addresses cannot create unbounded metric series.
- **Load test pointed at production, or demo seed pointed at production**: refused.
- **Staging is public**: it requires sign-in like production, uses non-default passwords for its demo users, and asks search engines not to index it.

## Requirements *(mandatory)*

### Functional Requirements

**Hosting, packaging and environments**

- **FR-001**: The system MUST be packaged as two container images, one for the server and one for the web application, each built in separate build and runtime stages, each running as a non-administrative user, and each published for both 64-bit ARM and 64-bit x86 processors from the same commit.
- **FR-002**: Each image MUST carry the commit it was built from, report it as its version (health page and metrics), and contain no secrets, no development dependencies beyond what the database-migration tool needs, and no source maps of the server code.
- **FR-003**: A single deployment bundle MUST describe production and staging as two isolated environments on one server: each with its own database and persistent storage, settings, secrets, resource limits and logs. One shared entry point MUST serve both over HTTPS under two host names, obtaining and renewing certificates automatically, and redirect plain HTTP to HTTPS.
- **FR-004**: The bundle MUST run unchanged on any server that can run containers; moving to another provider MUST require changing only settings files and DNS records. Provider-specific steps MUST be confined to the setup guide.
- **FR-005**: The database MUST NOT be reachable from outside the server. The metrics endpoint MUST NOT be reachable from the internet. Only the entry point MUST accept connections from the internet (HTTPS and HTTP-for-redirect).
- **FR-006**: Every service MUST restart automatically after a crash or a server restart, have a health check, have a memory limit, and have its logs rotated so they cannot fill the disk.
- **FR-007**: The staging environment MUST require sign-in like production, MUST use non-default passwords for any demo account, and MUST ask search engines not to index it.

**Delivery pipeline**

- **FR-008**: The automated gate MUST run, on every pull request and every change to `main`: the existing lint, type check, unit and end-to-end tests; the migration-safety check (FR-014); the image builds; the browser journey test (FR-039) against the built images; and a short load-test smoke run (FR-040).
- **FR-009**: When the gate passes on `main`, the images MUST be published to the container registry tagged with the commit, and staging MUST be deployed automatically with those images.
- **FR-010**: Production MUST be deployed only by an explicit operator action that names a release already deployed to staging; production MUST run the same image digests that staging ran.
- **FR-011**: A deployment MUST: hold a per-environment lock; fetch the images; for production, take and verify a full backup first and stop if it fails; apply pending migrations; start the new release next to the running one; move traffic only after the new release reports healthy within a bounded time; stop the previous release gracefully; check the public health page reports the new version; and record the release (version, digests, time, actor, outcome).
- **FR-012**: If any deployment step fails, the running release MUST keep serving and the deployment MUST be reported as failed with the step that failed.
- **FR-013**: An operator MUST be able to roll back an environment to any of its previously recorded releases with one command, without a database restore, and the rollback MUST be recorded like a deployment.

**Schema changes without downtime**

- **FR-014**: Every migration added after the first production release MUST be backward compatible with the release before it (expand-then-contract). The gate MUST refuse a new migration that drops or renames a table or column, changes a column's type, adds a required column without a default, or drops an enumeration value, unless the migration is marked as the contract step and names the earlier release that stopped using what it removes.
- **FR-015**: During a deployment that applies migrations, a client sending one request per second MUST see no failed or refused request.
- **FR-016**: On receiving a stop signal, the server MUST stop accepting new requests, finish requests in progress for up to 25 seconds, stop its background jobs, and exit.

**Rate limiting**

- **FR-017**: The system MUST limit requests per period as follows, and the limits MUST be configurable:

  | Requests | Counted per | Default limit |
  |---|---|---|
  | Sign-in | client address | 10 per minute and 50 per hour |
  | Token refresh | client address | 30 per minute |
  | Password change | signed-in user | 5 per 15 minutes |
  | Data import | signed-in user | 10 per minute |
  | Every other data-changing request (create, change, delete) | signed-in user (client address if not signed in) | 120 per minute |
  | Reading data, health page | not limited | — |

- **FR-018**: A refused request MUST change nothing, MUST receive the "too many requests" status with the standard error format, the code `RATE_LIMITED`, a message, the number of seconds to wait, and the correlation reference; it MUST be counted in the metrics and logged, and MUST NOT write an audit record (a refused request is not a mutation, and auditing each one would let an attacker flood the append-only audit trail).
- **FR-019**: The client address used for limits and logs MUST be taken from forwarding headers only when they come from the configured entry point; otherwise from the connection.
- **FR-020**: The web application MUST show a refused request as "Too many attempts. Try again in N seconds." on the sign-in page, and as a non-blocking message elsewhere.

**Security headers, cross-origin access and secrets**

- **FR-021**: Every response MUST carry the security headers listed in the contracts (content-type sniffing off, framing refused, strict referrer policy, restrictive permissions policy, a content security policy that allows scripts only from the site itself, and on HTTPS host names a strict-transport policy of at least one year). The server's own responses MUST carry them too, so they hold behind any proxy.
- **FR-022**: Cross-origin requests MUST be refused by default. An allowed-origin list MAY be configured with exact origins only; credentials MUST be allowed only for listed origins; wildcards MUST be refused at startup.
- **FR-023**: Session cookies MUST remain HTTP-only, same-site strict and secure on HTTPS environments (001), scoped to the sign-in paths.
- **FR-024**: All settings MUST be validated at startup; the server MUST refuse to start on a missing or invalid setting, naming it without its value. Every secret setting MUST be accepted either directly or from a file (for container secret files), and production MUST refuse development default secrets.
- **FR-025**: Secrets MUST NOT be stored in the repository, the images or the pipeline logs. Server secrets MUST live only on the server, in files readable only by the deployment account; pipeline secrets MUST be limited to what is needed to reach the server and the registry.
- **FR-026**: The sign-in signing secret MUST support rotation without signing users out: a previous secret MAY be configured and accepted for verifying tokens until it is removed; new tokens are always signed with the current secret.
- **FR-027**: The demo seed MUST be refused in production; on staging and in automated testing it MUST be allowed only with an explicitly set, non-default demo password.
- **FR-028**: A command MUST create the first Administrator of an environment with a one-time password that must be changed at first sign-in, audited as a system action, refusing an existing email.

**Logging, metrics and error tracking**

- **FR-029**: Every log line from the server MUST be a single structured record with at least: time (UTC), level, message, component, correlation reference (when inside a request or job), user (when signed in), environment and version. Errors MUST include their type and message; stack traces MUST be logged only for unexpected errors.
- **FR-030**: Exactly one access record MUST be written per request, with method, route pattern (not the raw address with query string), status, duration, client address and response size. Request and response bodies, query strings, cookies and authorization headers MUST never be logged. Configured secret values and connection-string passwords MUST be replaced with a redaction mark wherever they appear in a log message.
- **FR-031**: The server MUST expose a metrics endpoint in the standard text exposition format with: requests total and request duration distribution per method, route pattern and status class; server errors; rate-limited requests per policy; database connections in use, idle and waiting with the configured maximum; database reachability and probe time; process memory, processor time and event-loop delay; and the running version and environment. The number of distinct label values MUST be bounded.
- **FR-032**: An example dashboard MUST be provided showing request rate, error rate, latency percentiles per route, rate-limited requests, database connections and process health; and the optional monitoring tools to display it MUST be documented and startable with one command, off by default.
- **FR-033**: An error-tracking integration point MUST exist: when an error-tracking address is configured, unexpected server errors (never expected 4xx outcomes) MUST be sent with error type, message, stack, route pattern, correlation reference, environment and version, without bodies, headers, cookies or secrets, with a bounded timeout and no effect on the response. It MUST be off by default.

**Backups and restore**

- **FR-034**: Each environment's database MUST be backed up fully every day at a fixed time (production and staging at different times) and before every production deployment. Each backup MUST be compressed, have a checksum, be verified readable, record the migration level and release it was taken from, and be kept per the retention rule: production 7 daily and 4 weekly; staging 3 daily. A backup MUST refuse to start when free disk space is below 15%.
- **FR-035**: When off-site copying is configured, each production backup MUST be copied, encrypted before it leaves the server, to an object store, with its own retention (30 days by default). Failures MUST be reported without deleting the local backup.
- **FR-036**: A weekly restore drill MUST restore the latest production backup into a temporary database and check it: restore completes without error; all migrations recorded match the release recorded with the backup; core tables (users, entities, relationships, source records, audit records) exist and are non-empty; the audit trail's append-only protection is present. It MUST record the outcome and duration and remove the temporary database.
- **FR-037**: A restore procedure MUST restore a chosen backup into a chosen environment (staging or production) after an explicit confirmation, stop that environment's server during the restore, refuse a backup taken at a newer migration level than the target release, then apply pending migrations, restart, and write an audit record of the restore (backup, operator, time).
- **FR-038**: Backup jobs, restore drills and off-site copies MAY notify a configurable heartbeat address on success, so that an external free monitor reports missing or failed runs.

**Proof: browser journey and load test**

- **FR-039**: A browser test suite MUST run the core journey (sign in → open blocked Order #18492 → see its root cause and impact → create an exception → assign it → resolve it → verify it as a different user) against the production images and entry-point configuration with the reference data, check the values shown against features 005, 006 and 007's published fixtures, and check the exception history. It MUST run in the gate and keep screenshots, traces and server logs on failure.
- **FR-040**: A load-test script MUST run a mix of Home, blockers, dependencies, root-cause and impact requests from 20 concurrent signed-in users for at least 5 minutes against a 50,000-entity dataset, and pass or fail per target (SC-010). A deterministic dataset generator MUST build that dataset (at least 150,000 relationships, blocking chains 6 hops deep, an entity whose impact reaches at least 2,000 entities, 10,000 exceptions, 10,000 investigations, 10,000 open risks). Both MUST refuse to run against production, and the generator also against staging. The gate MUST run the script in a short smoke mode on the reference data so it keeps working.

**Runbook and documentation**

- **FR-041**: The documentation MUST include: a server setup guide (the free ARM server, firewall, DNS, container runtime, deployment account, timers) with a section on moving to another provider; a configuration and secrets guide (every setting, FR-024 to FR-026); a runbook with the procedures of User Story 8; a monitoring guide; and the expand-then-contract rules with examples.
- **FR-042**: Restores (FR-037) and first-Administrator creation (FR-028) MUST write audit records; deployments, rollbacks, backups and drills MUST be recorded in the server's release and job logs with time, actor and outcome. No existing audit behaviour may change.
- **FR-043**: Every new or changed response format (the rate-limit error code, the health version) MUST be defined once as a shared, validated schema used by the server and the web application, with end-to-end tests for: rate-limit refusal per policy, forwarded-address handling, security headers on success and error responses, cross-origin refusal and allowed origins, metrics content and protection, startup refusal on invalid settings, log redaction, and error reporting on and off.

### Key Entities

- **Environment**: production or staging; its host name, settings, secrets, database, resource limits, active release and release history.
- **Release**: one deployable version: commit, server and web image digests, migration level; recorded per environment with time, actor and outcome (deployed, failed, rolled back).
- **Backup**: one database copy of one environment: time, kind (daily, weekly, pre-deploy, manual), file, size, checksum, migration level and release, off-site copy status.
- **Restore Drill Result**: time, backup used, duration, outcome, failed checks.
- **Rate-limit Policy**: name, what it applies to, counting key, limit and period.
- **Log Record**: one structured line (fields in contracts).
- **Metric**: one named measurement with bounded labels (names in contracts).
- **Error Event**: one unexpected server error sent to the optional error tracker.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A change merged to `main` is serving on staging within 30 minutes of the merge, with no manual step, in 9 of 10 consecutive merges.
- **SC-002**: Across 3 consecutive deployments that include a migration, a client sending one request per second sees 0 failed or refused requests.
- **SC-003**: An operator rolls an environment back to its previous release in under 10 minutes using the runbook, without restoring the database.
- **SC-004**: A backup exists for each of the last 7 days in production; the weekly restore drill succeeds on the latest backup every week; data loss after a total server loss is at most 24 hours (at most the time since the last pre-deploy backup if that is newer); a full restore of a 50,000-entity database completes in under 30 minutes.
- **SC-005**: The 11th sign-in attempt within one minute from one address is refused, a second address is unaffected, and in the browser journey and load test no legitimate request is refused by a limit.
- **SC-006**: 100% of response kinds (page, static file, API success, API error, rate-limit refusal) carry every required security header (automated); a public security-header scanner rates the production site A or better.
- **SC-007**: 0 occurrences of any configured secret value, any test password, any token or any authorization or cookie header in the logs captured during the complete automated test run.
- **SC-008**: 100% of requests produce exactly one access record carrying the correlation reference returned to the client; an operator finds all log lines of a failed request from its reference in under 2 minutes.
- **SC-009**: The browser journey runs on every pull request and change to `main`, takes under 10 minutes including starting the images, and fails the gate when any step breaks.
- **SC-010**: On the 50,000-entity dataset with 20 concurrent users for 5 minutes, measured at the 95th percentile: Home under 2 seconds; blockers under 1 second; dependencies first page under 2 seconds; root cause under 1.5 seconds; impact summary under 2 seconds; and fewer than 1% failed requests.
- **SC-011**: Monthly hosting cost is 0 on the reference free server (a domain name, if bought, excepted); a fresh server reaches "both environments serving HTTPS" in under 2 hours following the setup guide; the same bundle runs on a second provider by changing only settings and DNS.
- **SC-012**: A team member who did not build this feature completes every runbook procedure on a test server without outside help.

## Assumptions

- **Hosting decision** (given by the user, binding): a single Oracle Cloud "Always Free" Ampere ARM virtual machine running Ubuntu; containers orchestrated with Docker Compose; Caddy as the shared entry point with automatic Let's Encrypt certificates; PostgreSQL 16 in a container with a persistent volume; GitHub Actions and the GitHub container registry; deployment over SSH; daily `pg_dump` backups with optional off-site copies to a free object store (such as OCI Object Storage's free tier). Products are named here and in the plan only; the requirements above stay provider-neutral so the portability requirement (FR-004) can be checked.
- **Staging and production on one server** (in place of a clarification): two isolated environments on the same free server, sharing only the entry point, are the cheapest option that still gives a real pre-production check. Isolation is by separate databases, settings, secrets, networks and memory limits. The trade-off, that a server failure takes both down, is accepted at this stage and covered by off-site backups.
- **Production promotion is manual** (in place of a clarification): the request asks for automatic deployment to staging only. Production is promoted by an operator action naming a staging release; full continuous deployment to production is a later decision.
- **Zero downtime means a single server** (in place of a clarification): the target is no failed request during deployments and migrations (FR-015), not surviving the loss of the server. High availability, multiple servers, database replication and automatic failover are out of scope.
- **Rate-limit counters are per running server and in memory**: with one server per environment this is exact enough; counters reset on each release. A shared counter store is a later concern when several servers run.
- **Rate-limited requests are logged and counted but not audited** (FR-018): auditing each refusal would let an attacker grow the append-only audit table without bound; 001's audited account lockout remains the audited signal for password guessing.
- **Limits** default to the FR-017 table, sized for a team of tens of users behind shared addresses; they are configurable per environment.
- **Backups and retention** (in place of a clarification): daily full logical backups (RPO 24 hours, plus a backup before every production release) are proportionate for an MVP whose data is mostly re-importable from source systems while its audit trail, investigations and exceptions are not. Point-in-time recovery is out of scope. Retention: production 7 daily + 4 weekly locally, 30 days off-site; staging 3 daily, no off-site copy.
- **Restore drill weekly, on production backups only**, into a throwaway database on the same server; it never touches a live environment.
- **Off-site copies are optional and encrypted on the server**, so the object store never sees readable data; the encryption passphrase is kept outside the server too (the runbook says where), otherwise off-site copies are useless after a server loss.
- **Metrics stay private**: the metrics endpoint is not routed by the entry point; the optional monitoring tools run on the same server (off by default because of the server's limits) and are reached through an SSH tunnel. A hosted free monitoring tier is documented as an alternative.
- **Error tracking** is an integration point for any service that accepts the common open error-event format (for example a hosted free tier or a self-hosted tracker), configured by one address and off by default. Browser-side error tracking is out of scope.
- **First Administrator**: production never contains demo accounts. The first Administrator is created by a server command (FR-028); further users are created in the app (001).
- **Staging data**: staging is loaded with the reference scenarios (the demo seed, FR-027) using a non-default demo password set on the server, so the team can try each release on known data.
- **Browser journey data**: the gate runs the browser suite against a fresh database loaded with the reference seed (including feature 007's seed rows). Creating a second exception on Order #18492 is allowed by 007 (it lists the existing one first).
- **Load-test location**: the full load test runs on demand against a production-like stack on a pipeline machine or on the server in a separate throwaway environment, never against production; the gate only runs a short smoke version. Results are recorded in the quickstart.
- **Scope boundaries**: out of scope, for later features: several servers, high availability, managed databases or Kubernetes; single sign-on; paging and alert routing (an external free heartbeat monitor is supported, FR-038); log shipping and search; a public status page; web-app error tracking; data-retention or deletion policies for business data; web-application firewall rules beyond rate limits; dependency and image vulnerability scanning beyond what the registry offers for free.
- **Dependencies**: features 004 to 010 must be merged before this feature starts: the browser journey needs 004–007's pages, the load test needs 003, 005, 006 and 010's routes, and the dataset generator fills 007–009's tables. Existing foundation from 001: sign-in, lockout, cookies, roles, audit, correlation references, error format, health page, settings validation.
