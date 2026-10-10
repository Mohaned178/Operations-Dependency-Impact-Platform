# API Contract: Exception Management and Ownership

**Feature**: `007-exception-management` | **Date**: 2026-10-07

All schemas live in `@opsgraph/shared`:
- `packages/shared/src/exceptions.ts` (constants in data-model §2, schemas below);
- `packages/shared/src/teams.ts`;
- `packages/shared/src/notifications.ts`.

All three are re-exported from `index.ts`. The backend validates every request with them, and the web app parses every response with them. `EntityRefDtoSchema`, `PageQuerySchema`, and the 005/006 schemas named in data-model §2b are reused unchanged.

---

## Routes

| # | Method | Path | Roles | Success | Errors |
|---|---|---|---|---|---|
| 1 | GET | `/api/exceptions` | all signed-in | 200 `ExceptionListResponse` | 400, 401 |
| 2 | POST | `/api/exceptions` | all signed-in | 201 `ExceptionDetailResponse` | 400, 401, 403 (`slaDueAt` by non-manager) |
| 3 | GET | `/api/exceptions/:id` | all signed-in | 200 `ExceptionDetailResponse` | 400, 401, 404 |
| 4 | PATCH | `/api/exceptions/:id` | contributors (FR-016) | 200 `ExceptionDetailResponse` | 400, 401, 403, 404, 409 |
| 5 | POST | `/api/exceptions/:id/assign` | see FR-016 | 200 `ExceptionDetailResponse` | 400, 401, 403, 404, 409 |
| 6 | POST | `/api/exceptions/:id/escalate` | see FR-016 | 200 `ExceptionDetailResponse` | 400, 401, 403, 404, 409 |
| 7 | POST | `/api/exceptions/:id/transitions` | see FR-016 | 200 `ExceptionDetailResponse` | 400, 401, 403, 404, 409 |
| 8 | POST | `/api/exceptions/:id/refresh-analysis` | contributors | 200 `ExceptionDetailResponse` | 400, 401, 403, 404, 409 |
| 9 | GET | `/api/exceptions/:id/comments` | all signed-in | 200 `ExceptionCommentListResponse` | 400, 401, 404 |
| 10 | POST | `/api/exceptions/:id/comments` | all signed-in | 201 `ExceptionCommentDto` | 400, 401, 404 |
| 11 | GET | `/api/exceptions/:id/evidence` | all signed-in | 200 `ExceptionEvidenceListResponse` | 400, 401, 404 |
| 12 | POST | `/api/exceptions/:id/evidence` | all signed-in | 201 `ExceptionEvidenceDto` | 400, 401, 404, 409 (Closed) |
| 13 | POST | `/api/exceptions/:id/evidence/:evidenceId/detach` | adder or contributors | 200 `ExceptionEvidenceDto` | 400, 401, 403, 404, 409 (Closed) |
| 14 | POST | `/api/exceptions/:id/entities` | all signed-in | 201 `LinkedEntityDto` | 400, 401, 404, 409 (Closed) |
| 15 | DELETE | `/api/exceptions/:id/entities/:entityId` | linker or contributors | 204 | 400, 401, 403, 404, 409 (Closed) |
| 16 | GET | `/api/exceptions/:id/history` | all signed-in | 200 `ExceptionHistoryResponse` | 400, 401, 404 |
| 17 | GET | `/api/teams` | all signed-in | 200 `TeamListResponse` | 401 |
| 18 | POST | `/api/teams` | ADMIN | 201 `TeamDto` | 400, 401, 403, 409 `TEAM_NAME_TAKEN` |
| 19 | GET | `/api/teams/:id` | all signed-in | 200 `TeamDto` | 400, 401, 404 |
| 20 | PATCH | `/api/teams/:id` | ADMIN | 200 `TeamDto` | 400, 401, 403, 404, 409 `TEAM_NAME_TAKEN` |
| 21 | POST | `/api/teams/:id/members` | ADMIN | 200 `TeamDto` | 400, 401, 403, 404 |
| 22 | DELETE | `/api/teams/:id/members/:userId` | ADMIN | 200 `TeamDto` | 400, 401, 403, 404 |
| 23 | GET | `/api/owner-directory` | all signed-in | 200 `OwnerDirectoryResponse` | 400, 401 |
| 24 | GET | `/api/notifications` | own only | 200 `NotificationListResponse` | 400, 401 |
| 25 | GET | `/api/notifications/unread-count` | own only | 200 `UnreadCountResponse` | 401 |
| 26 | POST | `/api/notifications/:id/read` | recipient | 200 `NotificationDto` | 400, 401, 404 |
| 27 | POST | `/api/notifications/read-all` | own only | 200 `UnreadCountResponse` | 401 |

**Controllers**:
- `apps/api/src/exceptions/`: `ExceptionsController` (`@Controller('exceptions')`, routes 1–8 and 16) and `ExceptionCollabController` (`@Controller('exceptions/:id')`, routes 9–15);
- `apps/api/src/users/`: `TeamsController` (`@Controller('teams')`, routes 17–22; `@Roles('ADMIN')` on 18, 20, 21, 22) and `OwnerDirectoryController` (route 23);
- `apps/api/src/notifications/`: `NotificationsController` (routes 24–27).

Path ids use `ParseUUIDPipe`; bodies and queries use `ZodValidationPipe`. Controllers take `@CurrentUser()` and pass it to services.

**409 codes** (new in `ErrorCodeSchema`, with `Errors` factories):

| Code | Status | Message | When |
|---|---|---|---|
| `VERSION_CONFLICT` | 409 | `The exception was changed by someone else` + detail `{ path: 'expectedVersion', message: 'Current version is N' }` | research R6 |
| `INVALID_STATE` | 409 | research R4 messages, or `` `${ACTION} is not allowed while the exception is CLOSED. Reopen it first.` `` | transitions, `needsOwner`, FR-014 |
| `TEAM_NAME_TAKEN` | 409 | `A team with this name already exists` | research R13 |

**Permission refusals** write `auth.forbidden` standalone with `metadata: { method, path, role, exceptionId, action }` (`teamId` instead of `exceptionId` for team routes, via `RolesGuard`), then 403. Routes 24–27 never return 403: another user's notification is 404.

---

## Audit rows

Every row is written in the same transaction as the change (research R11). Exception rows use `targetType 'exception'`, `targetId` = exception id.

| Route | `action` | `before` | `after` | `metadata` |
|---|---|---|---|---|
| 2 | `exception.created` | — | `ExceptionCore` (all fields) + `rootCause`/`impact` digests | `{ createdFrom, notifiedUserIds }` |
| 4 | `exception.updated` | changed fields | changed fields | — |
| 5 | `exception.assigned` | `{ owner }` | `{ owner }` | `{ notifiedUserIds }` |
| 6 | `exception.escalated` | changed fields of `severity, priority, slaDueAt, owner, escalationCount` | same | `{ reason, notifiedUserIds }` |
| 7 | `exception.status_changed` | changed fields (status and FR-013 details) | same | `{ transition, note }` (`note` = the action's input, or null) |
| 8 | `exception.analysis_refreshed` | `{ rootCause, impact }` digest | same | `{ snapshotIds }` |
| 10 | `exception.commented` | — | `ExceptionCommentDto` | — |
| 12 | `exception.evidence_added` | — | `ExceptionEvidenceDto` | — |
| 13 | `exception.evidence_detached` | the item before | the item after | — |
| 14 | `exception.entity_linked` | — | `LinkedEntityDto` | — |
| 15 | `exception.entity_unlinked` | `LinkedEntityDto` | — | — |
| 18 | `team.created` (`targetType 'team'`) | — | `TeamDto` | — |
| 20 | `team.updated` | changed fields | changed fields | — |
| 21 | `team.member_added` | — | `{ userId, displayName }` | — |
| 22 | `team.member_removed` | `{ userId, displayName }` | — | — |
| 26, 27 | `notification.read` (`targetType 'user'`, `targetId` = caller) | — | — | `{ count, notificationIds }` (ids capped at 1,000) |

No-ops write nothing and do not bump the version: assigning the current owner, detaching a detached item, adding an existing member, removing a non-member, marking read notifications read.

---

## Shared building blocks

```ts
// exceptions.ts
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v === undefined || v === '' ? null : v));

export const ExceptionTypeSchema = z.enum(EXCEPTION_TYPES);
export const ExceptionSeveritySchema = z.enum(EXCEPTION_SEVERITIES);
export const ExceptionPrioritySchema = z.enum(EXCEPTION_PRIORITIES);
export const ExceptionStatusSchema = z.enum(EXCEPTION_STATUSES);
export const ExceptionTransitionActionSchema = z.enum(EXCEPTION_TRANSITION_ACTIONS);
export const SlaStatusSchema = z.enum(SLA_STATUSES);
export const ExceptionEntityRoleSchema = z.enum(['SUBJECT', 'ROOT_CAUSE', 'RELATED']);
export const ExceptionCreatedFromSchema = z.enum(['EXCEPTIONS_AREA', 'ENTITY', 'ROOT_CAUSE', 'SEED']);

export const OwnerRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('USER'), userId: z.string().uuid() }),
  z.object({ kind: z.literal('TEAM'), teamId: z.string().uuid() }),
]);

export const UserRefDtoSchema = z.object({ id: z.string().uuid(), displayName: z.string(), active: z.boolean() });

export const OwnerDtoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('USER'), user: UserRefDtoSchema }),
  z.object({ kind: z.literal('TEAM'), team: z.object({ id: z.string().uuid(), name: z.string(), activeMemberCount: z.number().int().min(0) }) }),
]);

export const SlaDtoSchema = z.object({
  dueAt: z.string().datetime(),
  status: SlaStatusSchema,
  evaluatedAt: z.string().datetime(),
  windowMs: z.number().int().min(1),                 // dueAt − createdAt
  remainingMs: z.number().int().nullable(),          // dueAt − evaluatedAt; null when MET/MISSED
  sentence: z.string(),                              // § SLA sentences
});
```

`UserRefDtoSchema` here is a new schema; 005's `UserRefDtoSchema` (`{ id, displayName }`) stays in `evidence-notes.ts`. Name the new one `ActorRefDtoSchema` if both end up exported from `index.ts` and would collide.

---

## Request schemas

```ts
export const CreateExceptionRequestSchema = z.object({
  title: trimmed(EXCEPTION_LIMITS.titleMax),
  description: optionalTrimmed(EXCEPTION_LIMITS.descriptionMax),
  type: ExceptionTypeSchema,
  severity: ExceptionSeveritySchema,
  priority: ExceptionPrioritySchema.optional(),                   // default DEFAULT_PRIORITY[severity]
  owner: OwnerRefSchema.nullable().optional(),                    // default null
  subjectEntityId: z.string().uuid(),
  rootCauseEntityId: z.string().uuid().optional(),
  relatedEntityIds: z.array(z.string().uuid()).max(48).default([]),
  slaDueAt: z.string().datetime().optional(),                     // managers only (403 otherwise)
  createdFrom: z.enum(['EXCEPTIONS_AREA', 'ENTITY', 'ROOT_CAUSE']),
}).strict();

export const UpdateExceptionRequestSchema = z.object({
  expectedVersion: z.number().int().min(1),
  title: trimmed(EXCEPTION_LIMITS.titleMax).optional(),
  description: z.string().trim().max(EXCEPTION_LIMITS.descriptionMax).nullable().optional()
    .transform((v) => (v === '' ? null : v)),
  type: ExceptionTypeSchema.optional(),
  priority: ExceptionPrioritySchema.optional(),
  severity: ExceptionSeveritySchema.optional(),                   // managers only
  slaDueAt: z.string().datetime().optional(),                     // managers only, unresolved only
}).strict().refine((b) => Object.keys(b).some((k) => k !== 'expectedVersion'), {
  message: 'At least one field must be provided',
});

export const AssignExceptionRequestSchema = z.object({
  expectedVersion: z.number().int().min(1),
  owner: OwnerRefSchema.nullable(),                               // null = unassign (managers only)
}).strict();

export const EscalateExceptionRequestSchema = z.object({
  expectedVersion: z.number().int().min(1),
  severity: ExceptionSeveritySchema.optional(),
  owner: OwnerRefSchema.optional(),
  reason: trimmed(EXCEPTION_LIMITS.reasonMax),
}).strict();

export const TransitionExceptionRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('START'),   expectedVersion: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal('WAIT'),    expectedVersion: z.number().int().min(1), waitingReason: trimmed(500) }).strict(),
  z.object({ action: z.literal('RESUME'),  expectedVersion: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal('RESOLVE'), expectedVersion: z.number().int().min(1), resolutionNote: trimmed(2000) }).strict(),
  z.object({ action: z.literal('VERIFY'),  expectedVersion: z.number().int().min(1), verificationNote: optionalTrimmed(2000) }).strict(),
  z.object({ action: z.literal('CLOSE'),   expectedVersion: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal('REOPEN'),  expectedVersion: z.number().int().min(1), reopenReason: trimmed(500) }).strict(),
]);

export const RefreshAnalysisRequestSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

export const CreateCommentRequestSchema = z.object({ text: trimmed(EXCEPTION_LIMITS.commentMax) }).strict();

export const AddEvidenceRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SOURCE_RECORD'), sourceRecordId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('NOTE'), text: trimmed(2000), reference: optionalTrimmed(500) }).strict(),
]);

export const DetachEvidenceRequestSchema = z.object({ reason: trimmed(500) }).strict();

export const LinkEntityRequestSchema = z.object({ entityId: z.string().uuid() }).strict();

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]).flatMap((s) => String(s).split(',')).filter(Boolean)),
    z.array(item).optional());

export const ExceptionViewSchema = z.enum(['ALL', 'UNRESOLVED', 'OPEN', 'CRITICAL', 'MINE', 'MY_TEAMS', 'SLA_AT_RISK']);
export const ExceptionSortSchema = z.enum(['SLA_DUE', 'SEVERITY', 'PRIORITY', 'NEWEST', 'UPDATED']);

export const ExceptionListQuerySchema = PageQuerySchema.extend({
  view: ExceptionViewSchema.default('UNRESOLVED'),
  status: csv(ExceptionStatusSchema),
  severity: csv(ExceptionSeveritySchema),
  type: csv(ExceptionTypeSchema),
  priority: csv(ExceptionPrioritySchema),
  owner: z.string().regex(/^(ME|MY_TEAMS|UNASSIGNED|USER:[0-9a-f-]{36}|TEAM:[0-9a-f-]{36})$/i).optional(),
  sla: csv(SlaStatusSchema),
  entityId: z.string().uuid().optional(),
  entityRole: ExceptionEntityRoleSchema.optional(),               // requires entityId
  q: z.string().trim().min(1).max(200).optional(),
  sort: ExceptionSortSchema.default('SLA_DUE'),
  evaluatedAt: z.string().datetime().optional(),
}).superRefine(/* entityRole without entityId → issue on entityRole */);

export const ExceptionDetailQuerySchema = z.object({ evaluatedAt: z.string().datetime().optional() });

// teams.ts
export const CreateTeamRequestSchema = z.object({
  name: trimmed(100),
  description: optionalTrimmed(500),
}).strict();
export const UpdateTeamRequestSchema = z.object({
  name: trimmed(100).optional(),
  description: z.string().trim().max(500).nullable().optional().transform((v) => (v === '' ? null : v)),
}).strict().refine((b) => b.name !== undefined || b.description !== undefined, { message: 'At least one field must be provided' });
export const AddTeamMemberRequestSchema = z.object({ userId: z.string().uuid() }).strict();
export const OwnerDirectoryQuerySchema = z.object({ q: z.string().trim().max(100).optional() });

// notifications.ts
export const NotificationListQuerySchema = PageQuerySchema.extend({
  unread: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
```

**Semantic validation** (400 `VALIDATION_FAILED`, one detail each):

| Condition | `path` | `message` |
|---|---|---|
| subject entity does not exist | `subjectEntityId` | `Entity not found` |
| a related entity does not exist / repeats the subject | `relatedEntityIds.<i>` | `Entity not found` / `Entity is already linked` |
| root-cause entity is not a current candidate | `rootCauseEntityId` | `Not a current root-cause candidate of the subject` |
| owner user unknown / deactivated | `owner.userId` | `User not found` / `User is deactivated` |
| owner team unknown | `owner.teamId` | `Team not found` |
| `slaDueAt` not after creation time (create) | `slaDueAt` | `SLA due time must be after the creation time` |
| escalation severity not higher | `severity` | `` `Severity must be higher than ${CURRENT}` `` |
| escalation changes nothing | `severity` | `Escalation must raise severity or change the owner` |
| no owner after escalation | `owner` | `An escalated exception must have an owner` |
| evidence source record does not exist | `sourceRecordId` | `Source record not found` |
| 100 active evidence items | `kind` | `An exception can hold at most 100 active evidence items` |
| link: entity missing / already linked / 50 links | `entityId` | `Entity not found` / `Entity is already linked` / `An exception can link at most 50 entities` |
| unlink SUBJECT / ROOT_CAUSE | `entityId` | `The subject cannot be unlinked` / `The root-cause entity changes only through an analysis refresh` |
| team member user does not exist | `userId` | `User not found` |
| list cursor sort mismatch / malformed | `cursor` | `Invalid cursor` |

`slaDueAt` or `severity` sent by a non-manager is **403** (audited), not 400. `slaDueAt` on a resolved, verified or closed exception is 409 `INVALID_STATE`.

---

## Response schemas

```ts
// exceptions.ts
export const LinkedEntityDtoSchema = z.object({
  entity: EntityRefDtoSchema,
  role: ExceptionEntityRoleSchema,
  linkedBy: UserRefDtoSchema.nullable(),             // null = system
  linkedAt: z.string().datetime(),
});

export const ExceptionDtoSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int().min(1),
  key: z.string(),                                   // formatExceptionNumber(number)
  title: z.string(),
  description: z.string().nullable(),
  type: ExceptionTypeSchema,
  severity: ExceptionSeveritySchema,
  priority: ExceptionPrioritySchema,
  status: ExceptionStatusSchema,
  owner: OwnerDtoSchema.nullable(),
  subject: EntityRefDtoSchema,
  sla: SlaDtoSchema,
  createdFrom: ExceptionCreatedFromSchema,
  createdBy: UserRefDtoSchema.nullable(),            // null = system
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  waitingReason: z.string().nullable(),
  resolution: z.object({ by: UserRefDtoSchema, at: z.string().datetime(), note: z.string() }).nullable(),
  verification: z.object({ by: UserRefDtoSchema, at: z.string().datetime(), note: z.string().nullable() }).nullable(),
  closure: z.object({ by: UserRefDtoSchema, at: z.string().datetime() }).nullable(),
  escalationCount: z.number().int().min(0),
  reopenCount: z.number().int().min(0),
  version: z.number().int().min(1),
});

export const ExceptionSummaryDtoSchema = ExceptionDtoSchema.pick({
  id: true, number: true, key: true, title: true, type: true, severity: true, priority: true,
  status: true, owner: true, subject: true, sla: true, createdAt: true, lastActivityAt: true, version: true,
});

export const ExceptionPermissionsDtoSchema = z.object({
  edit: z.boolean(),
  editSeverityAndSla: z.boolean(),
  assignAny: z.boolean(),                            // manager or owner
  assignSelfOrOwnTeam: z.boolean(),                  // unowned rule
  unassign: z.boolean(),
  escalateSeverity: z.boolean(),
  escalateWithOwner: z.boolean(),                    // = assignAny || assignSelfOrOwnTeam
  transitions: z.array(ExceptionTransitionActionSchema),  // allowed by status, owner rule and policy
  refreshAnalysis: z.boolean(),
  comment: z.boolean(),
  addEvidence: z.boolean(),
  linkEntity: z.boolean(),
});

export const SnapshotEnvelopeSchema = <T extends z.ZodTypeAny>(payload: T) => z.object({
  id: z.string().uuid(),
  takenAt: z.string().datetime(),
  takenBy: UserRefDtoSchema.nullable(),
  payload,
});

export const ExceptionDetailResponseSchema = z.object({
  exception: ExceptionDtoSchema,
  links: z.array(LinkedEntityDtoSchema),             // SUBJECT, ROOT_CAUSE, then RELATED by linkedAt, entity id
  rootCause: SnapshotEnvelopeSchema(RootCauseSnapshotSchema),
  impact: SnapshotEnvelopeSchema(ImpactSnapshotSchema),
  snapshotCount: z.number().int().min(2),            // all snapshots ever taken, both kinds
  counts: z.object({ comments: z.number().int().min(0), activeEvidence: z.number().int().min(0), detachedEvidence: z.number().int().min(0) }),
  permissions: ExceptionPermissionsDtoSchema,
});

export const ExceptionListResponseSchema = z.object({
  query: z.object({ view: ExceptionViewSchema, sort: ExceptionSortSchema, evaluatedAt: z.string().datetime() }),
  total: z.number().int().min(0),
  items: z.array(ExceptionSummaryDtoSchema),
  nextCursor: z.string().nullable(),
});

export const ExceptionCommentDtoSchema = z.object({
  id: z.string().uuid(),
  author: UserRefDtoSchema,
  text: z.string(),
  createdAt: z.string().datetime(),
});
export const ExceptionCommentListResponseSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(ExceptionCommentDtoSchema),         // oldest first (seq ASC)
  nextCursor: z.string().nullable(),
});

export const ExceptionEvidenceDtoSchema = z.object({
  id: z.string().uuid(),
  origin: z.enum(['SOURCE', 'MANUAL']),              // SOURCE_RECORD → SOURCE, NOTE → MANUAL
  item: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('SOURCE_RECORD'),
      sourceRecordId: z.string().uuid(),
      recordKind: z.enum(['ENTITY', 'RELATIONSHIP', 'EVENT']),
      sourceSystem: z.string(),
      sourceId: z.string(),
      observedAt: z.string().datetime(),
      entity: EntityRefDtoSchema.nullable(),         // the record's entity, or the relationship's from-entity, or null for events
    }),
    z.object({ kind: z.literal('NOTE'), text: z.string(), reference: z.string().nullable() }),
  ]),
  addedBy: UserRefDtoSchema,
  createdAt: z.string().datetime(),
  active: z.boolean(),
  detachment: z.object({ by: UserRefDtoSchema, reason: z.string(), at: z.string().datetime() }).nullable(),
});
export const ExceptionEvidenceListResponseSchema = z.object({
  items: z.array(ExceptionEvidenceDtoSchema),        // all items, active first, each group by seq ASC (≤ 100 active + detached)
  fromRootCause: z.array(KeyEvidenceItemDtoSchema),  // current root-cause snapshot's chosen.keyEvidence, or []
  rootCauseSnapshotId: z.string().uuid(),
});

export const HistoryChangeDtoSchema = z.object({
  field: z.string(),                                 // EXCEPTION_FIELD_ORDER key, or item key
  label: z.string(),                                 // e.g. "SLA due"
  before: JsonValueSchema,
  after: JsonValueSchema,
});
export const ExceptionHistoryEntryDtoSchema = z.object({
  auditId: z.string(),
  occurredAt: z.string().datetime(),
  actor: UserRefDtoSchema.nullable(),                // null = System
  action: z.string(),                                // AUDIT_ACTIONS value
  sentence: z.string(),                              // § History sentences
  changes: z.array(HistoryChangeDtoSchema),
});
export const ExceptionHistoryResponseSchema = z.object({
  items: z.array(ExceptionHistoryEntryDtoSchema),    // oldest first (audit id ASC)
  nextCursor: z.string().nullable(),
});

// teams.ts
export const TeamMemberDtoSchema = z.object({
  user: z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string(), role: RoleSchema, active: z.boolean() }),
  addedAt: z.string().datetime(),
});
export const TeamDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  members: z.array(TeamMemberDtoSchema),             // by displayName, then id
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const TeamListResponseSchema = z.object({ items: z.array(TeamDtoSchema) });   // by name (compareCodeUnits on lower-case), then id
export const OwnerDirectoryResponseSchema = z.object({
  users: z.array(z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string(), role: RoleSchema })).max(20),
  teams: z.array(z.object({ id: z.string().uuid(), name: z.string(), memberCount: z.number().int().min(0) })).max(20),
});

// notifications.ts
export const NotificationKindSchema = z.enum(['ASSIGNED', 'ESCALATED']);
export const NotificationDtoSchema = z.object({
  id: z.string().uuid(),
  kind: NotificationKindSchema,
  exception: z.object({ id: z.string().uuid(), key: z.string(), title: z.string() }),   // title as of now
  actor: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),       // null = System
  message: z.string(),                               // stored at creation (§ Notification messages)
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});
export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationDtoSchema),             // createdAt DESC, id DESC
  nextCursor: z.string().nullable(),
});
export const UnreadCountResponseSchema = z.object({ unread: z.number().int().min(0) });
```

**Cursors**:
- list: research R14;
- comments: `encodeCursor({ seq })` as a decimal string; next page `seq > cursor`;
- history: the last `auditId`; next page `id > cursor`;
- notifications: `encodeCursor({ createdAt, id })`, next page strictly after, in `createdAt DESC, id DESC` order.

---

## Text templates

Notation: `iso(d)` = `d.toISOString()`; `actor` = the actor's `displayName`, or `System`; `EX` = `formatExceptionNumber(number)`; `excerpt(s, n)` = `s` if `s.length ≤ n`, else its first `n` characters + `…`; `money(list)` = 006's `formatMoneyText` per currency joined with ` and `, or `no exposure` when empty.

### Durations (`dur(ms)`, `ms ≥ 0`)

`m = floor(ms / 60000)`, `d = floor(m / 1440)`, `h = floor((m % 1440) / 60)`, `mm = m % 60`. Output the non-zero parts as `${d}d`, `${h}h`, `${mm}m` joined with a space; `0m` when all are zero. Examples: 14,400,000 → `4h`; 93,600,000 → `1d 2h`; 59,999 → `0m`.

### SLA sentences (`SlaDto.sentence`)

| Status | Sentence |
|---|---|
| ON_TRACK | `` `Due ${iso(due)}; ${dur(remaining)} remaining.` `` |
| AT_RISK | `` `Due ${iso(due)}; only ${dur(remaining)} remaining, within the last 25% of the ${dur(window)} SLA window.` `` |
| BREACHED | `` `Due ${iso(due)}; overdue by ${dur(−remaining)}.` `` |
| MET | `` `Resolved ${iso(resolvedAt)}, ${dur(due − resolvedAt)} before the due time ${iso(due)}.` ``; when equal: `` `Resolved ${iso(resolvedAt)}, at the due time.` `` |
| MISSED | `` `Resolved ${iso(resolvedAt)}, ${dur(resolvedAt − due)} after the due time ${iso(due)}.` `` |

### Notification messages (stored)

| Kind | Owner after | Message |
|---|---|---|
| ASSIGNED | user | `` `${actor} assigned ${EX} "${title}" to you.` `` |
| ASSIGNED | team | `` `${actor} assigned ${EX} "${title}" to ${team.name}.` `` |
| ESCALATED, severity raised | any | `` `${actor} escalated ${EX} "${title}" to ${SEVERITY}: ${reason}` `` |
| ESCALATED, owner only | user / team | `` `${actor} escalated ${EX} "${title}" to you: ${reason}` `` / `` `… to ${team.name}: ${reason}` `` |

### History sentences (`historySentence`)

| Action | Sentence |
|---|---|
| `exception.created` | `` `${actor} created the exception: ${TYPE_LABEL}, ${SEVERITY_LABEL} severity, ${owner ? 'owner ' + ownerName : 'no owner'}.` `` |
| `exception.updated` | `` `${actor} changed ${labels.join(', ')}.` `` |
| `exception.assigned` | `` `${actor} assigned the exception to ${afterName ?? 'nobody'} (previously ${beforeName ?? 'nobody'}).` `` |
| `exception.escalated` | `` `${actor} escalated the exception: ${parts.join('; ')}. Reason: ${reason}` ``, parts in field order, each `` `${label} ${before} → ${after}` `` (times as `iso`) |
| `exception.status_changed` | `` `${actor} ${VERB}: ${STATUS_LABEL(from)} → ${STATUS_LABEL(to)}.` `` + (note ? `` ` ${NOTE_LABEL}: ${note}` `` : '') |
| `exception.analysis_refreshed` | `` `${actor} refreshed the analysis: root cause ${rc(before)} → ${rc(after)}; impact ${imp(before)} → ${imp(after)}.` ``; each side that did not change is written once as `unchanged (${…})` |
| `exception.commented` | `` `${actor} commented: ${excerpt(text, 120)}` `` |
| `exception.evidence_added` | record: `` `${actor} attached source record ${sourceSystem} ${sourceId}${entity ? ' of ' + entity.displayName : ''} as evidence.` ``; note: `` `${actor} added an evidence note: ${excerpt(text, 120)}` `` |
| `exception.evidence_detached` | `` `${actor} detached evidence ${record ? sourceSystem + ' ' + sourceId : '"' + excerpt(text, 60) + '"'}. Reason: ${reason}` `` |
| `exception.entity_linked` | `` `${actor} linked ${displayName} (${type}) as related.` `` |
| `exception.entity_unlinked` | `` `${actor} unlinked ${displayName} (${type}).` `` |

- `VERB`: START `started work`, WAIT `set the exception to waiting`, RESUME `resumed work`, RESOLVE `resolved the exception`, VERIFY `verified the resolution`, CLOSE `closed the exception`, REOPEN `reopened the exception`.
- `NOTE_LABEL`: WAIT `Waiting for`, RESOLVE `Resolution`, VERIFY `Verification note`, REOPEN `Reason`.
- `rc(d)` = `` `${label} (${confidence})` `` or `none`; `imp(d)` = `` `${orders} customer orders, ${customers} customers, ${money(exposure)}` ``, plus ` (at least)` when `lowerBound`.
- Field labels: title `Title`, description `Description`, type `Type`, severity `Severity`, priority `Priority`, status `Status`, owner `Owner`, slaDueAt `SLA due`, waitingReason `Waiting reason`, resolutionNote `Resolution note`, verificationNote `Verification note`, escalationCount `Escalations`, reopenCount `Reopens`.

---

## Acceptance fixtures

Users: the seeded **Admin** (ADMIN), **Operations Manager** (OPS_MANAGER, member of Finance Operations) and **Operations Analyst** (ANALYST, member of Warehouse Operations), plus **Second Analyst** (ANALYST, no team), created by the test. Entity names are as in 003–006 fixtures. `exceptions-seed.e2e-spec.ts` asserts X1–X3; the other files assert X4–X9.

### X1. Seeded teams

- `GET /api/teams` returns exactly `Finance Operations` (members: Operations Manager) and `Warehouse Operations` (members: Operations Analyst), in that order.
- Re-running the seed creates nothing and writes no audit row.

### X2. Seeded reference exception

- `GET /api/exceptions?view=ALL` (as any user, on a freshly seeded database) has `total 1`. The item:
  - `key "EX-10001"`, `title "Shipment SHP-77120 (consolidated) Delayed"`, `type SHIPMENT_DELAY`, `severity CRITICAL`, `priority P1`, `status OPEN`;
  - `owner = { kind TEAM, team: { name "Finance Operations", activeMemberCount 1 } }`;
  - `subject` = Shipment SHP-77120 (consolidated), DELAYED;
  - `createdFrom SEED`, `createdBy null`;
  - `sla.windowMs 14400000`, `sla.dueAt` = `createdAt` + 4 h.
- Detail:
  - `links` = [SHP-77120 `SUBJECT`, Budget code for Order #18492 `ROOT_CAUSE`], both `linkedBy null`;
  - **`rootCause.payload`**:
    - `query.evaluatedAt "2026-09-29T16:00:00.000Z"`, `status ROOT_CAUSES_FOUND`;
    - `summary "Shipment SHP-77120 (consolidated) is DELAYED. 1 root cause found: Budget Code Missing (HIGH)."`;
    - `candidates` = 1 item (BR-18492, `Budget Code Missing`, HIGH);
    - `chosen`: `index 0`, `reason FIRST_RANKED`, `label "Budget Code Missing"`, `confidence HIGH`, `explanation.headline "Root cause: Budget Code Missing. Confidence: HIGH."`, `explanation.evidence` = 005 fixture R2's evidence sentence, `keyEvidence` 7 items (TMS SHP-77120, OMS 18492, ERP SO-18492, ContractMgmt CON-3982, Payments PAY-88213, FinanceApprovals APR-2291, FinanceApprovals BR-18492), `eventCount 8`, 8 `confidenceRules`;
  - **`impact.payload`**:
    - `anchorRole ROOT_CAUSE`, `anchor` = Budget code for Order #18492 (MISSING), `query.depth 6`;
    - categories: Order 17 (current 17), Customer 4 (current 4), Shipment 1, SLA 4 (current 3, potential 1), Approval 1, Invoice 1, Payment 1; `countedTotal 29`;
    - `exposure.byCurrency` = [USD: total 31,400.00 (17 orders), current 31,400.00, potential 0.00];
    - `summary[1]` = 006 fixture I7 line 2;
  - `counts` all 0, `snapshotCount 2`.
- Audit: exactly one `exception.created` row for it (`actorType 'system'`), with `metadata.createdFrom 'SEED'` and `metadata.notifiedUserIds` = [Operations Manager].

### X3. Seeded notification

- As Operations Manager: `GET /api/notifications/unread-count` → `{ unread: 1 }`; the item is `kind ASSIGNED`, `actor null`, message `System assigned EX-10001 "Shipment SHP-77120 (consolidated) Delayed" to Finance Operations.`
- As Operations Analyst and Admin: `{ unread: 0 }`.

### X4. Lifecycle on the reference exception (sequence)

Versions start at 1. Each step uses the version returned by the previous successful step.

| # | Actor | Request | Result |
|---|---|---|---|
| 1 | Operations Analyst | `START` | 403; one `auth.forbidden` (`metadata.action 'START'`) |
| 2 | Operations Manager | `START` | 200, `IN_PROGRESS`, version 2 |
| 3 | Operations Manager | `START` | 409 `INVALID_STATE`, `START is not allowed while the exception is IN_PROGRESS. Allowed: WAIT, RESOLVE.` |
| 4 | Operations Manager | `WAIT`, `waitingReason "account manager to supply budget code"` | 200, `WAITING`, `waitingReason` set, version 3 |
| 5 | Operations Manager | `RESOLVE`, `resolutionNote "Budget code BC-7781 supplied; approval APR-2291 released"` | 200, `RESOLVED`, `waitingReason null`, `resolution.by` = Operations Manager, `sla.status MET`, version 4 |
| 6 | Operations Manager | `VERIFY` | 403 (resolver) |
| 7 | Admin | `VERIFY`, `verificationNote "Order #18492 released in OMS"` | 200, `VERIFIED`, version 5 |
| 8 | Operations Analyst | `CLOSE` | 403 |
| 9 | Admin | `CLOSE` | 200, `CLOSED`, version 6, `permissions.transitions = ['REOPEN']` |
| 10 | Admin | `PATCH { title }` | 409 `INVALID_STATE` (`… while the exception is CLOSED. Reopen it first.`) |
| 11 | Operations Analyst | comment `Shipment delayed again on 2026-10-14` | 201 |
| 12 | Operations Analyst | `REOPEN`, `reopenReason "Budget code rejected by ERP on re-validation"` | 200, `REOPENED`, `resolution`, `verification`, `closure` null, `reopenCount 1`, `sla.status` computed live, version 7 |
| 13 | Operations Manager | `START` with `expectedVersion 6` | 409 `VERSION_CONFLICT`, detail `Current version is 7` |

**History** after step 13: 8 entries, oldest first: created; started work; set to waiting; resolved; verified; closed; commented; reopened. Entry 5's sentence is `Admin verified the resolution: Resolved → Verified. Verification note: Order #18492 released in OMS`. Entry 4's `changes` include `status`, `waitingReason`, `resolutionNote`, `resolvedAt`, `resolvedBy` with before/after. The history equals the `exception.*` audit rows for this id, one to one.

### X5. Assignment rules

Exception E1 is created by Second Analyst: subject Order #18492, `BLOCKED_ORDER`, `MEDIUM`, no owner.

| # | Actor | Request | Result |
|---|---|---|---|
| 1 | Operations Analyst | assign to user Operations Manager | 403 |
| 2 | Operations Analyst | assign to team Warehouse Operations | 200; `metadata.notifiedUserIds []` (the only member is the actor) |
| 3 | Operations Analyst (now owner) | assign to user Operations Manager | 200; Operations Manager gets `Operations Analyst assigned EX-<n> "Order #18492 Blocked" to you.` |
| 4 | Operations Manager | assign to user Operations Manager | 200, version unchanged, no audit row, no notification |
| 5 | Operations Analyst | assign to `null` | 403 (unassign is managers only) |
| 6 | Operations Manager | assign to `null` | 200, `owner null`, no notification |
| 7 | Second Analyst (creator) | assign to team Finance Operations | 403 (not a member) |
| 8 | Admin deactivates Second Analyst; Operations Manager assigns to Second Analyst | 400, `owner.userId` `User is deactivated` |

### X6. Escalation

Exception E2 is created by Second Analyst at T0: `SHIPMENT_DELAY`, `MEDIUM` (P3, due T0 + 72 h), owner team Warehouse Operations.

| # | Actor | Request | Result |
|---|---|---|---|
| 1 | Second Analyst, at T1 | `severity HIGH`, reason `Customer Acme Corp key account; SLA breach would trigger penalty` | 200: `HIGH`, `P2`, `slaDueAt = min(T0 + 72 h, T1 + 24 h)`, `escalationCount 1`; Operations Analyst gets `Second Analyst escalated EX-<n> "<title>" to HIGH: Customer Acme Corp key account; SLA breach would trigger penalty` |
| 2 | Second Analyst | `severity MEDIUM` | 400 `severity`: `Severity must be higher than HIGH` |
| 3 | Second Analyst | `owner` team Finance Operations, no severity | 403 (owner change needs assignment rights) |
| 4 | Operations Manager, at T2 | `severity CRITICAL`, `owner` user Admin | 200: `CRITICAL`, `P1`, `slaDueAt = min(previous, T2 + 4 h)`, owner Admin, `escalationCount 2`; only Admin is notified (ESCALATED); one audit row `exception.escalated` with `owner` in before/after |
| 5 | Operations Manager | no severity, no owner | 400 `severity`: `Escalation must raise severity or change the owner` |
| 6 | Operations Manager | `severity CRITICAL` | 400 `severity`: `Severity must be higher than CRITICAL` |

### X7. Collaboration and refresh (on the reference exception, after X2)

1. Operations Manager comments `Account manager confirms code will be issued by 14:00.` → 201; the comment list has 1 item.
2. Operations Analyst adds evidence `SOURCE_RECORD` = the ERP SO-18492 source record → 201, `origin SOURCE`, `item.entity` = Order #18492.
3. Operations Analyst adds evidence `NOTE` `Call with Finance, ticket FIN-4410` → 201, `origin MANUAL`.
4. Second Analyst detaches item 3 → 403. Operations Analyst detaches it with reason `Wrong ticket` → 200, `active false`. Again → 200, no audit row.
5. `GET …/evidence`: 2 items (active first), `fromRootCause` = the 7 key evidence items of X2.
6. Operations Analyst links Payment PAY-88213 → 201 `RELATED`. Again → 400 `Entity is already linked`. Unlink SHP-77120 → 400 `The subject cannot be unlinked`. Unlink BR-18492 → 400.
7. Operations Manager refreshes the analysis (now, so 005 rule STALE_EVIDENCE applies) → 200, `snapshotCount 4`, `rootCause.payload.chosen.reason KEPT`, `confidence MEDIUM`; links unchanged. History sentence: `Operations Manager refreshed the analysis: root cause Budget Code Missing (HIGH) → Budget Code Missing (MEDIUM); impact unchanged (17 customer orders, 4 customers, 31,400.00 USD).`
8. Direct `UPDATE exception_comments …`, `DELETE FROM exception_evidence …` and `UPDATE exception_snapshots …` each raise an error.

### X8. List (built set, `evaluatedAt=2026-10-07T12:00:00Z`)

Ten exceptions inserted by a test helper in this order (so numbers ascend L1…L10). The helper fills the FR-013 fields that the CHECKs of data-model §1b require (for example `waitingReason` for L3, resolution fields for L6–L8, verification for L7–L8, closure for L8). Times are 2026, UTC. FIN/WH = the teams, M/A = Operations Manager/Analyst.

| | Status | Sev | Pri | Owner | Created | Due | Outcome / SLA at T |
|---|---|---|---|---|---|---|---|
| L1 | OPEN | CRITICAL | P1 | FIN | 10-07 09:00 | 10-07 13:00 | AT_RISK (remaining 1h = 25%) |
| L2 | IN_PROGRESS | HIGH | P2 | M | 10-06 20:00 | 10-07 20:00 | ON_TRACK |
| L3 | WAITING | MEDIUM | P3 | WH | 10-04 08:00 | 10-07 08:00 | BREACHED |
| L4 | REOPENED | LOW | P4 | A | 10-01 12:00 | 10-08 12:00 | AT_RISK (at-risk from 10-06 18:00) |
| L5 | OPEN | HIGH | P1 | — | 10-07 11:00 | 10-08 11:00 | ON_TRACK |
| L6 | RESOLVED | CRITICAL | P1 | FIN | 10-05 10:00 | 10-05 14:00 | MET (resolved 10-05 13:00) |
| L7 | VERIFIED | MEDIUM | P3 | WH | 10-02 10:00 | 10-05 10:00 | MISSED (resolved 10-05 11:00) |
| L8 | CLOSED | LOW | P4 | M | 09-25 10:00 | 10-02 10:00 | MET (resolved 10-01 10:00) |
| L9 | OPEN | MEDIUM | P2 | A | 10-06 12:00 | 10-09 12:00 | ON_TRACK |
| L10 | IN_PROGRESS | CRITICAL | P1 | WH | 10-07 06:00 | 10-07 10:00 | BREACHED |

Expected (default sort `SLA_DUE` unless stated):

| Request | As | Items, in order |
|---|---|---|
| `view=ALL&sort=NEWEST` | any | L5, L1, L10, L2, L9, L6, L3, L7, L4, L8 |
| `view=UNRESOLVED` | any | L3, L10, L1, L2, L5, L4, L9 |
| `view=UNRESOLVED&sort=SEVERITY` | any | L10, L1, L2, L5, L3, L9, L4 |
| `view=UNRESOLVED&sort=PRIORITY` | any | L10, L1, L5, L2, L9, L3, L4 |
| `view=OPEN` | any | L1, L5, L4, L9 |
| `view=CRITICAL` | any | L10, L1 |
| `view=MINE` | M / A | L2 / L4, L9 |
| `view=MY_TEAMS` | M / A | L1 / L3, L10 |
| `view=SLA_AT_RISK` | any | L3, L10, L1, L4 |
| `view=ALL&sla=MET,MISSED&sort=NEWEST` | any | L6, L7, L8 |
| `view=ALL&owner=UNASSIGNED` | any | L5 |
| `view=ALL&severity=CRITICAL&status=RESOLVED` | any | L6 |
| `view=ALL&sort=NEWEST&limit=3`, following `nextCursor` | any | [L5, L1, L10], [L2, L9, L6], [L3, L7, L4], [L8]; `total 10` on every page; last `nextCursor null` |
| `view=ALL&q=EX-<L7 number>` | any | L7 |

Each row's `sla.sentence` matches § SLA sentences; for L1: `Due 2026-10-07T13:00:00.000Z; only 1h remaining, within the last 25% of the 4h SLA window.` Repeating any request 100 times gives identical bodies (SC-008).

### X9. Creation variants

- **From an entity, no root cause**: Operations Analyst creates for Warehouse WH-EAST-02 (`createdFrom ENTITY`, type `DATA_INCONSISTENCY`, `LOW`) → 201; `rootCause.payload.status NOT_BLOCKED`, `chosen null`, `candidates []`; `impact.payload.anchorRole SUBJECT`, anchor WH-EAST-02, exposure USD 31,400.00 all potential (006 fixture I9); links = [WH-EAST-02 `SUBJECT`].
- **From a root cause**: Operations Analyst creates for Shipment SHP-77120 with `rootCauseEntityId` = BR-18492 (`createdFrom ROOT_CAUSE`) → `chosen.reason SELECTED`, `confidence MEDIUM` (stale evidence at the real current time).
- **Root cause not a candidate**: same with `rootCauseEntityId` = Payment PAY-88213 → 400 `rootCauseEntityId`; no exception, audit row or notification is written.
- **Suggestions** (shared unit test): `suggestExceptionDraft` gives Shipment SHP-77120 → (`SHIPMENT_DELAY`, `Shipment SHP-77120 (consolidated) Delayed`); Order #18492 → (`BLOCKED_ORDER`, `Order #18492 Blocked`); Acme Corp delivery SLA → (`SLA_RISK`, `Acme Corp delivery SLA At Risk`); Finance approval APR-2291 → `MISSING_APPROVAL`; Warehouse WH-EAST-02 → (`null`, `East Distribution Center 02 Active`).

### Validation and access

| Request | Expected |
|---|---|
| No token, on any of the 27 routes | 401 |
| `POST /exceptions` with `title: '   '` / 201 characters | 400 on `title` |
| `POST /exceptions` with `severity: 'URGENT'` / `type: 'OTHER'` | 400 on that field |
| `POST /exceptions` with an extra property | 400 (strict) |
| `POST /exceptions` with `slaDueAt` as an Analyst | 403, audited |
| `GET /exceptions?view=SOON` / `sort=AGE` / `limit=201` / `entityRole=SUBJECT` without `entityId` | 400 on that field |
| `POST …/transitions` with `action: 'RESOLVE'` and no `resolutionNote` | 400 on `resolutionNote` |
| `POST …/transitions` with `action: 'ARCHIVE'` | 400 on `action` |
| Any mutation without `expectedVersion` (routes 4–8) | 400 on `expectedVersion` |
| `GET /exceptions/<unknown uuid>` / malformed id | 404 / 400 |
| `POST /teams` as OPS_MANAGER or ANALYST | 403, `auth.forbidden` |
| `POST /teams` with `name: 'finance operations'` after X1 | 409 `TEAM_NAME_TAKEN` |
| `POST /notifications/<someone else's id>/read` | 404, nothing changes |

None of the refused requests writes an exception, comment, evidence item, link, snapshot, team, membership or notification, or an `exception.*`, `team.*` or `notification.read` audit row.
