# Implementation Plan: Exception Management and Ownership

**Branch**: `007-exception-management` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-exception-management/spec.md`

## Summary

OpsGraph turns an operational problem into an **exception**: a structured case with a number (EX-10001), title, type, severity, priority, status, an owner (user or **team**), a subject entity and other linked entities, an SLA due time, comments, evidence and a full history (Product Overview §16, §35, §49).

- **Lifecycle**: status moves only through a 7-row transition table (Start work, Wait, Resume, Resolve, Verify, Close, Reopen) with required notes, owner rules and four-eyes verification.
- **Ownership**: assign, reassign and escalate (raise severity, tighten SLA, optionally change owner), with **in-app notifications** to the new owner.
- **Analysis snapshots**: at creation, OpsGraph freezes a **root-cause snapshot** of the subject (feature 005) and an **impact snapshot** (feature 006) of the root-cause entity, or of the subject when there is none. Users can refresh them while the exception is unresolved.
- **Exceptions area**: quick views (Open, Critical, Assigned to me, My teams, SLA at risk, Unresolved, All), filters, five sorts and keyset paging.
- **History**: every mutation writes one audit row; the History tab **is** those rows, rendered with fixed sentences and before/after values.
- **Seed**: two teams and the §16 reference exception (Critical, Finance Operations, Budget Code Missing, 17 orders, 4 customers, 31,400.00 USD).

**Approach** (research R1–R16):
1. **Storage**: one migration with 9 tables. The case row is mutable with an optimistic `version`; snapshots, comments, evidence and detachments are append-only (existing trigger function).
2. **Rules as pure code**: transition table, permission policy, SLA status, escalation, history sentences and notification messages are pure modules, shared where the web needs them, and exhaustively unit-tested.
3. **Snapshots reuse 005 and 006 unchanged**: `RootCauseService.analyze` and `ImpactService.summary` are called before the write transaction, and their responses are stored as validated subsets.
4. **Modules**: new `exceptions` and `notifications` modules; teams and the owner directory go in `users`.
5. **Web**: an Exceptions list, create and detail pages, an Entity 360 Exceptions section and create buttons, a header notification bell (30 s polling), and Admin → Teams.

All design decisions are in [research.md](./research.md) and are binding. The exact expected results are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures X1–X9.

## Prerequisites

- **Features 005 and 006 must be merged into this branch before implementation starts** (rebase `007-exception-management` onto `main` once they land). This feature calls `RootCauseService` and `ImpactService` and reuses their shared schemas (data-model §2b). If either is missing, stop and write the question in `questions.md`.
- Feature 004 (graph explorer) is independent of this feature.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS. Unchanged.

**Primary Dependencies**: unchanged. NestJS 11, Prisma 6, zod 3, React 19, React Router 7, TanStack Query 5, Tailwind 4. **No new dependencies** (research R19).

**Storage**: PostgreSQL 16 via Prisma 6.
- **One migration** (`<timestamp>_exceptions_teams_notifications`):
  - 10 enums and 9 tables (data-model §1a);
  - hand-written SQL: the number sequence restart, case-insensitive team-name index, CHECK constraints, partial unique and partial indexes, append-only triggers on 4 tables (data-model §1b).
- **Reads**: the new tables, `audit_entries` (history), `users`, `entities`, `source_records` (evidence), plus whatever 005 and 006 read.

**Testing**:
- **Jest unit tests** for every pure rule module (transitions 7 × 7, policy matrix, escalation, history, messages, list query) and the snapshot mappers.
- **Jest + supertest e2e** against real Postgres:
  - fixtures X1–X9 (seed, lifecycle, assignment, escalation, collaboration, list, creation variants);
  - audit/history equality, version conflicts, append-only enforcement;
  - teams, owner directory and notifications;
  - the authz matrix for all 27 routes.
- **Vitest** for shared schemas and rules (`computeSlaStatus`, `suggestExceptionDraft`) and web components.
- **Performance suite** behind `RUN_PERF=1`.

**Target Platform**: Linux server (API), evergreen browsers (web).

**Project Type**: Web application (pnpm monorepo: api + web + shared).

**Performance Goals** (SC-005): list first page p95 < 1 s with 10,000 exceptions for every view and sort; detail page < 2 s; unread count < 100 ms. Create and refresh are bounded by 005 + 006 (< 5 s).

**Constraints**:
- no `any`, no new dependencies;
- no traversal SQL anywhere in this feature (all graph work is inside 005/006 services);
- one audit row per user action, in the same transaction as the change;
- every exception-row mutation uses the conditional `version` update;
- analyses run **outside** write transactions;
- pure modules never read the clock; services read `now` once per request;
- all ordering in SQL uses unique tie-breaks; in-memory ordering uses `compareCodeUnits`;
- the §39 and §40 seed output is unchanged.

**Scale/Scope**:
- 27 endpoints (16 exceptions, 7 teams/directory, 4 notifications);
- 1 migration;
- 2 new Nest modules (+ teams in `users`);
- about 8 pure rule modules;
- about 25 web components, 10 hooks, 5 pages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | Source-record evidence shows source system, source id, observation time and entity. Root-cause snapshots keep the key evidence records with their provenance; impact snapshots keep the anchor and analysis time. Exceptions are user-created (MANUAL) records with author and time on every row, comment, evidence item, link and snapshot. |
| II. Fact vs Inference | ✅ | Evidence items carry `origin` (SOURCE for source records, MANUAL for notes). Snapshots keep 005's confidence, every rule outcome and the "insufficient evidence" heading, and 006's inferred-only counts and exposure share; the UI shows them verbatim. An automatically chosen root cause is labeled FIRST_RANKED, with every candidate's confidence listed. Snapshots are labeled with their time and never presented as current. **Conflicts**: 005's disagreement reasons are kept in the snapshot; this feature adds no new data that could conflict. |
| III. Explainability & Determinism | ✅ | No scores. SLA status is a published rule (25% threshold) with a sentence stating due time, remaining time and window. Escalation effects (priority max, SLA min) are fixed rules shown in history. Transition refusals name the allowed actions. Lists are deterministic with unique tie-breaks and a pinnable `evaluatedAt` (SC-008). No AI. |
| IV. Auditability | ✅ | Every mutation (27 routes' writes, seed included) writes one audit row with actor, action, target, before, after and time, in the same transaction. Permission refusals write `auth.forbidden`. The History tab reads the append-only audit table, so history cannot diverge or be edited. Snapshots, comments, evidence and detachments are append-only at the database level. |
| V. Test-Gated Changes | ✅ | All 27 endpoints have zod schemas in `@opsgraph/shared` and e2e tests for success, 401, validation, and 403/404/409 where they apply, plus authz-matrix rows. No graph traversal code is added. Rule modules have exhaustive unit tests (49 transitions, every policy row). |
| VI. MVP Scope Discipline | ✅ | Answers §65 "Who owns the problem?" and supports "What should happen next?" and "What evidence supports this?". §61 lists "exceptions" in the MVP. No workflows, automation, email, risk scoring, investigations or contract SLA management (spec Assumptions). |
| Tech constraints | ✅ | Strict TS, no new dependencies, no traversal outside `GraphRepository` (none at all here). One new module outside CLAUDE.md's list is justified below. |

**Post-design re-check**: ✅ No unjustified violations. Three deliberate choices are listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/007-exception-management/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/api.md           # routes, schemas, text templates, fixtures X1–X9
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (new and changed files only)

```text
packages/shared/src/
├── common.ts                  # + ErrorCode VERSION_CONFLICT, INVALID_STATE, TEAM_NAME_TAKEN
├── audit.ts                   # + 16 AUDIT_ACTIONS (research R11)
├── exceptions.ts              # NEW: constants, rules (computeSlaStatus, suggestExceptionDraft, slaAtRiskAt,
│                              #      formatExceptionNumber), snapshot payloads, request/response schemas
├── teams.ts                   # NEW: team + owner-directory schemas
├── notifications.ts           # NEW
├── state-words.ts             # NEW only if 005 keeps `words` API-side (data-model §2a note)
├── *.spec.ts                  # NEW exceptions.spec.ts, teams.spec.ts, notifications.spec.ts
└── index.ts                   # + 3 exports

apps/api/prisma/
├── schema.prisma              # + 10 enums, 9 models, back-relations (data-model §1a)
├── migrations/<ts>_exceptions_teams_notifications/migration.sql   # generated + data-model §1b SQL
└── seed.ts                    # + ExceptionsSeedService.seedReference()

apps/api/src/
├── app.module.ts                          # + ExceptionsModule, NotificationsModule
├── common/errors/app-error.ts             # + Errors.versionConflict, invalidState, teamNameTaken
├── root-cause/root-cause.module.ts        # + exports: [RootCauseService]
├── impact/impact.module.ts                # + exports: [ImpactService]
├── users/
│   ├── users.module.ts                    # + TeamsController, OwnerDirectoryController, TeamsService (exported)
│   ├── teams.controller.ts                # NEW (routes 17–22)
│   ├── teams.service.ts                   # NEW (+ teamIdsOf(userId), activeMemberIds(teamId, tx))
│   ├── team.mapper.ts                     # NEW
│   └── owner-directory.controller.ts      # NEW (route 23; service method on TeamsService)
├── notifications/                         # NEW module
│   ├── notifications.module.ts
│   ├── notifications.controller.ts        # routes 24–27
│   ├── notifications.service.ts           # notify(tx, …), list, unreadCount, markRead, markAllRead
│   └── notification.mapper.ts
└── exceptions/                            # NEW module
    ├── exceptions.module.ts               # imports RootCauseModule, ImpactModule, NotificationsModule, UsersModule
    ├── exceptions.controller.ts           # routes 1–8, 16
    ├── exception-collab.controller.ts     # routes 9–15
    ├── exceptions.service.ts              # create, update, assign, escalate, transition, refreshAnalysis
    ├── exceptions-query.service.ts        # list, detail, history
    ├── exception-collab.service.ts        # comments, evidence, links
    ├── snapshot.service.ts                # take (data-model §3b)
    ├── snapshot.mapper.ts                 # pure: toRootCauseSnapshot, toImpactSnapshot, digestOf
    ├── exception.mapper.ts                # rows → DTOs, ExceptionCore
    ├── actor.ts                           # Actor loading (data-model §3d)
    ├── rules/                             # pure: no Nest, no Prisma client, no clock
    │   ├── transitions.ts  policy.ts  escalation.ts  history.ts
    │   ├── notification-message.ts  list-query.ts  diff.ts
    │   └── *.spec.ts                      # one per module
    ├── seed/exceptions-seed.service.ts    # research R15
    └── *.spec.ts                          # snapshot.mapper.spec.ts, exception.mapper.spec.ts

apps/api/test/
├── helpers.ts                             # resetDb: + 9 tables, 4 trigger pairs; + insertExceptionFixture, createTestUser reuse
├── exceptions-seed.e2e-spec.ts            # NEW: X1–X3
├── exceptions.e2e-spec.ts                 # NEW: X4–X6, X9, validation, conflicts, audit = history
├── exception-collab.e2e-spec.ts           # NEW: X7, append-only
├── exceptions-list.e2e-spec.ts            # NEW: X8, determinism (SC-008)
├── teams.e2e-spec.ts                      # NEW
├── notifications.e2e-spec.ts              # NEW
├── seed.e2e-spec.ts                       # + exceptions block (idempotency)
├── authz-matrix.e2e-spec.ts               # + 27 rows
└── perf-exceptions.e2e-spec.ts            # NEW: RUN_PERF=1 only

apps/web/src/
├── router.tsx                             # exceptions, exceptions/new, exceptions/:id, admin/teams, admin/teams/:id
├── layout/
│   ├── AppShell.tsx                       # + NotificationBell, + "Teams" admin link
│   ├── NotificationBell.tsx (+ .test.tsx) # NEW
│   └── useNotifications.ts                # NEW: useUnreadCount (30 s), useNotifications, mark mutations
├── pages/exceptions/                      # NEW
│   ├── exceptions-params.ts (+ .test.ts)  # URL state (research R16)
│   ├── useExceptions.ts  useException.ts  useExceptionMutations.ts  useExceptionTabs.ts  useOwnerDirectory.ts
│   ├── ExceptionsListPage.tsx  ExceptionCreatePage.tsx  ExceptionDetailPage.tsx
│   ├── ExceptionFilters.tsx  ExceptionTable.tsx
│   ├── SeverityBadge.tsx  PriorityBadge.tsx  StatusBadge.tsx  SlaBadge.tsx  OwnerLabel.tsx  OwnerPicker.tsx
│   ├── ExceptionHeader.tsx  ExceptionActions.tsx
│   ├── EditDialog.tsx  AssignDialog.tsx  EscalateDialog.tsx  TransitionDialog.tsx
│   ├── RootCauseSnapshotView.tsx  ImpactSnapshotView.tsx  LinkedEntities.tsx
│   ├── CommentsTab.tsx  EvidenceTab.tsx  HistoryTab.tsx
│   ├── exceptions-test-data.ts
│   └── *.test.tsx                         # one per component/page
├── pages/entities/
│   ├── EntityDetailPage.tsx               # + header badge + "Create exception", + EntityExceptionsSection after ImpactSection
│   ├── EntityExceptionsSection.tsx (+ .test.tsx)   # NEW
│   └── RootCauseCandidate.tsx             # + "Create exception from this root cause" link
└── pages/admin/
    ├── TeamsListPage.tsx (+ .test.tsx)    # NEW
    └── TeamDetailPage.tsx (+ .test.tsx)   # NEW
```

**Structure Decision**: the existing pnpm monorepo.
- Exception logic goes in the `exceptions` bounded context listed in CLAUDE.md.
- Notifications get their own small module (Complexity Tracking); teams extend `users`.
- Web work is a new `pages/exceptions/` folder; Entity 360 gets one section and two buttons.

## Key Design Notes (for the implementer)

1. **Build order.** Each step is independently testable. Do not start a step before the previous one's tests pass.
   1. **Shared**: error codes, audit actions, `exceptions.ts` constants and pure rules (`computeSlaStatus`, `slaAtRiskAt`, `suggestExceptionDraft`, `formatExceptionNumber`), then the schemas; `teams.ts`; `notifications.ts`; their specs. Rebuild shared.
   2. **Migration**: `schema.prisma`, then `prisma migrate dev --create-only`, then append data-model §1b (check the sequence name first), then apply. Update `resetDb`. Run the whole suite: every existing test must pass unchanged.
   3. **Teams**: `TeamsService`, `TeamsController`, `OwnerDirectoryController`, then `teams.e2e-spec.ts` and authz rows.
   4. **Notifications**: `NotificationsService` (`notify` first, unit-tested through e2e with a built exception row), controller, `notifications.e2e-spec.ts`.
   5. **Exception rules** (pure), in order: `transitions`, `policy`, `escalation`, `diff`, `notification-message`, `history`, `list-query`, each with its spec.
   6. **Snapshots**: export the 005/006 services, `snapshot.mapper` (+ spec), `SnapshotService`.
   7. **Exceptions API**: `actor`, `exception.mapper`, `ExceptionsService.create`, `ExceptionsQueryService.detail`, then update/assign/escalate/transition/refresh, then list and history, then `ExceptionCollabService`. Then `exceptions.e2e-spec.ts`, `exception-collab.e2e-spec.ts`, `exceptions-list.e2e-spec.ts` and authz rows.
   8. **Seed**: `ExceptionsSeedService`, `prisma/seed.ts`, `exceptions-seed.e2e-spec.ts`, the `seed.e2e-spec.ts` block.
   9. **Web**: hooks and params; badges, `OwnerPicker`, snapshot views; list page; create page; detail page with dialogs and tabs; Entity 360 integration; bell; admin teams.
   10. **Performance**: `perf-exceptions.e2e-spec.ts`. Record timings in quickstart.md §4.
2. **Every mutating service method** follows research R5's check order: 404 → 403 (audited) → 409 `VERSION_CONFLICT` → 409 `INVALID_STATE` → 400. Then one `$transaction` containing: the conditional update (or inserts), the audit row, and notifications. Read `now = new Date()` once, before anything else, and pass it everywhere (`createdAt`, `lastActivityAt`, notification `createdAt`, snapshot `takenAt`, root-cause `evaluatedAt`).
3. **Snapshots**: call `SnapshotService.take` **before** `$transaction`. Never call 005/006 inside a transaction. Parse payloads with their zod schemas before insert and after read; a parse failure on read is an internal error (it means a contract drifted), never silently dropped.
4. **Audit rows**: exactly one per user action. Escalation with an owner change is **one** `exception.escalated` row (not also `assigned`). Root-cause link changes on refresh live inside `exception.analysis_refreshed`. No-ops write nothing and do not bump the version.
5. **Policy**: never inline permission checks in services; always call `rules/policy.ts`. The detail's `permissions` comes from the same functions. VERIFY by the resolver is 403 even for an Administrator.
6. **SLA**: `slaAtRiskAt` must be recomputed in every code path that changes `slaDueAt` (create, PATCH, escalate). `slaOutcome` is set only by RESOLVE and cleared only by REOPEN. Use integer milliseconds; never floating-point quarters.
7. **History**: `GET …/history` reads `audit_entries` (`target_type = 'exception'`). Resolve actor names in one `user.findMany`. Do not create a history table.
8. **Notifications**: resolve recipients inside the action's transaction (active users only, excluding the actor), insert with `createMany`, and put the ids in the audit row's `metadata.notifiedUserIds`. Messages are rendered once and stored.
9. **Web specifics** (research R16):
   - Parse every response with its shared schema through `apiFetch`.
   - Show only the actions in `permissions`; send `expectedVersion` from the loaded detail; handle 409 `VERSION_CONFLICT` with the reload message, and 409 `INVALID_STATE` by showing the server message and refetching.
   - Badges are text plus colour. Snapshot views state their time and anchor in their first line and link to the live Entity 360 section.
   - The Entity 360 Exceptions section has `id="exceptions"` and handles its own loading and error state; it must not blank the page.
   - The bell polls `unread-count` every 30 s and on window focus; it never polls the full list.
10. **Pitfalls**:
    - `noUncheckedIndexedAccess` is on. Use `.at()` with checks and invariant `Error`s, never `!`.
    - Never use `localeCompare`.
    - Postgres enum order is declaration order: keep `CRITICAL` first and `P1` first.
    - A Postgres enum value added in a migration cannot be used in that same migration (no data migration needed here).
    - Prisma reports violations of the hand-written `lower(name)` index as `P2002`; map it to `TEAM_NAME_TAKEN`.
    - `resetDb` does not restart the number sequence; tests must not assert absolute numbers except on a freshly migrated and seeded database (X2).
    - Deactivated users cannot sign in, so the `Actor` is always active; but owners and members may be deactivated: check `status` when notifying and when assigning.
    - The seed's system actor has no user id: write audit rows with `actorType: 'system'` and store `createdById`/`linkedById`/`takenById` as null.
11. **Do not**:
    - add traversal or recursive SQL, or call `GraphRepository`/`TracingService` from `exceptions`;
    - change 005 or 006 response shapes, rules or text;
    - add email, websockets, workflows, automation or risk features;
    - add edit or delete endpoints for comments, evidence, snapshots or exceptions, or a delete endpoint for teams;
    - add dependencies;
    - change §39 or §40 seed rows;
    - edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, the constitution or CLAUDE.md.

    Ambiguities go to `questions.md`.
12. **Entity 360 order** after 005, 006 and 007: Identity (with the exceptions badge and "Create exception"), Current state, Root cause, Blockers, Impact, **Exceptions**, Dependencies, Relationships, Timeline, Source records. Update the `EntityDetailPage` order test accordingly.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New `notifications` Nest module, not in CLAUDE.md's module list | Notifications are app-wide (header bell, `/api/notifications`) and will gain producers beyond exceptions (§50 risk alerts). A separate module keeps the dependency one-way: `exceptions → notifications`. | Putting them in `exceptions` would make a generic, user-scoped API part of the exception context, and a future producer would have to import `exceptions`. The module is 4 small files. |
| History read from `audit_entries` instead of a dedicated history table | Spec FR-027 says the history entries are the audit records; Constitution IV makes them append-only. | A history table duplicates every write and can drift from the audit trail. |
| Snapshots store subsets of 005/006 responses as JSON | §37 requires "evidence available at the time"; the shapes are owned by 005/006 and validated with their schemas (`.pick()`), so drift fails typecheck. | Normalizing snapshots into tables would duplicate the 005/006 models. Storing whole responses is unbounded in size. Recomputing live changes a case's facts after decisions were made. |
