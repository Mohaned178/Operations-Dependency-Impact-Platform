# Data Model: Core Operational Graph Model

This file covers four things:
- the Prisma additions to `apps/api/prisma/schema.prisma`, with migration notes;
- the shared vocabularies;
- the validation rules;
- the projection rules.

The reasons behind these decisions are in [research.md](./research.md) (R2–R4, R9–R11, R16). The seed dataset is in [seed-scenario.md](./seed-scenario.md).

## Vocabularies (`packages/shared/src/graph.ts`)

These are exported as zod enums with inferred types. The Prisma enums MUST use identical values.

```ts
export const EntityTypeSchema = z.enum(['Customer','Contract','Order','Product','Payment','Invoice',
  'Approval','Warehouse','Shipment','Supplier','SLA','BudgetRequirement']);
export const RelationshipTypeSchema = z.enum(['HAS','PLACED','GOVERNS','CONTAINS','GENERATES',
  'REQUIRES','DEPENDS_ON','BLOCKS','FULFILLED_BY','SUPPLIED_BY','DEFINES','RELATES_TO']);
export const RelationshipOriginSchema = z.enum(['SOURCE','INFERRED','MANUAL']);
export const ConfidenceSchema = z.enum(['HIGH','MEDIUM','LOW']);
export const OperationalStateSchema = z.enum(['ACTIVE','PENDING','WAITING','BLOCKED','MISSING',
  'DELAYED','AT_RISK','COMPLETED','FAILED','CANCELLED','SUSPENDED','UNKNOWN']);

/** FR-009. `null` means any entity type is allowed on that side. */
export const RELATIONSHIP_RULES: Record<RelationshipType, { from: readonly EntityType[] | null; to: readonly EntityType[] | null }> = {
  HAS:          { from: ['Customer'],          to: ['Contract'] },
  PLACED:       { from: ['Customer'],          to: ['Order'] },
  GOVERNS:      { from: ['Contract'],          to: ['Order'] },
  CONTAINS:     { from: ['Order'],             to: ['Product'] },
  GENERATES:    { from: ['Order'],             to: ['Invoice'] },
  FULFILLED_BY: { from: ['Order','Shipment'],  to: ['Warehouse'] },
  SUPPLIED_BY:  { from: ['Product'],           to: ['Supplier'] },
  DEFINES:      { from: ['Contract'],          to: ['SLA','BudgetRequirement'] },
  REQUIRES:     { from: null, to: null },
  DEPENDS_ON:   { from: null, to: null },
  BLOCKS:       { from: null, to: null },
  RELATES_TO:   { from: null, to: null },
};
/** Types that require attributes.amount + attributes.currency (R10). */
export const MONETARY_ENTITY_TYPES: readonly EntityType[] = ['Order','Payment','Invoice'];
```

`JsonValueSchema` is a recursive `z.lazy` union of `string | number | boolean | null | JsonValue[] | Record<string, JsonValue>`. It goes in `common.ts`.

## Prisma schema additions

```prisma
enum EntityType {
  Customer
  Contract
  Order
  Product
  Payment
  Invoice
  Approval
  Warehouse
  Shipment
  Supplier
  SLA
  BudgetRequirement
}

enum RelationshipType {
  HAS
  PLACED
  GOVERNS
  CONTAINS
  GENERATES
  REQUIRES
  DEPENDS_ON
  BLOCKS
  FULFILLED_BY
  SUPPLIED_BY
  DEFINES
  RELATES_TO
}

enum RelationshipOrigin {
  SOURCE
  INFERRED
  MANUAL
}

enum Confidence {
  HIGH
  MEDIUM
  LOW
}

enum OperationalState {
  ACTIVE
  PENDING
  WAITING
  BLOCKED
  MISSING
  DELAYED
  AT_RISK
  COMPLETED
  FAILED
  CANCELLED
  SUSPENDED
  UNKNOWN
}

enum SourceRecordKind {
  ENTITY
  RELATIONSHIP
  EVENT
}

enum ImportFormat {
  JSON
  CSV
}

enum ImportKind {
  ENTITIES
  RELATIONSHIPS
  EVENTS
}

enum ImportOutcome {
  APPLIED
  REJECTED
  DRY_RUN
}

enum ImportTrigger {
  API
  SEED
}

enum EventEntityRole {
  SUBJECT
  RELATED
}

model Import {
  id            String        @id @db.Uuid
  trigger       ImportTrigger
  format        ImportFormat
  csvKind       ImportKind?   @map("csv_kind")
  dryRun        Boolean       @map("dry_run")
  outcome       ImportOutcome
  actorType     String        @map("actor_type") // 'user' | 'system'
  submittedById String?       @map("submitted_by_id") @db.Uuid
  fileName      String        @map("file_name")
  byteSize      Int           @map("byte_size")
  receivedAt    DateTime      @map("received_at") @db.Timestamptz(6)
  counts        Json          // ImportCounts
  fileErrors    Json          @map("file_errors") // string[]
  rowErrors     Json          @map("row_errors")  // ImportRowError[]
  correlationId String        @map("correlation_id") @db.Uuid

  submittedBy       User?              @relation(fields: [submittedById], references: [id], onDelete: Restrict)
  sourceRecords     SourceRecord[]
  stateObservations StateObservation[]
  relationships     Relationship[]
  events            Event[]

  @@index([receivedAt(sort: Desc), id(sort: Desc)])
  @@map("imports")
}

model Entity {
  id             String           @id @db.Uuid
  type           EntityType
  displayName    String           @map("display_name")
  attributes     Json             @default("{}")
  currentState   OperationalState @default(UNKNOWN) @map("current_state")
  lastObservedAt DateTime         @map("last_observed_at") @db.Timestamptz(6)
  createdAt      DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  identifiers       EntityIdentifier[]
  sourceRecords     SourceRecord[]
  stateObservations StateObservation[]
  outgoing          Relationship[]     @relation("RelationshipFrom")
  incoming          Relationship[]     @relation("RelationshipTo")
  eventLinks        EventEntity[]

  @@index([displayName, id])
  @@index([type, displayName, id])
  @@index([currentState, displayName, id])
  @@map("entities")
}

model EntityIdentifier {
  id           String     @id @db.Uuid
  seq          BigInt     @unique @default(autoincrement())
  entityId     String     @map("entity_id") @db.Uuid
  entityType   EntityType @map("entity_type")
  sourceSystem String     @map("source_system")
  sourceId     String     @map("source_id")
  createdAt    DateTime   @map("created_at") @db.Timestamptz(6) // = receivedAt of the import that introduced it

  entity Entity @relation(fields: [entityId], references: [id], onDelete: Restrict)

  @@unique([entityType, sourceSystem, sourceId])
  @@index([entityId, seq])
  @@index([sourceSystem])
  @@index([sourceId])
  @@map("entity_identifiers")
}

model SourceRecord {
  id             String           @id @db.Uuid
  seq            BigInt           @unique @default(autoincrement())
  kind           SourceRecordKind
  sourceSystem   String           @map("source_system")
  sourceId       String           @map("source_id")
  observedAt     DateTime         @map("observed_at") @db.Timestamptz(6)
  receivedAt     DateTime         @map("received_at") @db.Timestamptz(6)
  rawPayload     Json             @map("raw_payload")
  payloadHash    String           @map("payload_hash") @db.Char(64)
  normalized     Json             // see "Normalized payloads" below
  importId       String           @map("import_id") @db.Uuid
  entityId       String?          @map("entity_id") @db.Uuid
  relationshipId String?          @map("relationship_id") @db.Uuid
  eventId        String?          @map("event_id") @db.Uuid

  import           Import            @relation(fields: [importId], references: [id], onDelete: Restrict)
  entity           Entity?           @relation(fields: [entityId], references: [id], onDelete: Restrict)
  relationship     Relationship?     @relation(fields: [relationshipId], references: [id], onDelete: Restrict)
  event            Event?            @relation(fields: [eventId], references: [id], onDelete: Restrict)
  stateObservation StateObservation?

  @@index([entityId, observedAt(sort: Desc), seq(sort: Desc)])
  @@index([relationshipId])
  @@index([eventId])
  @@map("source_records")
}

model StateObservation {
  id             String           @id @db.Uuid
  seq            BigInt           @unique @default(autoincrement())
  entityId       String           @map("entity_id") @db.Uuid
  sourceRecordId String           @unique @map("source_record_id") @db.Uuid
  state          OperationalState
  sourceStatus   String?          @map("source_status")
  sourceSystem   String           @map("source_system")
  sourceId       String           @map("source_id")
  observedAt     DateTime         @map("observed_at") @db.Timestamptz(6)
  receivedAt     DateTime         @map("received_at") @db.Timestamptz(6)
  importId       String           @map("import_id") @db.Uuid

  entity       Entity       @relation(fields: [entityId], references: [id], onDelete: Restrict)
  sourceRecord SourceRecord @relation(fields: [sourceRecordId], references: [id], onDelete: Restrict)
  import       Import       @relation(fields: [importId], references: [id], onDelete: Restrict)

  @@index([entityId, observedAt, seq])
  @@map("state_observations")
}

model Relationship {
  id           String             @id @db.Uuid
  type         RelationshipType
  fromEntityId String             @map("from_entity_id") @db.Uuid
  toEntityId   String             @map("to_entity_id") @db.Uuid
  origin       RelationshipOrigin
  confidence   Confidence
  basis        String?
  sourceSystem String             @map("source_system")
  sourceId     String             @map("source_id")
  observedAt   DateTime           @map("observed_at") @db.Timestamptz(6) // of the current (latest) observation
  importId     String             @map("import_id") @db.Uuid             // of the current (latest) observation
  createdAt    DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime           @updatedAt @map("updated_at") @db.Timestamptz(6)

  from          Entity         @relation("RelationshipFrom", fields: [fromEntityId], references: [id], onDelete: Restrict)
  to            Entity         @relation("RelationshipTo", fields: [toEntityId], references: [id], onDelete: Restrict)
  import        Import         @relation(fields: [importId], references: [id], onDelete: Restrict)
  sourceRecords SourceRecord[]

  @@unique([sourceSystem, sourceId])
  @@index([fromEntityId, type])
  @@index([toEntityId, type])
  @@map("relationships")
}

model Event {
  id           String   @id @db.Uuid
  type         String
  occurredAt   DateTime @map("occurred_at") @db.Timestamptz(6)
  observedAt   DateTime @map("observed_at") @db.Timestamptz(6)
  description  String?
  sourceSystem String   @map("source_system")
  sourceId     String   @map("source_id")
  importId     String   @map("import_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  import        Import         @relation(fields: [importId], references: [id], onDelete: Restrict)
  entities      EventEntity[]
  sourceRecords SourceRecord[]

  @@unique([sourceSystem, sourceId])
  @@index([occurredAt, id])
  @@map("events")
}

model EventEntity {
  eventId  String          @map("event_id") @db.Uuid
  entityId String          @map("entity_id") @db.Uuid
  role     EventEntityRole

  event  Event  @relation(fields: [eventId], references: [id], onDelete: Cascade)
  entity Entity @relation(fields: [entityId], references: [id], onDelete: Restrict)

  @@id([eventId, entityId])
  @@index([entityId])
  @@map("event_entities")
}
```

Add `imports Import[]` to `model User`.

### Migrations

1. **`<ts>_graph_model`**: the output of `prisma migrate dev --create-only`, with these lines appended:
   ```sql
   ALTER TABLE relationships ADD CONSTRAINT relationships_no_self_loop CHECK (from_entity_id <> to_entity_id);
   ALTER TABLE source_records ADD CONSTRAINT source_records_owner_matches_kind CHECK (
     (kind = 'ENTITY'       AND entity_id IS NOT NULL AND relationship_id IS NULL AND event_id IS NULL) OR
     (kind = 'RELATIONSHIP' AND relationship_id IS NOT NULL AND entity_id IS NULL AND event_id IS NULL) OR
     (kind = 'EVENT'        AND event_id IS NOT NULL AND entity_id IS NULL AND relationship_id IS NULL));
   CREATE UNIQUE INDEX event_entities_one_subject ON event_entities (event_id) WHERE role = 'SUBJECT';
   ```
2. **`<ts>_provenance_append_only`**: the raw-SQL triggers from research R16, on `source_records` and `state_observations`.

`apps/api/test/helpers.ts` → `resetDb` MUST:
1. Disable `TRIGGER USER` on `audit_entries`, `source_records` and `state_observations`.
2. `TRUNCATE users, refresh_tokens, imports, entities, entity_identifiers, source_records, state_observations, relationships, events, event_entities CASCADE`.
3. `DELETE FROM audit_entries`.
4. Re-enable the triggers.

## Normalized payloads (`source_records.normalized`)

| kind | `normalized` shape |
|---|---|
| ENTITY | `{ entityType, displayName, attributes, state: OperationalState \| null, sourceStatus: string \| null }` |
| RELATIONSHIP | `{ type, fromEntityId, toEntityId, origin, confidence, basis: string \| null }` |
| EVENT | `{ type, occurredAt, description: string \| null, subjectEntityId, relatedEntityIds: string[] }` |

`rawPayload` is the row exactly as received:
- **JSON**: the row object as parsed.
- **CSV**: `{ header: cell }` for every header.

`payloadHash = sha256(canonicalJson(rawPayload))`.

## Import row schemas (`packages/shared/src/imports.ts`)

```ts
export const SourceSystemSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/);
export const SourceIdSchema = z.string().min(1).max(200).regex(/^[^|;\r\n]+$/);
export const TimestampSchema = z.string().datetime({ offset: true });
export const EntityKeyRefSchema = z.object({ entityType: EntityTypeSchema, sourceSystem: SourceSystemSchema, sourceId: SourceIdSchema }).strict();
export const EntityIdRefSchema = z.object({ id: z.string().uuid() }).strict();
export const EntityRefSchema = z.union([EntityIdRefSchema, EntityKeyRefSchema]);

export const EntityImportRowSchema = z.object({
  type: EntityTypeSchema,
  sourceSystem: SourceSystemSchema,
  sourceId: SourceIdSchema,
  displayName: z.string().trim().min(1).max(200),
  observedAt: TimestampSchema,
  state: OperationalStateSchema.optional(),
  sourceStatus: z.string().max(100).optional(),
  attributes: z.record(JsonValueSchema).default({}),
  entityRef: EntityRefSchema.optional(),
}).superRefine(moneyRule);          // R10: amount/currency pairing + MONETARY_ENTITY_TYPES

export const RelationshipImportRowSchema = z.object({
  type: RelationshipTypeSchema,
  sourceSystem: SourceSystemSchema,
  sourceId: SourceIdSchema,
  from: EntityRefSchema,
  to: EntityRefSchema,
  origin: RelationshipOriginSchema,
  confidence: ConfidenceSchema,
  basis: z.string().trim().min(1).max(500).optional(),
  observedAt: TimestampSchema,
}).superRefine(basisRule);          // FR-012: basis required unless origin === 'SOURCE'

export const EventImportRowSchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  sourceSystem: SourceSystemSchema,
  sourceId: SourceIdSchema,
  occurredAt: TimestampSchema,
  observedAt: TimestampSchema,
  subject: EntityRefSchema,
  related: z.array(EntityRefSchema).max(50).default([]),
  description: z.string().max(2000).optional(),
});

export const ImportDocumentSchema = z.object({
  entities: z.array(z.unknown()).optional(),
  relationships: z.array(z.unknown()).optional(),
  events: z.array(z.unknown()).optional(),
}).strict();   // used only for the TypeScript type; the parser checks the top level by hand (R6)
export type ImportDocument = {
  entities?: EntityImportRow[];
  relationships?: RelationshipImportRow[];
  events?: EventImportRow[];
};
```

Rows are deliberately **not** `.strict()`. Unknown row fields are ignored during normalization, but they stay in `rawPayload` (FR-006, FR-033).

## Cross-row rules (planner)

These rules are checked in `import-planner.ts`. Each violation rejects the row with the message shown.

| # | Rule | Message |
|---|---|---|
| P1 | An `entityRef` by id must exist | `Entity <id> does not exist` |
| P2 | An `entityRef` must point to an entity of the same `type` | `Referenced entity is a <T>, row is a <U>` |
| P3 | An `entityRef` by key must be an existing identifier, or the own key of an in-file row without an `entityRef` | `Reference chains are not supported; reference the entity's own key or OpsGraph id` / `No entity with key <T>/<system>/<id>` |
| P4 | A row's own key that already belongs to entity E1 cannot be attached to a different entity E2 by `entityRef` | `Identifier <system>/<id> already belongs to entity <E1>` |
| P5 | All in-file rows sharing one key must resolve to the same entity | `Rows <a>, <b> resolve the same key to different entities` |
| P6 | Same key and same `observedAt` with different content in one file → reject all of them | `Ambiguous: rows <list> have the same key and observedAt but different content` |
| P7 | Relationship/event refs must resolve to an existing or in-file entity | `No entity with key …` / `Entity <id> does not exist` |
| P8 | Ref to an entity whose rows were all rejected | `Depends on rejected entities row <n>` (`dependsOn` set) |
| P9 | Relationship types must satisfy `RELATIONSHIP_RULES` | `PLACED requires from Customer → to Order; got Supplier → Order` |
| P10 | Relationship `from` and `to` must resolve to different entities | `A relationship cannot connect an entity to itself` |
| P11 | An existing relationship key cannot change `type`, `from` or `to` | `Relationship <system>/<id> already exists with a different type or endpoints` |
| P12 | An existing event key cannot change `type` or `subject` | `Event <system>/<id> already exists with a different type or subject` |
| P13 | An event's `related` list must not include its subject | `An event's subject cannot also be a related entity` |

## Projection rules (pure functions, unit-tested)

Ordering means ascending `(observedAt, seqOrder)`, where `seqOrder` is the real `seq` for existing observations, and `maxSeq + filePosition` for new ones (R4).

- **`projectEntity(observations, stateObservations)`**:
  - `displayName`: the latest observation's value.
  - `attributes`: a shallow merge over observations in ascending order. Later keys overwrite earlier ones, and a key absent from a later observation keeps its earlier value.
  - `currentState`: the latest state observation's state, or `UNKNOWN` if there is none.
  - `lastObservedAt`: the maximum `observedAt`.
- **`projectRelationship(observations)`**: `origin`, `confidence`, `basis`, `observedAt` and `importId` come from the latest observation.
- **`projectEvent(observations)`**: `occurredAt`, `description`, `relatedEntityIds`, `observedAt` and `importId` come from the latest observation. When the related set changes, the `event_entities` RELATED rows are replaced with `deleteMany` + `createMany`. `event_entities` is not append-only. Its history lives in `source_records.normalized`.
- **Per-source latest state** (detail page, FR-017): for each `sourceSystem`, the state observation with the maximum `(observedAt, seq)`.

## Row classification

| Kind | created | updated | unchanged |
|---|---|---|---|
| entity | key unknown and no `entityRef` → new entity; or key unknown with `entityRef` → new identifier on that entity. *Only the new-entity case counts as `created`; the new-identifier case counts as `updated`.* | new observation of an existing entity | same entity, same identifier, same `observedAt`, same `payloadHash` already stored (or an identical earlier row in the same file) |
| relationship | key unknown | new observation of an existing key | same key, `observedAt` and hash |
| event | key unknown | new observation of an existing key | same key, `observedAt` and hash |

For every kind: `received = created + updated + unchanged + rejected`.
