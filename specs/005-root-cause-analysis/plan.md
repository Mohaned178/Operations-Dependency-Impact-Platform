# Implementation Plan: Root-Cause Analysis

**Branch**: `005-root-cause-analysis` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-root-cause-analysis/spec.md`

## Summary

For any entity, OpsGraph produces a **root-cause analysis**: one or more candidates, each with:
- a classified causal chain (Symptom → Immediate Blocker → Upstream Cause(s) → Root Cause);
- a deterministic label ("Budget Code Missing");
- evidence gathered by five fixed rules;
- an overall HIGH/MEDIUM/LOW confidence computed by eight ordered, inspectable rules;
- a plain-language explanation.

When the evidence is weak, the result says so ("Possible root cause — insufficient evidence", with "may be … because" wording). Users can attach immutable, audited **evidence notes** (Supports / Disputes / Context) to entities and relationships. A Disputes note lowers confidence; the others never raise it.

**Approach** (research R2–R8):
1. **Chains**: the analysis is built on `TracingService.blockers` from feature 003, with no new traversal. Its ranked blocking paths are grouped by deepest blocker into candidates. Each group's first path is the primary chain; the rest are alternatives.
2. **Evidence**: an `EvidenceReader` loads all evidence with a fixed number of batched queries:
   - state records, relationship records, events and notes;
   - requirement sources, through one new one-hop `GraphRepository.findIncomingRelationships`.
3. **Pure analysis**: pure modules (`roles`, `label`, `confidence`, `candidates`, `key-evidence`, `explanation`) assemble the result.
4. **Reused sentences**: chain sentences reuse 003's `explainBlockingPath`, with a new optional `HEDGED` mood.
5. **Storage**: notes live in two **append-only** tables (`evidence_notes`, `evidence_note_retractions`), guarded by the existing provenance trigger.
6. **Web**: the Entity 360 page gains a **Root cause** section between Current state and Blockers. The header callout leads with the root-cause headline.

All design decisions and their reasons are in [research.md](./research.md). They are binding. Exact expected results on the seeded §39 scenario are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures R1–R9.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS. Unchanged.
**Primary Dependencies**: unchanged. NestJS 11, Prisma 6, zod 3, React 19, React Router 7, TanStack Query 5, Tailwind 4. **No new dependencies** (research R14).
**Storage**: PostgreSQL 16 via Prisma 6.
- **One migration** (`<timestamp>_evidence_notes`):
  - 1 enum and 2 tables;
  - CHECK constraints;
  - append-only triggers that reuse `forbid_provenance_mutation()` (data-model §1).
- **Reads**: `state_observations`, `source_records`, `events`, `event_entities`, `entities.attributes` and the new tables.

**Testing**:
- **Jest unit tests** for every pure analysis module, plus the extended 003 explanation.
- **Jest + supertest e2e** against real Postgres:
  - seed fixtures R1–R9;
  - built graphs for every confidence rule and status;
  - notes, permissions, audit and database immutability;
  - the authz matrix.
- **Vitest** for the shared schemas and web components.
- **Performance suite** behind `RUN_PERF=1`.

**Target Platform**: Linux server (API), evergreen browsers (web).
**Project Type**: Web application (pnpm monorepo: api + web + shared).
**Performance Goals**: the analysis p95 is under 1.5 s at 50k entities and 150k relationships (SC-003). That is 003 blockers (< 1 s) plus about 10 batched evidence queries.
**Constraints**:
- no `any`, no new dependencies;
- no traversal SQL outside `prisma-graph.repository.ts`;
- every ordering is done in TypeScript with `compareCodeUnits`;
- pure modules never read the clock;
- `GET /root-cause` writes nothing;
- notes are insert-only at the database level.

**Scale/Scope**:
- 5 new endpoints;
- 1 migration;
- about 7 pure modules;
- 1 extended screen (about 8 new components and 2 hooks).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | Every step carries its state records (current state plus each other source, each with its raw source record), the latest source record of every relationship assertion, the requirement-source records (for example the contract and its clause) and its events, all with source system, source id and observation time (FR-011). Notes carry their author and creation time, plus who retracted them, when and why. Key evidence names the exact records (fixture R1). |
| II. Fact vs Inference | ✅ | Hop origin and confidence are shown on every step. Explanations label inferred and manual links (003 templates). LOW candidates are headed "insufficient evidence" and use "may be" wording (FR-018). UNKNOWN states are "possible" causes. Notes are always `origin MANUAL` and never raise confidence. **Conflicts**: per-source states are returned and shown wherever sources disagree. A disagreement that crosses classifications lowers confidence (rule 6). Formal conflict flagging stays deferred (see Complexity Tracking). |
| III. Explainability & Determinism | ✅ | There are no scores and no percentages. All 8 rule outcomes are returned with reasons and refs. The label rule is returned with the label. Results depend only on data plus the explicit `evaluatedAt`, and SC-004 checks 100 identical runs. No AI is involved. |
| IV. Auditability | ✅ | Creating and retracting a note each write an audit row in the same transaction, with before and after. A refused retraction writes `auth.forbidden`. Notes and retractions are append-only at the database level (R9). The analysis is read-only. |
| V. Test-Gated Changes | ✅ | All 5 endpoints have zod schemas in `@opsgraph/shared`, and e2e tests for success, 401, 403/404 and validation, plus authz-matrix rows. No traversal logic changes. The one new repository method is one hop, and is covered by an e2e test. |
| VI. MVP Scope Discipline | ✅ | Answers §65 "Why is this blocked?" and "What evidence supports this?". §61 lists "root-cause paths" in the MVP. It includes no impact metrics, risk, exceptions, investigations, recurring causes, document upload or AI (spec Assumptions). |
| Tech constraints | ✅ | Strict TS, no new dependencies. Multi-hop traversal is reused from 003 unchanged. The new `findIncomingRelationships` is a one-hop lookup that lives in `GraphRepository`. |

**Post-design re-check**: ✅ No unjustified violations. There are two deliberate choices, listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/005-root-cause-analysis/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/api.md          # routes, schemas, text templates, acceptance fixtures R1–R9
├── checklists/requirements.md
└── tasks.md                  # /speckit-tasks
```

### Source Code (new and changed files only)

```text
packages/shared/src/
├── root-cause.ts              # NEW: constants (data-model §2) + query/response schemas
├── evidence-notes.ts          # NEW: stance, limits, target, request/response schemas
├── audit.ts                   # + EVIDENCE_NOTE_CREATED, EVIDENCE_NOTE_RETRACTED
├── *.spec.ts                  # NEW root-cause.spec.ts, evidence-notes.spec.ts
└── index.ts                   # + 2 exports

apps/api/prisma/
├── schema.prisma              # + EvidenceNoteStance, EvidenceNote, EvidenceNoteRetraction, back-relations
└── migrations/<ts>_evidence_notes/migration.sql   # generated + hand-written CHECKs and triggers

apps/api/src/
├── app.module.ts                      # + RootCauseModule
├── graph/
│   ├── graph.repository.ts            # + IncomingRelationshipRow, findIncomingRelationships
│   └── prisma-graph.repository.ts     # + findIncomingRelationships (findMany, one hop)
├── tracing/
│   ├── tracing.module.ts              # + exports: [TracingService]
│   └── explanation.ts                 # + optional mood param on explainBlockingPath (+ spec cases)
└── root-cause/                        # NEW module
    ├── root-cause.module.ts           # imports TracingModule, GraphModule, PrismaModule
    ├── root-cause.controller.ts       # GET entities/:id/root-cause
    ├── root-cause.service.ts          # orchestration (data-model §4)
    ├── evidence.reader.ts             # batched evidence queries (research R4)
    ├── evidence-notes.controller.ts   # POST evidence-notes, POST …/retract, 2 list routes
    ├── evidence-notes.service.ts      # create/retract (tx + audit), list, permission check
    ├── evidence-note.mapper.ts        # row → EvidenceNoteDto
    └── analysis/                      # pure, no Nest, no Prisma, no clock
        ├── types.ts
        ├── candidates.ts              # groupCandidates, orderCandidates (R3)
        ├── roles.ts                   # assignRoles → CausalChainDto (R3)
        ├── label.ts                   # rootCauseLabel, humanize, stateWords (R5)
        ├── confidence.ts              # computeConfidence: 8 rules (R6)
        ├── key-evidence.ts            # keyEvidence, eventCount
        ├── explanation.ts             # headline, reasons, evidence sentence, summary
        └── *.spec.ts                  # one per module

apps/api/test/
├── helpers.ts                         # resetDb: + 2 tables
├── graph-repository.e2e-spec.ts       # + findIncomingRelationships cases
├── root-cause-seed.e2e-spec.ts        # NEW: fixtures R1–R9, SC-004 determinism
├── root-cause.e2e-spec.ts             # NEW: built graphs per rule/status, validation, 401/404
├── evidence-notes.e2e-spec.ts         # NEW: note create/list/retract, 403, audit, DB immutability
├── authz-matrix.e2e-spec.ts           # + 5 AUTHENTICATED probes
└── perf-root-cause.e2e-spec.ts        # NEW: RUN_PERF=1 only

apps/web/src/pages/entities/
├── EntityDetailPage.tsx               # + RootCauseSection between CurrentState and Blockers
├── BlockerCallout.tsx                 # leads with root-cause headline (research R11)
├── useRootCause.ts                    # NEW: key ['entities', id, 'root-cause']
├── useEvidenceNotes.ts                # NEW: list + create/retract mutations with invalidation
├── RootCauseSection.tsx               # NEW
├── RootCauseCandidate.tsx             # NEW
├── CausalChainView.tsx                # NEW (RoleBadge inside)
├── StepEvidence.tsx                   # NEW
├── ConfidenceRules.tsx                # NEW
├── EvidenceNoteForm.tsx               # NEW
├── EvidenceNoteList.tsx               # NEW
├── root-cause-test-data.ts            # NEW fixtures for component tests
└── *.test.tsx                         # one per new component + updated EntityDetailPage/BlockerCallout tests
```

**Structure Decision**: the existing pnpm monorepo.
- Root-cause logic and notes go in a new `root-cause` bounded context (research R1).
- Multi-hop traversal stays in `graph` and is reached only through `TracingService`.
- The web work extends `pages/entities/`, keeping its flat layout.

## Key Design Notes (for the implementer)

1. **Build order.** Each step is independently testable. Do not start a step before the previous one's tests pass.
   1. **Shared**: `evidence-notes.ts`, `root-cause.ts`, the audit actions, their specs. Rebuild shared.
   2. **Migration**: `schema.prisma`, then `prisma migrate dev --create-only`, then append the data-model §1b SQL, then apply. Update `resetDb`.
   3. **Pure modules**, in dependency order: `label`, `roles`, `candidates`, `confidence`, `key-evidence`, `explanation`. Extend `tracing/explanation.ts` with the HEDGED mood. All existing 003 tests must stay green, unchanged.
   4. **Repository**: `findIncomingRelationships`, with its e2e test.
   5. **Notes**: `evidence-note.mapper`, `EvidenceNotesService`, `EvidenceNotesController`, then `evidence-notes.e2e-spec.ts`.
   6. **Analysis**: `EvidenceReader`, `RootCauseService`, `RootCauseController`, `RootCauseModule`, then `root-cause.e2e-spec.ts` and `root-cause-seed.e2e-spec.ts`. After that, add the authz-matrix rows.
   7. **Web**: hooks, then leaf components (`ConfidenceRules`, `StepEvidence`, `EvidenceNoteList`, `EvidenceNoteForm`), then `CausalChainView`, `RootCauseCandidate`, `RootCauseSection`, then `BlockerCallout` and the `EntityDetailPage` wiring.
   8. **Performance**: `perf-root-cause.e2e-spec.ts`. Record the timings in quickstart.md.
2. **`RootCauseService.analyze`**: follow data-model §4 exactly.
   - Read `computedAt` once.
   - Never call `new Date()` again. Pass `evaluatedAt` into the pure modules.
   - Call `tracing.blockers` with empty `relationshipTypes` and `entityTypes`, so the 003 defaults apply.
3. **Confidence**:
   - `computeConfidence` always returns exactly 8 outcomes, in `CONFIDENCE_RULES` order.
   - Rules 5–8 compare against the confidence **after** the previous rule.
   - `lower()` floors at LOW.
   - A rule that is applied but changes nothing (for example SEARCH_LIMIT on LOW) is still `applied: true`.
   - The stale test is `evaluatedAt.getTime() - Date.parse(observation.observedAt) > ROOT_CAUSE_LIMITS.staleAfterMs` (strictly greater).
4. **Hedged sentences**: re-generate with `explainBlockingPath(start, chainPath, 'HEDGED')` **only** when the candidate's final confidence is LOW. Otherwise copy `BlockingPathDto.explanation` as is.
5. **Evidence queries** (research R4):
   - Every list is re-sorted in TypeScript.
   - Pass an empty id list straight through, returning empty maps without querying.
   - Use `::uuid[]` casts in raw SQL.
   - Use `COLLATE "C"` on text in `ORDER BY` inside window functions.
   - Do **not** call `TimelineService` or `findNeighbors`.
6. **Notes service**:
   - Check that the target exists inside the create transaction. A missing target is `Errors.validation([{ path: 'target.entityId', message: 'Entity not found' }])`, or the relationship equivalent.
   - **Retract**:
     1. Load the note; a missing note is 404.
     2. If it is already retracted, return it with no audit row.
     3. If the caller is neither the author nor an ADMIN: `audit.recordStandalone(AUTH_FORBIDDEN …)`, then `Errors.forbidden()`.
     4. Otherwise insert the retraction and the audit row in one transaction. A unique violation on `note_id` (a race) is treated as "already retracted".
7. **Web specifics** (research R11):
   - Every response is parsed with its shared schema through `apiFetch`.
   - Role badges are text plus colour, never colour alone.
   - Use `OriginBadge`, `StateBadge`, `ExplanationSentence`/`linkTargets`, `PathView` and `formatTimestamp`.
   - The section anchor is `id="root-cause"`.
   - Each section handles its own loading and error states. A failing root-cause query must not blank the page or the Blockers section.
   - The retract button shows only for the author or an ADMIN, using `useAuth`.
8. **Pitfalls**:
   - `noUncheckedIndexedAccess` is on. Use `.at()` with checks and throw invariant `Error`s, never `!`.
   - Never use `localeCompare`.
   - `latestBySource` is empty when sources agree, so rule 6 must treat empty as "no disagreement".
   - Requirement sources come from **incoming** DEFINES/GOVERNS, meaning the step entity is the relationship's `to` end.
   - Key evidence de-duplicates by `sourceRecordId`, not by entity, because Order #18492 contributes two records.
9. **Do not**:
   - add traversal or recursive SQL;
   - change 003 response shapes or 003 explanation output for the default mood;
   - store or cache analyses;
   - write audit rows from `GET /root-cause`;
   - add note edit or delete endpoints;
   - add a graph diagram, risk, impact, exception or investigation UI;
   - change the seed;
   - edit `spec.md`, `plan.md`, `research.md`, the constitution or CLAUDE.md.

   Ambiguities go to `questions.md`.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New `root-cause` Nest module, not in CLAUDE.md's module list | Root cause is its own bounded context (§10, distinct from tracing §11). It owns the only mutations in this feature (notes), and `tracing` is read-only by design (003 FR-024). | Putting it in `tracing` would mix audited writes into a read-only context. A separate `evidence` module just for notes adds wiring with no consumer besides root cause (YAGNI). |
| Constitution II "surface conflicts": formal conflict **flagging** stays deferred | Per-source states are shown on every step where sources disagree. A disagreement that crosses classifications also lowers confidence, with a stated reason (rule 6). Spec Assumptions keep formal conflict detection and resolution out of scope, as in 002 and 003. | Building conflict detection expands scope beyond the agreed spec. Hiding the disagreement would violate the principle. |
