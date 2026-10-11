# Implementation Plan: Investigation Workspace

**Branch**: `008-investigation-workspace` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-investigation-workspace/spec.md`

## Summary

OpsGraph turns a question about one operational entity ("Why is Order #18492 delayed?") into an **investigation**: a persistent workspace with a number (INV-10001), title, severity, owner, status (Open, Resolved, Closed), a focus entity, pinned results, a computed scope, linked exceptions, decisions, notes and a full history (Product Overview §9, §23, §39, §48).

- **Pins**: root-cause (005) and impact (006) results frozen at a time, using **the same snapshot mechanism as 007's exceptions**, generalized into one `analysis_snapshots` table and one `SnapshotService`. Users pin, re-pin and unpin; the current pin of each kind drives the Overview, the scope and the list filters.
- **Workspace tabs**: Overview (current state live, pinned root cause, immediate blocker, key numbers, live-vs-pinned differences), Graph (004 explorer), Root Cause (005), Impact (006), Timeline (merged events and state changes of the scope), Related Entities (scope with reasons), Evidence, Actions (linked 007 exceptions), Decisions (with frozen context and citations), Notes, History.
- **Lifecycle**: Resolve → Close → Reopen, Close only when every linked exception is resolved.
- **Investigations area**: quick views (Open, Mine, Critical, SLA risk, Recurring root cause, All), filters, three sorts and keyset paging.
- **History**: every mutation writes one audit row; the History tab **is** those rows.
- **Seed**: INV-10001, the §39 investigation (Critical, Budget Code Missing HIGH, 17 orders, 4 customers, 3 SLA commitments, 31,400.00 USD, EX-10001 linked).

**Approach** (research R1–R18):
1. **Storage**: one migration that renames 007's `exception_snapshots` to `analysis_snapshots` with exactly one owner (exception or investigation) and three denormalized columns, and adds 6 tables. Pins, unpins, decisions and notes are append-only.
2. **Reuse over duplication**: snapshot schemas and mappers move to `packages/shared/src/analysis-snapshots.ts`; `SnapshotService` is split and exported; `TimelineService` gains a multi-entity method; live analyses, explorer, exception data and exception creation are reused unchanged.
3. **Rules as pure code**: transitions, policy, current pin, scope, recurrence, decision context, list query, history sentences, and the live-vs-pinned comparison (shared, used by the web).
4. **Modules**: one new Nest module, `investigations`, listed in CLAUDE.md.
5. **Web**: Investigations list, create page, an 11-tab investigation page, an Entity 360 section and button, and small optional slots in 004/005/006 components.

All design decisions are in [research.md](./research.md) and are binding. The exact expected results are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures V1–V8.

## Prerequisites

- **Features 004, 005, 006 and 007 must be merged into this branch before implementation starts** (rebase `008-investigation-workspace` onto `main` once they land). This feature reuses 004's explorer, 005's and 006's services, hooks and sections, and 007's snapshots, exception data, badges and create page, and its migration renames 007's snapshot table. If any of them is missing, stop and write the question in `questions.md`.
- The migration must run **after** 007's migration (it renames `exception_snapshots`). Do not edit 007's migration.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS. Unchanged.

**Primary Dependencies**: unchanged. NestJS 11, Prisma 6, zod 3, React 19, React Router 7, TanStack Query 5, Tailwind 4, `@xyflow/react` (from 004). **No new dependencies** (research R18).

**Storage**: PostgreSQL 16 via Prisma 6.
- **One migration** (`<timestamp>_investigations`), data-model §1:
  - rename `exception_snapshots` → `analysis_snapshots` (and its enum, sequence, indexes, constraints, triggers), owner columns with a one-owner CHECK, `root_cause_entity_id`, `root_cause_label`, `chain_entity_ids` with a GIN index, and a backfill of 007's rows;
  - 2 enums and 6 tables (`investigations`, `investigation_entities`, `investigation_exceptions`, `investigation_unpins`, `investigation_decisions`, `investigation_notes`), CHECKs, the number sequence restart, a partial index, append-only triggers on 3 tables.
- **Reads**: the new tables, `analysis_snapshots`, `exceptions` and `exception_entities` (007), `audit_entries` (history), `events`, `event_entities`, `state_observations`, `source_records`, `entities`, `users`, 005's evidence-note tables (citations).

**Testing**:
- **Jest unit tests** for every pure rule module (transitions 3 × 3, policy matrix, current pin, scope, recurrence boundaries, decision context and citations, list query, history) and the multi-entity timeline merge.
- **Vitest** for shared code (`suggestInvestigationTitle`, `compareDigests`, the moved snapshot mappers, schemas) and web components.
- **Jest + supertest e2e** against real Postgres: fixtures V1–V8, the snapshot-table migration, audit/history equality, version conflicts, append-only enforcement, the authz matrix for all 18 routes, and 007's suites unchanged and green.
- **Performance suite** behind `RUN_PERF=1`.

**Target Platform**: Linux server (API), evergreen browsers (web).

**Project Type**: Web application (pnpm monorepo: api + web + shared).

**Performance Goals** (SC-005): list first page p95 < 1 s with 10,000 investigations for every view and sort; detail < 2 s; timeline first page < 1 s for a 100-entity scope. Pinning is bounded by 005 + 006 (< 5 s).

**Constraints**:
- no `any`, no new dependencies;
- no traversal SQL anywhere in this feature (all graph work is inside 004/005/006 services);
- one audit row per user action, in the same transaction as the change;
- every mutation of the investigation row (edit, owner, transition, pin, unpin) uses the conditional `version` update; decisions check the version without bumping it;
- analyses run **outside** write transactions;
- pure modules never read the clock; services read `now` once per request;
- all ordering in SQL uses unique tie-breaks; in-memory ordering uses `compareCodeUnits`;
- 007's responses, audit rows and behaviour are unchanged; the §39 and §40 seed output and the 007 seed are unchanged.

**Scale/Scope**:
- 18 endpoints;
- 1 migration;
- 1 new Nest module (+ small exports in `exceptions` and `graph`);
- about 9 pure rule modules;
- about 30 web components, 12 hooks, 3 pages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | Pins keep key evidence records with source system, source id and observation time (005), and the impact anchor and analysis time (006). Timeline items keep source system, source id, observation time and import id. Decision citations freeze the cited record's provenance. Investigations, pins, decisions and notes are user-created (MANUAL) records with author and time. |
| II. Fact vs Inference | ✅ | Pins keep 005's confidence, every rule outcome and the "insufficient evidence" heading, and 006's inferred-only counts and exposure share; the UI shows them verbatim. Pinned values are labeled with their time and never shown as live; live values are labeled live; differences between them are listed, never silently reconciled. A first-ranked root cause is labeled FIRST_RANKED with every candidate's confidence. Citations carry `origin` (SOURCE / MANUAL). Scope entries state why each entity is included. **Conflicts**: 005's disagreement reasons stay in the pin; this feature adds no data that can conflict with sources. |
| III. Explainability & Determinism | ✅ | No scores. SLA risk and recurrence are published rules over stored columns, with a sentence on each row ("Recurring: … on N root causes in the last 30 days"). The scope is a computed union with reasons. The live-vs-pinned comparison lists each differing field. Lists and timelines are deterministic with unique tie-breaks and a pinnable `evaluatedAt` (SC-007). No AI; the question text is never parsed. |
| IV. Auditability | ✅ | Every mutation (18 routes' writes, seed included) writes one audit row with actor, action, target, before, after and time, in the same transaction. Permission refusals write `auth.forbidden`. The History tab reads the append-only audit table. Pins, unpins, decisions and notes are append-only at the database level; decisions preserve "the evidence available at the time" (§37). |
| V. Test-Gated Changes | ✅ | All 18 endpoints have zod schemas in `@opsgraph/shared` and e2e tests for success, 401, validation, and 403/404/409 where they apply, plus authz-matrix rows. No graph traversal code is added. Rule modules have exhaustive unit tests. The renamed snapshot table has its own migration e2e test, and 007's suites must stay green. |
| VI. MVP Scope Discipline | ✅ | §61 lists "investigation" in the MVP. Answers §65 questions 1–7 on one page, supports 9 ("Who owns the problem?", via owner and linked exceptions), 10 (decisions), 11 (evidence, citations) and 12 ("Has this happened before?", recurrence). No risk scoring, what-if, workflows, automation, AI, notifications or file uploads (spec Assumptions). |
| Tech constraints | ✅ | Strict TS, no new dependencies, no traversal outside `GraphRepository` (none at all here). The only new module, `investigations`, is in CLAUDE.md's list. |

**Post-design re-check**: ✅ No unjustified violations. Four deliberate choices are listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/008-investigation-workspace/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/api.md           # routes, schemas, text templates, fixtures V1–V8
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (new and changed files only)

```text
packages/shared/src/
├── common.ts                  # + csvArray (moved from 007's exceptions.ts csv helper)
├── audit.ts                   # + 11 AUDIT_ACTIONS (research R14)
├── analysis-snapshots.ts      # NEW: moved from 007 (schemas, toRootCauseSnapshot, toImpactSnapshot, digestOf)
│                              #      + chain step, slaCommitments, compareDigests, chainEntityIdsOf (data-model §2a)
├── exceptions.ts              # imports the moved snapshot code; no behaviour change
├── investigations.ts          # NEW: constants, suggestInvestigationTitle, worstSlaStatus, formatInvestigationNumber,
│                              #      decision context, request/response schemas
├── *.spec.ts                  # NEW analysis-snapshots.spec.ts (incl. 007's moved mapper tests), investigations.spec.ts
└── index.ts                   # + 2 exports

apps/api/prisma/
├── schema.prisma              # AnalysisSnapshot (renamed), 2 enums, 6 models, back-relations (data-model §1a)
├── migrations/<ts>_investigations/migration.sql   # hand-edited: rename instead of drop/create + data-model §1b
└── seed.ts                    # + InvestigationsSeedService.seedReference() after the exceptions seed

apps/api/src/
├── app.module.ts                          # + InvestigationsModule
├── graph/
│   ├── graph.module.ts                    # + exports: [TimelineService]
│   ├── timeline.service.ts                # + listForEntities (research R9); list() delegates, output unchanged
│   └── timeline.service.spec.ts           # + multi-entity cases
├── exceptions/                            # 007 code, mechanical changes only (research R17)
│   ├── exceptions.module.ts               # + exports: [SnapshotService, ExceptionsQueryService]
│   ├── snapshot.service.ts                # split: takeRootCause, takeImpact, take, rowData
│   ├── snapshot.mapper.ts                 # removed; imports point to @opsgraph/shared
│   └── *                                  # prisma.exceptionSnapshot → prisma.analysisSnapshot
└── investigations/                        # NEW module
    ├── investigations.module.ts           # imports ExceptionsModule, GraphModule
    ├── investigations.controller.ts       # routes 1–5, 17, 18
    ├── pins.controller.ts                 # routes 6–8
    ├── investigation-scope.controller.ts  # routes 9–12
    ├── decisions.controller.ts            # routes 13–14
    ├── investigation-notes.controller.ts  # routes 15–16
    ├── investigations.service.ts          # create, update, transition
    ├── investigations-query.service.ts    # list, detail, timeline, history
    ├── pins.service.ts                    # pin, unpin, list (research R6)
    ├── scope.service.ts                   # add/remove entity, link/unlink exception, loadScope
    ├── decisions.service.ts               # record, list (research R10)
    ├── notes.service.ts
    ├── investigation.mapper.ts            # rows → DTOs, InvestigationCore, PinDto
    ├── actor.ts
    ├── rules/                             # pure: no Nest, no Prisma client, no clock
    │   ├── transitions.ts  policy.ts  current-pin.ts  scope.ts  recurrence.ts
    │   ├── decision-context.ts  list-query.ts  history.ts  diff.ts
    │   └── *.spec.ts                      # one per module
    ├── seed/investigations-seed.service.ts
    └── *.spec.ts                          # investigation.mapper.spec.ts, pins.service.spec.ts (stubbed analyses)

apps/api/test/
├── helpers.ts                             # resetDb: analysis_snapshots + 6 tables, 3 trigger pairs; + insertInvestigationFixture
├── analysis-snapshots-migration.e2e-spec.ts   # NEW: one-owner CHECK, backfill, append-only, 007 reads unchanged
├── investigations-seed.e2e-spec.ts        # NEW: V1–V3
├── investigations.e2e-spec.ts             # NEW: create, edit, owner, V6, conflicts, audit = history
├── investigation-pins.e2e-spec.ts         # NEW: V4, data change after pin
├── investigation-scope.e2e-spec.ts        # NEW: V5, timeline filters and paging
├── investigation-decisions.e2e-spec.ts    # NEW: V7, notes, append-only
├── investigations-list.e2e-spec.ts        # NEW: V8, determinism (SC-007)
├── seed.e2e-spec.ts                       # + investigations block (idempotency)
├── authz-matrix.e2e-spec.ts               # + 18 rows
└── perf-investigations.e2e-spec.ts        # NEW: RUN_PERF=1 only

apps/web/src/
├── router.tsx                             # investigations, investigations/new, investigations/:id
├── pages/investigations/                  # NEW
│   ├── investigations-params.ts (+ .test.ts)   # list URL state
│   ├── investigation-tab-params.ts (+ .test.ts) # tab + timeline filters URL state
│   ├── overview-text.ts (+ .test.ts)      # pure: contracts § Overview lines
│   ├── useInvestigations.ts  useInvestigation.ts  useInvestigationMutations.ts  usePins.ts
│   ├── useInvestigationTimeline.ts  useDecisions.ts  useNotes.ts  useInvestigationHistory.ts
│   ├── InvestigationsListPage.tsx  InvestigationCreatePage.tsx  InvestigationPage.tsx
│   ├── InvestigationFilters.tsx  InvestigationTable.tsx  InvestigationStatusBadge.tsx  RecurrenceBadge.tsx
│   ├── InvestigationHeader.tsx  EditInvestigationDialog.tsx  TransitionDialog.tsx  UnpinDialog.tsx
│   ├── tabs/
│   │   ├── OverviewTab.tsx  LiveVsPinned.tsx  GraphTab.tsx  RootCauseTab.tsx  ImpactTab.tsx  PinList.tsx
│   │   ├── TimelineTab.tsx  TimelineFilters.tsx  ScopeTab.tsx  EvidenceTab.tsx  ActionsTab.tsx
│   │   ├── DecisionsTab.tsx  DecisionForm.tsx  CitationPicker.tsx  DecisionContextView.tsx
│   │   └── NotesTab.tsx  HistoryTab.tsx
│   ├── investigations-test-data.ts
│   └── *.test.tsx                         # one per component/page
├── pages/entities/
│   ├── EntityDetailPage.tsx               # + "Start investigation" button, + EntityInvestigationsSection after Exceptions
│   ├── EntityInvestigationsSection.tsx (+ .test.tsx)   # NEW
│   ├── RootCauseSection.tsx, RootCauseCandidate.tsx    # + optional entityId, candidateActions (research R17)
│   └── impact/ImpactSection.tsx           # + optional entityId, depth, headerActions
├── pages/explorer/
│   ├── ExplorerPage.tsx                   # export ExplorerView with props
│   └── NodeDetailsPanel.tsx               # + optional actions
└── pages/exceptions/ExceptionCreatePage.tsx   # + ?investigation=<id> link-after-create (research R13)
```

**Structure Decision**: the existing pnpm monorepo.
- Investigation logic goes in the `investigations` bounded context listed in CLAUDE.md.
- Snapshot code is shared by moving its pure parts to `packages/shared` and exporting 007's `SnapshotService`; no new module.
- Web work is a new `pages/investigations/` folder; Entity 360 gets one section and one button; 004/005/006/007 components get optional props only.

## Key Design Notes (for the implementer)

1. **Build order.** Each step is independently testable. Do not start a step before the previous one's tests pass.
   1. **Shared, part 1 (refactor, no behaviour change)**: move the snapshot schemas and mappers to `analysis-snapshots.ts`, move the `csv` helper to `common.ts`, update 007 imports; run the whole suite.
   2. **Shared, part 2**: chain steps, `slaCommitments`, `compareDigests`, `chainEntityIdsOf`; `investigations.ts` constants, rules and schemas; audit actions; specs. Rebuild shared.
   3. **Migration**: `schema.prisma`, `prisma migrate dev --create-only`, **replace** the generated drop/create of the snapshot table with data-model §1b's rename, append the rest, apply on a database migrated to 007 **with the 007 seed loaded** (so the backfill runs on real rows). Check `prisma migrate diff` reports no drift. Rename 007's `prisma.exceptionSnapshot` uses; split `SnapshotService` (`take` unchanged in behaviour); update `resetDb`. Run the whole suite: every existing test, 007's included, must pass. Then `analysis-snapshots-migration.e2e-spec.ts`.
   4. **Timeline**: `listForEntities`, export; existing timeline tests unchanged plus new cases.
   5. **Investigation rules** (pure), in order: `transitions`, `policy`, `current-pin`, `scope`, `recurrence`, `diff`, `history`, `decision-context`, `list-query`, each with its spec.
   6. **Investigations API**: `actor`, `investigation.mapper`, `InvestigationsService.create` (with pins), `InvestigationsQueryService.detail`, then `update`/`transition`, `PinsService`, `ScopeService`, `DecisionsService`, `NotesService`, then list, timeline and history. Then the e2e files and authz rows.
   7. **Seed**: `InvestigationsSeedService`, `prisma/seed.ts`, `investigations-seed.e2e-spec.ts`, the `seed.e2e-spec.ts` block.
   8. **Web**: optional props in 004/005/006/007 components (their tests unchanged); hooks and params; list page; create page; investigation page with header and dialogs; tabs in the order Overview, Root Cause, Impact, Related Entities, Timeline, Actions, Decisions, Notes, Evidence, Graph, History; Entity 360 integration.
   9. **Performance**: `perf-investigations.e2e-spec.ts`. Record timings in quickstart.md §4.
2. **Every mutating service method** follows research R5's check order: 404 → 403 (audited) → 409 `VERSION_CONFLICT` → 409 `INVALID_STATE` → 400. Then one `$transaction` containing the conditional update or inserts and the audit row. Read `now = new Date()` once, before anything else, and pass it everywhere (`createdAt`, `lastActivityAt`, snapshot `takenAt`, root-cause `evaluatedAt`, decision `capturedAt`).
3. **Pins**: call `SnapshotService.takeRootCause` / `takeImpact` **before** `$transaction`; never call 005/006 inside a transaction. Insert with `SnapshotService.rowData` so the denormalized columns are always set. Parse payloads with their zod schemas before insert and after read; a parse failure on read is an internal error.
4. **Current pins** change only in `PinsService.pin`, `PinsService.unpin` and `create`, always together with `slaCommitmentsAtRisk`, under the version check. Use `rules/current-pin.ts` to choose the fallback after an unpin.
5. **Audit rows**: exactly one per user action. Pinning both kinds is **one** `investigation.pinned` row. Creating with pins is **one** `investigation.created` row. No-ops write nothing and do not bump the version.
6. **Policy**: never inline permission checks in services; always call `rules/policy.ts`. The detail's `permissions` comes from the same functions combined with the status (FR-019).
7. **Scope**: always computed with `rules/scope.ts` from the current pins, links and added entities; never stored. The "involves entity" `where` must stay equivalent to `computeScope` (a shared test builds both from the same fixture and compares).
8. **Timeline**: only through `TimelineService.listForEntities`. Do not copy the merge. The per-entity endpoint's output must stay byte-identical (V3 regression check).
9. **Decisions**: check `expectedVersion` against the current version but do **not** increment it. Validate every citation with `rules/decision-context.ts` against the scope and current pins read **inside** the transaction; freeze copies, not ids only.
10. **History**: `GET …/history` reads `audit_entries` (`target_type = 'investigation'`). Do not create a history table.
11. **Web specifics** (research R16):
    - Parse every response with its shared schema through `apiFetch`.
    - Show only the actions in `permissions`; send `expectedVersion` from the loaded detail; handle 409 `VERSION_CONFLICT` with the reload message, and 409 `INVALID_STATE` by showing the server message and refetching.
    - Every pinned value is labeled `Pinned <time>`; every live value `Live`. Never mix them in one figure.
    - Each tab handles its own loading and error state and must not blank the page; inactive tabs do not fetch.
    - The live-vs-pinned block runs only for non-Closed investigations and uses `compareDigests` from shared; it never calls the API to compare.
    - The Graph tab keeps explorer settings in component state (default `blockers=true`, depth 2) and links to `/graph/:focusId?<settings>`.
12. **Pitfalls**:
    - `noUncheckedIndexedAccess` is on. Use `.at()` with checks and invariant `Error`s, never `!`.
    - Never use `localeCompare`.
    - Prisma will try to drop and recreate the renamed table; hand-edit the migration and never let it drop `exception_snapshots`.
    - The backfill `UPDATE` needs the append-only trigger disabled for that statement only; re-enable it in the same migration.
    - Prisma scalar lists: filter with `has`; the GIN index is hand-written SQL.
    - One-to-one relations need `@unique` on `current_root_cause_pin_id` and `current_impact_pin_id`.
    - `resetDb` does not restart the number sequence; do not assert absolute numbers except on a fresh, seeded database (V1).
    - Owners may be deactivated after assignment: show them as deactivated; refuse assigning to them.
    - The seed's system actor has no user id: write audit rows with `actorType: 'system'` and store `createdById`/`takenById`/`linkedById` as null.
13. **Do not**:
    - add traversal or recursive SQL, or call `GraphRepository`/`TracingService` from `investigations`;
    - change 005, 006 or 007 response shapes, rules, audit rows or text (only the additive, optional snapshot fields of research R2);
    - add notifications, risk features, workflows, file uploads or AI;
    - add edit or delete endpoints for pins, decisions, notes or investigations;
    - accept analysis results or an evaluation time from the client for pins;
    - add dependencies;
    - change §39, §40 or the 007 seed rows;
    - edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, the constitution or CLAUDE.md.

    Ambiguities go to `questions.md`.
14. **Entity 360 order** after 005–008: Identity (with the exceptions badge, "Create exception" and "Start investigation"), Current state, Root cause, Blockers, Impact, Exceptions, **Investigations**, Dependencies, Relationships, Timeline, Source records. Update the `EntityDetailPage` order test accordingly.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Renaming 007's `exception_snapshots` to `analysis_snapshots` with a polymorphic owner (exception or investigation) | The task requires reusing 007's snapshot mechanism; one table, one service and one append-only guarantee keep an exception snapshot and an investigation pin identical in content, and make recurrence a single indexed query across both owners. | A second table with the same columns duplicates the mechanism and forces the recurrence rule to union two tables and read labels from JSON. Linking investigations to `exception_snapshots` gives pins the wrong owner. |
| Denormalized columns (`root_cause_entity_id`, `root_cause_label`, `chain_entity_ids` on snapshots; `current_*_pin_id`, `sla_commitments_at_risk` on investigations) | The list filters (SLA risk, recurrence, involved entity) must be indexed `WHERE` clauses to meet SC-005. All are written once in the same transaction as the source data and covered by consistency tests. | JSON-path filters on `payload` cannot be indexed usefully and would need raw SQL; computing "latest pin per investigation" per query needs `DISTINCT ON`. |
| Two read endpoints beyond "CRUD, pinning, decisions and notes": `GET …/timeline` and `GET …/history` | The merged timeline needs one cursor across up to 100 entities (impossible with one request per entity), and the history needs non-admin access to one investigation's audit rows (`/api/audit` is ADMIN-only). Both are read-only sub-resources of the investigation. | Client-side merging of 100 per-entity timelines breaks paging and costs 100 requests; opening `/api/audit` to all users exposes every audit row. |
| Optional props added to 004/005/006/007 web components and a link-after-create parameter on 007's create page | The workspace must reuse those views (spec FR-028, FR-029, FR-032) and add Pin / Add / Link actions to them. Defaults reproduce today's behaviour exactly. | Copying the components would duplicate rendering rules (badges, explanations, chains) and let them drift. |
