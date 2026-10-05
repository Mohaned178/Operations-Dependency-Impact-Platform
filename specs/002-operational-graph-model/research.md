# Research: Core Operational Graph Model

Every Technical Context item is resolved below. Each decision is final for the implementer: **do not substitute alternatives**. If a decision turns out to be unworkable, stop and write the problem in `questions.md`.

Feature 001's decisions (R1–R15 in `specs/001-foundation-platform/research.md`) still apply unless this file overrides them.

---

## R1. Module layout

- **Decision**: two new Nest modules, following the bounded contexts in CLAUDE.md.
  - **`graph`**: reads the graph. It contains `GraphRepository` (neighbor lookup), `EntitiesService` (list, detail, state history, source records), `TimelineService`, and the read-only controllers.
  - **`ingestion`**: writes the graph. It contains the import pipeline (parse → validate → plan → write), `ImportsController`, and `SeedService`.

  Nothing outside `ingestion` writes graph tables. Nothing outside `graph` reads graph connections for display.
- **Rationale**: Reading and writing have different shapes. Writes are batch-heavy and planned ahead. Reads are paginated and filtered. Keeping them apart stops an implementer from mixing traversal-style reads into the import code.
- **Alternatives**: a single `graph` module (too large, and it blurs the GraphRepository boundary), one module per table (too much ceremony).

## R2. Storage model: append-only observations plus projections

- **Decision**: every imported row becomes an immutable **observation**:
  - a `source_records` row, holding the raw payload and normalized values;
  - for entity rows that carry a state, also a `state_observations` row.

  `entities`, `relationships` and `events` are **projections**. Their current columns are recomputed from all of their observations whenever a new observation arrives. `source_records` and `state_observations` are append-only, enforced by a DB trigger exactly like `audit_entries` (R16).
- **Rationale**:
  - FR-016, FR-021 and FR-022 require history to be kept and never overwritten.
  - Principle I requires the raw payload to stay retrievable.
  - Projection columns (`current_state`, `display_name`, `last_observed_at`) keep the list page fast (SC-003) without computing "latest observation" on every read.
- **Alternatives**: event-sourcing everything with no projections (slow list page), overwriting entity rows in place and keeping history only in the audit log (the audit log is not provenance, and FR-016 forbids overwriting).

## R3. Identity and uniqueness

- **Decision**:
  - **Entities** are keyed by `entity_identifiers (entity_type, source_system, source_id)`, which is UNIQUE.
  - **Relationships** are keyed by `(source_system, source_id)`, which is UNIQUE.
  - **Events** are keyed by `(source_system, source_id)`, which is UNIQUE.
  - A row with an **existing key** is a new observation of that record.
  - An entity row with an **unknown key** creates a new entity. The only exception is a row with `entityRef`, which attaches the new key to the referenced entity (FR-019).
  - There is **no** name-based or fuzzy matching anywhere.
- **The `entityRef` rule**: an `entityRef` given by key MUST point to one of two things:
  - an identifier that already exists in the DB;
  - the own key of an entity row in the same file that does **not** itself carry an `entityRef`.

  Any other target, including chains of references, is rejected with the message `Reference chains are not supported; reference the entity's own key or OpsGraph id`.
- **Immutable fields**:
  - a relationship's `type`, `from` and `to`;
  - an event's `type` and `subject`;
  - an identifier's entity.

  A later row that tries to change one of these is rejected.
- **Rationale**: These keys are the simplest rules that satisfy FR-019 deterministically. Making the fields immutable keeps the projections well-defined.

## R4. Deterministic ordering and tie-breaks

- **Decision**: `source_records`, `state_observations` and `entity_identifiers` each get a `seq BIGINT` column. It is UNIQUE, filled by a DB sequence default, and assigned in insert order.
  - "Latest observation" always means max `(observed_at, seq)`.
  - Rows from one import are inserted in **file order**, so for equal `observed_at` the later row in the file wins. This is "most recently received wins" (FR-015).
  - When the planner computes projections before the rows exist, it orders existing observations by their real `seq`, then new rows by their file position.
- **Rationale**: Ordering by UUIDs, or by `received_at` (identical for every row of one import), would not be deterministic.

## R5. Import transport and size limit

- **Decision**: `POST /api/imports` takes `multipart/form-data`:
  - one file part named `file`;
  - text fields `format` (`json` or `csv`), `kind` (`entities`, `relationships` or `events`; required when `format=csv`, rejected when `format=json`), and `dryRun` (`true` or `false`, default `false`).
- **Upload handling**:
  - The upload is handled by Nest's `FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } })`, which uses multer's memory storage. Multer ships inside `@nestjs/platform-express`, so it needs no new runtime dependency.
  - The interceptor is wrapped in `ImportUploadInterceptor`. It catches Nest's `PayloadTooLargeException` and rethrows `Errors.importTooLarge()`: status `413`, code `IMPORT_TOO_LARGE`, message `Imports are limited to 10 MB and 10,000 rows`.
  - Guards run before interceptors, so a non-Admin is refused before the file is even read.
- **Constants**, in `packages/shared/src/imports.ts`: `IMPORT_MAX_BYTES = 10 * 1024 * 1024` and `IMPORT_MAX_ROWS = 10_000`.
- **Row limit**: after parsing, if the total row count exceeds `IMPORT_MAX_ROWS`, the same `413 IMPORT_TOO_LARGE` is thrown. In both too-large cases, a standalone audit entry `import.refused` is written with metadata `{ reason: 'bytes' | 'rows', limit, actual? }`, and no Import record is created.
- **Rationale**:
  - Express's global JSON body limit stays at its 100 kB default for every other route. Raising it globally would widen the DoS surface.
  - Multer applies limits per route.
  - One transport covers both JSON and CSV, and later a web upload screen.
- **Alternatives**:
  - A raw `application/json` / `text/csv` body with a raised global parser limit: this affects every route.
  - Route-scoped `express.json` middleware: needs a direct `express` dependency and ordering tricks with Nest's parser.
- **Dev dependency**: `@types/multer` (for `Express.Multer.File`).

## R6. Decoding and parsing

- **Decision**:
  - **Decoding**: `new TextDecoder('utf-8', { fatal: true })`. A decode failure is a file-level error: `File is not valid UTF-8`. A leading BOM is stripped.
  - **JSON**: `JSON.parse`. If it fails, the file-level error is the parser's message (Node 22 includes the position).
    - The top level MUST be an object whose only allowed keys are `entities`, `relationships` and `events`. Each one is optional, but at least one must be present, and each must be an array. Any other key is a file-level error: `Unknown top-level section "<key>"` (FR-033).
    - Every array element MUST be an object. A non-object element is a row error.
  - **CSV**: **`csv-parse` (v5, `csv-parse/sync`)** with `{ bom: true, relax_column_count: true, skip_empty_lines: true }`. It returns `string[][]`.
    - The first record is the header. Header names are trimmed. Empty or duplicate header names are file-level errors.
    - A data record whose column count differs from the header's is a **row error** (`Expected N columns, found M`). All other rows are still processed for the report.
    - A `CsvError` thrown by the parser (for example an unclosed quote) is a file-level error that includes the parser's line number.
    - Empty cells mean "absent".
  - **CSV to row mapping**: each CSV record is converted to the same object shape as a JSON row, using the column map in [contracts/import-format.md](./contracts/import-format.md). The raw payload stored for a CSV row is the object `{ <header>: <cell string> }` for **every** header, empty cells included, exactly as read.
  - **Error locations**:
    - **JSON**: `row` is the 1-based index within its section, and `field` is the JSON path, for example `from.sourceId`.
    - **CSV**: `row` is the spreadsheet row number (header = 1, first data row = 2), and `field` is the CSV column name, translated back through the column map.
- **Rationale**: Hand-written CSV parsing is a common source of quoting and newline bugs. `csv-parse` is mature and has zero dependencies.
- **Runtime dependency added**: `csv-parse` (api only).
- **Alternatives**: papaparse (browser-oriented, larger), a hand-rolled parser (risky for the implementer).

## R7. All-or-nothing import pipeline

- **Decision**: `ImportService.run(input)` runs these steps:
  1. **Decode and parse** (R6). This produces `ParsedImport { rows: ParsedRow[]; fileErrors: string[] }`. Each `ParsedRow` holds `{ kind, row, raw, candidate, columnMap? }`.
  2. **Row limit check** (R5).
  3. **Static validation** (`row-validator.ts`): each row is checked against its shared zod schema (`EntityImportRowSchema`, `RelationshipImportRowSchema`, `EventImportRowSchema`), plus these time checks:
     - `observedAt` and `occurredAt` must be ≤ `now + 5 min`;
     - timestamps must include an offset.

     A failing row becomes one or more `RowError`s.
  4. **Open one interactive transaction**: `prisma.$transaction(fn, { timeout: 120_000, maxWait: 10_000 })`. Its first statement takes `SELECT pg_advisory_xact_lock(hashtext('opsgraph:graph-import'))`, so imports run one at a time and the outcome depends only on data, never on timing.
  5. **Load the snapshot** (`import-snapshot.loader.ts`): fetch the existing identifiers, relationships, events and source records that the valid rows refer to, plus every observation (no raw payload) of the existing entities, relationships and events those rows touch.
     - `IN` lists are chunked at 5,000 values.
     - Superset queries (for example `sourceId IN (…)`) are filtered to exact keys in memory.
  6. **Plan** (`import-planner.ts`, a **pure function** with no I/O): `planImport(validRows, snapshot, { now, receivedAt }) → ImportPlan`. It:
     - resolves references, in this order: entities first (rows without `entityRef`, then rows with one), then relationships, then events;
     - applies the cross-row rules (R3, the FR-009 type matrix, self-loops, duplicate and ambiguous keys, dependent-row rejection);
     - classifies each row as `created`, `updated`, `unchanged` or `rejected`;
     - computes the new projections (R2, R4);
     - produces the write set and the audit inputs.
  7. **Decide the outcome**:
     - any `fileErrors` or `rowErrors` → `REJECTED`;
     - otherwise, `dryRun` → `DRY_RUN`;
     - otherwise → `APPLIED`.
  8. **Write**, inside the same transaction:
     - Always: the `imports` row and one summary audit entry (`import.applied`, `import.rejected` or `import.dry_run`).
     - Only when the outcome is `APPLIED`: the graph rows and the per-row audit entries (R8).
  9. **Return** the `ImportReport` DTO.
- **Skipping no-op runs**: `ImportService.run` accepts `skipIfNoChanges?: boolean`, which only `SeedService` uses. When it is set and the plan would be `APPLIED` with zero created and zero updated rows, nothing at all is written and the function returns `null`. This makes FR-042's "second run changes nothing" literally true.
- **Dependent-row rejection**: a row whose reference points to an entity key whose rows were **all** rejected is itself rejected. The reason is `Depends on rejected <kind> row <n>`, and `dependsOn` is set to that row.
- **Duplicates within one file** (same key and same `observedAt`):
  - identical canonical payload → the first row is processed and the later ones are `unchanged`;
  - different payload → **all** of them are rejected with `Ambiguous: rows <a>, <b> have the same key and observedAt but different content`.
- **Rationale**: A pure planner can be unit-tested in depth without a database. That matters because the implementer is a weaker model and this is the riskiest logic in the feature.

## R8. Batch writes and audit volume

- **Decision**:
  - All new graph rows get app-generated ids (`randomUUID()`), so `createMany` can be used without reading ids back.
  - Writes are chunked at 1,000 rows per `createMany`, in FK order: imports → entities → entity_identifiers → relationships → events → event_entities → source_records → state_observations → audit.
  - Projection updates to existing rows use one `update` per row.
- **Audit**:
  - `AuditService` gains `recordMany(tx, inputs: AuditRecordInput[])`. It uses `createMany`, applies the same redaction and context resolution as `record`, and chunks at 1,000.
  - Per-row audit inputs carry `metadata: { importId, sourceRecordId }`.
  - The raw payload is **not** copied into audit entries. It lives in `source_records`.
- **Audit actions**, added to `AUDIT_ACTIONS` in shared:

  | Constant | Value | Target | before / after |
  |---|---|---|---|
  | `IMPORT_APPLIED` | `import.applied` | `import` / id | after: `{ format, kind, counts }` |
  | `IMPORT_REJECTED` | `import.rejected` | `import` / id | after: `{ format, kind, counts, errorCount }` |
  | `IMPORT_DRY_RUN` | `import.dry_run` | `import` / id | after: `{ format, kind, counts, errorCount }` |
  | `IMPORT_REFUSED` | `import.refused` | none | metadata: `{ reason, limit, actual }` |
  | `ENTITY_CREATED` | `entity.created` | `entity` / id | after: projection + `identifiers` |
  | `ENTITY_OBSERVED` | `entity.observed` | `entity` / id | before / after: projection |
  | `ENTITY_STATE_OBSERVED` | `entity.state_observed` | `entity` / id | after: `{ state, sourceStatus, sourceSystem, observedAt }` |
  | `RELATIONSHIP_CREATED` | `relationship.created` | `relationship` / id | after: projection |
  | `RELATIONSHIP_OBSERVED` | `relationship.observed` | `relationship` / id | before / after: projection |
  | `EVENT_CREATED` | `event.created` | `event` / id | after: projection |
  | `EVENT_OBSERVED` | `event.observed` | `event` / id | before / after: projection |

  "Projection" here means:
  - **entity**: `{ type, displayName, attributes, currentState, lastObservedAt }`
  - **relationship**: `{ type, fromEntityId, toEntityId, origin, confidence, basis, observedAt }`
  - **event**: `{ type, occurredAt, description, subjectEntityId, relatedEntityIds }`
- **Rationale**: Ten thousand rows produce about 50k inserts. Batched `createMany` keeps that well under the 60 s target (SC-004). Individual updates are only needed for existing records.

## R9. Detecting unchanged rows

- **Decision**: `payloadHash = sha256(canonicalJson(raw))`, stored as `char(64)` on `source_records`. `canonicalJson` serializes the value with object keys sorted recursively and no whitespace.
- **"Unchanged" means**: a stored source record exists for the same record (the same entity identifier, relationship key or event key) with the same `observedAt` **and** the same `payloadHash`.
- **Same key and `observedAt` but a different hash, across imports**: this is a new observation, counted as `updated`. Ties resolve by `seq` (R4).
- **Key order**: JSON key order and duplicate keys are not significant. JSONB normalizes both, and the hash is computed over the canonical form.

## R10. Money and attributes

- **Decision**: `attributes` is a JSON object of arbitrary JSON values. One convention is validated:
  - If `attributes.amount` is present, it MUST be a string matching `^(0|[1-9]\d{0,12})(\.\d{1,4})?$`, and `attributes.currency` MUST be present and match `^[A-Z]{3}$`.
  - Rows of type `Order`, `Payment` and `Invoice` MUST have both.
- **Storage**: amounts stay strings. They are never parsed to `number`.
- **Display**: the web formats them with `formatMoney(amount, currency)`, which groups digits with commas by string manipulation and pads to 2 decimals, for example `12,480.00 USD`.
- **Rationale**: FR-003 requires exact decimals. Strings in JSONB keep them exact without per-type tables.

## R11. Timestamps and other value rules

- **Timestamps**: `z.string().datetime({ offset: true })`. Naive timestamps are rejected. They are stored as `timestamptz` and returned as UTC ISO strings.
- **`sourceSystem`**: `^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$`.
- **`sourceId`**: 1–200 characters, none of `|`, `;`, CR or LF. Those characters are reserved for CSV reference lists.
- **`displayName`**: trimmed, 1–200 characters.
- **`sourceStatus`**: up to 100 characters.
- **`basis`**: trimmed, 1–500 characters.
- **`description`**: up to 2,000 characters.
- **`eventType`**: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`.
- **Events**: an event's `related` list MUST NOT contain its subject, and duplicate references in `related` are de-duplicated.
- **Enum errors**: zod's message already lists the allowed values, which satisfies the "report lists allowed values" edge case.

## R12. GraphRepository (neighbor lookup only)

- **Decision**: `apps/api/src/graph/graph.repository.ts` exports the following.

  ```ts
  export const GRAPH_REPOSITORY = Symbol('GRAPH_REPOSITORY');
  export type NeighborDirection = 'OUT' | 'IN' | 'BOTH';
  export interface NeighborQuery {
    entityId: string;
    direction: NeighborDirection;
    relationshipTypes?: readonly RelationshipType[];
    neighborTypes?: readonly EntityType[];
    cursor?: string;           // opaque, produced by this repository
    limit: number;             // 1..200
  }
  export interface NeighborRow {
    relationship: { id; type; direction: 'OUT' | 'IN'; origin; confidence; basis: string | null;
                    sourceSystem; sourceId; observedAt: Date; importId };
    neighbor: { id; type; displayName; currentState };
  }
  export interface NeighborPage { items: NeighborRow[]; nextCursor: string | null }
  export interface GraphRepository {
    findNeighbors(query: NeighborQuery): Promise<NeighborPage>;
    countNeighbors(entityId: string): Promise<number>;  // relationships touching the entity, either direction
  }
  ```

  It is implemented by `PrismaGraphRepository` (`prisma-graph.repository.ts`) and provided in `GraphModule` as `{ provide: GRAPH_REPOSITORY, useClass: PrismaGraphRepository }`. `GraphModule` exports the token for later features.
- **Query**: a single `prisma.$queryRaw`, built with `Prisma.sql` fragments.
  - **Body**: a `UNION ALL` of the outgoing part (`from_entity_id = $id`, with the neighbor being `to`) and the incoming part (`to_entity_id = $id`, with the neighbor being `from`).
  - **Filters**: `direction` decides which parts are included. The type filters use `= ANY($types::text[])`, comparing the enum cast as `::text`.
  - **Ordering**: `ORDER BY rel_type_text, direction, neighbor_display_name, relationship_id`, all as text, which makes the order deterministic.
  - **Pagination**: keyset, with the condition `(rel_type_text, direction, neighbor_display_name, relationship_id::text) > ($1, $2, $3, $4)`, then `LIMIT limit + 1`.
  - **Cursor**: base64url JSON of those four values, validated with zod when decoded. An invalid cursor gives `400 VALIDATION_FAILED`, path `cursor`.
- **Depth**: exactly one hop. The method takes no depth parameter. There is no recursion and no CTE in this feature.
- **Rationale**:
  - CLAUDE.md and the constitution require every graph read to go through this repository.
  - Starting with raw SQL here means 003 can add recursive CTEs alongside it.
  - Postgres compares enums by declaration order, not alphabetically, so they are cast to text for a predictable order.
- **Out of scope**: no multi-hop method may be added "for later" (FR-048).

## R13. Timeline pagination (events + state changes)

- **Decision**: `TimelineService.list(entityId, { cursor, limit })` returns items in **ascending** order of `(at, kindRank, id)`.
  - **Events**: `at = occurredAt`, `kindRank = 0`.
  - **State changes**: `at = observedAt`, `kindRank = 1`.
- **Mechanics**:
  - Two Prisma queries, each with `take: limit + 1` after the cursor:
    - events joined through `event_entities` where `entity_id = X`;
    - `state_observations` where `entity_id = X`.
  - The two lists are merged in memory by `(at, kindRank)`. Items of the same kind keep their DB order (`id` ascending, compared in SQL only).
  - The merged list is cut to `limit`. `nextCursor` is base64url JSON `{ at, kindRank, id }` of the last item returned.
  - The cursor condition per query is `at > c.at OR (at = c.at AND kindRank > c.kindRank) OR (at = c.at AND kindRank = c.kindRank AND id > c.id)`. For each query, `kindRank` is a constant, so this reduces to simple Prisma `where` clauses.
- **Default limit**: 50.
- **Rationale**: Chronological ascending order answers "how did we get here?" (§19). Two indexed queries are simpler and safer than a raw `UNION`.

## R14. Entity list

- **Decision**: `GET /entities` uses Prisma `findMany` on `entities`.
- **Filters**:
  - `type`;
  - `state`, matched against `current_state`;
  - `sourceSystem`, through `identifiers: { some: { sourceSystem } }`;
  - `q`, which matches `displayName` contains (insensitive) OR `identifiers.some.sourceId` contains (insensitive).
- **Ordering and pagination**: `ORDER BY display_name ASC, id ASC`, with a keyset cursor (base64url JSON `{ displayName, id }`). Default limit 50, maximum 200.
- **Each row includes**:
  - `primaryIdentifier`: the identifier with the lowest `seq`;
  - `sourceSystems`: distinct, sorted;
  - `currentState` and `lastObservedAt`, read from the projection.
- **Rationale**: At 50k rows, a sequential `ILIKE` scan runs in tens of milliseconds, well under SC-003. `pg_trgm` is not needed yet.

## R15. Seeding through the real import path

- **Decision**:
  - `apps/api/src/ingestion/seed/scenario-39.ts` exports `buildScenario39Document(): ImportDocument`. It builds the exact dataset in [seed-scenario.md](./seed-scenario.md) with fixed timestamps.
  - `SeedService.seedScenario39()` serializes that document to a JSON `Buffer` and calls `ImportService.run({ format: 'json', fileName: 'scenario-39.json', trigger: 'SEED', dryRun: false, skipIfNoChanges: true, actor: { type: 'system' } })` inside `RequestContext.runDetached(...)`.
  - `runDetached` is a new `RequestContext` method. It calls `cls.run()` and sets a fresh `correlationId`, so audit rows have one.
  - `prisma/seed.ts` keeps its user seeding, then calls `NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })`, gets `SeedService`, runs it, and closes the context.
  - If the seed import comes back `REJECTED`, the script prints the row errors and exits non-zero.
- **Rationale**: FR-035 requires seed data to meet the same validation and provenance rules as imports. Running it through the real pipeline guarantees that, and also exercises the pipeline end to end on every setup.
- **Alternatives**: direct Prisma inserts in `seed.ts` (would duplicate the projection logic and could drift from it).

## R16. Append-only provenance tables

- **Decision**: a migration adds a generic trigger function and applies it to `source_records` and `state_observations`:
  - a `BEFORE UPDATE OR DELETE` row trigger;
  - a `BEFORE TRUNCATE` statement trigger.

  The function is:

  ```sql
  CREATE FUNCTION forbid_provenance_mutation() RETURNS trigger AS $$
  BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
  ```

  The e2e helper `resetDb` disables and re-enables `TRIGGER USER` on these tables, the same way it already does for `audit_entries`.
- **Rationale**: Principle I. The raw evidence must not be altered after the fact.

## R17. Web pages

- **Routes**: `/entities` (`EntityListPage`) and `/entities/:id` (`EntityDetailPage`), under the existing `RequireAuth` and `AppShell`, open to all roles. An "Entities" nav link is added for all roles, between Home and Investigations.
- **Detail page layout**: a header showing type, display name and a state badge, followed by five sections:
  1. Identity
  2. Current state
  3. Relationships
  4. Timeline
  5. Source records

  Each section fetches its own endpoint with TanStack Query. The paginated sections use `useInfiniteQuery` with a "Load more" button, like `AuditPage`.
- **Origin labelling** (FR-011): every relationship row shows an `OriginBadge` with **text**, not only color:
  - `Source · HIGH`: neutral styling, solid border.
  - `Inferred · MEDIUM`: amber, dashed border.
  - `Manual · MEDIUM`: violet, dotted border.

  A test asserts that INFERRED and MANUAL rows never render the "Source" label.
- **Times**: `formatTimestamp(iso)` returns `toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' })`.
- **Raw payloads**: shown in a collapsed `<details>` element containing `<pre>{JSON.stringify(rawPayload, null, 2)}</pre>`.
- **Component files**: PascalCase `.tsx`, matching the existing web code. Tests sit next to them as `*.test.tsx`.

## R18. Performance verification

- **Decision**: `apps/api/test/perf-graph.e2e-spec.ts` is skipped unless `RUN_PERF=1`, following the `perf-audit` pattern from 001. It covers three cases:
  1. **SC-003**: bulk-insert 50,000 entities via SQL `generate_series`, plus one hub entity with 1,000 relationships and 1,000 events. Then assert:
     - the first filtered page of `/entities?type=Order` returns in under 2 s;
     - `/entities/:hub`, `/neighbors` and `/timeline` each return in under 2 s.
  2. **SC-008**: `/entities/:hub/neighbors` returns in under 500 ms, and two calls return identical results.
  3. **SC-004**: a 10,000-row JSON import through the API completes in under 60 s.
- **Where it runs**: locally before merge. It is not run in CI.

## R19. Dependencies added by this feature

| Package | Where | Kind | Why |
|---|---|---|---|
| `csv-parse` ^5 | apps/api | runtime | RFC 4180 CSV parsing (R6) |
| `@types/multer` | apps/api | dev | Types for `Express.Multer.File` (R5) |

No other dependencies may be added.
