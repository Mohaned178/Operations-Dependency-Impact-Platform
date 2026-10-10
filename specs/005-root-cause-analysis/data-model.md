# Data Model: Root-Cause Analysis

**Feature**: `005-root-cause-analysis` | **Date**: 2026-10-06

This feature stores exactly one new kind of data: **evidence notes** and their **retractions**. The analysis itself is computed on demand and never stored (spec FR-005). Response schemas are in [contracts/api.md](./contracts/api.md).

---

## 1. Storage (Prisma + migration `<timestamp>_evidence_notes`)

### 1a. Prisma schema additions (`apps/api/prisma/schema.prisma`)

```prisma
enum EvidenceNoteStance {
  SUPPORTS
  DISPUTES
  CONTEXT
}

model EvidenceNote {
  id             String             @id @default(uuid()) @db.Uuid
  entityId       String?            @map("entity_id") @db.Uuid
  relationshipId String?            @map("relationship_id") @db.Uuid
  stance         EvidenceNoteStance
  text           String
  reference      String?
  authorId       String             @map("author_id") @db.Uuid
  createdAt      DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)

  entity       Entity?                  @relation(fields: [entityId], references: [id], onDelete: Restrict)
  relationship Relationship?            @relation(fields: [relationshipId], references: [id], onDelete: Restrict)
  author       User                     @relation("EvidenceNoteAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  retraction   EvidenceNoteRetraction?

  @@index([entityId, createdAt(sort: Desc), id(sort: Desc)])
  @@index([relationshipId, createdAt(sort: Desc), id(sort: Desc)])
  @@map("evidence_notes")
}

model EvidenceNoteRetraction {
  noteId        String   @id @map("note_id") @db.Uuid
  retractedById String   @map("retracted_by_id") @db.Uuid
  reason        String
  retractedAt   DateTime @default(now()) @map("retracted_at") @db.Timestamptz(6)

  note        EvidenceNote @relation(fields: [noteId], references: [id], onDelete: Restrict)
  retractedBy User         @relation("EvidenceNoteRetractor", fields: [retractedById], references: [id], onDelete: Restrict)

  @@map("evidence_note_retractions")
}
```

Add the back-relations:
- `Entity.evidenceNotes EvidenceNote[]`
- `Relationship.evidenceNotes EvidenceNote[]`
- `User.evidenceNotes EvidenceNote[] @relation("EvidenceNoteAuthor")`
- `User.evidenceNoteRetractions EvidenceNoteRetraction[] @relation("EvidenceNoteRetractor")`

### 1b. Hand-written SQL appended to the generated migration (research R9)

```sql
ALTER TABLE evidence_notes
  ADD CONSTRAINT evidence_notes_one_target CHECK (num_nonnulls(entity_id, relationship_id) = 1),
  ADD CONSTRAINT evidence_notes_text_length CHECK (char_length(text) BETWEEN 1 AND 2000),
  ADD CONSTRAINT evidence_notes_reference_length
    CHECK (reference IS NULL OR char_length(reference) BETWEEN 1 AND 500);

ALTER TABLE evidence_note_retractions
  ADD CONSTRAINT evidence_note_retractions_reason_length CHECK (char_length(reason) BETWEEN 1 AND 500);

CREATE TRIGGER evidence_notes_append_only
BEFORE UPDATE OR DELETE ON evidence_notes
FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER evidence_notes_append_only_truncate
BEFORE TRUNCATE ON evidence_notes
FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER evidence_note_retractions_append_only
BEFORE UPDATE OR DELETE ON evidence_note_retractions
FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER evidence_note_retractions_append_only_truncate
BEFORE TRUNCATE ON evidence_note_retractions
FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
```

`forbid_provenance_mutation()` already exists (migration `20261005163949_provenance_append_only`). Do not redefine it.

**`apps/api/test/helpers.ts → resetDb`**:
- add `evidence_notes` and `evidence_note_retractions` to the `DISABLE TRIGGER USER` / `ENABLE TRIGGER USER` pairs;
- add both tables to the `TRUNCATE` list, before `users`.

### 1c. Validation rules (enforced twice: zod in `packages/shared`, CHECKs in the database)

| Field | Rule |
|---|---|
| `text` | trimmed; 1 to 2,000 characters |
| `reference` | trimmed; empty means absent (`null`); otherwise 1 to 500 characters |
| `stance` | `SUPPORTS` \| `DISPUTES` \| `CONTEXT` |
| target | exactly one of an entity or a relationship; it must exist (otherwise 400, research R10) |
| retraction `reason` | trimmed; 1 to 500 characters |
| retraction | at most one per note (PK). Allowed only for the author or an `ADMIN`. |

**Lifecycle**: `ACTIVE`, then `RETRACTED`. This is the only transition. A note is **active** if and only if it has no retraction row. Notes never change any entity, state, relationship, event or source record (FR-026).

---

## 2. Shared constants and types (`packages/shared/src/root-cause.ts`, `evidence-notes.ts`)

```ts
export const CAUSAL_ROLES = ['SYMPTOM', 'IMMEDIATE_BLOCKER', 'UPSTREAM_CAUSE', 'ROOT_CAUSE'] as const;
export const CausalRoleSchema = z.enum(CAUSAL_ROLES);

export const CONFIDENCE_RULES = [
  'WEAKEST_LINK', 'UNKNOWN_STATE', 'CYCLE', 'SEARCH_LIMIT',
  'STALE_EVIDENCE', 'CLASSIFICATION_DISAGREEMENT', 'UNCORROBORATED', 'DISPUTED',
] as const;                                   // evaluation order (research R6)
export const ConfidenceRuleSchema = z.enum(CONFIDENCE_RULES);

export const LabelRuleSchema = z.enum(['REQUIRED_FIELD', 'DISPLAY_NAME_STATE']);
export const EvidenceRuleSchema = z.enum([
  'STATE_RECORD', 'RELATIONSHIP_RECORD', 'REQUIREMENT_SOURCE', 'EVENT', 'MANUAL_NOTE',
]);
export const RootCauseStatusSchema = z.enum(['ROOT_CAUSES_FOUND', 'NOT_BLOCKED', 'UNEXPLAINED']);

export const ROOT_CAUSE_LIMITS = {
  staleAfterMs: 72 * 60 * 60 * 1000,          // FR-017 rule 5 (clarification Q2)
  eventsPerEntity: 20,                          // spec Edge Cases
  requirementSourcesPerEntity: 20,
  notesPerTarget: 50,
} as const;

export const REQUIREMENT_SOURCE_RELATIONSHIP_TYPES = ['DEFINES', 'GOVERNS'] as const;

// evidence-notes.ts
export const EvidenceNoteStanceSchema = z.enum(['SUPPORTS', 'DISPUTES', 'CONTEXT']);
export const EVIDENCE_NOTE_LIMITS = { textMax: 2000, referenceMax: 500, reasonMax: 500 } as const;
```

Add these entries to `AUDIT_ACTIONS` in `packages/shared/src/audit.ts`:

```ts
EVIDENCE_NOTE_CREATED: 'evidence_note.created',
EVIDENCE_NOTE_RETRACTED: 'evidence_note.retracted',
```

---

## 3. Internal types

### 3a. `GraphRepository` addition (`apps/api/src/graph/graph.repository.ts`)

```ts
export interface IncomingRelationshipRow {
  relationship: NeighborRelationship;   // direction is always 'IN'
  /** The relationship's `to` end: one of the requested entity ids. */
  targetEntityId: string;
  /** The `from` end, with its attributes (needed for requirement-source evidence). */
  source: GraphEntityRef & { attributes: Record<string, JsonValue> };
}

export interface GraphRepository {
  // …existing methods…
  /**
   * One hop, no recursion: every relationship of the given types whose `to` end is in entityIds.
   * Returns [] for an empty id list without querying.
   */
  findIncomingRelationships(
    entityIds: readonly string[],
    types: readonly RelationshipType[],
  ): Promise<IncomingRelationshipRow[]>;
}
```

`PrismaGraphRepository` implements it with a single `prisma.relationship.findMany`:
- `where: { toEntityId: { in }, type: { in } }`;
- `include: { from: true }`.

Results are sorted in TypeScript by `(targetEntityId, type, source.displayName, source.id, relationship.id)` with `compareCodeUnits`. It contains no recursive SQL.

### 3b. Evidence bundle (`apps/api/src/root-cause/evidence.reader.ts`)

```ts
export interface EvidenceRequest {
  entityIds: readonly string[];         // every chain entity, start included, de-duplicated
  relationshipIds: readonly string[];   // every assertion id on every chain hop
  rootCauseEntityIds: readonly string[];// for attributes (label rule)
}

export interface EvidenceBundle {
  entities: Map<string, EntityEvidenceDto>;        // contracts/api.md
  relationships: Map<string, RelationshipEvidenceDto>;
  attributes: Map<string, Record<string, JsonValue>>;   // root-cause entities only
}
```

`EntityEvidenceDto.stateRecords` lists the current state record first, then the latest record from each other source system, ordered by `sourceSystem`. The number of distinct `sourceSystem` values in `stateRecords` is the source count that rule 7 uses.

### 3c. Pure analysis inputs (`apps/api/src/root-cause/analysis/types.ts`)

```ts
export interface ConfidenceInput {
  chain: BlockingPathDto;                // primary chain (003 DTO)
  start: TracedEntityDto;
  deepest: BlockerDto;                   // from BlockersResponse.deepestBlockers
  truncation: TruncationDto;
  evaluatedAt: Date;
  /** Evidence for every entity on the chain, start included. */
  entityEvidence: ReadonlyMap<string, EntityEvidenceDto>;
  relationshipEvidence: ReadonlyMap<string, RelationshipEvidenceDto>;
}

export interface ConfidenceResult {
  confidence: Confidence;
  outcomes: ConfidenceRuleOutcomeDto[];  // always 8, in CONFIDENCE_RULES order
}
```

Every pure module imports only `@opsgraph/shared` types and `compareCodeUnits`. They import no Nest, no Prisma and no `Date.now()`.

---

## 4. Mapping (in `RootCauseService`)

1. `computedAt = new Date()`. `evaluatedAt = query.evaluatedAt ? new Date(query.evaluatedAt) : computedAt`.
2. `blockers = await tracing.blockers(id, { depth, relationshipTypes: [], entityTypes: [] })`. A 404 propagates.
3. **No paths**:
   - start classification `SATISFIED`: status `NOT_BLOCKED`;
   - otherwise: status `UNEXPLAINED`, and load evidence for the start entity only (FR-019).
4. **Paths exist**:
   1. `groups = groupCandidates(blockers.paths)` (research R3);
   2. load the `EvidenceBundle` for every entity and every assertion id on every path;
   3. per group:
      - `label`;
      - `computeConfidence`;
      - `assignRoles` for the primary and each alternative chain;
      - `keyEvidence`;
      - `explanation` (sentences re-generated HEDGED when the confidence is LOW);
   4. `orderCandidates`.
5. `summary = summarizeRootCause(start, status, candidates, depth)`.
6. Assemble `evidence.entities` and `evidence.relationships` as arrays, in order of first appearance:
   1. the start entity;
   2. then each candidate in order: primary chain, then alternatives, hop by hop;
   3. for relationships, assertion ids in ascending code-unit order within a hop.

---

## 5. Entities (spec Key Entities → this model)

| Spec entity | Where |
|---|---|
| Root-Cause Analysis | `RootCauseResponse` (computed) |
| Root-Cause Candidate | `RootCauseCandidateDto` (computed) |
| Causal Step | `CausalStepDto` (computed) |
| Evidence Item | `EvidenceSourceRecordDto`, `RequirementSourceDto`, `EventEvidenceDto`, `EvidenceNoteDto` |
| Confidence Rule Outcome | `ConfidenceRuleOutcomeDto` (computed) |
| Evidence Note | `evidence_notes` + `evidence_note_retractions` (stored), `EvidenceNoteDto` |
