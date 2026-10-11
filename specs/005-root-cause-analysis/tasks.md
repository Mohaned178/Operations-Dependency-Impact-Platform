# Tasks: Root-Cause Analysis

**Input**: `specs/005-root-cause-analysis/` (plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md)
**Tests**: REQUIRED.
- Constitution V requires a zod schema and e2e tests for every endpoint.
- Spec FR-033 and FR-034 list the required coverage.
- SC-002 and SC-004 to SC-006 are verified by tests.

## Rules for the implementer (read first)

1. Do tasks **in ID order** within a phase. `[P]` tasks touch different files and may be done in any order.
2. Before each task, re-read the section it references:
   - research.md (R#);
   - data-model.md (§#);
   - contracts/api.md (§ name, fixture R#);
   - plan.md "Key Design Notes" (KDN #).

   **Do not invent alternatives.** The strings and values in contracts/api.md § Explanation text and § Acceptance fixtures are exact. Assert them literally.
3. **Forbidden**:
   - new dependencies;
   - `any`, `TODO`s, and non-null `!` (use `.at()` with a check and throw an invariant `Error`);
   - `localeCompare` (compare strings only with `compareCodeUnits` from `apps/api/src/graph/traversal/path-order.ts`);
   - `WITH RECURSIVE`, or any multi-hop traversal outside `apps/api/src/graph/prisma-graph.repository.ts`. This feature adds **none**.
   - calling `new Date()` or `Date.now()` in `apps/api/src/root-cause/analysis/` (pure modules receive `evaluatedAt`).
4. Do not change the output of any 003 endpoint or the default mood of `explainBlockingPath`. Every existing 003 test must pass **unchanged**.
5. After each **phase**, run its **Checkpoint**. Fix every failure, tick the boxes, and commit with Conventional Commits (`feat(root-cause): …`, `test(root-cause): …`, `feat(web): …`), one commit per task or small group of tasks.
6. If anything is ambiguous, contradicts an acceptance fixture, or Postgres rejects a query, stop. Write the question, with the exact error output, to `specs/005-root-cause-analysis/questions.md`.
7. Rebuild shared after every change to `packages/shared`: `pnpm --filter @opsgraph/shared build`.

**Standard gate** (used by the checkpoints): `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`

---

## Phase 1: Setup

- [x] T001 On branch `005-root-cause-analysis`, confirm the baseline is green before any change. With `docker compose up -d db` running, run the standard gate plus `pnpm build`. If anything fails, stop and record it in `specs/005-root-cause-analysis/questions.md`. Do not fix 003 code in this feature. The untracked `specs/004-graph-explorer/` folder is unrelated: do not touch or commit it.

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: shared schemas, the notes storage, the small 003 extensions, the one-hop repository lookup, and every pure analysis module. All of them are needed by more than one story.

### Shared (`packages/shared/src`)

- [x] T002 [P] Create `packages/shared/src/evidence-notes.ts` with everything in contracts/api.md for notes:
  - `EvidenceNoteStanceSchema` and `EVIDENCE_NOTE_LIMITS` (data-model §2);
  - `EvidenceNoteTargetSchema`, `CreateEvidenceNoteRequestSchema` (`.strict()`, with the `reference` transform: empty or absent becomes `null`), `RetractEvidenceNoteRequestSchema` (`.strict()`) and `EvidenceNoteListQuerySchema` (= `PageQuerySchema`);
  - `UserRefDtoSchema`, `EvidenceNoteDtoSchema` and `EvidenceNoteListResponseSchema`.

  Export an inferred type for each schema. Add `export * from './evidence-notes';` to `index.ts`.
- [x] T003 Create `packages/shared/src/root-cause.ts`:
  - the constants in data-model §2: `CAUSAL_ROLES`/`CausalRoleSchema`, `CONFIDENCE_RULES`/`ConfidenceRuleSchema`, `LabelRuleSchema`, `EvidenceRuleSchema`, `RootCauseStatusSchema`, `ROOT_CAUSE_LIMITS`, `REQUIREMENT_SOURCE_RELATIONSHIP_TYPES`;
  - every schema in contracts/api.md § Query and request schemas (`RootCauseQuerySchema`) and § Response schemas, from `StateRecordEvidenceDtoSchema` through `RootCauseResponseSchema`. `Counted` is a non-exported helper.

  Import `TraceDepthSchema`, `TracedEntityDtoSchema`, `HopDtoSchema` and `TruncationDtoSchema` from `./tracing`, base schemas from `./graph`, and `EvidenceNoteDtoSchema` from `./evidence-notes`. Export inferred types, and add `export * from './root-cause';` to `index.ts`.

  In `packages/shared/src/audit.ts`, add `EVIDENCE_NOTE_CREATED: 'evidence_note.created'` and `EVIDENCE_NOTE_RETRACTED: 'evidence_note.retracted'` to `AUDIT_ACTIONS`.
- [x] T004 Create `packages/shared/src/evidence-notes.spec.ts` and `packages/shared/src/root-cause.spec.ts` (Vitest).

  **Notes schemas**:
  - `text: '  x  '` becomes `'x'`;
  - `text` of `'   '` or 2,001 characters is rejected at path `['text']`;
  - `reference: ''` becomes `null`, and an absent reference becomes `null`;
  - `stance: 'MAYBE'` is rejected;
  - `target: { kind: 'TEAM' }` is rejected;
  - an extra property is rejected (strict);
  - a retract `reason` over 500 characters is rejected.

  **Root-cause schemas**:
  - `RootCauseQuerySchema`: `depth` defaults to 6; `"0"`, `"11"` and `"abc"` are rejected; `evaluatedAt: 'yesterday'` is rejected; `'2026-09-29T16:00:00Z'` is accepted;
  - `CONFIDENCE_RULES` is exactly the 8 rules in research R6 order;
  - `ROOT_CAUSE_LIMITS.staleAfterMs === 259_200_000`;
  - a hand-built `RootCauseResponse` sample parses;
  - `confidenceRules` with 7 items fails.

  Run `pnpm --filter @opsgraph/shared build test`.

### Storage (data-model §1, research R9)

- [x] T005 In `apps/api/prisma/schema.prisma`, add `EvidenceNoteStance`, `EvidenceNote` and `EvidenceNoteRetraction`, plus the 4 back-relations, exactly as in data-model §1a.
  1. Run `pnpm --filter api prisma migrate dev --create-only --name evidence_notes`.
  2. Append the SQL of data-model §1b, verbatim, to the generated `migration.sql`. Do **not** redefine `forbid_provenance_mutation()`.
  3. Apply it with `pnpm --filter api prisma migrate dev`, then run `prisma generate`.
- [x] T006 In `apps/api/test/helpers.ts → resetDb`:
  - add `ALTER TABLE evidence_notes DISABLE TRIGGER USER` and `ALTER TABLE evidence_note_retractions DISABLE TRIGGER USER` next to the existing ones, with matching `ENABLE` lines;
  - add `evidence_note_retractions, evidence_notes` to the front of the `TRUNCATE` list.

  Run `pnpm --filter api test:e2e -- seed` to confirm that reset still works.

### 003 extensions (research R2, R8)

- [x] T007 [P] In `apps/api/src/tracing/tracing.module.ts`, add `exports: [TracingService]`.
- [x] T008 [P] In `apps/api/src/tracing/explanation.ts`, add a third optional parameter `mood: 'ASSERTIVE' | 'HEDGED' = 'ASSERTIVE'` to `explainBlockingPath`, and pass it to `subjectClause`. HEDGED changes only two rows (contracts/api.md § Chain sentences):
  - UNSATISFIED: `${name} may be ${label} because`;
  - SATISFIED + AT_RISK: `${name} may be at risk because`.

  Export the mood type as `ExplanationMood`. In `explanation.spec.ts`, **add** cases:
  - F2 `explanation[0]` with HEDGED: `Order #18492 may be blocked because it requires Payment PAY-88213, which is PENDING.`;
  - F3 `paths[0].explanation[0]` with HEDGED: it starts `Acme Corp delivery SLA may be at risk because`;
  - INDETERMINATE and non-AT_RISK SATISFIED subjects are identical in both moods.

  Leave every existing case untouched.

### One-hop repository lookup (data-model §3a)

- [x] T009 In `apps/api/src/graph/graph.repository.ts`, add `IncomingRelationshipRow` and `findIncomingRelationships(entityIds, types)` exactly as in data-model §3a. In `prisma-graph.repository.ts`, implement it:
  - **Empty input**: return `[]` without querying when `entityIds` or `types` is empty.
  - **Query**: a single `prisma.relationship.findMany({ where: { toEntityId: { in }, type: { in } }, include: { from: true } })`.
  - **Mapping**: map each row to `relationship` (with `direction: 'IN'`), `targetEntityId` and `source` (with `attributes` cast through `JsonValueSchema.parse`, so no `any`).
  - **Sorting**: sort in TypeScript by `(targetEntityId, type, source.displayName, source.id, relationship.id)` with `compareCodeUnits`.

  It contains no raw SQL and no recursion.
- [x] T010 Extend `apps/api/test/graph-repository.e2e-spec.ts` with `findIncomingRelationships`. Seed the §39 scenario the way `tracing-seed.e2e-spec.ts` does. Assert:
  - `([], ['DEFINES'])` returns `[]`;
  - for BR-18492 with `['DEFINES','GOVERNS']`: exactly 1 row, `source` = CON-3982, `relationship.type = 'DEFINES'`, and `source.attributes.clause` = "Orders above 10,000.00 USD require finance approval with a budget code";
  - for Order #18492: 1 GOVERNS row from CON-3982;
  - for `[18492, BR-18492]` together: 2 rows, ordered by `targetEntityId`;
  - PLACED relationships into Order #18492 are **not** returned when only `['DEFINES','GOVERNS']` is requested.

### Pure analysis modules (`apps/api/src/root-cause/analysis/`, no Nest, no Prisma, no clock)

- [x] T011 [P] Create `types.ts` with `ConfidenceInput` and `ConfidenceResult` (data-model §3c). Also add `CandidateGroup { deepestEntityId: string; primary: BlockingPathDto; primaryIndex: number; alternatives: BlockingPathDto[] }`.
- [x] T012 [P] Create `label.ts` (research R5):
  - `stateWords(state)`;
  - `humanize(field)`;
  - `rootCauseLabel(entity: TracedEntityDto, attributes: Record<string, JsonValue> | undefined): { label: string; labelRule: LabelRule }`.

  Create `label.spec.ts` covering:
  - `budgetCode` + MISSING gives `Budget Code Missing` / REQUIRED_FIELD;
  - `cost_center` gives `Cost Center`, `po-number` gives `Po Number`, and `x` gives `X`;
  - an empty-string or non-string `requiredField` falls back to DISPLAY_NAME_STATE (`Payment PAY-88213 Pending`);
  - `stateWords` for all 12 states (AT_RISK gives `At Risk`).
- [x] T013 [P] Create `roles.ts`: `toCausalChain(start: TracedEntityDto, path: BlockingPathDto, sentences: string[]): CausalChainDto`. Use the research R3 role table, set `possible` from `currentState === 'UNKNOWN'`, set `hop` to `null` at index 0, and copy `length`, `weakestConfidence`, `nonSourceHops`, `continuesBeyondDepth` and `endsInCycle` from the path. Create `roles.spec.ts` with hand-built paths of 1, 2, 3 and 6 hops (asserting each step's `roles` array exactly), plus an UNKNOWN step giving `possible: true`.
- [x] T014 [P] Create `candidates.ts`:
  - `groupCandidates(paths: readonly BlockingPathDto[]): CandidateGroup[]`: group by the last hop's `entity.id`, in first-appearance order, keeping alternatives in `paths` order;
  - `orderCandidates<T extends { confidence: Confidence; primaryIndex: number }>(items: T[]): T[]`: CONFIDENCE_RANK descending, then `primaryIndex` ascending, without mutating the input.

  Create `candidates.spec.ts` covering:
  - 3 paths, where paths 0 and 2 end at X and path 1 ends at Y: groups are X (alternatives [path 2]), then Y;
  - ordering with a MEDIUM X and a HIGH Y gives Y first;
  - equal confidence keeps `primaryIndex` order;
  - `[]` gives `[]`.
- [x] T015 Create `explanation.ts` (root-cause), with pure functions exactly as specified in contracts/api.md § Explanation text:
  - `headline(candidate fields, candidateCount, depth)`;
  - one reason builder per rule: `weakestLinkReason`, `unknownStateReason`, `cycleReason`, `searchLimitReason`, `staleReason`, `disagreementReason`, `corroborationReason`, `disputedReason`. Each takes the data it names and returns the applied or not-applied sentence;
  - `evidenceSentence(keyEvidence, eventCount)`;
  - `summarizeRootCause(start, status, candidates, depth)`.

  Reuse `steps()` by exporting it from `tracing/explanation.ts`, without changing its behaviour. Create `explanation.spec.ts` asserting, character for character:
  - every R1 reason (rules 1–8);
  - the R1 headline, evidence sentence and summary;
  - the R2 and R3 weakest-link reasons and evidence sentences;
  - R3's headline and summary;
  - the R4, R5 and R9 summaries;
  - the R6 stale reason;
  - an R7-shaped disputed reason with a 97-character text, giving the exact 80-character excerpt plus `…`;
  - the headline variants: LOW, more than one candidate, `(state unknown)`, `(circular dependency)`, `(deepest cause found within 6 steps)`, and all three suffixes together in order;
  - the summary variants: 1 LOW candidate and k = 2.
- [x] T016 Create `confidence.ts`: `computeConfidence(input: ConfidenceInput): ConfidenceResult`. It follows research R6 exactly, using the reason builders from T015.
  - It always returns 8 outcomes, in `CONFIDENCE_RULES` order.
  - Each outcome carries `confidenceAfter` and sorted `refs` (contracts/api.md § Refs).
  - `lower()` floors at LOW.
  - Rules 5–8 fire at most once.
  - Notes count only when `active && stance === 'DISPUTES'`, targeting either a chain entity or any `hop.assertions[].relationshipId`.

  Create `confidence.spec.ts` with hand-built inputs:
  - each rule alone;
  - rules 2 and 3 overriding HIGH;
  - rule 4 capping HIGH to MEDIUM, and staying `applied` on LOW with LOW;
  - rule 4 triggered by `truncation.pathLimit` alone;
  - stale at exactly 72 h (not applied) and at 72 h + 1 ms (applied);
  - a future observation (not stale);
  - a missing observation (stale, "never observed");
  - rule 6 within one class (not applied, same-class reason) versus across classes (applied);
  - rule 7 with 1 source and 0 events (applied), 1 source and 1 event (not applied), and 2 sources and 0 events (not applied, "reported by 2 source systems");
  - rule 8 with a retracted DISPUTES note (ignored), and with SUPPORTS and CONTEXT notes (ignored);
  - HIGH with rules 5, 6, 7 and 8 all firing gives LOW, with each firing once;
  - the full R1 input gives HIGH and exactly the 8 R1 reasons.
- [x] T017 [P] Create `key-evidence.ts`:
  - `keyEvidence(chain: CausalChainDto, entityEvidence): KeyEvidenceItemDto[]`, following contracts/api.md § Key evidence: chain order, state records then requirement-source state records, de-duplicated by `sourceRecordId`, skipping null state records;
  - `eventCount(chain, entityEvidence): number`: the distinct event ids over the steps' `events.items`.

  Create `key-evidence.spec.ts` with the R1 shape (6 items in order, CON-3982 kept only once) and an `eventCount` that counts an event shared by 2 steps once.

**Checkpoint**: `pnpm --filter @opsgraph/shared build test`, `pnpm --filter api test`, `pnpm --filter api test:e2e -- graph-repository tracing`, `pnpm lint`, `pnpm typecheck`. Every existing 003 test must still pass.

---

## Phase 3: User Story 1 — classified, evidenced causal chain (P1) 🎯 MVP

**Goal**: `GET /api/entities/:id/root-cause` returns candidates with role-classified chains, labels, evidence, key evidence and explanations. The Entity 360 page shows them in a Root cause section and in the header callout.
**Independent test**: with the seed loaded, contracts/api.md fixtures R1–R4 and R8 pass, SC-004 determinism passes, and quickstart §3 steps 1–3 and 5 behave as written.

### Backend

- [x] T018 [US1] Create `apps/api/src/root-cause/evidence.reader.ts`: an `@Injectable() EvidenceReader` with `load(req: EvidenceRequest): Promise<EvidenceBundle>` (data-model §3b, research R4). It runs one query per row of the R4 table, batched over all ids. Raw SQL uses `::uuid[]` casts, and `COLLATE "C"` inside window `ORDER BY`. Every returned list is re-sorted in TypeScript with `compareCodeUnits`.
  1. **State records**:
     - the current observation plus the latest from each other source system, both joined to `source_records` for `SourceRecordDto` (`rawPayload` included);
     - the current record goes first with `current: true`, and the others follow sorted by `sourceSystem` with `current: false`.
  2. **Relationship records**: the latest source record per relationship id (`DISTINCT ON (relationship_id) … ORDER BY relationship_id, observed_at DESC, seq DESC`), plus each relationship's own `origin` and `confidence`.
  3. **Requirement sources**:
     - `graph.findIncomingRelationships(entityIds, REQUIREMENT_SOURCE_RELATIONSHIP_TYPES)`;
     - load the defining entities' state records with step 1;
     - cap at 20 per target entity, sorted by `(relationshipType, entity.displayName, entity.id)`, with `total`.
  4. **Events**:
     - top 20 per entity by `occurred_at DESC, source_system COLLATE "C", source_id COLLATE "C"`, plus counts;
     - load every entity named in those events, for `entities[]`;
     - set `role` from `event_entities.role` of the evidenced entity.
  5. **Notes**:
     - per target kind, top 50 per target by `created_at DESC, id DESC`, left-joined to retractions, with the author and retractor `display_name`, plus counts;
     - map them with the note mapper. Put the pure row→DTO function in `evidence-note.mapper.ts` now, and complete it in T036;
     - add `rule: 'MANUAL_NOTE'` and `origin: 'MANUAL'`.
  6. **Attributes** for `rootCauseEntityIds`.

  Every requested entity id and relationship id gets an entry, even when it is empty. Empty inputs make no queries.
- [x] T019 [US1] Create `apps/api/src/root-cause/root-cause.service.ts`: `analyze(id: string, query: RootCauseQuery): Promise<RootCauseResponse>`, exactly as data-model §4 and plan KDN 2–4 describe:
  - Read `computedAt` once.
  - Call `tracing.blockers` (`relationshipTypes: []`, `entityTypes: []`).
  - Status rules are in contracts/api.md.
  - Load evidence for the entities and assertion ids on all paths. For UNEXPLAINED, load the start only.
  - For each group:
    1. `rootCauseLabel`;
    2. `computeConfidence` on the primary chain;
    3. chain sentences: `BlockingPathDto.explanation`, or `explainBlockingPath(start, path, 'HEDGED')` when the confidence is LOW, for primary and alternative chains alike;
    4. `toCausalChain` for each chain;
    5. `keyEvidence` and `eventCount`;
    6. `explanation` (`headline`, `chain` = primary sentences, `confidence` = the reasons of applied outcomes, `evidence` sentence).
  - Then `orderCandidates`. The headline needs the final candidate count, so compute headlines after grouping.
  - Build `summarizeRootCause`, then the `evidence.entities` and `evidence.relationships` arrays in first-appearance order (data-model §4.6).
  - Echo `query.evaluatedAt` as an ISO string.
- [x] T020 [US1] Create `root-cause.controller.ts`: `@Controller('entities')` with `@Get(':id/root-cause')`, using `ParseUUIDPipe` and `ZodValidationPipe(RootCauseQuerySchema)`. Create `root-cause.module.ts`, importing `TracingModule`, `GraphModule` and `PrismaModule`, with providers `RootCauseService` and `EvidenceReader`. Register `RootCauseModule` in `apps/api/src/app.module.ts`.
- [x] T021 [US1] Create `apps/api/test/root-cause-seed.e2e-spec.ts`. Seed as `tracing-seed.e2e-spec.ts` does, and sign in as an ANALYST. Parse every response with `RootCauseResponseSchema`. Use `evaluatedAt=2026-09-29T16:00:00Z` and look up ids with `entityIdByKey`. Assert **every line** of fixtures R1, R2, R3, R4 and R8 in contracts/api.md.

  Add the SC-004 test: for Order #18492, Shipment SHP-77120 and the Acme SLA, 100 sequential calls with the same `evaluatedAt` produce responses that are deep-equal after deleting `computedAt`.

  Add the SC-002 check: the analyses of Order #18492, SHP-77120 and all 4 delivery SLAs name `Budget Code Missing`. The SLA keys are in the seed scenario. The Umbrella SLA is ACTIVE, but it still depends on SHP-77120.
- [x] T022 [US1] Create `apps/api/test/root-cause.e2e-spec.ts`. Build small graphs with `runImport`, using JSON entity, relationship and event rows; the shapes are in `tracing.e2e-spec.ts`. Cover US1 behaviour:
  - **validation**: `depth` 0, 11 and `abc`, and `evaluatedAt=yesterday` all give 400 with the right detail path; a malformed id gives 400; an unknown id gives 404; no token gives 401;
  - **evidence rules**:
    - an entity with 25 events returns 20 items, newest first, with `total 25`;
    - an entity with states from 2 sources returns 2 `stateRecords`, the current one first;
    - a GOVERNS and a DEFINES into one step both appear as requirement sources, sorted by type;
    - a relationship evidence `record` is the latest of its 2 observations;
  - `GET /root-cause` writes no `audit_entries` rows: count them before and after.
- [x] T023 [US1] In `apps/api/test/authz-matrix.e2e-spec.ts`, add an AUTHENTICATED probe for `GET /api/entities/:id/root-cause`, using `MISSING_ID` like the other entity probes.

### Web (`apps/web/src/pages/entities/`, research R11)

- [x] T024 [P] [US1] Create `root-cause-test-data.ts` with typed `RootCauseResponse` constants:
  - `R1_ORDER` (the R1 shape);
  - `R2_SHIPMENT` (with 1 alternative chain);
  - `R4_NOT_BLOCKED`;
  - `R5_UNEXPLAINED`.

  Each must parse with `RootCauseResponseSchema`; assert this in the first component test. Reuse entity and hop samples from `tracing-test-data.ts` where they fit.
- [x] T025 [P] [US1] Create `useRootCause.ts`: `useRootCause(entityId)` is a `useQuery` with key `['entities', entityId, 'root-cause']`, and `apiFetch('/entities/${id}/root-cause', { schema: RootCauseResponseSchema })`.
- [x] T026 [P] [US1] Create `StepEvidence.tsx`, which renders one step's evidence from `EntityEvidenceDto` plus, when the step has a hop, its `RelationshipEvidenceDto`s. Groups are headed **State records**, **Relationship records**, **Requirement sources**, **Events (n of total)** and **Notes**. Every item shows its source system, source id and observed time (`formatTimestamp`), and `OriginBadge` for non-SOURCE items. A requirement source shows its relationship (`Contract CON-3982 DEFINES Budget code…`) and its attributes as key: value lines. Leave the Notes group showing only the list for now: a read-only list of text, stance and author, marked "retracted" when inactive. US3 replaces it. Create `StepEvidence.test.tsx` (BR-18492 evidence from R1 shows the clause and "Events (1 of 1)").
- [x] T027 [US1] Create `CausalChainView.tsx`:
  - an ordered list of steps;
  - each step shows its `RoleBadge` (text labels: Symptom, Immediate Blocker, Upstream Cause, Root Cause; multiple roles show multiple badges), the entity link (`/entities/:id`), `StateBadge`, "possible" when `possible`, and the linking relationship as recorded with `OriginBadge` and its confidence;
  - a disclosure button per step reveals `StepEvidence`.

  Create `CausalChainView.test.tsx` covering R1's 4 steps and roles, an R8-like step with 2 badges, and expanding a step to show its evidence.
- [x] T028 [US1] Create `RootCauseCandidate.tsx`. It renders:
  - the `headline`;
  - the `explanation.chain` sentences through `ExplanationSentence`, with link targets built from the chain's step entities. If `linkTargets` only accepts a start and a path, add an overload that takes `TracedEntityDto[]`, without changing existing callers;
  - `explanation.confidence` and `explanation.evidence`;
  - the primary `CausalChainView`;
  - a collapsed "Alternative chains (n)" disclosure, with one `CausalChainView` each.

  Create `RootCauseCandidate.test.tsx` covering R1 (headline, 3 sentences, evidence sentence) and R2 (the alternative chain is collapsed by default, and expanding it shows "manually recorded").
- [x] T029 [US1] Create `RootCauseSection.tsx` (`<section id="root-cause">`, heading `Root cause`, using `useRootCause`):
  - **loading**: a loading line;
  - **error**: its own `role="alert"` line, without throwing;
  - **NOT_BLOCKED**: a single line containing the `summary`;
  - **UNEXPLAINED**: the `summary`, plus the start entity's `StepEvidence`;
  - **ROOT_CAUSES_FOUND**: the `summary`, then one `RootCauseCandidate` per candidate.

  Create `RootCauseSection.test.tsx` covering all four states, using `apiFetchMock` as in `BlockerCallout.test.tsx`.
- [x] T030 [US1] Update `BlockerCallout.tsx` (research R11):
  - use `useRootCause` and `useBlockers`;
  - when there are candidates, render the root-cause `summary`, the first candidate's `headline` and its chain sentences, and a link `#root-cause` ("See root cause");
  - then, when blockers exist, the 003 blocker `summary` and the link `#blockers`;
  - also render `paths[0].explanation` when the first candidate's primary-chain hop keys differ from `paths[0]`'s.

  It renders nothing when both are empty. Update `BlockerCallout.test.tsx`:
  - R1 together with F2 shows the headline and no duplicate explanation;
  - a mismatching-chain case shows both explanations;
  - a failed root-cause query still shows the blocker summary.
- [x] T031 [US1] In `EntityDetailPage.tsx`, render `<RootCauseSection entityId={entity.id} />` between `CurrentStateSection` and `BlockersSection`. In `EntityDetailPage.test.tsx`:
  - add a mock answer for `/root-cause`;
  - update the heading-order test to Identity, Current state, Root cause, Blockers, Dependencies, Relationships, Timeline, Source records;
  - keep the FR-032 assertion (no risk, exception, impact or investigation headings);
  - add a test that a failing `/root-cause` request leaves Blockers and Identity rendered.

**Checkpoint**: standard gate. Then, with the dev DB seeded and `pnpm dev` running, walk quickstart §2 (the R1 call) and §3 steps 1, 2, 3 and 5 at 1366×768 (FR-029).

---

## Phase 4: User Story 2 — inspectable confidence and honest uncertainty (P1)

**Goal**: every confidence rule is shown with its outcome, and weak evidence is reported as "Possible root cause — insufficient evidence" with "may be" wording. Unexplained states name no cause.
**Independent test**: fixtures R5, R6 and R9 pass, every Story 2 acceptance scenario passes on built graphs, and the confidence details are visible on the page.

- [x] T032 [US2] Extend `apps/api/test/root-cause-seed.e2e-spec.ts` with fixtures **R5** (Order #18532 UNEXPLAINED, start-only evidence), **R6** (`evaluatedAt=2026-10-06T12:00:00Z`, exact stale reason, MEDIUM) and **R9** (BR-18492 UNEXPLAINED). Assert every line.
- [x] T033 [US2] Extend `apps/api/test/root-cause.e2e-spec.ts` with built graphs, one `describe` per spec Story 2 scenario. Assert the candidate `confidence`, which rule outcomes have `applied`, the exact reason for the applied rule, and the headline form:
  1. **Inferred low link**: a chain of SOURCE/HIGH, SOURCE/HIGH and INFERRED/LOW hops. Expect LOW, the `Possible root cause — insufficient evidence:` headline, and every chain sentence containing `may be` (except INDETERMINATE subjects).
  2. **Unknown root**: the deepest entity is UNKNOWN. Expect LOW, `possible: true`, a ` (state unknown)` headline suffix, and sentences saying `whose state is unknown`.
  3. **Depth limit**: depth 2 on a 4-hop chain. Expect `continuesBeyondDepth`, a cap at MEDIUM, and the ` (deepest cause found within 2 steps)` suffix.
  4. **Blocked with no dependencies**: a BLOCKED entity with no blocker relationships. Expect UNEXPLAINED, the exact summary, and no candidates.
  5. **Cross-class disagreement**: one step with source A ACTIVE (older) and source B BLOCKED (newer). Expect rule 6 applied and lowered by one level, with both states in `details`.
  6. **Stale step**: `evaluatedAt` 73 h after one step's observation. Expect rule 5 applied, and the reason naming that step and its time.
  7. **Two root causes**: one entity REQUIRES two separate MISSING entities. Expect 2 candidates, headlines starting `Possible root cause:`, and a summary starting `… 2 possible root causes found; highest ranked:`.
  8. **Cycle**: A REQUIRES B, B REQUIRES A, both BLOCKED. Expect a `(circular dependency)` suffix and LOW.
  9. **Uncorroborated root**: one source system and no events. Expect rule 7 applied.
- [x] T034 [P] [US2] Create `apps/web/src/pages/entities/ConfidenceRules.tsx`. It is a disclosure labeled `Confidence: <LEVEL> — show the 8 rules`, containing a list with one row per outcome: the rule name in words, `Applied` or `Not applied` as text (not colour only), `confidenceAfter`, and the `reason`. Create `ConfidenceRules.test.tsx` checking that R1 shows 8 rows with only Weakest link applied, and that an R6-like outcome list marks Stale evidence as applied.
- [x] T035 [US2] In `RootCauseCandidate.tsx`:
  - render `ConfidenceRules` under the explanation;
  - when `insufficientEvidence`, give the candidate an amber "Insufficient evidence" text badge and an `aria-describedby` pointing at the applied reasons;
  - show "possible" on `possible` candidates.

  Extend `RootCauseCandidate.test.tsx` with a LOW candidate: the badge and hedged sentences are visible, and the headline starts `Possible root cause — insufficient evidence`. In `RootCauseSection.test.tsx`, add a 2-candidate response where both headlines render in the given order.

**Checkpoint**: standard gate. Then walk quickstart §2 (the R6 and R5 calls) and expand Confidence on Order #18492 in the browser.

---

## Phase 5: User Story 3 — manual evidence notes (P2)

**Goal**: any signed-in user can attach immutable, audited notes to entities and relationships. Only the author or an admin can retract them. Disputes notes lower confidence.
**Independent test**: `evidence-notes.e2e-spec.ts` and fixture R7 pass, and the note flow in quickstart §3 step 4 works in the browser.

### Backend

- [x] T036 [US3] Complete `apps/api/src/root-cause/evidence-note.mapper.ts`, started in T018. It provides `toEvidenceNoteDto(row)` for both Prisma rows (with `author` and `retraction.retractedBy` included) and the raw rows used by `EvidenceReader`. `active` is `retraction === null`, and every date is ISO. Create `evidence-note.mapper.spec.ts` covering an active note, a retracted note, and both target kinds.
- [x] T037 [US3] Create `evidence-notes.service.ts` (plan KDN 6, research R9 and R10):
  - **`create(input, user)`**: in one `$transaction`:
    1. check that the target exists; otherwise `Errors.validation([{ path: 'target.entityId' | 'target.relationshipId', message: 'Entity not found' | 'Relationship not found' }])`;
    2. insert the note;
    3. `audit.record(tx, { action: EVIDENCE_NOTE_CREATED, targetType: 'evidence_note', targetId, after: dto })`.
  - **`retract(noteId, reason, user, request)`**:
    1. load the note; a missing note is 404 (`Errors.notFound('Evidence note')`);
    2. if it is already retracted, return its DTO with no audit row;
    3. if the caller is neither the author nor an ADMIN: `audit.recordStandalone({ action: AUTH_FORBIDDEN, metadata: { method, path, role } })`, then throw `Errors.forbidden()`;
    4. otherwise, in a transaction: insert the retraction and record `EVIDENCE_NOTE_RETRACTED` with `before` and `after`. A unique violation on `note_id` re-reads the note and returns it, as in step 2.
  - **`listForEntity(id, page)`** and **`listForRelationship(id, page)`**:
    - 404 when the target is missing;
    - order by `createdAt DESC`, then `id DESC`;
    - cursor `{ createdAt, id }` via `encodeCursor`/`decodeCursor`, with the next page starting strictly after the cursor;
    - fetch `limit + 1` to decide `nextCursor`.
- [x] T038 [US3] Create `evidence-notes.controller.ts` (`@Controller()`):
  - `POST evidence-notes` (201);
  - `POST evidence-notes/:noteId/retract` (200, `@HttpCode(200)`);
  - `GET entities/:id/evidence-notes`;
  - `GET relationships/:id/evidence-notes`.

  Use `ZodValidationPipe` with the T002 schemas, `ParseUUIDPipe`, and `@CurrentUser()`; pass `method` and `path` from the request for the forbidden audit. Register the controller and `EvidenceNotesService` in `RootCauseModule`.
- [x] T039 [US3] Create `apps/api/test/evidence-notes.e2e-spec.ts`:
  - **creation**: create on an entity and on a relationship (201, schema-valid, `active true`), with exactly one `evidence_note.created` audit row whose `after.text` matches;
  - **validation**: every note row of the contracts/api.md § Validation and access table gives 400 with the stated detail, and no note or `evidence_note.*` row is written;
  - **listing**: list paging over 3 notes with `limit=2` (order, `nextCursor`, second page); listing for a missing entity gives 404;
  - **retraction**:
    - by the author: 200, with an audit `before.active true` and `after.active false`;
    - by an admin of another user's note: 200;
    - by another analyst: 403, with one `auth.forbidden` row, and the note unchanged;
    - repeated: 200, with no new audit row;
    - for a missing note: 404;
  - **database immutability** (SC-006): raw `UPDATE evidence_notes SET text = 'x'`, `DELETE FROM evidence_notes` and `DELETE FROM evidence_note_retractions` each reject with an error matching `/append-only/`.
- [x] T040 [US3] Extend `apps/api/test/root-cause-seed.e2e-spec.ts` with fixture **R7**. Run steps 1–6 in order, with users A, B (ANALYST) and C (ADMIN) created through `createUser`, and assert every line, including R2 dropping to MEDIUM while the dispute is active.
- [x] T041 [US3] In `apps/api/test/authz-matrix.e2e-spec.ts`, add AUTHENTICATED probes for:
  - `POST /api/evidence-notes` (body `{}`, expecting 400 for signed-in users);
  - `POST /api/evidence-notes/:MISSING_ID/retract` (body `{ reason: 'x' }`, expecting 404);
  - `GET /api/entities/:MISSING_ID/evidence-notes`;
  - `GET /api/relationships/:MISSING_ID/evidence-notes`.

  Follow how existing probes treat non-2xx "authenticated" outcomes; read the matrix helper first.

### Web

- [x] T042 [P] [US3] Create `apps/web/src/pages/entities/useEvidenceNotes.ts`:
  - `useEvidenceNotes(target)`: `useInfiniteQuery`, key `['evidence-notes', kind, targetId]`;
  - `useCreateEvidenceNote()` and `useRetractEvidenceNote()`: mutations through `apiFetch` with the shared schemas. On success, `queryClient.invalidateQueries({ predicate: q => q.queryKey[0] === 'evidence-notes' || q.queryKey[2] === 'root-cause' })`.
- [x] T043 [P] [US3] Create `EvidenceNoteList.tsx`. It renders notes newest first, each with:
  - a stance badge (Supports, Disputes or Context, as text);
  - the text and reference;
  - the author and time;
  - for retracted notes, a "Retracted by X on T: reason" line, with the text struck through but still readable.

  It shows a **Retract** button only when `useAuth().user` is the author or has role ADMIN. Retracting opens an inline reason field (required, 500 characters at most) with Confirm and Cancel. Create `EvidenceNoteList.test.tsx` covering: the button is hidden for a non-author analyst, shown for the author and for an admin, and confirming calls the retract mutation with the reason.
- [x] T044 [P] [US3] Create `EvidenceNoteForm.tsx`, with props `targets: { label: string; target: EvidenceNoteTarget }[]`, so that a step can offer "this entity" and "the link to it". It contains:
  - a target radio (when there is more than one target);
  - a stance radio (Supports, Disputes, Context; required);
  - a text area (required, 2,000 characters at most, with a counter);
  - an optional reference input (500 characters at most);
  - a submit button that is disabled while pending, with the server error shown when submission fails.

  Create `EvidenceNoteForm.test.tsx` covering client-side required errors, a successful submit payload that matches `CreateEvidenceNoteRequestSchema`, and a server 400 detail shown in the form.
- [x] T045 [US3] In `StepEvidence.tsx`, replace the read-only Notes group from T026 with `EvidenceNoteList`, using the notes already present in `EntityEvidenceDto.notes` and `RelationshipEvidenceDto.notes` (plus "Show all n" via `useEvidenceNotes` when `total` exceeds the items). Add an **Add note** action that opens `EvidenceNoteForm` with targets "this entity" and, when the step has a hop, "the link: <relationship as recorded>" for its first assertion id. Update `StepEvidence.test.tsx`: the add-note form opens with 2 targets on a hop step and 1 on the symptom step, and a retracted note renders as retracted.

**Checkpoint**: standard gate. Then walk quickstart §2 (the R7 calls) and §3 step 4 in the browser, signed in as two different analysts.

---

## Phase 6: Polish and cross-cutting

- [x] T046 Create `apps/api/test/perf-root-cause.e2e-spec.ts` (`describePerf`, `RUN_PERF=1` only). Reuse the dataset builder and the 6-hop blocking chain from `perf-tracing.e2e-spec.ts`; import or copy its setup helper, as that file allows. Run `GET /root-cause` 20 times for the 6-hop start entity, and assert p95 < 1,500 ms (SC-003). Run it locally and record the p95 in the `quickstart.md` § 4 table. If it fails, follow research R13 (check the indexes with `EXPLAIN`) and write the findings to `questions.md`, rather than adding caching.
- [x] T047 Run the repository-wide checks and fix any hit:
  - `git grep -n "WITH RECURSIVE" -- apps/api/src` returns only `prisma-graph.repository.ts`;
  - `git grep -n "localeCompare\|: any\|as any\|TODO" -- apps packages` returns no new hits;
  - `git grep -n "new Date()\|Date.now()" -- apps/api/src/root-cause/analysis` returns nothing;
  - `git diff main -- '**/package.json' pnpm-lock.yaml` adds no dependencies.
- [x] T048 Run the full standard gate plus `pnpm build`. Then, with the dev DB re-seeded, walk all of `quickstart.md` §2 and §3 at 1366×768 and confirm every expected output. Tick the remaining boxes and commit.

---

## Dependencies

- **Phase order**: Phase 1 → Phase 2 → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3) → Phase 6.
- **Within Phase 2**:
  - T002 → T003 → T004;
  - T005 → T006;
  - T007 and T008 are independent;
  - T009 → T010;
  - T011–T014 and T017 need T003;
  - T015 needs T003 and T008 (`steps` export);
  - T016 needs T011 and T015.
- **US1**: needs all of Phase 2.
  - T018 → T019 → T020 → T021 → T022 → T023;
  - for the web, T024 and T025 can start after T003 is built; then T026 → T027 → T028 → T029 → T030 → T031.
- **US2**: needs US1, because it extends its e2e files and the candidate component.
  - T032 and T033 are backend only;
  - T034 → T035 for the web.
- **US3**: needs US1 (the evidence reader already reads notes, and `StepEvidence` exists).
  - T036 → T037 → T038 → T039 → T040 → T041;
  - for the web, T042, T043 and T044 can run in parallel, then T045.
  - US3 is independent of US2.
- **Phase 6** needs all stories.

## Parallel examples

- **Phase 2**: T002 with T005, T007, T008 and T009. Then T011, T012, T013, T014 and T017 together.
- **US1**: the web tasks T024–T026 alongside the backend tasks T018–T020.
- **US3**: T042, T043 and T044 together, alongside the backend tasks T036–T038.

## Implementation strategy

- **MVP**: Phases 1–3. Root-cause analysis works end to end on the Entity 360 page. Fixture R1 proves the §39 promise: the root cause is "Budget Code Missing", with the contract, payment and approval records as key evidence. Confidence is already computed, because the pure modules are foundational. US2 proves it and makes it visible.
- **Increment 2**: Phase 4 adds the honesty guarantees and the confidence UI.
- **Increment 3**: Phase 5 adds audited manual notes.
- **Last**: Phase 6 covers performance and the final checks.
- **Review points** for the orchestrator:
  - after T010: the one-hop lookup is confirmed on the seed;
  - after T016: the confidence rules match the hand-derived R1 reasons;
  - after T021: the seed fixtures pass, which validates the hand-derived evidence lists and counts;
  - after T039: database-level immutability is proven;
  - after T046: the performance numbers.
