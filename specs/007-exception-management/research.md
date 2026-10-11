# Research: Exception Management and Ownership

**Feature**: `007-exception-management` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

The spec has no clarification markers; its defaults are listed in its Assumptions. This document records the **design decisions**. They are binding for the implementer. Each one gives the decision, the rationale and the alternatives rejected. Section numbers (R1–R19) are referenced from plan.md, data-model.md and contracts/api.md.

Codebase facts this research relies on (state of `007-exception-management`: 001–003 implemented; 005 and 006 specified and planned, and **must be merged before this feature starts**, see plan.md):

- `AuditService` offers `record(tx, input)`, `recordMany(tx, inputs)` and `recordStandalone(input)`. It resolves the actor from `RequestContext` (user, else anonymous) unless `actorType` is given, and it redacts secrets. `audit_entries` is append-only at the database level. `GET /api/audit` is ADMIN-only.
- Every audit row has `targetType`, `targetId`, `before`, `after` and `metadata` (JSON). There is an index on `(target_type, target_id, id DESC)`.
- `RolesGuard` writes `auth.forbidden` (standalone, `metadata: { method, path, role }`) before throwing `Errors.forbidden()`. Routes without `@Roles` are open to every signed-in user; `JwtAuthGuard` is global.
- `Errors` has `validation`, `forbidden`, `notFound`, `emailTaken`, `lastAdmin` and others. `ErrorCodeSchema` in `packages/shared/src/common.ts` lists every error code.
- `encodeCursor` / `decodeCursor(schema, cursor)` exist in `apps/api/src/common/pagination/cursor.ts`.
- `forbid_provenance_mutation()` exists (migration `20261005163949_provenance_append_only`) and is reused by 005's note tables.
- `UsersModule` holds the ADMIN-only `UsersController`. Users have `role` (ADMIN, OPS_MANAGER, ANALYST) and `status` (ACTIVE, DEACTIVATED).
- `prisma/seed.ts` upserts 3 users (admin, manager, analyst), then runs `SeedService.seedScenario39()` in a Nest application context. 006 adds `seedScenario40()`.
- 005 plans `RootCauseService.analyze(id, { depth, evaluatedAt? })` returning `RootCauseResponse`. 006 plans `ImpactService.summary(id, { depth })` returning `ImpactResponse`. Neither module exports its service yet.
- The web app already has an `/exceptions` route showing `ComingSoonPage` and a nav link to it.

---

## R1. Module layout

**Decision**:
- **`exceptions`** (new Nest module, `apps/api/src/exceptions/`): exceptions, links, snapshots, comments, evidence, history, the seed of the reference exception, and pure rule modules in `exceptions/rules/`.
- **`notifications`** (new Nest module, `apps/api/src/notifications/`): the `notifications` table, `NotificationsService.createMany(tx, …)` for producers, and the 4 read/mark routes.
- **Teams** go into the existing **`users`** module: `TeamsController`, `TeamsService`, `team.mapper.ts`, and `OwnerDirectoryController`. `UsersModule` exports `TeamsService`.
- `RootCauseModule` adds `exports: [RootCauseService]`. `ImpactModule` adds `exports: [ImpactService]`. `ExceptionsModule` imports both, plus `NotificationsModule` and `UsersModule`.

**Rationale**:
- CLAUDE.md lists `exceptions` as a bounded context, so it needs no justification.
- Teams are part of identity and organisation, which `users` already owns; a separate module would hold two small files.
- Notifications are app-wide: the header bell is not part of the exception UI, and §50 (risk alerts) will produce them later. Keeping them out of `exceptions` keeps the dependency one-way (`exceptions → notifications`). This is the one new module not in CLAUDE.md (plan.md Complexity Tracking).
- Snapshots call the 005 and 006 services, so their rules, ordering and text are reused exactly, and no traversal code is added.

**Alternatives rejected**:
- **Notifications inside `exceptions`**: the `/api/notifications` routes and the bell would live in a module about exceptions, and a later producer would have to import `exceptions`.
- **A `teams` module**: extra wiring for two files with no independent consumer.
- **Calling `GraphRepository` or `TracingService` directly for snapshots**: duplicates 005/006 logic and risks disagreeing with the Entity 360 page.

---

## R2. Storage: mutable case row, append-only facts

**Decision** (data-model §1):

| Table | Mutability | Why |
|---|---|---|
| `exceptions` | mutable, `version` column | the case's current state; history lives in the audit trail |
| `exception_entities` | insert and delete | links come and go; every change is audited |
| `exception_snapshots` | **append-only** (trigger) | snapshots are evidence "available at the time" (§37) |
| `exception_comments` | **append-only** (trigger) | comments are immutable (FR-022) |
| `exception_evidence` | **append-only** (trigger) | items are never edited (FR-023) |
| `exception_evidence_detachments` | **append-only** (trigger) | detaching is a fact, like 005 retractions |
| `teams` | mutable | renamed, never deleted |
| `team_members` | insert and delete | membership changes are audited |
| `notifications` | mutable `read_at` only | read state |

- Append-only tables reuse `forbid_provenance_mutation()` for `UPDATE`, `DELETE` and `TRUNCATE`, exactly as 005 does for evidence notes.
- `exceptions`, `teams` and `exception_snapshots` are referenced with `onDelete: Restrict`, and no route deletes them (FR-028).
- Detachments follow the 005 retraction pattern: a separate table with the evidence id as primary key, so both tables stay insert-only.

**Rationale**: append-only where the spec says "never edited", and plain mutable rows where the spec defines a current state. The audit trail is the single source of history (R11), so no shadow history tables are needed.

**Alternatives rejected**:
- **Event-sourcing the exception** (rebuild state from events): far more code; the audit trail already gives a full history.
- **A JSON column for comments or evidence**: no immutability guarantee, no pagination, no foreign keys.

---

## R3. Exception numbers

**Decision**: `exceptions.number INTEGER UNIQUE` from a Postgres identity sequence (`@default(autoincrement())`), restarted at **10001** by hand-written SQL in the migration (`ALTER SEQUENCE exceptions_number_seq RESTART WITH 10001`). Displayed as `EX-${number}` by `formatExceptionNumber` in shared. Searching accepts `EX-10001`, `ex-10001` or `10001`.

**Rationale**: human-readable, sortable, never reused (spec Assumptions). Sequence gaps after rolled-back transactions are acceptable.

**Alternatives rejected**: a counter table (needs locking), or uuid prefixes (not human-friendly).

**Tests**: never assert absolute numbers after `resetDb` (the sequence is not restarted). Seed tests assert the format only, plus that the reference exception is the first one created on a fresh database.

---

## R4. Status machine as data

**Decision**: the transition table (spec FR-012) is a constant in `packages/shared/src/exceptions.ts`:

```ts
export const EXCEPTION_TRANSITIONS = {
  START:   { from: ['OPEN', 'REOPENED'],                            to: 'IN_PROGRESS', needsOwner: true,  input: null },
  WAIT:    { from: ['OPEN', 'IN_PROGRESS', 'REOPENED'],             to: 'WAITING',     needsOwner: true,  input: 'waitingReason' },
  RESUME:  { from: ['WAITING'],                                     to: 'IN_PROGRESS', needsOwner: true,  input: null },
  RESOLVE: { from: ['OPEN', 'IN_PROGRESS', 'WAITING', 'REOPENED'],  to: 'RESOLVED',    needsOwner: false, input: 'resolutionNote' },
  VERIFY:  { from: ['RESOLVED'],                                    to: 'VERIFIED',    needsOwner: false, input: 'verificationNote' },
  CLOSE:   { from: ['VERIFIED'],                                    to: 'CLOSED',      needsOwner: false, input: null },
  REOPEN:  { from: ['RESOLVED', 'VERIFIED', 'CLOSED'],              to: 'REOPENED',    needsOwner: false, input: 'reopenReason' },
} as const satisfies Record<ExceptionTransition, TransitionRule>;
```

- `allowedTransitionsFrom(status)` returns the actions whose `from` contains `status`, in the constant's key order.
- `applyTransition(row, action, input, actor, now)` (pure, `exceptions/rules/transitions.ts`) returns the field changes of FR-013:
  - leaving WAITING clears `waitingReason`;
  - RESOLVE sets `resolvedAt`, `resolvedById`, `resolutionNote` and `slaOutcome` (R7);
  - VERIFY sets `verifiedAt`, `verifiedById`, `verificationNote`;
  - CLOSE sets `closedAt`, `closedById`;
  - REOPEN clears all of those, sets `reopenCount + 1`, and keeps `slaDueAt`.
- A disallowed pair throws `Errors.invalidState(status, action, allowedTransitionsFrom(status))` (409 `INVALID_STATE`). Its message is `` `${ACTION} is not allowed while the exception is ${STATUS}. Allowed: ${list or 'none'}.` ``
- `needsOwner` with no owner gives 409 `INVALID_STATE` with the message `The exception must be assigned before ${ACTION}.`
- A database `CHECK` mirrors the invariants that do not depend on the path taken (data-model §1b): for example `resolution_note IS NOT NULL` if and only if status is RESOLVED, VERIFIED or CLOSED.

**Rationale**:
- One table drives the API, the permission matrix test (7 × 7) and the UI's action buttons.
- Pure functions make every rule unit-testable without a database.

**Alternatives rejected**:
- **A state-machine library**: a new dependency for 7 rows.
- **Transitions as separate endpoints** (`/start`, `/wait`…): 7 routes with identical shape. One `POST /transitions` with `action` is simpler to validate and to test exhaustively.

---

## R5. Permission policy (pure)

**Decision**: `exceptions/rules/policy.ts` exports:

```ts
interface Actor { id: string; role: Role; teamIds: ReadonlySet<string> }
interface PolicyRow { status; ownerUserId; ownerTeamId; createdById; resolvedById }

isOwner(row, actor)       = row.ownerUserId === actor.id || (row.ownerTeamId !== null && actor.teamIds.has(row.ownerTeamId))
isManager(actor)          = actor.role === 'OPS_MANAGER' || actor.role === 'ADMIN'
isContributor(row, actor) = isManager(actor) || isOwner(row, actor) || row.createdById === actor.id

permissionsFor(row, actor): ExceptionPermissionsDto      // contracts/api.md
canAssign(row, actor, target: OwnerRef | null): boolean
canTransition(row, actor, action): boolean
canDetachEvidence(row, actor, addedById), canUnlink(row, actor, linkedById)
```

The rules are exactly spec FR-016:
- `canAssign`:
  - `target === null` (unassign): `isManager`;
  - `isManager` or `isOwner`: any target;
  - unowned row: a target equal to `{ kind: 'USER', id: actor.id }` or `{ kind: 'TEAM', id ∈ actor.teamIds }`;
  - otherwise false.
- `canTransition`:
  - START, WAIT, RESUME, RESOLVE: `isOwner || isManager`;
  - VERIFY: `isManager && actor.id !== row.resolvedById`;
  - CLOSE: `isManager`;
  - REOPEN: true.
- Escalation without an owner change: any actor. With an owner change: `canAssign`.
- **Team membership counts only for active users**: `actor.teamIds` is loaded per request from `team_members` (the actor is always active, because deactivated users cannot sign in).

**Order of checks** in every mutating service method:
1. load the row, or 404;
2. permission, or `auth.forbidden` audit + 403 (same metadata as `RolesGuard`, plus `exceptionId` and `action`);
3. `expectedVersion`, or 409 `VERSION_CONFLICT` (R6);
4. status, or 409 `INVALID_STATE` (R4, FR-014);
5. semantic validation (deactivated owner, unknown team, severity not higher, etc.), or 400 `VALIDATION_FAILED`.

Permissions are evaluated against the **current** row. The detail response carries `permissions` so the UI shows only allowed actions, and the server enforces them regardless.

**Rationale**: a pure policy gives one place to test every row of FR-016, and the same function feeds both enforcement and the `permissions` DTO, so the UI and the API cannot disagree.

**Alternatives rejected**: `@Roles` decorators (they cannot express ownership or "not the resolver"); CASL or similar (new dependency).

---

## R6. Concurrency: optimistic versioning

**Decision**:
- `exceptions.version INTEGER NOT NULL DEFAULT 1`.
- Every request that changes the exception row (`PATCH`, `assign`, `escalate`, `transitions`, `refresh-analysis`) carries `expectedVersion`.
- Inside the transaction: read the row; run the checks of R5; then `tx.exception.updateMany({ where: { id, version: expectedVersion }, data: { …changes, version: { increment: 1 }, lastActivityAt: now } })`. A count of 0 means another writer won: throw `Errors.versionConflict(currentVersion)` (409 `VERSION_CONFLICT`, detail `{ path: 'expectedVersion', message: 'Current version is N' }`).
- Comments, evidence and links do **not** carry a version and do not bump it. They touch `lastActivityAt` only, with a plain `update` that cannot conflict.
- The response of every mutation is the full `ExceptionDetailResponse`, with the new version.

**Rationale**: spec Story 2 scenario 8 and FR-015. The conditional update closes the race between read and write without `SELECT … FOR UPDATE` or raw SQL. Comments and evidence are additive and never conflict.

**Alternatives rejected**:
- **Last write wins**: silently loses a reassignment.
- **Pessimistic locks**: need raw SQL and hold locks across user think time if misused.
- **ETags/If-Match headers**: equivalent, but less explicit in shared zod schemas and harder to test.

---

## R7. SLA rules

**Decision**:
- **Windows** (shared): `SLA_WINDOW_MS = { CRITICAL: 4h, HIGH: 24h, MEDIUM: 72h, LOW: 168h }`.
- **Stored columns**: `slaDueAt`, plus `slaAtRiskAt = slaDueAt − floor((slaDueAt − createdAt) / 4)` in whole milliseconds, recomputed by the service whenever `slaDueAt` changes (create, edit, escalation), and `slaOutcome` (`MET` | `MISSED` | null), set on RESOLVE and cleared on REOPEN.
- **Status at evaluation time T** (pure `computeSlaStatus` in shared, also used by the web for the countdown):

  ```text
  if status ∈ {RESOLVED, VERIFIED, CLOSED}: slaOutcome         (MET if resolvedAt ≤ slaDueAt, else MISSED)
  else if T > slaDueAt:                     BREACHED
  else if T ≥ slaAtRiskAt:                  AT_RISK
  else:                                     ON_TRACK
  ```

  With whole milliseconds, `T ≥ slaAtRiskAt` is the same as "remaining ≤ 25% of the window" (spec FR-011). Exactly at `slaDueAt` is AT_RISK; 1 ms later is BREACHED.
- **The SLA DTO** carries `dueAt`, `status`, `evaluatedAt`, `windowMs`, `remainingMs` (negative when overdue, null when resolved) and a fixed sentence (contracts/api.md § SLA sentences).
- **Evaluation time**: list and detail accept an optional `evaluatedAt` query (ISO-8601 UTC, as in 005 R7), defaulting to the request time, and echo it. Acceptance tests pin it.
- **List filtering** uses only stored columns, so every SLA filter is a plain indexed `WHERE`:
  - BREACHED: unresolved and `slaDueAt < T`;
  - AT_RISK: unresolved and `slaAtRiskAt ≤ T ≤ slaDueAt`;
  - ON_TRACK: unresolved and `T < slaAtRiskAt`;
  - MET / MISSED: `slaOutcome`.
- The due time can be changed only while unresolved (spec FR-015), so `slaOutcome` never goes stale.

**Rationale**: deterministic, inspectable, cheap to filter. No scores (Constitution III).

**Alternatives rejected**:
- **A Postgres generated column** for `slaAtRiskAt`: Prisma 6 does not support writing models with generated columns cleanly.
- **Computing at-risk in SQL from `created_at` and `sla_due_at`**: needs raw SQL for every list query.
- **Pausing the clock while Waiting**: out of scope (spec Assumptions).

---

## R8. Escalation

**Decision** (pure `exceptions/rules/escalation.ts`):

```text
input: severity? (target), owner? (OwnerRef), reason
raises = severity !== undefined && SEVERITY_RANK[severity] < SEVERITY_RANK[row.severity]   // CRITICAL=0 … LOW=3
ownerChanges = owner !== undefined && !sameOwner(owner, row.owner)
if severity !== undefined && !raises: 400 { path: 'severity', message: 'Severity must be higher than <CURRENT>' }
if !raises && !ownerChanges:          400 { path: 'severity', message: 'Escalation must raise severity or change the owner' }
ownerAfter = ownerChanges ? owner : row.owner
if ownerAfter === null:               400 { path: 'owner', message: 'An escalated exception must have an owner' }
changes:
  severity  = raises ? severity : row.severity
  priority  = raises ? higherPriority(row.priority, DEFAULT_PRIORITY[severity]) : row.priority
  slaDueAt  = raises ? min(row.slaDueAt, now + SLA_WINDOW_MS[severity]) : row.slaDueAt
  slaAtRiskAt recomputed when slaDueAt changes
  owner     = ownerAfter
  escalationCount + 1
notify: ownerAfter (R12), kind ESCALATED
```

- Allowed only while unresolved (409 `INVALID_STATE` otherwise).
- A Critical exception can only be escalated with an owner change (spec Story 4 scenario 3).
- An escalation that changes the owner writes **one** audit row, `exception.escalated`, whose before/after include the owner. It does not also write `exception.assigned`, and it sends only the ESCALATED notification to the new owner (not also ASSIGNED).

- A direct severity change through `PATCH` (Operations Managers and Administrators only, FR-015) changes **only** the severity. Priority and SLA due time are not recomputed; managers change them explicitly if needed. Only escalation applies the automatic rules above.

**Rationale**: spec FR-010. One audit row per user action keeps the history readable (R11).

---

## R9. Snapshots

**Decision**:

**Taking** (`exceptions/snapshot.service.ts`, `SnapshotService.take(subjectId, chosenRootCauseId | null, now, opts)`):
1. `rc = await rootCause.analyze(subjectId, { depth: 6, evaluatedAt: opts.rootCauseEvaluatedAt ?? now.toISOString() })`.
2. Choose the candidate:
   - with `chosenRootCauseId`: the candidate whose `rootCause.id` equals it, or 400 `{ path: 'rootCauseEntityId', message: 'Not a current root-cause candidate of the subject' }`; reason `SELECTED`;
   - otherwise `rc.candidates[0]` if any; reason `FIRST_RANKED`;
   - otherwise none.
3. `anchor = chosen ? chosen.rootCause.id : subjectId`, and `im = await impact.summary(anchor, { depth: 6 })`.
4. Map both with pure `toRootCauseSnapshot(rc, chosenIndex, reason)` and `toImpactSnapshot(im, anchorRole)` into the shared payload schemas (data-model §2b). Parse both with their zod schemas before storing; a parse failure is an internal error, never stored.

Both analyses run **before** the write transaction: they are read-only and can take up to about 2 s each, which must not be spent holding row locks. The snapshot rows are inserted inside the transaction.

**Payloads** are a **subset** of the 005/006 DTOs, built with `.pick()` from their schemas, so a change to those contracts fails typecheck here. They keep exactly what the exception page shows: the root-cause status, summary, candidates, the chosen candidate's headline, confidence, rule outcomes, chain sentences and key evidence; and the impact summary, categories, exposure, limits and anchor. They do **not** keep evidence bundles or paths (size). The live Entity 360 page has those.

**Refresh** (`POST /exceptions/:id/refresh-analysis`): the same steps, with the **current root-cause entity** as `chosenRootCauseId`. If it is still a candidate it is kept (reason `KEPT`); otherwise the first-ranked candidate is taken (reason `FIRST_RANKED`), or none. A refresh never fails because the root cause disappeared. Then, in one transaction:
- insert both snapshots;
- sync the ROOT_CAUSE link (data-model §3c);
- bump the version;
- write one audit row `exception.analysis_refreshed`, whose before/after are the **snapshot digests** (data-model §2c): root-cause label, entity and confidence; impact anchor, order count, customer count and exposure per currency.

**Current snapshot**: the latest row per `(exceptionId, kind)` by `seq`.

**Rationale**:
- §37 asks for "evidence available at the time".
- Choosing the first-ranked candidate is stated in the payload (`chosen.reason`) with every candidate's confidence, so the choice is never silent (Constitution II).
- The impact anchor rule reproduces §16 on the §39 seed: 006 fixture I7 gives 17 orders, 4 customers, 31,400.00 USD.

**Alternatives rejected**:
- **Storing whole responses**: root-cause evidence bundles and impact paths can be hundreds of kilobytes.
- **Computing live on every view**: the case's facts would change after decisions were made, and the detail page would cost two analyses.
- **Accepting snapshots from the client**: untrusted; the server always recomputes.

---

## R10. Creation flow and suggestions

**Decision**:
- `POST /api/exceptions` body: `title`, `type`, `severity`, `subjectEntityId`, optional `description`, `priority`, `owner`, `slaDueAt` (managers only), `rootCauseEntityId`, `relatedEntityIds` (≤ 48), and `createdFrom` (`EXCEPTIONS_AREA` | `ENTITY` | `ROOT_CAUSE`; `SEED` is not accepted from the API).
- Service steps:
  1. `now = new Date()` once.
  2. Validate the subject and related entities exist (400 on `subjectEntityId` / `relatedEntityIds.<i>`), the owner (R13), and `slaDueAt` permission (403 if not a manager, audited).
  3. `snap = SnapshotService.take(...)` (R9).
  4. Transaction: insert the exception (`createdAt = now`, `lastActivityAt = now`, defaults of FR-003), the SUBJECT link, the ROOT_CAUSE link (if any), RELATED links, both snapshots, one `exception.created` audit row (after = the created detail core, data-model §4), and ASSIGNED notifications for the owner (R12).
- **Suggestions** (spec FR-006): pure `suggestExceptionDraft(entity: EntityRefDto): { type: ExceptionType | null; title: string }` in shared, so the web form and tests use the same function. `title = displayName + ' ' + words(currentState)`, where `words` is 005's rule (AT_RISK → "At Risk"). The suggestion table is the constant `EXCEPTION_TYPE_SUGGESTIONS`.
- **Duplicate hint** (FR-009): the form calls `GET /api/exceptions?entityId=<subject>&entityRole=SUBJECT&view=UNRESOLVED&limit=5`. The server does not block.

**Rationale**: the server owns every rule that affects stored data; the client only pre-fills. One transaction makes the exception, its links, snapshots, audit row and notifications appear together or not at all.

---

## R11. Audit and history

**Decision**:
- **One user action, one audit row**, written in the same transaction as the change (spec FR-026). All exception actions use `targetType: 'exception'` and `targetId` = exception id, so the history is a single indexed query.
- **before/after** hold only the changed fields, using `ExceptionDto` field names and DTO values (owners as `{ kind, id, name }`, times as ISO strings). `exception.created` has `before: null` and `after` = the initial core fields. Comment, evidence and link actions put the created or removed item in `after` / `before`.
- **metadata** holds the action detail: `{ transition, note }`, `{ reason }`, `{ notifiedUserIds }`, `{ commentId }`, `{ evidenceId }`, `{ entityId, role }`.
- **History endpoint** (`GET /api/exceptions/:id/history`) reads `audit_entries` where `target_type = 'exception' AND target_id = :id`, ordered by `id ASC`, cursor = last audit id. Open to every signed-in user (unlike `GET /api/audit`).
- **Sentences**: pure `historySentence(entry, names)` in `exceptions/rules/history.ts`, with the templates in contracts/api.md. `names` resolves actor ids to display names in one query. A system actor is "System".
- **Changes list**: `changes = keys(before ∪ after)` in `EXCEPTION_FIELD_ORDER`, each `{ field, label, before, after }`.
- **Refusals**: permission refusals write `auth.forbidden` standalone (not in the history, since `targetType` is null there, as for `RolesGuard`). Validation, version and state refusals write nothing.

New `AUDIT_ACTIONS` (shared):

```ts
EXCEPTION_CREATED: 'exception.created',
EXCEPTION_UPDATED: 'exception.updated',
EXCEPTION_ASSIGNED: 'exception.assigned',
EXCEPTION_ESCALATED: 'exception.escalated',
EXCEPTION_STATUS_CHANGED: 'exception.status_changed',
EXCEPTION_ANALYSIS_REFRESHED: 'exception.analysis_refreshed',
EXCEPTION_COMMENTED: 'exception.commented',
EXCEPTION_EVIDENCE_ADDED: 'exception.evidence_added',
EXCEPTION_EVIDENCE_DETACHED: 'exception.evidence_detached',
EXCEPTION_ENTITY_LINKED: 'exception.entity_linked',
EXCEPTION_ENTITY_UNLINKED: 'exception.entity_unlinked',
TEAM_CREATED: 'team.created',
TEAM_UPDATED: 'team.updated',
TEAM_MEMBER_ADDED: 'team.member_added',
TEAM_MEMBER_REMOVED: 'team.member_removed',
NOTIFICATIONS_READ: 'notification.read',
```

**Rationale**: the spec says the history entries **are** the audit records (FR-027). Reusing them guarantees the history and the audit trail never disagree, and Constitution IV's append-only guarantee covers the history for free.

**Alternatives rejected**: a separate `exception_history` table (two sources of truth); writing one audit row per changed field (noisy, and a single action would be split across rows).

---

## R12. Notifications

**Decision**:
- **Producer API**: `NotificationsService.notify(tx, { kind, exception, actorId, owner, message })`. It resolves recipients **inside the transaction**:
  - user owner: that user, if ACTIVE and not the actor;
  - team owner: every ACTIVE member except the actor, ordered by user id.

  It inserts the rows with `createMany`, and returns the recipient ids, which the caller puts in its audit row's `metadata.notifiedUserIds`. Creating a notification writes no separate audit row: it is part of the audited action.
- **Kinds**: `ASSIGNED` (create with owner, assign, reassign) and `ESCALATED`. Unassigning notifies nobody.
- **Messages**: fixed templates (contracts/api.md § Notification messages), rendered once at creation and stored, so a later rename does not rewrite old notifications.
- **Reads**:
  - `GET /api/notifications?unread=&cursor=&limit=`: the caller's own, newest first (`createdAt DESC, id DESC`);
  - `GET /api/notifications/unread-count`;
  - `POST /api/notifications/:id/read`: 404 if it does not exist **or belongs to someone else** (no existence leak); idempotent;
  - `POST /api/notifications/read-all`: sets `read_at` on all the caller's unread rows.
- **Audit of reads**: one `notification.read` row per request that changed something, `targetType: 'user'`, `targetId` = caller, `metadata: { notificationIds }` (capped at 1,000 ids, plus `count`). A request that marks nothing writes nothing.
- **Delivery**: the web polls `unread-count` every 30 s (TanStack Query `refetchInterval: 30_000`, also on window focus). No websockets or server-sent events.

**Rationale**: spec FR-020, FR-021 and SC-004 with no new dependency. Resolving recipients in the same transaction as the change means a membership change cannot slip between them.

**Alternatives rejected**:
- **Fan-out at read time** (store one row per team notification and join members): unread state is per user, so it needs per-user rows anyway.
- **Server-sent events**: infrastructure and testing cost beyond the 30 s requirement.

---

## R13. Teams and the owner directory

**Decision**:
- **Teams**: `teams(id, name, description, created_at, updated_at)` with a unique index on `lower(name)` (hand-written SQL). A violation maps to 409 `TEAM_NAME_TAKEN`. Names are trimmed; internal whitespace is kept.
- **Members**: `team_members(team_id, user_id, added_at, added_by_id)`, primary key `(team_id, user_id)`. Adding an existing member or removing a non-member is a no-op 200 with no audit row. Deactivated users stay members (and are shown as deactivated), but receive no notifications and do not count as owners because they cannot sign in.
- **Routes**: `GET /api/teams` and `GET /api/teams/:id` for every signed-in user; create, rename and membership changes are `@Roles('ADMIN')`, so `RolesGuard` audits refusals.
- **Owner directory**: `GET /api/owner-directory?q=` returns up to 20 ACTIVE users and 20 teams whose name (or user email) contains `q` (case-insensitive), each ordered by name then id. Without `q`, it returns the first 20 of each. It is open to every signed-in user and returns only `id`, `displayName`, `email` and `role` for users, and `id`, `name`, `memberCount` for teams.
- **Owner reference** (shared): `OwnerRefSchema = discriminatedUnion('kind', [{ kind: 'USER', userId }, { kind: 'TEAM', teamId }])`. An unknown or deactivated user, or an unknown team, is 400 on `owner.userId` / `owner.teamId`.

**Rationale**: `GET /api/users` is ADMIN-only and returns more than an owner picker needs. A dedicated directory exposes the minimum.

---

## R14. Exceptions list: filters, sorts and cursors

**Decision**:
- **Query** (`ExceptionListQuerySchema`, contracts/api.md): `view`, `status[]`, `severity[]`, `type[]`, `priority[]`, `owner`, `sla[]`, `entityId`, `entityRole`, `q`, `sort`, `evaluatedAt`, `cursor`, `limit`. Array parameters accept repeated keys or comma-separated values.
- **Where**: the view and the filters are combined with AND (data-model §5a). `owner=MY_TEAMS` expands to the caller's team ids (an empty set matches nothing). `q` matching `^(EX-)?\d+$` (case-insensitive) filters by number; otherwise `title ILIKE '%q%'` (Prisma `contains`, `mode: 'insensitive'`).
- **Sorts**, each ending with a unique tie-break:

  | `sort` | Order |
  |---|---|
  | `SLA_DUE` (default) | `slaDueAt ASC, number ASC` |
  | `SEVERITY` | `severity ASC` (enum order CRITICAL…LOW), `slaDueAt ASC, number ASC` |
  | `PRIORITY` | `priority ASC` (P1…P4), `slaDueAt ASC, number ASC` |
  | `NEWEST` | `createdAt DESC, number DESC` |
  | `UPDATED` | `lastActivityAt DESC, number DESC` |

- **Cursor**: `encodeCursor({ s: sort, k: [...sortKeyValues, number] })`. The next page uses a keyset `OR` chain built by pure `keysetWhere(sort, key)`. A cursor whose `s` differs from the query's sort is 400 on `cursor`.
- **Total**: `prisma.exception.count({ where })`, returned as `total`.
- **Indexes** (data-model §1a): `(status, sla_due_at, number)`, `(owner_user_id, status)`, `(owner_team_id, status)`, `(severity, sla_due_at)`, `(priority, sla_due_at)`, `(created_at DESC, number DESC)`, `(last_activity_at DESC, number DESC)`, `(sla_at_risk_at)`, and `exception_entities(entity_id, role)`.
- **Row DTO** (`ExceptionSummaryDto`) includes the subject `EntityRefDto`, the owner with `active`, and the SLA DTO computed at `evaluatedAt`.

**Rationale**: Prisma's typed `where` and `orderBy` cover everything once SLA thresholds are stored (R7). Enum sort order in Postgres follows declaration order, so CRITICAL must be declared first.

**Alternatives rejected**: offset pagination (skips or repeats rows when data changes, spec Story 3 scenario 4); raw SQL (not needed).

---

## R15. Seed

**Decision**: `ExceptionsSeedService.seedReference()` (in `exceptions/seed/`) runs from `prisma/seed.ts` after the §39 and §40 datasets, idempotently:
1. Teams **Finance Operations** (member: `manager@opsgraph.local`) and **Warehouse Operations** (member: `analyst@opsgraph.local`), created only if no team of that name exists, each with a `team.created` and `team.member_added` audit row (`actorType: 'system'`).
2. The **§16 reference exception**, created only if no exception with `createdFrom = 'SEED'` exists, through `ExceptionsService.create` with a system actor and `rootCauseEvaluatedAt = '2026-09-29T16:00:00Z'`:
   - title `Shipment SHP-77120 (consolidated) Delayed`, type `SHIPMENT_DELAY`, severity `CRITICAL`, owner team Finance Operations;
   - description `Consolidated shipment held because Order #18492 cannot be released: finance approval APR-2291 is waiting for a budget code.`;
   - subject Shipment SHP-77120, root cause BR-18492 (first-ranked; R2 of 005 gives exactly one candidate, HIGH);
   - impact anchored on BR-18492 (006 fixture I7).

   This creates one ASSIGNED notification for the Operations Manager, with actor "System".

The seed prints `exceptions seeded` or `exceptions already present`.

**Rationale**: spec FR-032 and SC-007. Going through the service guarantees the seed exercises the same code as the API, including audit and notifications. Pinning the root-cause evaluation time keeps the seeded confidence HIGH forever (005 R7).

---

## R16. Web design

**Decision**:

**Routes** (`router.tsx`):
- `exceptions` → `ExceptionsListPage` (replaces `ComingSoonPage`);
- `exceptions/new` → `ExceptionCreatePage` (`?subject=<id>&rootCause=<id>&from=ENTITY|ROOT_CAUSE`);
- `exceptions/:id` → `ExceptionDetailPage` (`?tab=overview|comments|evidence|history`);
- `admin/teams`, `admin/teams/:id` under `RequireRole role="ADMIN"`.

**List page** (`pages/exceptions/`):
- quick-view tabs, a filter bar, a sort `<select>`, a search box, and a table;
- all state in the URL (`exceptions-params.ts`: parse, serialize, defaults omitted; invalid values ignored, as in 003's `tracing-params.ts`);
- `useExceptions(params)`: an infinite query with key `['exceptions', 'list', params]`, "Load more", and the total.

**Create page**: subject picker (entity search via `GET /api/entities?q=`) or prefilled subject; the suggestion of `suggestExceptionDraft`; duplicate hint (R10); owner picker (`OwnerPicker` over `useOwnerDirectory`); severity; optional priority, description and (managers only) SLA due time. On success it navigates to the detail page.

**Detail page**:
- **Header**: number, title, type, `SeverityBadge`, `PriorityBadge`, `StatusBadge`, owner (with "deactivated" mark), `SlaBadge` (status, due time, remaining/overdue time), and action buttons from `permissions`;
- **Dialogs**: Edit, Assign, Escalate, one `TransitionDialog` per action needing input, Refresh analysis (confirm). Each sends `expectedVersion`. A 409 `VERSION_CONFLICT` shows "This exception was changed by someone else. Reload to see the latest version." with a Reload button;
- **Tabs**:
  - Overview: description, waiting/resolution/verification details, `RootCauseSnapshotView`, `ImpactSnapshotView`, `LinkedEntities`;
  - Comments: list and form;
  - Evidence: attached items, detached items, and key evidence from the snapshot;
  - History: `HistoryList` with sentences and before → after tables.

**Snapshot views** reuse `StateBadge`, `OriginBadge` and `formatMoney`, and state the snapshot time and anchor in their first line ("Impact of Budget code for Order #18492 (root cause), taken 2026-10-07 09:12"). They link to the live Entity 360 sections (`/entities/:id#root-cause`, `#impact`).

**Entity 360**:
- `EntityExceptionsSection` (`id="exceptions"`) between `ImpactSection` and `DependenciesSection`, using `useExceptions({ entityId, sort: SLA_DUE, view: ALL })` sorted client-side unresolved first (the first page of 20 is enough; it links to the full list);
- a header badge "N unresolved exceptions" from `GET /api/exceptions?entityId=&view=UNRESOLVED&limit=1` (`total`);
- a "Create exception" button in the header;
- a "Create exception from this root cause" link on each `RootCauseCandidate`.

**Header bell** (`layout/NotificationBell.tsx`): unread count from `useUnreadCount` (30 s polling), a dropdown with `useNotifications` (infinite), "Mark all read", and selecting an item marks it read and navigates to the exception.

**Admin**: `TeamsListPage` (list and create) and `TeamDetailPage` (rename, description, add member via user search, remove member). Nav link "Teams" next to "Users".

**Cache invalidation**: every exception mutation invalidates `['exceptions']` and `['notifications']`; team mutations invalidate `['teams']` and `['owner-directory']`.

**Rules**: parse every response with its shared schema through `apiFetch`; badges are text plus colour; each section and tab handles its own loading and error state; never use `localeCompare`.

**Rationale**: spec Stories 1 to 6, FR-024 to FR-031. It follows the 003–006 patterns: URL state, sections that fail independently, and server-provided permissions.

---

## R17. Testing strategy

**Jest unit tests** (pure modules):
- `rules/transitions.spec.ts`: all 49 action/status pairs against `EXCEPTION_TRANSITIONS`, the field changes of every transition, `needsOwner`, and the error messages.
- `rules/policy.spec.ts`: every row of FR-016 for 6 actors (owner user, team member, non-member analyst, creator, manager, admin) plus the resolver for VERIFY.
- `rules/escalation.spec.ts`: raise only, owner only, both, Critical without owner, same severity, lower severity, no owner after, priority max, SLA min (both directions).
- `rules/history.spec.ts`: every sentence template, field ordering, the System actor.
- `rules/notification-message.spec.ts`: every template.
- `rules/list-query.spec.ts`: `buildWhere` for every view and filter, `keysetWhere` for every sort.
- `snapshot.mapper.spec.ts`: candidate choice (selected, first-ranked, none), anchor rule, digest.
- **shared** (Vitest): `computeSlaStatus` boundaries (25% exact, due exact, +1 ms, resolved MET/MISSED), `suggestExceptionDraft` table, schemas.

**Jest + supertest e2e** (real Postgres):
- `exceptions-seed.e2e-spec.ts`: fixtures X1 to X3 on the seeded database (contracts/api.md).
- `exceptions.e2e-spec.ts`: create (each origin), validation, detail, edit, version conflicts, every transition end to end (fixture X4), escalation (X6), assignment rules (X5), closed-state refusals, audit rows with before/after, history equality with audit (SC-003).
- `exception-collab.e2e-spec.ts`: comments, evidence (both kinds), detach permissions, links and unlink rules, append-only enforcement at the database (UPDATE/DELETE raise).
- `exceptions-list.e2e-spec.ts`: a built set of 14 exceptions (fixture X8) with pinned `evaluatedAt`: every view, filter, sort, paging without gaps, determinism (SC-008).
- `teams.e2e-spec.ts`: CRUD, case-insensitive uniqueness, membership no-ops, ADMIN-only with `auth.forbidden`, owner directory.
- `notifications.e2e-spec.ts`: recipients (user, team, self, deactivated), list, count, read, read-all, isolation between users, audit of reads.
- `authz-matrix.e2e-spec.ts`: rows for all 27 routes.
- `perf-exceptions.e2e-spec.ts` (`RUN_PERF=1`): 10,000 exceptions, every view and sort, p95 < 1 s (SC-005).

**Vitest (web)**: `exceptions-params.test.ts`; one test file per new component; `ExceptionDetailPage` showing only permitted actions; the conflict message; `EntityDetailPage` section order; `NotificationBell` polling and read flow.

**`resetDb`**: add the 9 new tables to `TRUNCATE`, and `DISABLE/ENABLE TRIGGER USER` for the 4 append-only ones.

---

## R18. Performance

**Budget** (SC-005):

| Operation | Budget | How |
|---|---|---|
| List first page, any view/sort, 10k rows | < 1 s p95 | indexed `WHERE` + keyset + one `count` |
| Detail (header + current snapshots) | < 2 s | 1 row + links + 2 latest snapshots + permissions; no analysis |
| Create / refresh | < 5 s | 005 (< 1.5 s) + 006 (< 2 s) + one short transaction |
| Unread count | < 100 ms | partial index on `(recipient_id) WHERE read_at IS NULL` |

Create and refresh are not in the spec's success criteria; their budget follows from the 005 and 006 budgets. The perf test seeds 10,000 exceptions with `createMany` across owners, statuses and due times, and records timings in quickstart.md.

---

## R19. Dependencies

**Decision**: **none**. Postgres features used: identity sequences, `CHECK`, functional unique index (`lower(name)`), partial index, triggers. The web UI uses existing React, React Router, TanStack Query and Tailwind primitives.
