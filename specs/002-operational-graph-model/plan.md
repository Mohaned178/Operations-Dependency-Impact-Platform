# Implementation Plan: Core Operational Graph Model

**Branch**: `002-operational-graph-model` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-operational-graph-model/spec.md`

## Summary

This feature adds OpsGraph's operational graph for the Logistics/Commerce vertical:
- **Entities**: 12 types.
- **Relationships**: 12 types. Each is directed and carries origin, confidence and a basis.
- **Events**: each linked to one subject entity and any number of related entities.
- **State**: normalized states, with the source's own status kept word for word.

Every imported row becomes an **immutable observation**: a `source_records` row with the raw payload, plus a `state_observations` row when the row has a state. Entities, relationships and events are **projections**, recomputed deterministically from their observations. That gives full provenance and history without overwriting anything.

**Import**: an Admin-only multipart endpoint that accepts JSON or CSV. It runs a pipeline: parse, validate, plan, write.
- The **planner** is a pure function, unit-tested in depth.
- The **import** is all-or-nothing. It runs serially inside one transaction under an advisory lock.
- **Audit**: one audit entry per created or changed record, plus a summary entry, all written in the same transaction.

**Seed**: the §39 scenario (44 entities, 102 relationships, 10 events) is loaded **through the same import pipeline**, so it meets the same validation and provenance rules as any import, and re-running it is a no-op.

**Reading**:
- `GraphRepository` provides exactly one capability, one-hop neighbor lookup, as a single raw-SQL query with keyset pagination.
- The web app gains an entity list and an entity detail page with Identity, Current state, Relationships, Timeline and Source records sections.

All design decisions and their reasons are in [research.md](./research.md). They are binding.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS. Unchanged from 001.
**Primary Dependencies**:
- Everything from 001.
- **New for api**: `csv-parse` ^5 (runtime) and `@types/multer` (dev). Multer itself is already bundled with `@nestjs/platform-express`.
- **New for web and shared**: none.

**Storage**: PostgreSQL 16 via Prisma 6. This feature adds 8 tables and 11 enums, and 2 migrations, one of which is raw SQL (CHECK constraints and append-only triggers).
**Testing**:
- **Jest unit tests** for the pure pipeline parts (parsers, validator, planner, projections, canonical hash, seed document).
- **Jest + supertest e2e** against real Postgres (imports, entities, neighbors, timeline, seed, authorization matrix).
- **Vitest + Testing Library** (web pages and components).
- **Vitest** (shared schemas).

**Target Platform**: Linux server (API), evergreen browsers (web).
**Project Type**: Web application (pnpm monorepo: api + web + shared).
**Performance Goals**:
- list page and detail page under 2 s at 50k entities (SC-003);
- a 10k-row import under 60 s (SC-004);
- a neighbor lookup over 1,000 relationships under 500 ms (SC-008).

**Constraints**:
- no `any`;
- no dependencies beyond R19;
- graph connections are read only through `GraphRepository`, and only one hop (FR-048);
- import transactions use `timeout: 120_000`.

**Scale/Scope**: up to 50k entities for the MVP; imports of at most 10k rows / 10 MB; 10 new endpoints; 2 new screens.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature satisfies it |
|---|---|---|
| I. Source Traceability | ✅ | Every entity observation, relationship, state and event has a `source_records` row with `source_system`, `source_id`, `observed_at`, `received_at`, `raw_payload` (exactly as received, unknown fields included) and `import_id`. `source_records` and `state_observations` are append-only, enforced by DB triggers (R16). Every DTO exposes the provenance fields, which SC-002 checks over the full seed. |
| II. Fact vs Inference | ✅ | Relationships carry `origin` and `confidence`. INFERRED and MANUAL require a `basis`. Every relationship DTO includes origin and confidence, and the web shows a text badge that is never "Source" for INFERRED or MANUAL (R17). **Conflicts**: every observation is kept, and the detail page shows each source system's latest state alongside the current one (FR-017), so no source value is hidden. Formal conflict *flagging* is deferred by the spec; see Complexity Tracking. |
| III. Explainability & Determinism | ✅ | There are no conclusions computed in this feature. The projections and every ordering are deterministic: `(observedAt, seq)` tie-breaks (R4), and keyset ordering on text-cast columns (R12, R13, R14). The planner is a pure function. |
| IV. Auditability | ✅ | Every applied import writes one audit entry per created or observed entity, state, relationship and event, with before and after values, plus a summary entry. These go in the same transaction as the data, through `AuditService.recordMany` (R8). Rejected imports, dry runs and refused uploads are audited too. Forbidden attempts are audited by the existing `RolesGuard`. |
| V. Test-Gated Changes | ✅ | Every new endpoint has a zod schema in `@opsgraph/shared` and e2e tests covering its success path and authorization. The authorization matrix is extended. The planner, projections and parsers have unit tests. `GraphRepository` has e2e tests, including a 2-node cycle and determinism. Performance tests are gated behind `RUN_PERF=1`. |
| VI. MVP Scope Discipline | ✅ | The feature answers §65 Q1 ("What is happening?": current state and timeline) and Q11 ("What evidence supports this?": source records and provenance). It lays the base for Q3, Q5 and Q6. It touches none of the §62 non-goals: no connectors, no warehouse-style analytics, no identity resolution. Multi-hop traversal, an import UI and editing are explicitly excluded. |
| Tech constraints | ✅ | Strict TS. Only the 2 dependencies listed in R19 are added. `GraphRepository` is the only reader of graph connections, and it is one hop only: no recursion yet, so no depth or cycle guard is needed. 003 adds those. |

**Post-design re-check**: ✅ No unjustified violations. There is one deliberate deferral, listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-operational-graph-model/
├── spec.md  plan.md  research.md  data-model.md  seed-scenario.md  quickstart.md
├── contracts/api.md  contracts/import-format.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (new and changed files only)

```text
docs/
├── import-format.md                         # published from contracts/import-format.md (FR-024)
└── examples/import/entities.csv  relationships.csv  events.csv  import.json

packages/shared/src/
├── common.ts            # + JsonValueSchema, + IMPORT_TOO_LARGE in ErrorCodeSchema
├── audit.ts             # + 11 AUDIT_ACTIONS (research R8)
├── graph.ts             # NEW: vocabularies, RELATIONSHIP_RULES, MONETARY_ENTITY_TYPES, read DTOs + query schemas
├── imports.ts           # NEW: limits, row schemas, ImportDocument, ImportRequestFieldsSchema, ImportReport/Summary DTOs
├── index.ts             # + export graph, imports
└── graph.spec.ts  imports.spec.ts

apps/api/
├── package.json                             # + csv-parse, + @types/multer (dev)
├── prisma/
│   ├── schema.prisma                        # + models/enums from data-model.md
│   ├── migrations/<ts>_graph_model/         # + CHECK constraints, partial unique index
│   ├── migrations/<ts>_provenance_append_only/
│   └── seed.ts                              # users (unchanged) + Nest app context → SeedService (R15)
├── src/
│   ├── app.module.ts                        # + GraphModule, IngestionModule
│   ├── common/context/request-context.ts    # + runDetached(fn)
│   ├── common/errors/app-error.ts           # + Errors.importTooLarge()
│   ├── common/pagination/cursor.ts          # NEW: encodeCursor / decodeCursor(schema, value) → 400 on invalid
│   ├── audit/audit.service.ts               # + recordMany(tx, inputs)
│   ├── graph/
│   │   ├── graph.module.ts
│   │   ├── graph.repository.ts              # interface + GRAPH_REPOSITORY token (R12)
│   │   ├── prisma-graph.repository.ts       # the only neighbor SQL
│   │   ├── entities.controller.ts           # /entities, /entities/:id, /:id/neighbors, /:id/timeline, /:id/states, /:id/source-records
│   │   ├── source-systems.controller.ts     # /source-systems
│   │   ├── entities.service.ts              # list, detail, states, source records
│   │   ├── timeline.service.ts              # merge pagination (R13)
│   │   ├── entity.mapper.ts
│   │   └── *.spec.ts
│   └── ingestion/
│       ├── ingestion.module.ts
│       ├── imports.controller.ts            # POST /imports, GET /imports, GET /imports/:id
│       ├── import-upload.interceptor.ts     # FileInterceptor wrapper → IMPORT_TOO_LARGE (R5)
│       ├── import.service.ts                # orchestration, transaction, lock, outcome (R7)
│       ├── import.mapper.ts                 # Import row → ImportReport / ImportSummary
│       ├── parsing/decode.ts                # UTF-8 fatal decode + BOM strip
│       ├── parsing/json-import.parser.ts
│       ├── parsing/csv-import.parser.ts     # csv-parse + column map (contracts/import-format.md)
│       ├── parsing/parsed-import.ts         # ParsedRow / ParsedImport types
│       ├── validation/row-validator.ts      # zod + time checks → RowError[]
│       ├── planning/import-planner.ts       # PURE: planImport(rows, snapshot, ctx) → ImportPlan (rules P1–P13)
│       ├── planning/projections.ts          # PURE: projectEntity / projectRelationship / projectEvent
│       ├── planning/canonical-json.ts       # canonicalJson + sha256 payloadHash
│       ├── planning/import-plan.ts          # ImportPlan / ImportSnapshot types
│       ├── persistence/import-snapshot.loader.ts
│       ├── persistence/import-writer.ts     # chunked createMany in FK order + updates + recordMany
│       ├── seed/scenario-39.ts              # buildScenario39Document() — seed-scenario.md verbatim
│       ├── seed/seed.service.ts
│       └── **/*.spec.ts                     # planner, projections, parsers, validator, canonical-json, scenario-39
└── test/
    ├── helpers.ts                           # resetDb extended (data-model.md); + importFile(app, token, …) helper
    ├── imports.e2e-spec.ts  entities.e2e-spec.ts  graph-repository.e2e-spec.ts
    ├── timeline.e2e-spec.ts  seed.e2e-spec.ts  docs-examples.e2e-spec.ts
    ├── authz-matrix.e2e-spec.ts             # + rows from contracts/api.md
    └── perf-graph.e2e-spec.ts               # RUN_PERF=1 only (R18)

apps/web/src/
├── router.tsx                               # + /entities, /entities/:id
├── layout/AppShell.tsx                      # + "Entities" nav link (all roles)
├── lib/format.ts                            # NEW: formatTimestamp, formatMoney (+ format.test.ts)
└── pages/entities/
    ├── EntityListPage.tsx                   # filters: type, state, source system; search; Load more
    ├── EntityDetailPage.tsx                 # header + 5 sections
    ├── IdentitySection.tsx  CurrentStateSection.tsx  RelationshipsSection.tsx
    ├── TimelineSection.tsx  SourceRecordsSection.tsx
    ├── OriginBadge.tsx  StateBadge.tsx
    └── *.test.tsx
```

**Structure Decision**: the existing pnpm monorepo. The new backend code goes in two bounded-context modules, `graph` (reads) and `ingestion` (writes), following CLAUDE.md.

## Key Design Notes (for the implementer)

1. **Build order**:
   1. shared vocabularies and schemas;
   2. Prisma schema and migrations;
   3. pure pipeline pieces with unit tests: canonical JSON, projections, parsers, validator, planner;
   4. the writer and `ImportService`;
   5. the controllers;
   6. the seed;
   7. `GraphRepository` and the read endpoints;
   8. the web pages.

   Do **not** start the planner until the projections and parser types exist.
2. **The planner is pure.** It receives `rows`, a `snapshot` and `{ now, receivedAt, newId: () => string }`. It never touches Prisma. Inject `newId` so tests get deterministic ids. Cover every rule P1–P13 and every classification cell in data-model.md with at least one unit test.
3. **The transaction wraps everything after parsing**:
   ```ts
   return this.prisma.$transaction(async (tx) => {
     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('opsgraph:graph-import'))`;
     const snapshot = await this.snapshotLoader.load(tx, validRows);
     const plan = planImport(validRows, snapshot, { now, receivedAt, newId: randomUUID });
     const outcome = decideOutcome(fileErrors, staticErrors, plan, input.dryRun);
     if (input.skipIfNoChanges && outcome === 'APPLIED' && plan.changeCount === 0) return null;
     const importRow = await this.writer.writeImport(tx, …);           // always
     if (outcome === 'APPLIED') await this.writer.applyPlan(tx, importRow.id, plan);
     await this.audit.record(tx, summaryAuditFor(outcome, importRow)); // always
     return toImportReport(importRow, submitter);
   }, { timeout: 120_000, maxWait: 10_000 });
   ```
   Submissions with errors found before the transaction still go through it, so the Import record and the summary audit entry are written:
   - **File-level errors**: the file couldn't be read as rows at all, so the planner is skipped and the outcome is `REJECTED`.
   - **Static row errors**: the planner still runs over the remaining valid rows, so the report lists *every* problem in one pass. The outcome is `REJECTED`.
4. **Row error merging**: static errors and planner errors are merged and sorted by `(kind order, row, field ?? '')`. Rows that failed static validation are excluded from planning. When another row references their key, rule P8 applies.
5. **Readers never compute "latest" on the fly for lists.** They use the projection columns. The detail page reads the latest state observation by `(observedAt DESC, seq DESC)` and the per-source latest with `DISTINCT ON (source_system)`. That one is a plain Prisma `findMany` with `distinct: ['sourceSystem']` and `orderBy: [{ sourceSystem: 'asc' }, { observedAt: 'desc' }, { seq: 'desc' }]`.
6. **`EntitiesController` is thin.** It uses `ParseUUIDPipe` on `:id` and `ZodValidationPipe` on queries, then calls a service and returns a DTO. `/neighbors` calls `GraphRepository.findNeighbors` through a small `EntitiesService.neighbors()` that first checks the entity exists (404) and maps `Date` to ISO.
7. **`ImportsController`**:
   - `@Roles('ADMIN')` at class level.
   - `@UseInterceptors(ImportUploadInterceptor)` on POST.
   - `@UploadedFile() file: Express.Multer.File | undefined`. If `undefined`, throw `Errors.validation([{ path: 'file', message: 'A file is required' }])`.
   - `@Body(new ZodValidationPipe(ImportRequestFieldsSchema))`.
   - Return with `@HttpCode(201)`.
8. **Seed (`prisma/seed.ts`)**: after the user loop:
   ```ts
   const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error','warn'] });
   try { const report = await app.get(SeedService).seedScenario39(); /* log outcome or "unchanged" */ }
   finally { await app.close(); }
   ```
   `SeedService` throws if the outcome is `REJECTED`, including the row errors in the message.
9. **Web detail page**:
   - It loads `/entities/:id` first. A 404 renders "Entity not found" with a link back to the list.
   - The sections render independently: each has its own loading and error state, so one failing section doesn't blank the page.
   - Relationship rows are grouped visually by `relationship.type`. The direction is shown as "→ neighbor" (OUT) or "← neighbor" (IN).
   - Every relationship row shows `OriginBadge`, the basis (when present), and `sourceSystem · observedAt`.
10. **Entity list**:
    - The filters are controlled selects. The source-system options come from `/source-systems`, and the type and state options come from the shared enums.
    - Search is debounced by 300 ms and kept in the URL (`?type=Order&q=18492`), so it survives reload and back navigation.
    - The empty state reads "No entities match these filters".
11. **Do not**:
    - add a multi-hop method or any recursive SQL;
    - add an import UI;
    - add edit or delete endpoints for graph data;
    - match entities by name;
    - parse amounts to `number`;
    - read `relationships` anywhere except `PrismaGraphRepository` and the ingestion snapshot loader. The loader reads relationships by key to plan writes. It is not traversal.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Constitution II "surface conflicts": formal conflict **flagging** is deferred. Only the per-source latest state is shown. | The spec explicitly puts source-conflict detection out of scope (Assumptions). The data model keeps every observation, so a later feature can add flagging without migrating data. | Building conflict detection now would expand scope beyond what the user agreed. Hiding disagreements would violate the principle, so FR-017 shows them. |
| A second pagination style: merged-stream cursor for the timeline (R13) | The timeline merges two tables (events and state observations) into one chronological stream. | A raw SQL `UNION` would be a second hand-written query outside `GraphRepository`, harder for the implementer to get right, and easy to mistake for traversal SQL. |
