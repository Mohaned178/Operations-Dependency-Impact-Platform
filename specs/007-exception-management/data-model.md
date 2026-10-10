# Data Model: Exception Management and Ownership

**Feature**: `007-exception-management` | **Date**: 2026-10-07

This feature stores **exceptions** and everything attached to them, **teams**, and **notifications**. History is not stored separately: it is the audit trail (research R11). Response schemas are in [contracts/api.md](./contracts/api.md). The reasons for every decision are in [research.md](./research.md).

---

## §1 Storage (Prisma + migration `<timestamp>_exceptions_teams_notifications`)

### §1a Prisma schema additions (`apps/api/prisma/schema.prisma`)

```prisma
enum ExceptionType {
  BLOCKED_ORDER
  FAILED_PAYMENT
  SHIPMENT_DELAY
  MISSING_APPROVAL
  DATA_INCONSISTENCY
  SLA_RISK
}

/// Declaration order is the sort order (research R14): CRITICAL sorts first.
enum ExceptionSeverity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}

enum ExceptionPriority {
  P1
  P2
  P3
  P4
}

enum ExceptionStatus {
  OPEN
  IN_PROGRESS
  WAITING
  RESOLVED
  VERIFIED
  CLOSED
  REOPENED
}

enum ExceptionCreatedFrom {
  EXCEPTIONS_AREA
  ENTITY
  ROOT_CAUSE
  SEED
}

enum SlaOutcome {
  MET
  MISSED
}

enum ExceptionEntityRole {
  SUBJECT
  ROOT_CAUSE
  RELATED
}

enum ExceptionSnapshotKind {
  ROOT_CAUSE
  IMPACT
}

enum ExceptionEvidenceKind {
  SOURCE_RECORD
  NOTE
}

enum NotificationKind {
  ASSIGNED
  ESCALATED
}

model Team {
  id          String   @id @default(uuid()) @db.Uuid
  name        String
  description String?
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  members         TeamMember[]
  ownedExceptions Exception[]  @relation("ExceptionOwnerTeam")

  @@map("teams")
}

model TeamMember {
  teamId    String   @map("team_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  addedAt   DateTime @default(now()) @map("added_at") @db.Timestamptz(6)
  addedById String?  @map("added_by_id") @db.Uuid          // null = system (seed)

  team    Team  @relation(fields: [teamId], references: [id], onDelete: Restrict)
  user    User  @relation("TeamMemberUser", fields: [userId], references: [id], onDelete: Restrict)
  addedBy User? @relation("TeamMemberAddedBy", fields: [addedById], references: [id], onDelete: Restrict)

  @@id([teamId, userId])
  @@index([userId])
  @@map("team_members")
}

model Exception {
  id               String               @id @default(uuid()) @db.Uuid
  number           Int                  @unique @default(autoincrement())
  title            String
  description      String?
  type             ExceptionType
  severity         ExceptionSeverity
  priority         ExceptionPriority
  status           ExceptionStatus      @default(OPEN)
  ownerUserId      String?              @map("owner_user_id") @db.Uuid
  ownerTeamId      String?              @map("owner_team_id") @db.Uuid
  subjectEntityId  String               @map("subject_entity_id") @db.Uuid
  slaDueAt         DateTime             @map("sla_due_at") @db.Timestamptz(6)
  slaAtRiskAt      DateTime             @map("sla_at_risk_at") @db.Timestamptz(6)    // research R7
  slaOutcome       SlaOutcome?          @map("sla_outcome")
  createdFrom      ExceptionCreatedFrom @map("created_from")
  createdById      String?              @map("created_by_id") @db.Uuid               // null = system
  createdAt        DateTime             @map("created_at") @db.Timestamptz(6)        // set by the service
  lastActivityAt   DateTime             @map("last_activity_at") @db.Timestamptz(6)
  waitingReason    String?              @map("waiting_reason")
  resolvedAt       DateTime?            @map("resolved_at") @db.Timestamptz(6)
  resolvedById     String?              @map("resolved_by_id") @db.Uuid
  resolutionNote   String?              @map("resolution_note")
  verifiedAt       DateTime?            @map("verified_at") @db.Timestamptz(6)
  verifiedById     String?              @map("verified_by_id") @db.Uuid
  verificationNote String?              @map("verification_note")
  closedAt         DateTime?            @map("closed_at") @db.Timestamptz(6)
  closedById       String?              @map("closed_by_id") @db.Uuid
  escalationCount  Int                  @default(0) @map("escalation_count")
  reopenCount      Int                  @default(0) @map("reopen_count")
  version          Int                  @default(1)

  ownerUser     User?   @relation("ExceptionOwnerUser", fields: [ownerUserId], references: [id], onDelete: Restrict)
  ownerTeam     Team?   @relation("ExceptionOwnerTeam", fields: [ownerTeamId], references: [id], onDelete: Restrict)
  subjectEntity Entity  @relation("ExceptionSubject", fields: [subjectEntityId], references: [id], onDelete: Restrict)
  createdBy     User?   @relation("ExceptionCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  resolvedBy    User?   @relation("ExceptionResolvedBy", fields: [resolvedById], references: [id], onDelete: Restrict)
  verifiedBy    User?   @relation("ExceptionVerifiedBy", fields: [verifiedById], references: [id], onDelete: Restrict)
  closedBy      User?   @relation("ExceptionClosedBy", fields: [closedById], references: [id], onDelete: Restrict)

  links         ExceptionEntity[]
  snapshots     ExceptionSnapshot[]
  comments      ExceptionComment[]
  evidence      ExceptionEvidence[]
  notifications Notification[]

  @@index([status, slaDueAt, number])
  @@index([ownerUserId, status])
  @@index([ownerTeamId, status])
  @@index([severity, slaDueAt])
  @@index([priority, slaDueAt])
  @@index([createdAt(sort: Desc), number(sort: Desc)])
  @@index([lastActivityAt(sort: Desc), number(sort: Desc)])
  @@index([slaAtRiskAt])
  @@index([subjectEntityId])
  @@map("exceptions")
}

model ExceptionEntity {
  exceptionId String              @map("exception_id") @db.Uuid
  entityId    String              @map("entity_id") @db.Uuid
  role        ExceptionEntityRole
  linkedById  String?             @map("linked_by_id") @db.Uuid    // null = system (creation, refresh, seed)
  linkedAt    DateTime            @map("linked_at") @db.Timestamptz(6)

  exception Exception @relation(fields: [exceptionId], references: [id], onDelete: Restrict)
  entity    Entity    @relation("ExceptionLinkEntity", fields: [entityId], references: [id], onDelete: Restrict)
  linkedBy  User?     @relation("ExceptionLinkedBy", fields: [linkedById], references: [id], onDelete: Restrict)

  @@id([exceptionId, entityId])
  @@index([entityId, role])
  @@map("exception_entities")
}

model ExceptionSnapshot {
  id             String                @id @default(uuid()) @db.Uuid
  seq            BigInt                @unique @default(autoincrement())
  exceptionId    String                @map("exception_id") @db.Uuid
  kind           ExceptionSnapshotKind
  anchorEntityId String                @map("anchor_entity_id") @db.Uuid  // ROOT_CAUSE: subject; IMPACT: anchor
  takenAt        DateTime              @map("taken_at") @db.Timestamptz(6)
  takenById      String?               @map("taken_by_id") @db.Uuid       // null = system
  payload        Json                                                      // §2b, validated on write and read

  exception    Exception @relation(fields: [exceptionId], references: [id], onDelete: Restrict)
  anchorEntity Entity    @relation("ExceptionSnapshotAnchor", fields: [anchorEntityId], references: [id], onDelete: Restrict)
  takenBy      User?     @relation("ExceptionSnapshotTakenBy", fields: [takenById], references: [id], onDelete: Restrict)

  @@index([exceptionId, kind, seq(sort: Desc)])
  @@map("exception_snapshots")
}

model ExceptionComment {
  id          String   @id @default(uuid()) @db.Uuid
  seq         BigInt   @unique @default(autoincrement())
  exceptionId String   @map("exception_id") @db.Uuid
  authorId    String   @map("author_id") @db.Uuid
  text        String
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  exception Exception @relation(fields: [exceptionId], references: [id], onDelete: Restrict)
  author    User      @relation("ExceptionCommentAuthor", fields: [authorId], references: [id], onDelete: Restrict)

  @@index([exceptionId, seq])
  @@map("exception_comments")
}

model ExceptionEvidence {
  id             String                @id @default(uuid()) @db.Uuid
  seq            BigInt                @unique @default(autoincrement())
  exceptionId    String                @map("exception_id") @db.Uuid
  kind           ExceptionEvidenceKind
  sourceRecordId String?               @map("source_record_id") @db.Uuid
  text           String?
  reference      String?
  addedById      String                @map("added_by_id") @db.Uuid
  createdAt      DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)

  exception    Exception                     @relation(fields: [exceptionId], references: [id], onDelete: Restrict)
  sourceRecord SourceRecord?                 @relation("ExceptionEvidenceRecord", fields: [sourceRecordId], references: [id], onDelete: Restrict)
  addedBy      User                          @relation("ExceptionEvidenceAddedBy", fields: [addedById], references: [id], onDelete: Restrict)
  detachment   ExceptionEvidenceDetachment?

  @@index([exceptionId, seq])
  @@map("exception_evidence")
}

model ExceptionEvidenceDetachment {
  evidenceId   String   @id @map("evidence_id") @db.Uuid
  detachedById String   @map("detached_by_id") @db.Uuid
  reason       String
  detachedAt   DateTime @default(now()) @map("detached_at") @db.Timestamptz(6)

  evidence   ExceptionEvidence @relation(fields: [evidenceId], references: [id], onDelete: Restrict)
  detachedBy User              @relation("ExceptionEvidenceDetachedBy", fields: [detachedById], references: [id], onDelete: Restrict)

  @@map("exception_evidence_detachments")
}

model Notification {
  id          String           @id @default(uuid()) @db.Uuid
  recipientId String           @map("recipient_id") @db.Uuid
  kind        NotificationKind
  exceptionId String           @map("exception_id") @db.Uuid
  actorId     String?          @map("actor_id") @db.Uuid            // null = system
  message     String
  createdAt   DateTime         @map("created_at") @db.Timestamptz(6)  // = the action's `now`
  readAt      DateTime?        @map("read_at") @db.Timestamptz(6)

  recipient User      @relation("NotificationRecipient", fields: [recipientId], references: [id], onDelete: Restrict)
  actor     User?     @relation("NotificationActor", fields: [actorId], references: [id], onDelete: Restrict)
  exception Exception @relation(fields: [exceptionId], references: [id], onDelete: Restrict)

  @@index([recipientId, createdAt(sort: Desc), id(sort: Desc)])
  @@map("notifications")
}
```

Back-relations to add:
- **`User`**: `teamMemberships TeamMember[] @relation("TeamMemberUser")`, `teamMembersAdded TeamMember[] @relation("TeamMemberAddedBy")`, `ownedExceptions`, `createdExceptions`, `resolvedExceptions`, `verifiedExceptions`, `closedExceptions`, `exceptionLinks`, `exceptionSnapshots`, `exceptionComments`, `exceptionEvidenceAdded`, `exceptionEvidenceDetached`, `notifications @relation("NotificationRecipient")`, `notificationsActed @relation("NotificationActor")`, each with its relation name above.
- **`Entity`**: `exceptionsAsSubject Exception[] @relation("ExceptionSubject")`, `exceptionLinks ExceptionEntity[] @relation("ExceptionLinkEntity")`, `exceptionSnapshots ExceptionSnapshot[] @relation("ExceptionSnapshotAnchor")`.
- **`SourceRecord`**: `exceptionEvidence ExceptionEvidence[] @relation("ExceptionEvidenceRecord")`.

### §1b Hand-written SQL appended to the generated migration

```sql
-- Numbers start at 10001 (research R3)
ALTER SEQUENCE exceptions_number_seq RESTART WITH 10001;

-- Team names unique ignoring case (research R13)
CREATE UNIQUE INDEX teams_name_lower_key ON teams (lower(name));
ALTER TABLE teams
  ADD CONSTRAINT teams_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
  ADD CONSTRAINT teams_description_length CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 500);

-- Exceptions
ALTER TABLE exceptions
  ADD CONSTRAINT exceptions_one_owner CHECK (num_nonnulls(owner_user_id, owner_team_id) <= 1),
  ADD CONSTRAINT exceptions_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  ADD CONSTRAINT exceptions_description_length CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 4000),
  ADD CONSTRAINT exceptions_sla_order CHECK (sla_at_risk_at <= sla_due_at),
  ADD CONSTRAINT exceptions_waiting CHECK ((status = 'WAITING') = (waiting_reason IS NOT NULL)),
  ADD CONSTRAINT exceptions_resolved CHECK (
    (status IN ('RESOLVED','VERIFIED','CLOSED'))
      = (resolved_at IS NOT NULL AND resolution_note IS NOT NULL AND sla_outcome IS NOT NULL)),
  ADD CONSTRAINT exceptions_verified CHECK ((status IN ('VERIFIED','CLOSED')) = (verified_at IS NOT NULL)),
  ADD CONSTRAINT exceptions_closed CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  ADD CONSTRAINT exceptions_counts CHECK (escalation_count >= 0 AND reopen_count >= 0 AND version >= 1);

-- One subject and at most one root cause per exception
CREATE UNIQUE INDEX exception_entities_one_subject ON exception_entities (exception_id) WHERE role = 'SUBJECT';
CREATE UNIQUE INDEX exception_entities_one_root_cause ON exception_entities (exception_id) WHERE role = 'ROOT_CAUSE';

-- Comments and evidence
ALTER TABLE exception_comments
  ADD CONSTRAINT exception_comments_text_length CHECK (char_length(text) BETWEEN 1 AND 4000);
ALTER TABLE exception_evidence
  ADD CONSTRAINT exception_evidence_kind_shape CHECK (
    (kind = 'SOURCE_RECORD' AND source_record_id IS NOT NULL AND text IS NULL AND reference IS NULL)
    OR (kind = 'NOTE' AND source_record_id IS NULL AND text IS NOT NULL)),
  ADD CONSTRAINT exception_evidence_text_length CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 2000),
  ADD CONSTRAINT exception_evidence_reference_length CHECK (reference IS NULL OR char_length(reference) BETWEEN 1 AND 500);
ALTER TABLE exception_evidence_detachments
  ADD CONSTRAINT exception_evidence_detachments_reason_length CHECK (char_length(reason) BETWEEN 1 AND 500);

-- Unread notifications (research R18)
CREATE INDEX notifications_unread ON notifications (recipient_id) WHERE read_at IS NULL;

-- Append-only tables (research R2); forbid_provenance_mutation() already exists, do not redefine it
CREATE TRIGGER exception_snapshots_append_only BEFORE UPDATE OR DELETE ON exception_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER exception_snapshots_append_only_truncate BEFORE TRUNCATE ON exception_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER exception_comments_append_only BEFORE UPDATE OR DELETE ON exception_comments
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER exception_comments_append_only_truncate BEFORE TRUNCATE ON exception_comments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER exception_evidence_append_only BEFORE UPDATE OR DELETE ON exception_evidence
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER exception_evidence_append_only_truncate BEFORE TRUNCATE ON exception_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER exception_evidence_detachments_append_only BEFORE UPDATE OR DELETE ON exception_evidence_detachments
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER exception_evidence_detachments_append_only_truncate BEFORE TRUNCATE ON exception_evidence_detachments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
```

Check the generated sequence name before appending (`\d exceptions` after `--create-only`); Prisma names it `exceptions_number_seq`.

**`apps/api/test/helpers.ts → resetDb`**:
- `DISABLE TRIGGER USER` / `ENABLE TRIGGER USER` on `exception_snapshots`, `exception_comments`, `exception_evidence` and `exception_evidence_detachments`;
- add `teams, team_members, exceptions, exception_entities, exception_snapshots, exception_comments, exception_evidence, exception_evidence_detachments, notifications` to the `TRUNCATE` list, before `users`.

### §1c Validation rules (zod in `packages/shared` and CHECKs in the database)

| Field | Rule |
|---|---|
| `title` | trimmed; 1 to 200 characters |
| `description` | trimmed; empty means absent (`null`); otherwise 1 to 4,000 |
| `type`, `severity`, `priority` | enums above |
| `owner` | `{ kind: 'USER', userId }` (ACTIVE user) or `{ kind: 'TEAM', teamId }` (existing team), or `null` |
| `slaDueAt` | ISO-8601 UTC; after `createdAt` on create (400 otherwise); may be in the past on edit (spec Edge Cases) |
| `waitingReason`, `reopenReason`, escalation `reason`, detach `reason` | trimmed; 1 to 500 |
| `resolutionNote` | trimmed; 1 to 2,000 |
| `verificationNote` | trimmed; empty means absent; otherwise 1 to 2,000 |
| comment `text` | trimmed; 1 to 4,000 |
| evidence note `text` / `reference` | trimmed; 1 to 2,000 / empty means absent, otherwise 1 to 500 |
| team `name` / `description` | trimmed; 1 to 100, unique ignoring case / empty means absent, otherwise 1 to 500 |
| `expectedVersion` | integer ≥ 1 |
| linked entities | ≤ 50 per exception (SUBJECT, ROOT_CAUSE and RELATED together) |
| active evidence | ≤ 100 per exception (attached and not detached) |

---

## §2 Shared constants and snapshot payloads (`packages/shared/src/exceptions.ts`)

### §2a Constants

```ts
export const EXCEPTION_TYPES = ['BLOCKED_ORDER','FAILED_PAYMENT','SHIPMENT_DELAY','MISSING_APPROVAL','DATA_INCONSISTENCY','SLA_RISK'] as const;
export const EXCEPTION_SEVERITIES = ['CRITICAL','HIGH','MEDIUM','LOW'] as const;           // rank = index
export const EXCEPTION_PRIORITIES = ['P1','P2','P3','P4'] as const;                         // rank = index
export const EXCEPTION_STATUSES = ['OPEN','IN_PROGRESS','WAITING','RESOLVED','VERIFIED','CLOSED','REOPENED'] as const;
export const UNRESOLVED_STATUSES = ['OPEN','IN_PROGRESS','WAITING','REOPENED'] as const;
export const EXCEPTION_TRANSITION_ACTIONS = ['START','WAIT','RESUME','RESOLVE','VERIFY','CLOSE','REOPEN'] as const;
export const SLA_STATUSES = ['ON_TRACK','AT_RISK','BREACHED','MET','MISSED'] as const;

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  BLOCKED_ORDER: 'Blocked order', FAILED_PAYMENT: 'Failed payment', SHIPMENT_DELAY: 'Shipment delay',
  MISSING_APPROVAL: 'Missing approval', DATA_INCONSISTENCY: 'Data inconsistency', SLA_RISK: 'SLA risk',
};
export const SEVERITY_LABELS = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' } as const;
export const STATUS_LABELS = { OPEN: 'Open', IN_PROGRESS: 'In progress', WAITING: 'Waiting', RESOLVED: 'Resolved',
  VERIFIED: 'Verified', CLOSED: 'Closed', REOPENED: 'Reopened' } as const;
export const TRANSITION_LABELS = { START: 'Start work', WAIT: 'Wait', RESUME: 'Resume', RESOLVE: 'Resolve',
  VERIFY: 'Verify', CLOSE: 'Close', REOPEN: 'Reopen' } as const;

export const DEFAULT_PRIORITY: Record<ExceptionSeverity, ExceptionPriority> = { CRITICAL: 'P1', HIGH: 'P2', MEDIUM: 'P3', LOW: 'P4' };
const HOUR = 60 * 60 * 1000;
export const SLA_WINDOW_MS: Record<ExceptionSeverity, number> = { CRITICAL: 4 * HOUR, HIGH: 24 * HOUR, MEDIUM: 72 * HOUR, LOW: 168 * HOUR };

export const EXCEPTION_TRANSITIONS = { /* research R4, verbatim */ } as const;

/** Spec FR-006. First matching row wins; no match → type null. */
export const EXCEPTION_TYPE_SUGGESTIONS: ReadonlyArray<{
  entityTypes: readonly EntityType[]; states: readonly OperationalState[]; type: ExceptionType;
}> = [
  { entityTypes: ['Order'], states: ['BLOCKED', 'WAITING', 'PENDING'], type: 'BLOCKED_ORDER' },
  { entityTypes: ['Payment'], states: ['FAILED'], type: 'FAILED_PAYMENT' },
  { entityTypes: ['Shipment'], states: ['DELAYED', 'BLOCKED', 'WAITING'], type: 'SHIPMENT_DELAY' },
  { entityTypes: ['Approval', 'BudgetRequirement'], states: ['MISSING', 'BLOCKED', 'PENDING'], type: 'MISSING_APPROVAL' },
  { entityTypes: ['SLA'], states: ['AT_RISK'], type: 'SLA_RISK' },
];

export const EXCEPTION_LIMITS = {
  titleMax: 200, descriptionMax: 4000, reasonMax: 500, noteMax: 2000, commentMax: 4000,
  evidenceTextMax: 2000, evidenceReferenceMax: 500, linkedEntitiesMax: 50, activeEvidenceMax: 100,
  teamNameMax: 100, teamDescriptionMax: 500, directoryMax: 20,
  defaultDepth: 6,                                    // snapshot analyses (research R9)
  notificationReadAuditIdsMax: 1000,
} as const;

/** History change-list order (research R11). */
export const EXCEPTION_FIELD_ORDER = [
  'title','description','type','severity','priority','status','owner','slaDueAt','waitingReason',
  'resolutionNote','resolvedAt','resolvedBy','verificationNote','verifiedAt','verifiedBy','closedAt','closedBy',
  'escalationCount','reopenCount','rootCause','impact',
] as const;

export function formatExceptionNumber(n: number): string { return `EX-${n}`; }
export function suggestExceptionDraft(entity: EntityRefDto): { type: ExceptionType | null; title: string };
export function computeSlaStatus(input: SlaInput, evaluatedAt: Date): SlaDto;   // research R7
export function slaAtRiskAt(createdAt: Date, dueAt: Date): Date;               // dueAt − floor((dueAt − createdAt) / 4)
```

`words(state)` for titles is 005's rule (contracts of 005 § Explanation text). If 005 exports it from the API only, move it to shared (`stateWords`) and re-import it in 005's `label.ts`; behaviour must stay byte-identical.

### §2b Snapshot payloads

Both are subsets of the 005 and 006 response schemas, built with `.pick()` / `.extend()` so contract drift fails typecheck.

```ts
export const RootCauseSnapshotSchema = z.object({
  kind: z.literal('ROOT_CAUSE'),
  query: RootCauseResponseSchema.shape.query,                // entityId (subject), depth, evaluatedAt
  computedAt: z.string().datetime(),
  status: RootCauseStatusSchema,                             // ROOT_CAUSES_FOUND | NOT_BLOCKED | UNEXPLAINED
  summary: z.string(),
  candidates: z.array(z.object({
    rootCause: EntityRefDtoSchema,
    label: z.string(),
    confidence: ConfidenceSchema,
    insufficientEvidence: z.boolean(),
  })),
  chosen: RootCauseCandidateDtoSchema.pick({
    label: true, labelRule: true, possible: true, inCycle: true, continuesBeyondDepth: true,
    insufficientEvidence: true, confidence: true, keyEvidence: true, eventCount: true, explanation: true,
  }).extend({
    index: z.number().int().min(0),                          // in `candidates`
    reason: z.enum(['SELECTED', 'FIRST_RANKED', 'KEPT']),   // KEPT: refresh kept the previous root cause
    rootCause: EntityRefDtoSchema,
    confidenceRules: z.array(ConfidenceRuleOutcomeDtoSchema.omit({ refs: true })).length(8),
  }).nullable(),                                             // null unless ROOT_CAUSES_FOUND
});

export const ImpactSnapshotSchema = z.object({
  kind: z.literal('IMPACT'),
  anchorRole: z.enum(['ROOT_CAUSE', 'SUBJECT']),
  anchor: EntityRefDtoSchema,
  query: ImpactQueryEchoSchema,                              // entityId (= anchor), depth
  computedAt: z.string().datetime(),
  startClass: ImpactStateClassSchema,
  summary: z.array(z.string()).min(1),
  countedTotal: z.number().int().min(0),
  categories: z.array(ImpactCategoryDtoSchema).min(6),
  exposure: ImpactResponseSchema.shape.exposure,
  notCountedTotal: z.number().int().min(0),
  limits: ImpactLimitsDtoSchema,
});
```

`EntityRefDto` values are copied from the analysis responses (`start`, `rootCause`) by dropping `state`, so each snapshot records the state names and states **as they were**.

### §2c Snapshot digest (audit `before`/`after` of `exception.analysis_refreshed`, history sentences)

```ts
export interface SnapshotDigest {
  rootCause: { label: string; entityId: string; confidence: Confidence } | null;
  impact: {
    anchorEntityId: string;
    orders: number;          // categories[type=Order].total
    customers: number;       // categories[type=Customer].total
    exposure: Array<{ currency: string; amount: string }>;   // byCurrency[].total
    lowerBound: boolean;
  };
}
```

---

## §3 Internal types and algorithms (`apps/api/src/exceptions`)

### §3a Pure rule modules (`exceptions/rules/`, no Nest, no Prisma, no clock)

| File | Exports | Research |
|---|---|---|
| `transitions.ts` | `allowedTransitionsFrom`, `applyTransition` | R4 |
| `policy.ts` | `isOwner`, `isManager`, `isContributor`, `permissionsFor`, `canAssign`, `canTransition`, `canDetachEvidence`, `canUnlink` | R5 |
| `escalation.ts` | `planEscalation(row, input, now) → { changes, ownerAfter } \| ValidationIssue` | R8 |
| `history.ts` | `historySentence`, `toHistoryEntry(auditRow, names)` | R11 |
| `notification-message.ts` | `assignedMessage`, `escalatedMessage` | R12 |
| `list-query.ts` | `buildWhere(query, ctx) → Prisma.ExceptionWhereInput`, `orderByFor(sort)`, `keysetWhere(sort, key)`, `sortKeyOf(row, sort)` | R14 |
| `diff.ts` | `diffFields(before: ExceptionCore, after: ExceptionCore) → { before, after }` (changed fields only, `EXCEPTION_FIELD_ORDER`) | R11 |

`list-query.ts` imports Prisma **types only**; it builds plain objects and never queries.

### §3b `SnapshotService` (`exceptions/snapshot.service.ts`)

```ts
interface TakenSnapshots {
  rootCause: RootCauseSnapshot;          // §2b, parsed
  impact: ImpactSnapshot;                // §2b, parsed
  rootCauseEntityId: string | null;      // chosen?.rootCause.id
  digest: SnapshotDigest;                // §2c
}
take(subjectId: string, chosenRootCauseId: string | null, now: Date,
     opts?: { rootCauseEvaluatedAt?: string; fallbackToFirstRanked?: boolean }): Promise<TakenSnapshots>
```

- `fallbackToFirstRanked: true` is used by refresh (research R9): a stale `chosenRootCauseId` falls back instead of failing.
- Pure mappers in `exceptions/snapshot.mapper.ts`: `toRootCauseSnapshot`, `toImpactSnapshot`, `digestOf`.

### §3c Root-cause link sync (inside the create or refresh transaction)

```text
old = link with role ROOT_CAUSE (if any)
new = taken.rootCauseEntityId
if old?.entityId === new: nothing
else:
  if old: delete old link
  if new:
    existing = link (exceptionId, new)
    if existing.role === 'RELATED': update its role to ROOT_CAUSE (linkedById, linkedAt unchanged)
    else: insert { role: ROOT_CAUSE, linkedById: null, linkedAt: now }
```

The link change is reported inside the `exception.analysis_refreshed` audit row (`before.rootCause` / `after.rootCause` in the digest); it writes no separate `entity_linked` row. The 50-link cap is checked before inserting; at the cap, the refresh still succeeds and the root cause stays unlinked, with `metadata.rootCauseLinkSkipped: true` (extremely unlikely; documented for completeness).

### §3d `Actor` loading

`ExceptionsService` builds the policy `Actor` per request from `CurrentUser` plus one `team_members` query (`teamIds`). The system actor used by the seed is `{ id: null, role: 'ADMIN', teamIds: ∅, system: true }`; it bypasses the policy and is written with `actorType: 'system'`.

---

## §4 Service algorithms (`ExceptionsService`, `ExceptionCollabService`)

All mutating methods follow research R5's check order and R6's conditional update, and return `ExceptionDetailResponse`.

| Method | Steps inside the transaction (after checks) | Audit action | Notifies |
|---|---|---|---|
| `create` | insert exception, links, 2 snapshots | `exception.created` (after = core + snapshot digests) | ASSIGNED, if owner |
| `update` | conditional update of edited fields; recompute `slaAtRiskAt` if `slaDueAt` changed | `exception.updated` (diff) | — |
| `assign` | conditional update of owner; no-op if same owner (no version bump, no audit) | `exception.assigned` (`owner` before/after) | ASSIGNED, if new owner |
| `escalate` | conditional update with `planEscalation` changes | `exception.escalated` (diff, `metadata.reason`) | ESCALATED, owner after |
| `transition` | conditional update with `applyTransition` changes | `exception.status_changed` (diff, `metadata.transition`, note) | — |
| `refreshAnalysis` | insert 2 snapshots, §3c, conditional update (version only) | `exception.analysis_refreshed` (digests) | — |
| `addComment` | insert comment, touch `lastActivityAt` | `exception.commented` (after = comment) | — |
| `addEvidence` | insert evidence, touch | `exception.evidence_added` (after = item) | — |
| `detachEvidence` | insert detachment, touch; already detached → 200, no audit | `exception.evidence_detached` (before/after item) | — |
| `linkEntity` | insert RELATED link, touch; already linked (any role) → 400 on `entityId`, "Entity is already linked"; at 50 links → 400 on `entityId`, "An exception can link at most 50 entities" | `exception.entity_linked` | — |
| `unlinkEntity` | delete RELATED link, touch; SUBJECT/ROOT_CAUSE → 400 on `entityId` | `exception.entity_unlinked` (before = link) | — |

`ExceptionCore` (the audited shape) is `ExceptionDto` without `sla`, `subject` and the version, with owners and users as `{ kind, id, name }` / `{ id, name }`.

---

## §5 Queries

### §5a List `where` (`buildWhere`)

```text
view:
  ALL         → {}
  UNRESOLVED  → status ∈ UNRESOLVED_STATUSES
  OPEN        → status ∈ {OPEN, REOPENED}
  CRITICAL    → severity = CRITICAL ∧ unresolved
  MINE        → ownerUserId = caller ∧ unresolved
  MY_TEAMS    → ownerTeamId ∈ callerTeamIds ∧ unresolved
  SLA_AT_RISK → unresolved ∧ slaAtRiskAt ≤ T            (covers AT_RISK and BREACHED)
filters (AND):
  status[] → status ∈; severity[], type[], priority[] likewise
  owner: ME → ownerUserId = caller; MY_TEAMS → ownerTeamId ∈ callerTeamIds; UNASSIGNED → both null;
         USER:<id> → ownerUserId = id; TEAM:<id> → ownerTeamId = id
  sla[] → OR of: ON_TRACK (unresolved ∧ slaAtRiskAt > T), AT_RISK (unresolved ∧ slaAtRiskAt ≤ T ≤ slaDueAt),
                 BREACHED (unresolved ∧ slaDueAt < T), MET (slaOutcome = MET), MISSED (slaOutcome = MISSED)
  entityId → links some { entityId [, role = entityRole] }
  q → number = n  |  title contains q (insensitive)
```

### §5b Detail

1 `findUnique` with `ownerUser`, `ownerTeam` (+ member count), `subjectEntity`, `createdBy`, `resolvedBy`, `verifiedBy`, `closedBy`; 1 `findMany` of links with entities and linkers; 2 `findFirst` for the latest snapshot per kind (`orderBy seq desc`); 2 counts (comments, active evidence); the caller's team ids. No analysis is run.

---

## §6 Entities (spec Key Entities → this model)

| Spec entity | Where |
|---|---|
| Exception | `exceptions` (stored), `ExceptionDto`, `ExceptionSummaryDto`, `ExceptionDetailResponse` |
| Exception Link | `exception_entities` (stored), `LinkedEntityDto` |
| Root-Cause Snapshot | `exception_snapshots` kind ROOT_CAUSE (stored, append-only), `RootCauseSnapshot` |
| Impact Snapshot | `exception_snapshots` kind IMPACT (stored, append-only), `ImpactSnapshot` |
| Comment | `exception_comments` (stored, append-only), `ExceptionCommentDto` |
| Evidence Item | `exception_evidence` + `exception_evidence_detachments` (stored, append-only), `ExceptionEvidenceDto` |
| Team | `teams` (stored), `TeamDto` |
| Team Membership | `team_members` (stored), `TeamMemberDto` |
| Notification | `notifications` (stored), `NotificationDto` |
| History Entry | `audit_entries` rows (existing), `ExceptionHistoryEntryDto` (computed) |
