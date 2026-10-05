# Tasks: Core Operational Graph Model

**Input**: `specs/002-operational-graph-model/` (plan.md, spec.md, research.md, data-model.md, seed-scenario.md, contracts/api.md, contracts/import-format.md, quickstart.md)
**Tests**: REQUIRED (Constitution V, FR-049). Every new endpoint needs a zod schema in `packages/shared` and an e2e test covering its success path and its authorization failure.

## Rules for the implementer (read first)

1. Do tasks **in ID order** within a phase. `[P]` tasks touch different files and may be done in any order.
2. Before each task, re-read the referenced section of `research.md` (R#), `data-model.md`, `seed-scenario.md` or `contracts/`. **Do not invent alternatives.**
3. The only dependencies you may add are `csv-parse` and `@types/multer` (T001). Anything else goes in `questions.md` first.
4. After each **phase**, run the phase's **Checkpoint**. Fix all failures before moving on, then tick the boxes and commit (`feat(<scope>): …`, one commit per task or small group).
5. If anything is ambiguous or conflicts with an invariant in CLAUDE.md, stop and write the question to `specs/002-operational-graph-model/questions.md`.
6. Never use `any`, never leave `TODO`s, never parse money to `number`, never add recursive SQL, and never write graph tables outside the `ingestion` module.
7. **Phase order is not story-priority order.** The import pipeline (Phase 2) is shared by the seed (US2) and the import endpoint (US3), so it is built once, up front. After Phase 2: US2 (seed) → US1 (viewing, which needs seed data for its tests) → US3 → US4.

---

## Phase 1: Setup

- [x] T001 In `apps/api/package.json` add runtime dep `csv-parse@^5` and dev dep `@types/multer`. Run `pnpm install`. Commit the lockfile. (research R19)

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: shared contracts, DB schema, API infrastructure, and the whole import pipeline (parse → validate → plan → write) for JSON input.

### Shared contracts (`packages/shared/src`)

- [x] T002 [P] In `common.ts` add `JsonValueSchema` (recursive `z.lazy` union, data-model.md) with its type, and add `'IMPORT_TOO_LARGE'` to `ErrorCodeSchema`.
- [x] T003 Create `graph.ts`: the five vocabulary enums, `RELATIONSHIP_RULES`, `MONETARY_ENTITY_TYPES` (data-model.md "Vocabularies"), and every read DTO and query schema listed in `contracts/api.md` "Shared graph DTOs" and "Entities" (`EntityListResponseSchema`, `NeighborQuerySchema`, `TimelineResponseSchema`, …), each with its inferred type. Create `graph.spec.ts`: every `RELATIONSHIP_RULES` key is a valid relationship type, and sample DTOs parse.
- [x] T004 Create `imports.ts` per data-model.md "Import row schemas" and `contracts/api.md` "Imports": `IMPORT_MAX_BYTES`, `IMPORT_MAX_ROWS`, `SourceSystemSchema`, `SourceIdSchema`, `TimestampSchema`, the ref schemas, the three row schemas (with `moneyRule` and `basisRule` as `superRefine`), `ImportDocument` type (built from the row schemas' **input** types, `z.input<…>`, so callers may omit fields that have defaults such as `attributes` and `related`), `ImportRequestFieldsSchema` (`kind` required iff `format=csv`, forbidden iff `json`; `dryRun` string → boolean, default false), `ImportCountsSchema`, `ImportRowErrorSchema`, `ImportReportSchema`, `ImportSummaryDtoSchema`, `ImportListResponseSchema`. Create `imports.spec.ts` covering each rule in research R10 and R11 (naive timestamp rejected, amount as number rejected, Order without currency rejected, INFERRED without basis rejected, bad event type rejected, unknown row fields allowed).
- [x] T005 In `audit.ts` add the 11 actions from research R8 to `AUDIT_ACTIONS`. In `index.ts` add `export * from './graph'` and `export * from './imports'`. Run `pnpm --filter @opsgraph/shared build test`.

### Database

- [x] T006 Add every enum and model from `data-model.md` "Prisma schema additions" to `apps/api/prisma/schema.prisma`, and `imports Import[]` to `model User`. Use the exact names, `@map`s and indexes.
- [x] T007 Run `pnpm --filter api prisma migrate dev --create-only --name graph_model`. Append the three SQL statements from data-model.md "Migrations" (item 1) to the generated `migration.sql`. Apply it. Then run `prisma migrate dev --create-only` again: it MUST report no changes. If Prisma wants to drop `event_entities_one_subject`, delete that generated migration, drop the partial index from the SQL, enforce one SUBJECT per event in the planner and writer instead (with a unit test), adjust the T009 test accordingly, and note the decision in `questions.md`.
- [x] T008 Create the second migration `provenance_append_only` (`--create-only`, then write the SQL by hand): the `forbid_provenance_mutation()` function and the row and TRUNCATE triggers on `source_records` and `state_observations` (research R16). Apply it.
- [x] T009 Update `resetDb` in `apps/api/test/helpers.ts` exactly as data-model.md "Migrations" describes. Create `apps/api/test/graph-constraints.e2e-spec.ts` asserting through raw SQL: UPDATE/DELETE/TRUNCATE on `source_records` and `state_observations` fail with `is append-only`; a self-loop relationship violates its CHECK; a `source_records` row with two owners violates its CHECK; two SUBJECT rows for one event violate the partial unique index.

### API infrastructure (`apps/api/src`)

- [x] T010 [P] `common/errors/app-error.ts`: add `Errors.importTooLarge()` (413, `IMPORT_TOO_LARGE`, message from contracts/api.md). Make sure `AllExceptionsFilter` passes its status through (it already uses `AppError.status`).
- [x] T011 [P] Create `common/pagination/cursor.ts`: `encodeCursor(value: unknown): string` (base64url JSON) and `decodeCursor<T>(schema: ZodType<T>, cursor: string): T`, which throws `Errors.validation([{ path: 'cursor', message: 'Invalid cursor' }])` on bad base64, bad JSON or a schema mismatch. Add `cursor.spec.ts`.
- [x] T012 [P] `common/context/request-context.ts`: add `runDetached<T>(fn: () => Promise<T>): Promise<T>`, which runs `fn` inside `cls.run()` with a fresh `correlationId` (`randomUUID()`) and no user id (research R15). Add a unit test.
- [x] T013 `audit/audit.service.ts`: add `recordMany(tx: Tx, inputs: AuditRecordInput[]): Promise<void>`. Same redaction and context resolution as `record`, via `createMany` in chunks of 1,000 (research R8). Extend `audit.service.spec.ts` (mocked `tx`): 2,500 inputs produce exactly 3 `createMany` calls of 1,000 / 1,000 / 500 rows, an empty array makes no call, and secrets are redacted.

### Import pipeline: pure parts (`apps/api/src/ingestion`)

- [x] T014 [P] `planning/canonical-json.ts`: `canonicalJson(value)` (keys sorted recursively, no whitespace) and `payloadHash(value)` (sha256 hex, 64 chars). Unit tests: key order doesn't change the hash; array order does; nested objects.
- [x] T015 [P] Create the type-only files `parsing/parsed-import.ts` (`ParsedRow`, `ParsedImport`, `RowError`) and `planning/import-plan.ts` (`ImportSnapshot`, `ImportPlan`, per-row classification, write set, audit inputs, `changeCount`). Design them so the planner (T019–T020) and writer (T021) need no other shared types. Keep them consistent with data-model.md and research R7.
- [x] T016 `planning/projections.ts` (PURE): `projectEntity`, `projectRelationship`, `projectEvent`, `latestStateBySource`, per data-model.md "Projection rules" and research R4 ordering. Unit tests in `projections.spec.ts`: later observation wins; an older observation does not change current values; equal `observedAt` → higher seq wins; attribute shallow merge keeps earlier keys; no state observation → `UNKNOWN`; per-source latest.
- [x] T017 `parsing/decode.ts` (UTF-8 fatal decode, BOM strip) and `parsing/json-import.parser.ts` (research R6): returns `ParsedImport`. File-level errors for invalid UTF-8, invalid JSON, a non-object top level, an unknown top-level section (FR-033), a non-array section, or none of the three sections. Non-object elements become row errors. Keep `raw` exactly as parsed. Add specs.
- [x] T018 `validation/row-validator.ts`: validate each `ParsedRow` with the shared schema; add the time checks (≤ now + 5 min); convert zod issues to `RowError` (`field` = joined path). Unit tests: each class of invalid row from the spec's edge cases, including that enum errors list the allowed values.
- [x] T019 `planning/import-planner.ts` (PURE) — **entities part**: `planImport` for entity rows. Reference resolution (P1–P5), duplicate and ambiguous keys (P6), classification created/updated/unchanged (data-model.md "Row classification"), projection computation with `newId` injected, the audit inputs for entities and states. Add `import-planner.entities.spec.ts` covering every rule P1–P6 and every classification cell for entities.
- [x] T020 `planning/import-planner.ts` — **relationships and events part**: P7–P13, dependent-row rejection (`dependsOn`), classification, `event_entities` replacement, audit inputs. Add `import-planner.graph.spec.ts` covering P7–P13, plus: a relationship that appears before its entity in the file; a relationship to a rejected entity; two assertions of the same link from different sources are both kept (FR-013); a 2-node cycle is accepted.

### Import pipeline: persistence and orchestration

- [x] T021 `persistence/import-snapshot.loader.ts` (research R7 step 5; chunked `IN` lists, exact-key filtering in memory) and `persistence/import-writer.ts` (research R8: chunked `createMany` in FK order, individual projection updates, `recordMany`; `writeImport` for the `imports` row).
- [x] T022 `import.service.ts`: `run(input)` exactly as plan.md key note 3 and research R7 (row-limit check after parsing: if the total exceeds `IMPORT_MAX_ROWS`, call `refuse('rows', …)` and throw `Errors.importTooLarge()`; `refuse(reason, limit, actual)` writes the standalone `import.refused` audit via `recordStandalone`; advisory lock, outcome decision, `skipIfNoChanges`, summary audit, `ImportReport` mapping via `import.mapper.ts`). Create `ingestion.module.ts` and `graph/graph.module.ts` (empty providers for now); register both in `app.module.ts`.
- [x] T023 Add the e2e helper `runImport(app, { format, kind?, content, dryRun? })` in `apps/api/test/helpers.ts`, calling `ImportService.run` directly. It MUST create (or reuse) an ADMIN user first, because `imports.submitted_by_id` has a foreign key to `users`, and MUST wrap the call in `RequestContext.runDetached` so `correlationId` is a valid UUID (`audit_entries` and `imports` both require one). Create `apps/api/test/import-service.e2e-spec.ts`: (a) a valid 3-section JSON → `APPLIED`, rows exist, one summary audit and one audit per created row, all linked to the import; (b) the same file again → all `unchanged`, no new rows; (c) a file with one bad row → `REJECTED`, **zero** graph rows, one `import.rejected` audit; (d) dry run → `DRY_RUN`, zero graph rows, one `import.dry_run` audit; (e) `received = created + updated + unchanged + rejected` for every case; (f) unknown row fields are stored in `raw_payload`; (g) two concurrent `run` calls serialize (both succeed, and the second reports the first's rows as `unchanged`).

**Checkpoint**:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```
All pass.

---

## Phase 3: User Story 2 — The §39 scenario is seeded (P1)

**Goal**: a fresh setup contains the §39 scenario, loaded through the real import pipeline.
**Independent test**: run the seed on an empty DB, check the counts in `seed-scenario.md`; run it again, nothing changes.

- [x] T024 [US2] `ingestion/seed/scenario-39.ts`: `buildScenario39Document(): ImportDocument`, **verbatim** from `seed-scenario.md` (all entity rows 1–48, relationships R1–R20, events E1–E10, with the stated source ids, timestamps and conventions). Use small local helper functions; the output must match exactly.
- [x] T025 [US2] `ingestion/seed/scenario-39.spec.ts` (no DB), per "Required tests for this dataset" item 1: row schemas pass; counts 48/44/102/10; every relationship satisfies `RELATIONSHIP_RULES`; the test-only reverse-dependency walk gives 17 orders, 4 customers, 31,400.00 USD, 4 SLAs with 3 AT_RISK, and excludes the 3 control orders. Also run `planImport` against an empty snapshot and assert zero rejected rows.
- [x] T026 [US2] `ingestion/seed/seed.service.ts`: `seedScenario39()` per research R15 (`runDetached`, `trigger: 'SEED'`, `skipIfNoChanges: true`, system actor). Throws with the row errors if the outcome is `REJECTED`. Provide it in `IngestionModule` and export it.
- [x] T027 [US2] `apps/api/prisma/seed.ts`: after the user loop, bootstrap the Nest application context and run `SeedService.seedScenario39()` (plan.md key note 8). Log "§39 scenario seeded" or "§39 scenario already present". Keep the production-refusal check.
- [x] T028 [US2] `apps/api/test/seed.e2e-spec.ts`, per "Required tests" item 2: the exact DB counts, Order #18492's state data (BLOCKED, 4 observations, OMS BLOCKED / ERP PENDING), second run adds no rows and no audit entries, provenance fields are never null, the Budget Requirement is MISSING and the Finance Approval is BLOCKED, and all three origins and all three confidence levels are present.
- [x] T029 [US2] Update the root `README.md` "Local setup" so the seed step says it also loads the §39 scenario.

**Checkpoint**: full gate as above. Then run `pnpm --filter api prisma db seed` twice by hand against the dev DB.

---

## Phase 4: User Story 1 — Inspect an entity and see where every fact came from (P1)

**Goal**: any signed-in user can list entities and open a detail page with identity, state, relationships, timeline and source records.
**Independent test**: with the seed loaded, follow quickstart steps 1–4.

### Backend

- [ ] T030 [US1] `graph/graph.repository.ts` (interface, types, `GRAPH_REPOSITORY` token) and `graph/prisma-graph.repository.ts` per research R12: one `$queryRaw` with `Prisma.sql`, the `UNION ALL` of OUT and IN parts, text-cast ordering, keyset cursor, `limit + 1`. Also implement `countNeighbors(entityId)` (a single `SELECT count(*)` over relationships where the entity is `from` or `to`), used for `EntityDetailDto.counts.relationships`. **One hop only; no recursion.** Provide and export it in `GraphModule`.
- [ ] T031 [US1] `apps/api/test/graph-repository.e2e-spec.ts` (use `runImport` to build data): OUT, IN and BOTH; `relationshipTypes` and `neighborTypes` filters; two relationships of the same type between the same entities from different sources are both returned; a 2-node cycle returns each side's neighbor once; pagination across 3 pages has no gaps or duplicates; two identical calls return identical output; an unknown entity id returns an empty page; `countNeighbors` equals the number of relationships returned across all pages.
- [ ] T032 [US1] `graph/entity.mapper.ts`, `graph/entities.service.ts` (`list`, `detail`, `neighbors` — which checks the entity exists and calls `GraphRepository.findNeighbors` —, `states`, `sourceRecords`) per research R14, plan.md key notes 5–6 and `contracts/api.md`. `detail` includes `latestStateBySource` and `counts`; `counts.relationships` MUST come from `GraphRepository.countNeighbors`, never from a direct `relationships` query.
- [ ] T033 [US1] `graph/timeline.service.ts` per research R13. Unit-test the merge and cursor logic with fixtures: equal timestamps order events before state changes; paging across a tie has no gaps or duplicates.
- [ ] T034 [US1] `graph/entities.controller.ts` and `graph/source-systems.controller.ts` (all routes in `contracts/api.md`; thin; `ParseUUIDPipe`; `ZodValidationPipe`; no `@Roles`). Register in `GraphModule`.
- [ ] T035 [US1] `apps/api/test/entities.e2e-spec.ts` (seeded DB): list ordering and pagination; each filter and `q` (by name and by source id); detail of Order #18492 matches quickstart step 2; neighbors return origin, confidence, basis and provenance for every row; the INFERRED and MANUAL relationships appear with the right origin; timeline order; states and source-records pages; `GET /source-systems` returns the distinct, sorted source systems; unknown id → 404; non-UUID → 400; no token → 401.
- [ ] T036 [US1] `apps/api/test/timeline.e2e-spec.ts`: an entity that is a related (not subject) entity of an event shows that event with `role: 'RELATED'`; state changes appear as `STATE` items; ascending order; pagination.
- [ ] T037 [US1] Add the entity rows (anonymous 401, ANALYST/OPS_MANAGER/ADMIN ✅) to `apps/api/test/authz-matrix.e2e-spec.ts`.

### Web

- [ ] T038 [P] [US1] `apps/web/src/lib/format.ts`: `formatTimestamp` and `formatMoney` (research R10, R17; string arithmetic only). Add `format.test.ts` (`"12480.00","USD"` → `12,480.00 USD`; `"5"` pads to `5.00`; four-decimal amounts are kept; a huge amount is not rounded).
- [ ] T039 [P] [US1] `apps/web/src/pages/entities/OriginBadge.tsx` and `StateBadge.tsx` per research R17 (text labels, not colour alone). Tests: the three origins render distinct text; INFERRED and MANUAL never render "Source".
- [ ] T040 [US1] `EntityListPage.tsx` per plan.md key note 10 (filters, debounced search kept in the URL, Load more, empty state, error state). Test it with a mocked `apiFetch`.
- [ ] T041 [US1] `EntityDetailPage.tsx` plus `IdentitySection`, `CurrentStateSection`, `RelationshipsSection`, `TimelineSection`, `SourceRecordsSection` (research R17; plan.md key note 9). `CurrentStateSection` shows the current state with its source and time, the "by source" list and the history. Tests: each section renders its data; a failing section shows an error without blanking the others; a 404 shows "Entity not found"; relationship rows show origin and confidence; raw payload is behind a `<details>`; relationship and timeline rows show their source system and observation time; state changes in the timeline look different from events.
- [ ] T042 [US1] `router.tsx`: add `/entities` and `/entities/:id` under the authenticated shell. `AppShell.tsx`: add an "Entities" link for all roles between Home and Investigations. Update `AppShell.test.tsx` for the new link.

**Checkpoint**: full gate. Then do quickstart steps 1–4 by hand in the browser.

---

## Phase 5: User Story 3 — Administrator imports from JSON or CSV (P2)

**Goal**: an Admin submits a file through the API and gets a complete report.
**Independent test**: quickstart steps 6–8 and 10.

- [ ] T043 [US3] `parsing/csv-import.parser.ts` per research R6 and `contracts/import-format.md` (column maps for the three kinds, `attr.` columns, `related` list parsing, the "both reference forms" error, row-count mismatch → row error, header problems and `CsvError` → file errors, spreadsheet row numbers, column-name error fields, the raw payload being every header and cell). Add `csv-import.parser.spec.ts`.
- [ ] T044 [US3] `import-upload.interceptor.ts` (research R5) and `imports.controller.ts` (`POST /imports`, `GET /imports`, `GET /imports/:id`; plan.md key note 7). The interceptor injects `ImportService` and, when it converts multer's `PayloadTooLargeException`, first calls `importService.refuse('bytes', IMPORT_MAX_BYTES, undefined)` so the oversize upload is audited (the row limit is already handled in `run`, T022). In `ImportService` add `list` and `get`, ordered `(receivedAt DESC, id DESC)`.
- [ ] T045 [US3] `apps/api/test/imports.e2e-spec.ts` through HTTP with multipart: JSON success and CSV success for each kind; dry run; REJECTED with nothing stored and a correct `rowErrors` (row numbers, fields, messages for an unknown type, a disallowed relationship pair, a self-loop, a missing reference, a missing basis, a bad timestamp, a bad amount); dependent-row rejection with `dependsOn`; a CSV with a short row; invalid JSON; unknown top-level section; non-UTF-8; unknown fields kept in the payload; a file over 10 MB → 413 and an `import.refused` audit; more than 10,000 rows → 413; missing file or bad fields → 400; Analyst, Manager and anonymous → 403/401 with `auth.forbidden` audited for the two roles; `GET /imports` and `GET /imports/:id` (incl. 404).
- [ ] T046 [US3] Add the `/imports` rows to `apps/api/test/authz-matrix.e2e-spec.ts`.
- [ ] T047 [P] [US3] Publish `contracts/import-format.md` as `docs/import-format.md` (drop the implementer note) and create the four example files under `docs/examples/import/` as described at the end of that document.
- [ ] T048 [US3] `apps/api/test/docs-examples.e2e-spec.ts`: import `entities.csv`, `relationships.csv`, `events.csv` in that order and then `import.json`, through the API; each must be `APPLIED`.

**Checkpoint**: full gate. Then quickstart steps 6–8 and 10 by hand.

---

## Phase 6: User Story 4 — Entities accumulate observations from several systems (P2)

**Goal**: the multiple-source and history behaviour is proven end to end.
**Independent test**: quickstart step 9 plus the tests below.

- [ ] T049 [US4] Extend `apps/api/test/imports.e2e-spec.ts` (or a new `imports-multisource.e2e-spec.ts`) for the five US4 scenarios: (1) an `entityRef` row from a second system attaches to the entity, which then lists both systems and both records; (2) a same-type, same-name row from a second system *without* `entityRef` creates a separate entity; (3) an older state observation is stored in the history and leaves the current state alone; (4) re-submitting an identical row is `unchanged` and writes no audit entry; (5) two systems with different latest states both appear in `latestStateBySource`. Also: P4 (an identifier already owned by another entity), an `entityRef` chain is rejected, and two files imported in opposite orders produce the same final projections (determinism, FR-021/FR-022).
- [ ] T050 [US4] Web test in `CurrentStateSection.test.tsx`: when two source systems disagree, both states are shown beside the overall current state, and neither is hidden. Add a test that an entity with only `UNKNOWN` state shows "No state observed".

**Checkpoint**: full gate.

---

## Phase 7: Polish and cross-cutting

- [ ] T051 `apps/api/test/perf-graph.e2e-spec.ts` per research R18 (skipped unless `RUN_PERF=1`). Run it locally and record the three timings in the PR description or `questions.md`.
- [ ] T052 Cross-check against the spec: for every FR-001 to FR-049, confirm a test or implementation covers it. Write any gap into `questions.md`. Check that no file outside `ingestion` writes graph tables (`grep` for `prisma.entity.create`, `relationship.create` and similar), and that no SQL outside `prisma-graph.repository.ts` reads relationships for display.
- [ ] T053 Walk the whole of `quickstart.md` by hand and tick off each step. Fix any step that doesn't behave as written, in the code or in the quickstart (the quickstart may only be edited to fix factual errors).
- [ ] T054 Final gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`. Confirm there are no `TODO`s, dead code, or unused dependencies (`csv-parse` and `@types/multer` must both be used).

---

## Dependencies

- Phase 1 → Phase 2 → Phase 3 (US2) → Phase 4 (US1) → Phase 5 (US3) → Phase 6 (US4) → Phase 7.
- Within Phase 2: T002–T004 → T005 → T006–T008 → T009; T010–T013 are independent of each other but need T005 (audit actions) and T006 (Prisma types). T014 needs nothing. T016 needs T015 (observation types) and T003. T017–T018 need T015. T019 → T020 → T021 → T022 → T023.
- US1 depends on US2 only for seed data in tests. The backend read paths (T030–T036) could be built before the seed if tests use `runImport`, but keep the order above.
- US3 depends on Phase 2 (JSON pipeline). US4 depends on US3's HTTP endpoint only for realism. Its logic is already in Phase 2.

## Parallel examples

- **Phase 2 shared contracts**: T002 → T003 → T004 are sequential (each imports the previous one), so parallel work starts at T006 once T005 is done.
- **US2**: T025 and T029 once T024 exists.
- **US3**: T047 (docs) alongside T043–T045.
- **US4**: T049 and T050 at the same time.
- **Phase 2 infrastructure**: T010, T011 and T012 at the same time; T014 alongside any of them.
- **Phase 4 web**: T038 and T039 at the same time, while the backend tasks T032–T035 proceed.

## Implementation strategy

- **MVP**: Phases 1–4 deliver the model, the seeded scenario and the inspection UI (both P1 stories). Stop and review there if needed. Phase 5 adds the Admin import endpoint, and Phase 6 proves the multi-source behaviour end to end.
- **Review points** (for the orchestrator): after T023 (pipeline correctness is the highest risk), after T028 (seed numbers), and after T042.
