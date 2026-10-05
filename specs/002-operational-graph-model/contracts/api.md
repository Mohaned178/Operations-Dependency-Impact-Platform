# API Contract: Core Operational Graph Model

These conventions are inherited from feature 001 (`specs/001-foundation-platform/contracts/api.md`):
- base path `/api`;
- `Authorization: Bearer` on every route;
- the error envelope `ErrorResponseSchema`;
- the `x-request-id` header;
- `mustChangePassword` gating.

**Schemas**: every schema named below MUST be exported from `@opsgraph/shared` together with its inferred type. Graph read DTOs go in `packages/shared/src/graph.ts`, and import DTOs go in `packages/shared/src/imports.ts`.

**Timestamps**: all responses use UTC ISO-8601 strings (`z.string().datetime()`).

**Cursors**: opaque base64url strings. An invalid cursor gives `400 VALIDATION_FAILED` with `details[0].path = "cursor"`.

## New error code

Add `IMPORT_TOO_LARGE` to `ErrorCodeSchema`. Add `Errors.importTooLarge()` → `AppError('IMPORT_TOO_LARGE', 413, 'Imports are limited to 10 MB and 10,000 rows')`.

## Shared graph DTOs (`graph.ts`)

```ts
EntityRefDto = { id: uuid, type: EntityType, displayName: string, currentState: OperationalState }

IdentifierDto = { sourceSystem: string, sourceId: string, firstSeenAt: datetime }

EntityListItemDto = {
  id: uuid, type: EntityType, displayName: string, currentState: OperationalState,
  primaryIdentifier: IdentifierDto, sourceSystems: string[], lastObservedAt: datetime }

StateObservationDto = {
  id: uuid, state: OperationalState, sourceStatus: string | null,
  sourceSystem: string, sourceId: string, observedAt: datetime, receivedAt: datetime, importId: uuid }

EntityDetailDto = {
  id: uuid, type: EntityType, displayName: string,
  attributes: Record<string, JsonValue>,
  currentState: OperationalState,
  currentStateObservation: StateObservationDto | null,      // null ⇔ currentState === 'UNKNOWN'
  latestStateBySource: StateObservationDto[],               // one per source system, sorted by sourceSystem
  identifiers: IdentifierDto[],                             // ordered by seq (first = primary)
  sourceSystems: string[],                                  // distinct, sorted
  lastObservedAt: datetime, createdAt: datetime,
  counts: { sourceRecords: number, stateObservations: number, relationships: number, events: number } }

SourceRecordDto = {
  id: uuid, kind: 'ENTITY' | 'RELATIONSHIP' | 'EVENT', sourceSystem: string, sourceId: string,
  observedAt: datetime, receivedAt: datetime, importId: uuid, rawPayload: JsonValue }

NeighborDto = {
  relationship: { id: uuid, type: RelationshipType, direction: 'OUT' | 'IN',
                  origin: RelationshipOrigin, confidence: Confidence, basis: string | null,
                  sourceSystem: string, sourceId: string, observedAt: datetime, importId: uuid },
  neighbor: EntityRefDto }

TimelineItemDto = discriminatedUnion('kind', [
  { kind: 'EVENT', id: uuid, at: datetime /* occurredAt */, eventType: string, description: string | null,
    role: 'SUBJECT' | 'RELATED',
    entities: { entity: EntityRefDto, role: 'SUBJECT' | 'RELATED' }[],   // all linked entities, subject first
    sourceSystem: string, sourceId: string, observedAt: datetime, importId: uuid },
  { kind: 'STATE', id: uuid, at: datetime /* observedAt */, state: OperationalState, sourceStatus: string | null,
    sourceSystem: string, sourceId: string, observedAt: datetime, importId: uuid } ])

Page<T> = { items: T[], nextCursor: string | null }   // one named schema per T, e.g. EntityListResponseSchema
```

## Entities (`graph` module). Any authenticated role.

| Method & path | Query (schema) | Success | Errors |
|---|---|---|---|
| GET `/entities` | `ListEntitiesQuerySchema = PageQuery.extend({ type?: EntityType, state?: OperationalState, sourceSystem?: string, q?: string (trimmed, 1–100) })` | 200 `EntityListResponseSchema` (Page<EntityListItemDto>), ordered by `displayName ASC, id ASC` | 400, 401 |
| GET `/entities/:id` | — | 200 `EntityDetailDtoSchema` | 400 (not a UUID), 401, 404 `NOT_FOUND` |
| GET `/entities/:id/neighbors` | `NeighborQuerySchema = PageQuery.extend({ direction: enum('OUT','IN','BOTH').default('BOTH'), relationshipType?: RelationshipType, neighborType?: EntityType })` | 200 `NeighborListResponseSchema` (Page<NeighborDto>), ordered as in research R12 | 400, 401, 404 |
| GET `/entities/:id/timeline` | `PageQuery` | 200 `TimelineResponseSchema` (Page<TimelineItemDto>), chronological ascending (research R13) | 400, 401, 404 |
| GET `/entities/:id/states` | `PageQuery` | 200 `StateHistoryResponseSchema` (Page<StateObservationDto>), newest first by `(observedAt DESC, seq DESC)` | 400, 401, 404 |
| GET `/entities/:id/source-records` | `PageQuery` | 200 `SourceRecordListResponseSchema` (Page<SourceRecordDto>), newest first by `(observedAt DESC, seq DESC)`. Only the entity's own (`kind = 'ENTITY'`) records | 400, 401, 404 |
| GET `/source-systems` | — | 200 `SourceSystemListResponseSchema = { items: string[] }`: distinct `entity_identifiers.source_system`, sorted | 401 |

- `/entities/:id/neighbors` is the **only** endpoint that returns relationships. It MUST call `GraphRepository.findNeighbors` (FR-047, FR-048).
- `EntitiesController` and `SourceSystemsController` have **no** `@Roles` decorator, so any authenticated user may call them.

## Imports (`ingestion` module). Admin only (`@Roles('ADMIN')` on the controller).

### POST `/imports`

The request is `multipart/form-data`:

| Part | Type | Rules |
|---|---|---|
| `file` | file | Required. At most 10 MB (`IMPORT_MAX_BYTES`). |
| `format` | text | `json` or `csv` |
| `kind` | text | `entities`, `relationships` or `events`. Required when `format=csv`, forbidden when `format=json`. |
| `dryRun` | text | `true` or `false`. Optional, default `false`. |

The text fields are validated with `ImportRequestFieldsSchema`, which transforms `dryRun` to a boolean. A missing `file` gives `400 VALIDATION_FAILED`, path `file`.

**Responses**:

| Status | When | Body |
|---|---|---|
| 201 | Every processed submission, whatever its outcome | `ImportReportSchema` |
| 400 | Invalid form fields or missing file | error envelope |
| 401 | Not signed in | error envelope |
| 403 | Not an Admin. Also audits `auth.forbidden`, via the existing `RolesGuard`. | error envelope |
| 413 `IMPORT_TOO_LARGE` | File larger than 10 MB, or more than 10,000 rows. Also audits `import.refused`. | error envelope |

The client MUST read `outcome` from the report. A `201` does not mean the data was stored.

```ts
ImportKindSchema = z.enum(['entities','relationships','events'])
ImportCountsSchema = z.object({ received, created, updated, unchanged, rejected })   // all z.number().int().min(0)
ImportRowErrorSchema = z.object({
  kind: ImportKindSchema,
  row: z.number().int().min(1),             // JSON: 1-based index in its section; CSV: spreadsheet row (header = 1)
  field: z.string().nullable(),             // JSON path (e.g. "from.sourceId") or CSV column name; null for row-level
  message: z.string(),
  dependsOn: z.object({ kind: ImportKindSchema, row: z.number().int() }).nullable() })
ImportReportSchema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(['APPLIED','REJECTED','DRY_RUN']),
  countsAreProjected: z.boolean(),          // true unless outcome === 'APPLIED' (FR-028)
  trigger: z.enum(['API','SEED']),
  format: z.enum(['json','csv']),
  kind: ImportKindSchema.nullable(),        // CSV only
  dryRun: z.boolean(),
  fileName: z.string(), byteSize: z.number().int(),
  receivedAt: datetime,
  submittedBy: z.object({ id: uuid, email: z.string() }).nullable(),   // null for SEED
  counts: z.object({ entities: ImportCountsSchema, relationships: ImportCountsSchema, events: ImportCountsSchema }),
  fileErrors: z.array(z.string()),
  rowErrors: z.array(ImportRowErrorSchema) })   // ordered by kind (entities, relationships, events), then row, then field
```

**Invariant**, asserted in tests for every report: `counts.<kind>.received = created + updated + unchanged + rejected`.

For a file-level error:
- all counts are 0 and `outcome` is `REJECTED`;
- `received` is still filled in when the rows could be counted. An example is an unknown top-level key next to valid arrays.

### Other import routes

| Method & path | Query | Success | Errors |
|---|---|---|---|
| GET `/imports` | `PageQuery` | 200 `ImportListResponseSchema` (Page<ImportSummaryDto>), newest first by `(receivedAt DESC, id DESC)` | 401, 403 |
| GET `/imports/:id` | — | 200 `ImportReportSchema` | 401, 403, 404 |

`ImportSummaryDto = ImportReportSchema.omit({ rowErrors: true, fileErrors: true }).extend({ errorCount: z.number().int() })`

## Authorization matrix additions (e2e MUST cover each cell)

| Route group | anonymous | ANALYST | OPS_MANAGER | ADMIN |
|---|---|---|---|---|
| `/entities`, `/entities/:id/**`, `/source-systems` | 401 | ✅ | ✅ | ✅ |
| `/imports` (GET, POST), `/imports/:id` | 401 | 403 + audit `auth.forbidden` | 403 + audit | ✅ |

Add these rows to `apps/api/test/authz-matrix.e2e-spec.ts`.

## Audit actions added to `AUDIT_ACTIONS`

The full table is in research R8. The web `AuditPage` action filter picks them up automatically, because it iterates over `AUDIT_ACTIONS`.
