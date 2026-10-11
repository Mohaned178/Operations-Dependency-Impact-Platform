# Data Model: Investigation Workspace

**Feature**: `008-investigation-workspace` | **Date**: 2026-10-07

This feature stores **investigations**, their **user-added entities**, **exception links**, **unpins**, **decisions** and **notes**, and generalizes 007's snapshot table into **`analysis_snapshots`**, which holds both exception snapshots and investigation pins (research R2). The scope and the history are computed, not stored (research R8, R14). Response schemas are in [contracts/api.md](./contracts/api.md).

---

## §1 Storage (Prisma + migration `<timestamp>_investigations`)

### §1a Prisma schema changes (`apps/api/prisma/schema.prisma`)

**Generalized snapshot table** (replaces 007's `ExceptionSnapshot` model and `ExceptionSnapshotKind` enum):

```prisma
enum AnalysisSnapshotKind {        // was ExceptionSnapshotKind (renamed in SQL, §1b)
  ROOT_CAUSE
  IMPACT
}

model AnalysisSnapshot {
  id                String               @id @default(uuid()) @db.Uuid
  seq               BigInt               @unique @default(autoincrement())
  kind              AnalysisSnapshotKind
  exceptionId       String?              @map("exception_id") @db.Uuid       // exactly one owner (CHECK, §1b)
  investigationId   String?              @map("investigation_id") @db.Uuid
  anchorEntityId    String               @map("anchor_entity_id") @db.Uuid   // ROOT_CAUSE: subject/focus; IMPACT: anchor
  takenAt           DateTime             @map("taken_at") @db.Timestamptz(6)
  takenById         String?              @map("taken_by_id") @db.Uuid        // null = system
  payload           Json                                                      // §2b, validated on write and read
  rootCauseEntityId String?              @map("root_cause_entity_id") @db.Uuid  // ROOT_CAUSE with a chosen candidate
  rootCauseLabel    String?              @map("root_cause_label")
  chainEntityIds    String[]             @default([]) @map("chain_entity_ids") @db.Uuid

  exception       Exception?     @relation(fields: [exceptionId], references: [id], onDelete: Restrict)
  investigation   Investigation? @relation("InvestigationPins", fields: [investigationId], references: [id], onDelete: Restrict)
  anchorEntity    Entity         @relation("AnalysisSnapshotAnchor", fields: [anchorEntityId], references: [id], onDelete: Restrict)
  rootCauseEntity Entity?        @relation("AnalysisSnapshotRootCause", fields: [rootCauseEntityId], references: [id], onDelete: Restrict)
  takenBy         User?          @relation("AnalysisSnapshotTakenBy", fields: [takenById], references: [id], onDelete: Restrict)
  unpin           InvestigationUnpin?
  currentRootCauseOf Investigation? @relation("InvestigationCurrentRootCausePin")
  currentImpactOf    Investigation? @relation("InvestigationCurrentImpactPin")

  @@index([exceptionId, kind, seq(sort: Desc)])
  @@index([investigationId, kind, seq(sort: Desc)])
  @@index([kind, takenAt, rootCauseLabel])
  @@map("analysis_snapshots")
}
```

Relation names: keep 007's names where they exist (`ExceptionSnapshotAnchor` → rename to `AnalysisSnapshotAnchor`, `ExceptionSnapshotTakenBy` → `AnalysisSnapshotTakenBy`); update the back-relations on `User` (`analysisSnapshots`) and `Entity` (`analysisSnapshotAnchors`, `analysisSnapshotRootCauses`), and `Exception.snapshots AnalysisSnapshot[]`.

**New models**:

```prisma
enum InvestigationStatus {
  OPEN
  RESOLVED
  CLOSED
}

enum InvestigationCreatedFrom {
  INVESTIGATIONS_AREA
  ENTITY
  SEED
}

model Investigation {
  id                    String                   @id @default(uuid()) @db.Uuid
  number                Int                      @unique @default(autoincrement())
  title                 String
  description           String?
  severity              ExceptionSeverity        // 007's enum, reused (CRITICAL first)
  status                InvestigationStatus      @default(OPEN)
  focusEntityId         String                   @map("focus_entity_id") @db.Uuid
  ownerId               String                   @map("owner_id") @db.Uuid
  createdFrom           InvestigationCreatedFrom @map("created_from")
  createdById           String?                  @map("created_by_id") @db.Uuid      // null = system
  createdAt             DateTime                 @map("created_at") @db.Timestamptz(6)
  lastActivityAt        DateTime                 @map("last_activity_at") @db.Timestamptz(6)
  resolvedAt            DateTime?                @map("resolved_at") @db.Timestamptz(6)
  resolvedById          String?                  @map("resolved_by_id") @db.Uuid
  resolutionSummary     String?                  @map("resolution_summary")
  closedAt              DateTime?                @map("closed_at") @db.Timestamptz(6)
  closedById            String?                  @map("closed_by_id") @db.Uuid
  reopenCount           Int                      @default(0) @map("reopen_count")
  currentRootCausePinId String?                  @unique @map("current_root_cause_pin_id") @db.Uuid
  currentImpactPinId    String?                  @unique @map("current_impact_pin_id") @db.Uuid
  slaCommitmentsAtRisk  Int                      @default(0) @map("sla_commitments_at_risk")  // research R6
  version               Int                      @default(1)

  focusEntity      Entity            @relation("InvestigationFocus", fields: [focusEntityId], references: [id], onDelete: Restrict)
  owner            User              @relation("InvestigationOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  createdBy        User?             @relation("InvestigationCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  resolvedBy       User?             @relation("InvestigationResolvedBy", fields: [resolvedById], references: [id], onDelete: Restrict)
  closedBy         User?             @relation("InvestigationClosedBy", fields: [closedById], references: [id], onDelete: Restrict)
  currentRootCausePin AnalysisSnapshot? @relation("InvestigationCurrentRootCausePin", fields: [currentRootCausePinId], references: [id], onDelete: Restrict)
  currentImpactPin    AnalysisSnapshot? @relation("InvestigationCurrentImpactPin", fields: [currentImpactPinId], references: [id], onDelete: Restrict)

  pins           AnalysisSnapshot[]       @relation("InvestigationPins")
  addedEntities  InvestigationEntity[]
  exceptionLinks InvestigationException[]
  decisions      InvestigationDecision[]
  notes          InvestigationNote[]

  @@index([status, lastActivityAt(sort: Desc), number(sort: Desc)])
  @@index([ownerId, status])
  @@index([severity, lastActivityAt(sort: Desc)])
  @@index([createdAt(sort: Desc), number(sort: Desc)])
  @@index([lastActivityAt(sort: Desc), number(sort: Desc)])
  @@index([focusEntityId])
  @@map("investigations")
}

model InvestigationEntity {
  investigationId String   @map("investigation_id") @db.Uuid
  entityId        String   @map("entity_id") @db.Uuid
  addedById       String?  @map("added_by_id") @db.Uuid      // null = system
  addedAt         DateTime @map("added_at") @db.Timestamptz(6)

  investigation Investigation @relation(fields: [investigationId], references: [id], onDelete: Restrict)
  entity        Entity        @relation("InvestigationAddedEntity", fields: [entityId], references: [id], onDelete: Restrict)
  addedBy       User?         @relation("InvestigationEntityAddedBy", fields: [addedById], references: [id], onDelete: Restrict)

  @@id([investigationId, entityId])
  @@index([entityId])
  @@map("investigation_entities")
}

model InvestigationException {
  investigationId String   @map("investigation_id") @db.Uuid
  exceptionId     String   @map("exception_id") @db.Uuid
  linkedById      String?  @map("linked_by_id") @db.Uuid     // null = system (seed)
  linkedAt        DateTime @map("linked_at") @db.Timestamptz(6)

  investigation Investigation @relation(fields: [investigationId], references: [id], onDelete: Restrict)
  exception     Exception     @relation("InvestigationExceptionLink", fields: [exceptionId], references: [id], onDelete: Restrict)
  linkedBy      User?         @relation("InvestigationExceptionLinkedBy", fields: [linkedById], references: [id], onDelete: Restrict)

  @@id([investigationId, exceptionId])
  @@index([exceptionId])
  @@map("investigation_exceptions")
}

model InvestigationUnpin {
  snapshotId   String   @id @map("snapshot_id") @db.Uuid
  unpinnedById String   @map("unpinned_by_id") @db.Uuid
  reason       String
  unpinnedAt   DateTime @map("unpinned_at") @db.Timestamptz(6)

  snapshot   AnalysisSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Restrict)
  unpinnedBy User             @relation("InvestigationUnpinnedBy", fields: [unpinnedById], references: [id], onDelete: Restrict)

  @@map("investigation_unpins")
}

model InvestigationDecision {
  id                   String   @id @default(uuid()) @db.Uuid
  seq                  BigInt   @unique @default(autoincrement())
  investigationId      String   @map("investigation_id") @db.Uuid
  authorId             String   @map("author_id") @db.Uuid
  statement            String
  rationale            String
  supersedesDecisionId String?  @unique @map("supersedes_decision_id") @db.Uuid   // superseded at most once
  context              Json                                                         // §2c, validated on write and read
  createdAt            DateTime @map("created_at") @db.Timestamptz(6)

  investigation Investigation          @relation(fields: [investigationId], references: [id], onDelete: Restrict)
  author        User                   @relation("InvestigationDecisionAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  supersedes    InvestigationDecision? @relation("DecisionSupersedes", fields: [supersedesDecisionId], references: [id], onDelete: Restrict)
  supersededBy  InvestigationDecision? @relation("DecisionSupersedes")

  @@index([investigationId, seq(sort: Desc)])
  @@map("investigation_decisions")
}

model InvestigationNote {
  id              String   @id @default(uuid()) @db.Uuid
  seq             BigInt   @unique @default(autoincrement())
  investigationId String   @map("investigation_id") @db.Uuid
  authorId        String   @map("author_id") @db.Uuid
  text            String
  createdAt       DateTime @map("created_at") @db.Timestamptz(6)

  investigation Investigation @relation(fields: [investigationId], references: [id], onDelete: Restrict)
  author        User          @relation("InvestigationNoteAuthor", fields: [authorId], references: [id], onDelete: Restrict)

  @@index([investigationId, seq(sort: Desc)])
  @@map("investigation_notes")
}
```

Back-relations to add:
- **`User`**: `ownedInvestigations`, `createdInvestigations`, `resolvedInvestigations`, `closedInvestigations`, `investigationEntitiesAdded`, `investigationExceptionsLinked`, `investigationUnpins`, `investigationDecisions`, `investigationNotes`, each with its relation name above.
- **`Entity`**: `investigationsAsFocus @relation("InvestigationFocus")`, `investigationAdds @relation("InvestigationAddedEntity")`.
- **`Exception`**: `investigationLinks InvestigationException[] @relation("InvestigationExceptionLink")`.

### §1b Hand-written SQL in the migration

Create the migration with `prisma migrate dev --create-only`, then **replace** the generated statements for the snapshot table (Prisma would drop and recreate it) with the rename below, and append the rest. Check the generated SQL before applying: it must not contain `DROP TABLE "exception_snapshots"`.

```sql
-- 1. Generalize 007's snapshots (research R2)
ALTER TYPE "ExceptionSnapshotKind" RENAME TO "AnalysisSnapshotKind";
ALTER TABLE exception_snapshots RENAME TO analysis_snapshots;
ALTER TABLE analysis_snapshots RENAME CONSTRAINT exception_snapshots_pkey TO analysis_snapshots_pkey;
ALTER INDEX exception_snapshots_seq_key RENAME TO analysis_snapshots_seq_key;
ALTER INDEX "exception_snapshots_exception_id_kind_seq_idx" RENAME TO "analysis_snapshots_exception_id_kind_seq_idx";
ALTER SEQUENCE exception_snapshots_seq_seq RENAME TO analysis_snapshots_seq_seq;
-- rename the FK constraints the same way (names from \d exception_snapshots)
ALTER TRIGGER exception_snapshots_append_only ON analysis_snapshots RENAME TO analysis_snapshots_append_only;
ALTER TRIGGER exception_snapshots_append_only_truncate ON analysis_snapshots RENAME TO analysis_snapshots_append_only_truncate;

ALTER TABLE analysis_snapshots
  ALTER COLUMN exception_id DROP NOT NULL,
  ADD COLUMN investigation_id uuid REFERENCES investigations(id) ON DELETE RESTRICT,
  ADD COLUMN root_cause_entity_id uuid REFERENCES entities(id) ON DELETE RESTRICT,
  ADD COLUMN root_cause_label text,
  ADD COLUMN chain_entity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT analysis_snapshots_one_owner CHECK (num_nonnulls(exception_id, investigation_id) = 1),
  ADD CONSTRAINT analysis_snapshots_root_cause_pair CHECK ((root_cause_entity_id IS NULL) = (root_cause_label IS NULL)),
  ADD CONSTRAINT analysis_snapshots_root_cause_kind CHECK (kind = 'ROOT_CAUSE' OR (root_cause_entity_id IS NULL AND cardinality(chain_entity_ids) = 0));

-- Backfill 007 rows (they have no chain yet; chain_entity_ids stays empty for them)
ALTER TABLE analysis_snapshots DISABLE TRIGGER analysis_snapshots_append_only;
UPDATE analysis_snapshots
   SET root_cause_label = payload -> 'chosen' ->> 'label',
       root_cause_entity_id = (payload -> 'chosen' -> 'rootCause' ->> 'id')::uuid
 WHERE kind = 'ROOT_CAUSE' AND jsonb_typeof(payload -> 'chosen') = 'object';
ALTER TABLE analysis_snapshots ENABLE TRIGGER analysis_snapshots_append_only;

CREATE INDEX analysis_snapshots_chain_entity_ids_gin ON analysis_snapshots USING gin (chain_entity_ids);

-- 2. Investigations
ALTER SEQUENCE investigations_number_seq RESTART WITH 10001;
ALTER TABLE investigations
  ADD CONSTRAINT investigations_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  ADD CONSTRAINT investigations_description_length CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  ADD CONSTRAINT investigations_resolved CHECK (
    (status IN ('RESOLVED','CLOSED')) = (resolved_at IS NOT NULL AND resolution_summary IS NOT NULL)),
  ADD CONSTRAINT investigations_resolution_length CHECK (resolution_summary IS NULL OR char_length(resolution_summary) BETWEEN 1 AND 2000),
  ADD CONSTRAINT investigations_closed CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  ADD CONSTRAINT investigations_counts CHECK (reopen_count >= 0 AND version >= 1 AND sla_commitments_at_risk >= 0);
CREATE INDEX investigations_sla_at_risk ON investigations (sla_commitments_at_risk) WHERE sla_commitments_at_risk > 0;

-- 3. Unpins, decisions, notes
ALTER TABLE investigation_unpins
  ADD CONSTRAINT investigation_unpins_reason_length CHECK (char_length(reason) BETWEEN 1 AND 500);
ALTER TABLE investigation_decisions
  ADD CONSTRAINT investigation_decisions_statement_length CHECK (char_length(statement) BETWEEN 1 AND 500),
  ADD CONSTRAINT investigation_decisions_rationale_length CHECK (char_length(rationale) BETWEEN 1 AND 4000),
  ADD CONSTRAINT investigation_decisions_not_self CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id);
ALTER TABLE investigation_notes
  ADD CONSTRAINT investigation_notes_text_length CHECK (char_length(text) BETWEEN 1 AND 4000);

-- Append-only (forbid_provenance_mutation() already exists; do not redefine it)
CREATE TRIGGER investigation_unpins_append_only BEFORE UPDATE OR DELETE ON investigation_unpins
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER investigation_unpins_append_only_truncate BEFORE TRUNCATE ON investigation_unpins
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER investigation_decisions_append_only BEFORE UPDATE OR DELETE ON investigation_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER investigation_decisions_append_only_truncate BEFORE TRUNCATE ON investigation_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER investigation_notes_append_only BEFORE UPDATE OR DELETE ON investigation_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER investigation_notes_append_only_truncate BEFORE TRUNCATE ON investigation_notes
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
```

Ordering inside the migration: create `investigations` (and its enums) **before** step 1 adds the `investigation_id` foreign key; add the `current_*_pin_id` foreign keys of `investigations` **after** step 1. Use the constraint and index names Prisma generated for 007 (read them with `\d exception_snapshots` on a database migrated to 007) and the names Prisma expects for the renamed model, so that `prisma migrate diff` against `schema.prisma` reports no drift after the migration.

**Exception snapshots stay owned by exceptions**: 007 queries keep filtering by `exceptionId`, so they never see investigation pins.

**`apps/api/test/helpers.ts → resetDb`**:
- replace `exception_snapshots` by `analysis_snapshots` in the `TRUNCATE` list and in the `DISABLE/ENABLE TRIGGER USER` list;
- add `investigations, investigation_entities, investigation_exceptions, investigation_unpins, investigation_decisions, investigation_notes` to `TRUNCATE` (before `analysis_snapshots`, `exceptions` and `users`), and `DISABLE/ENABLE TRIGGER USER` for the three append-only ones.

### §1c Validation rules (zod in `packages/shared` and CHECKs in the database)

| Field | Rule |
|---|---|
| `title` | trimmed; 1 to 200 |
| `description` | trimmed; empty means absent (`null`); otherwise 1 to 4,000 |
| `severity` | `EXCEPTION_SEVERITIES` |
| `focusEntityId`, `ownerId` | uuid; existing entity / ACTIVE user (400 otherwise) |
| `resolutionSummary` | trimmed; 1 to 2,000 |
| `reopenReason`, unpin `reason` | trimmed; 1 to 500 |
| decision `statement` / `rationale` | trimmed; 1 to 500 / 1 to 4,000 |
| decision `citations` | 0 to 20 items, distinct by kind and id |
| note `text` | trimmed; 1 to 4,000 |
| pin `depth` | 1 to 10, default 6 |
| `expectedVersion` | integer ≥ 1 |
| added entities | ≤ 40 per investigation |
| linked exceptions | ≤ 20 per investigation |
| scope | ≤ 100 (by construction, research R8) |

---

## §2 Shared code

### §2a `packages/shared/src/analysis-snapshots.ts` (moved from 007, research R2)

Moved unchanged from `exceptions.ts` / `exceptions/snapshot.mapper.ts`: `RootCauseSnapshotSchema`, `ImpactSnapshotSchema`, `SnapshotEnvelopeSchema`, `SnapshotDigest`, `toRootCauseSnapshot`, `toImpactSnapshot`, `digestOf`. `exceptions.ts` imports and re-exports nothing new; its own schemas reference them by import.

**Additive changes**:

```ts
export const SnapshotChainStepSchema = z.object({
  index: z.number().int().min(0),
  roles: z.array(CausalRoleSchema).min(1),                 // 005
  possible: z.boolean(),
  entity: EntityRefDtoSchema,                              // state as it was
  hop: z.object({
    relationshipType: TraceableRelationshipTypeSchema,
    traversal: z.enum(['FORWARD', 'REVERSE']),
    origin: RelationshipOriginSchema,                      // effectiveOrigin
    confidence: ConfidenceSchema,                          // effectiveConfidence
  }).nullable(),                                           // null at index 0
});

// in RootCauseSnapshotSchema.chosen:
  chain: z.array(SnapshotChainStepSchema).min(2).optional(),   // absent only in 007 snapshots taken before 008

// in SnapshotDigest.impact:
  slaCommitments?: number;                                 // categories[type=SLA].current; absent in older digests

export interface DigestDifference {
  field: 'rootCauseLabel' | 'rootCauseEntity' | 'confidence' | 'orders' | 'customers' | 'slaCommitments' | 'exposure';
  label: string;                 // "Root cause", "Root-cause entity", "Confidence", "Customer orders", "Customers", "SLA commitments at risk", "Exposure (USD)"
  pinned: string;                // rendered value, "none" when absent
  live: string;
}
export function compareDigests(pinned: Partial<SnapshotDigest>, live: Partial<SnapshotDigest>): DigestDifference[];
export function chainEntityIdsOf(snapshot: RootCauseSnapshot): string[];  // chosen?.chain?.map(s => s.entity.id) ?? []
```

`toRootCauseSnapshot` fills `chain` from `candidate.primaryChain.steps`, mapping each `CausalStepDto` to `SnapshotChainStepSchema` (entity: `TracedEntityDto` without `state`; hop: `relationshipType`, `traversal`, `effectiveOrigin`, `effectiveConfidence`). `digestOf` fills `impact.slaCommitments`. `compareDigests` compares only the kinds present on both sides, in the `field` order above; exposure is compared per currency in currency order, one difference per currency whose `total` differs (`"31,400.00 USD"` style via 006's `formatMoneyText`); a currency present on one side only compares against `none`.

### §2b `packages/shared/src/investigations.ts`

```ts
export const INVESTIGATION_STATUSES = ['OPEN', 'RESOLVED', 'CLOSED'] as const;
export const INVESTIGATION_TRANSITION_ACTIONS = ['RESOLVE', 'CLOSE', 'REOPEN'] as const;
export const INVESTIGATION_TRANSITIONS = { /* research R4, verbatim */ } as const;
export const INVESTIGATION_STATUS_LABELS = { OPEN: 'Open', RESOLVED: 'Resolved', CLOSED: 'Closed' } as const;
export const INVESTIGATION_TRANSITION_LABELS = { RESOLVE: 'Resolve', CLOSE: 'Close', REOPEN: 'Reopen' } as const;
export const INVESTIGATION_VIEWS = ['OPEN', 'MINE', 'CRITICAL', 'SLA_RISK', 'RECURRING', 'ALL'] as const;
export const INVESTIGATION_SORTS = ['UPDATED', 'NEWEST', 'SEVERITY'] as const;
export const SCOPE_REASON_KINDS = ['FOCUS', 'ROOT_CAUSE_CHAIN', 'IMPACT_ANCHOR', 'EXCEPTION_SUBJECT', 'EXCEPTION_ROOT_CAUSE', 'ADDED'] as const;

export const INVESTIGATION_LIMITS = {
  titleMax: 200, descriptionMax: 4000, summaryMax: 2000, reasonMax: 500,
  statementMax: 500, rationaleMax: 4000, noteMax: 4000, citationsMax: 20,
  addedEntitiesMax: 40, linkedExceptionsMax: 20, scopeMax: 100,
  defaultDepth: 6, recurrenceWindowDays: 30,
} as const;

/** History change-list order (research R14). */
export const INVESTIGATION_FIELD_ORDER = [
  'title', 'description', 'severity', 'owner', 'status', 'resolutionSummary', 'resolvedAt', 'resolvedBy',
  'closedAt', 'closedBy', 'reopenCount', 'rootCause', 'impact',
] as const;

export function formatInvestigationNumber(n: number): string { return `INV-${n}`; }
export function suggestInvestigationTitle(entity: EntityRefDto): string;   // research R7
export function worstSlaStatus(statuses: readonly SlaStatus[]): 'BREACHED' | 'AT_RISK' | 'ON_TRACK' | null;
```

Request/response schemas: contracts/api.md.

### §2c Decision context (`DecisionContextSchema`, stored in `investigation_decisions.context`)

```ts
export const CitationInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SOURCE_RECORD'), sourceRecordId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('EVIDENCE_NOTE'), noteId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('EXCEPTION_EVIDENCE'), exceptionId: z.string().uuid(), evidenceId: z.string().uuid() }).strict(),
]);

export const FrozenCitationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SOURCE_RECORD'), origin: z.literal('SOURCE'),
    sourceRecordId: z.string().uuid(), recordKind: z.enum(['ENTITY', 'RELATIONSHIP', 'EVENT']),
    sourceSystem: z.string(), sourceId: z.string(), observedAt: z.string().datetime(),
    entity: EntityRefDtoSchema.nullable(),              // the record's entity, or the event's subject
    via: z.enum(['SCOPE_ENTITY', 'PINNED_KEY_EVIDENCE', 'SCOPE_EVENT']),
  }),
  z.object({
    kind: z.literal('EVIDENCE_NOTE'), origin: z.literal('MANUAL'),
    noteId: z.string().uuid(), stance: EvidenceNoteStanceSchema, text: z.string(), reference: z.string().nullable(),
    author: z.object({ id: z.string().uuid(), displayName: z.string() }), createdAt: z.string().datetime(),
    target: EvidenceNoteTargetSchema,
  }),
  z.object({
    kind: z.literal('EXCEPTION_EVIDENCE'), origin: z.enum(['SOURCE', 'MANUAL']),
    exceptionId: z.string().uuid(), exceptionKey: z.string(), evidenceId: z.string().uuid(),
    item: ExceptionEvidenceDtoSchema.shape.item,
    addedBy: z.object({ id: z.string().uuid(), displayName: z.string() }), createdAt: z.string().datetime(),
  }),
]);

export const DecisionContextSchema = z.object({
  capturedAt: z.string().datetime(),
  investigationVersion: z.number().int().min(1),
  focus: z.object({
    entity: EntityRefDtoSchema,
    observedAt: z.string().datetime().nullable(),       // of the current state observation
    sourceSystem: z.string().nullable(),
  }),
  rootCausePin: z.object({ id: z.string().uuid(), takenAt: z.string().datetime(), digest: SnapshotDigestRootCauseSchema.nullable() }).nullable(),
  impactPin: z.object({ id: z.string().uuid(), takenAt: z.string().datetime(), anchor: EntityRefDtoSchema, digest: SnapshotDigestImpactSchema }).nullable(),
  exceptions: z.array(z.object({
    id: z.string().uuid(), key: z.string(), title: z.string(),
    status: ExceptionStatusSchema, severity: ExceptionSeveritySchema,
    sla: z.object({ status: SlaStatusSchema, dueAt: z.string().datetime() }),
  })),                                                   // by number
  citations: z.array(FrozenCitationSchema).max(20),     // request order
});
```

`SnapshotDigestRootCauseSchema` / `SnapshotDigestImpactSchema` are zod forms of `SnapshotDigest['rootCause']` / `['impact']`, added to `analysis-snapshots.ts`.

---

## §3 Internal types and algorithms (`apps/api/src/investigations`)

### §3a Pure rule modules (`investigations/rules/`, no Nest, no Prisma client, no clock)

| File | Exports | Research |
|---|---|---|
| `transitions.ts` | `allowedInvestigationTransitionsFrom`, `applyInvestigationTransition` | R4 |
| `policy.ts` | `isOwner`, `isManager`, `isContributor`, `permissionsFor`, `canEdit`, `canChangeOwner`, `canPin`, `canChangeScope`, `canLinkExceptions`, `canDecide`, `canTransition` | R5 |
| `current-pin.ts` | `nextCurrentPin(pins: Array<{ id, seq, unpinned }>) → id \| null` | R6 |
| `scope.ts` | `computeScope(input) → ScopeEntry[]`, `involvesEntityWhere(entityId) → Prisma.InvestigationWhereInput` | R8 |
| `decision-context.ts` | `buildDecisionContext(rows, citations, now)`, `validateCitation(citation, scope, pinKeyEvidence, links) → issue \| null` | R10 |
| `recurrence.ts` | `labelEntitiesOf(occurrences)`, `recurringWhere(map)`, `recurrenceOf(pin, map)` | R12 |
| `list-query.ts` | `buildInvestigationWhere(query, ctx)`, `orderByFor(sort)`, `investigationKeysetWhere(sort, key)`, `sortKeyOf(row, sort)` | R12 |
| `history.ts` | `investigationHistorySentence`, `toHistoryEntry(auditRow, names)` | R14 |
| `diff.ts` | `diffFields(before: InvestigationCore, after: InvestigationCore)` (changed fields only, `INVESTIGATION_FIELD_ORDER`) | R14 |

`list-query.ts` and `scope.ts` import Prisma **types only**.

### §3b `ScopeEntry`

```ts
interface ScopeReason {
  kind: ScopeReasonKind;
  roles?: CausalRole[];                       // ROOT_CAUSE_CHAIN
  anchorRole?: 'ROOT_CAUSE' | 'SUBJECT';      // IMPACT_ANCHOR
  exception?: { id: string; key: string };    // EXCEPTION_*
  addedBy?: { id: string | null; displayName: string }; addedAt?: string;   // ADDED (null id = System)
}
interface ScopeEntry { entityId: string; reasons: ScopeReason[] }   // reasons in research R8 order
```

### §3c Actor

Per request from `CurrentUser`: `{ id, role }`. The seed's system actor is `{ id: null, role: 'ADMIN', system: true }`; it bypasses the policy and writes `actorType: 'system'`.

---

## §4 Service algorithms

All mutating methods follow research R5's check order and return `InvestigationDetailResponse` (except decisions and notes, which return their DTO). `now` is read once per request.

| Service / method | Steps inside the transaction (after checks) | Audit action | Version |
|---|---|---|---|
| `InvestigationsService.create` | insert investigation; pins (R6) if `pin`; set current pins | `investigation.created` | starts at 1 |
| `update` | conditional update of edited fields (title, description, severity, ownerId) | `investigation.updated` (diff; owner as `{ id, name }`) | +1 |
| `transition` | `applyInvestigationTransition`; CLOSE counts unresolved linked exceptions first | `investigation.status_changed` (`metadata: { transition, note }`) | +1 |
| `PinsService.pin` | insert pins; set current pins and `slaCommitmentsAtRisk` | `investigation.pinned` | +1 |
| `PinsService.unpin` | insert unpin; recompute current pin of its kind; no-op if already unpinned | `investigation.unpinned` | +1 |
| `ScopeService.addEntity` / `removeEntity` | insert / delete `investigation_entities`; touch `lastActivityAt` | `investigation.entity_added` / `entity_removed` | — |
| `ScopeService.linkException` / `unlinkException` | insert / delete `investigation_exceptions`; touch | `investigation.exception_linked` / `exception_unlinked` | — |
| `DecisionsService.record` | check version (no bump); validate citations; build context; insert; touch | `investigation.decision_recorded` | checked, not bumped |
| `NotesService.add` | insert note; touch | `investigation.note_added` | — |

`InvestigationCore` (the audited shape) is `InvestigationDto` without `focus`, `version` and counters that are not fields, with users as `{ id, name }`.

Snapshot rows are inserted with `SnapshotService.rowData(taken, { investigationId }, actor.id, now)` (research R2), which sets `rootCauseEntityId`, `rootCauseLabel` and `chainEntityIds`.

---

## §5 Queries

### §5a List `where` (`buildInvestigationWhere`)

```text
view:
  ALL       → {}
  OPEN      → status = OPEN
  MINE      → ownerId = caller ∧ status ≠ CLOSED
  CRITICAL  → severity = CRITICAL ∧ status ≠ CLOSED
  SLA_RISK  → status = OPEN ∧ (slaCommitmentsAtRisk > 0
                ∨ exceptionLinks some { exception: { status ∈ UNRESOLVED_STATUSES ∧ slaAtRiskAt ≤ T } })
  RECURRING → recurringWhere(labelEntities(T))        (research R12)
filters (AND):
  status[], severity[] → in
  owner: ME → ownerId = caller; USER:<id> → ownerId = id
  entityId → involvesEntityWhere(entityId)             (research R8)
  focusEntityId → focusEntityId = id
  q → number = n (matches ^(INV-)?\d+$, case-insensitive) | title contains q (insensitive)
```

### §5b Detail

1 `findUnique` with `focusEntity`, `owner`, `createdBy`, `resolvedBy`, `closedBy`, `currentRootCausePin` (+ `takenBy`), `currentImpactPin` (+ `takenBy`, `anchorEntity`); 1 `findMany` of added entities with entities and adders; 1 `findMany` of exception links with 007 summary includes; 1 `entity.findMany` for the scope's entity refs; 4 counts (pins, decisions, notes, unpinned pins). No analysis is run.

### §5c Timeline

`TimelineService.listForEntities(scopeIds, filters, page)` (research R9): 2 `findMany` (events, states) with `take = limit + 1`, merged in memory.

---

## §6 Entities (spec Key Entities → this model)

| Spec entity | Where |
|---|---|
| Investigation | `investigations` (stored), `InvestigationDto`, `InvestigationSummaryDto`, `InvestigationDetailResponse` |
| Pin | `analysis_snapshots` with `investigation_id` (stored, append-only), `PinDto` |
| Unpin | `investigation_unpins` (stored, append-only), `PinDto.unpin` |
| Added Entity | `investigation_entities` (stored) |
| Exception Link | `investigation_exceptions` (stored), `LinkedExceptionDto` |
| Scope Entity | computed by `computeScope`, `ScopeEntityDto` |
| Decision | `investigation_decisions` (stored, append-only), `DecisionDto` |
| Note | `investigation_notes` (stored, append-only), `InvestigationNoteDto` |
| History Entry | `audit_entries` rows (existing), `InvestigationHistoryEntryDto` (computed) |
