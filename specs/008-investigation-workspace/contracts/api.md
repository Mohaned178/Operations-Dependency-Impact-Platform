# API Contract: Investigation Workspace

**Feature**: `008-investigation-workspace` | **Date**: 2026-10-07

All schemas live in `@opsgraph/shared`:
- `packages/shared/src/investigations.ts` (constants in data-model §2b, schemas below);
- `packages/shared/src/analysis-snapshots.ts` (moved from 007, data-model §2a).

Both are re-exported from `index.ts`. The backend validates every request with them, and the web app parses every response with them. `EntityRefDtoSchema`, `PageQuerySchema`, `TimelineItemDtoSchema`, 007's `ExceptionSummaryDtoSchema`, `ExceptionSeveritySchema`, `ActorRefDtoSchema` (007's `UserRefDtoSchema` with `active`, see 007 contracts note) and the snapshot schemas are reused unchanged.

**Reused unchanged by the web app** (no server change): `GET /api/entities?q=`, `GET /api/entities/:id`, `GET /api/entities/:id/neighbors`, `GET /api/entities/:id/source-records`, `GET /api/entities/:id/neighborhood` (004), `GET /api/entities/:id/blockers`, `GET /api/entities/:id/root-cause` (005), `GET /api/entities/:id/evidence-notes` (005), `GET /api/entities/:id/impact*` (006), `GET /api/exceptions*`, `POST /api/exceptions` (007), `GET /api/owner-directory` (007).

---

## Routes

| # | Method | Path | Roles | Success | Errors |
|---|---|---|---|---|---|
| 1 | GET | `/api/investigations` | all signed-in | 200 `InvestigationListResponse` | 400, 401 |
| 2 | POST | `/api/investigations` | all signed-in | 201 `InvestigationDetailResponse` | 400, 401 |
| 3 | GET | `/api/investigations/:id` | all signed-in | 200 `InvestigationDetailResponse` | 400, 401, 404 |
| 4 | PATCH | `/api/investigations/:id` | contributors; `ownerId`: owner or managers | 200 `InvestigationDetailResponse` | 400, 401, 403, 404, 409 |
| 5 | POST | `/api/investigations/:id/transitions` | see spec FR-020 | 200 `InvestigationDetailResponse` | 400, 401, 403, 404, 409 |
| 6 | GET | `/api/investigations/:id/pins` | all signed-in | 200 `PinListResponse` | 400, 401, 404 |
| 7 | POST | `/api/investigations/:id/pins` | contributors | 201 `InvestigationDetailResponse` | 400, 401, 403, 404, 409 |
| 8 | POST | `/api/investigations/:id/pins/:pinId/unpin` | contributors | 200 `InvestigationDetailResponse` | 400, 401, 403, 404, 409 |
| 9 | POST | `/api/investigations/:id/entities` | contributors | 201 `ScopeEntityDto` | 400, 401, 403, 404, 409 (Closed) |
| 10 | DELETE | `/api/investigations/:id/entities/:entityId` | contributors | 204 | 400, 401, 403, 404, 409 (Closed) |
| 11 | POST | `/api/investigations/:id/exceptions` | contributors | 201 `LinkedExceptionDto` | 400, 401, 403, 404, 409 (Closed) |
| 12 | DELETE | `/api/investigations/:id/exceptions/:exceptionId` | contributors | 204 | 400, 401, 403, 404, 409 (Closed) |
| 13 | GET | `/api/investigations/:id/decisions` | all signed-in | 200 `DecisionListResponse` | 400, 401, 404 |
| 14 | POST | `/api/investigations/:id/decisions` | contributors | 201 `DecisionDto` | 400, 401, 403, 404, 409 |
| 15 | GET | `/api/investigations/:id/notes` | all signed-in | 200 `InvestigationNoteListResponse` | 400, 401, 404 |
| 16 | POST | `/api/investigations/:id/notes` | all signed-in | 201 `InvestigationNoteDto` | 400, 401, 404 |
| 17 | GET | `/api/investigations/:id/timeline` | all signed-in | 200 `InvestigationTimelineResponse` | 400, 401, 404 |
| 18 | GET | `/api/investigations/:id/history` | all signed-in | 200 `InvestigationHistoryResponse` | 400, 401, 404 |

**Controllers** (`apps/api/src/investigations/`):
- `InvestigationsController` (`@Controller('investigations')`): routes 1–5, 17, 18;
- `PinsController` (`@Controller('investigations/:id/pins')`): routes 6–8;
- `InvestigationScopeController` (`@Controller('investigations/:id')`): routes 9–12;
- `DecisionsController` and `InvestigationNotesController` (`@Controller('investigations/:id')`): routes 13–16.

Path ids use `ParseUUIDPipe`; bodies and queries use `ZodValidationPipe`. Controllers take `@CurrentUser()` and pass it to services.

**Error codes**: no new codes. `VERSION_CONFLICT` and `INVALID_STATE` come from 007.

| Code | Status | Message | When |
|---|---|---|---|
| `VERSION_CONFLICT` | 409 | `The investigation was changed by someone else` + detail `{ path: 'expectedVersion', message: 'Current version is N' }` | research R6, R10 |
| `INVALID_STATE` | 409 | research R4 messages | transitions, Close with unresolved exceptions, Closed refusals |

**Permission refusals** write `auth.forbidden` standalone with `metadata: { method, path, role, investigationId, action }`, then 403.

---

## Audit rows

Every row is written in the same transaction as the change, with `targetType 'investigation'` and `targetId` = investigation id (research R14).

| Route | `action` | `before` | `after` | `metadata` |
|---|---|---|---|---|
| 2 | `investigation.created` | — | `InvestigationCore` (all fields) + `rootCause`/`impact` digests (when pinned) | `{ createdFrom, pinIds }` |
| 4 | `investigation.updated` | changed fields | changed fields | — |
| 5 | `investigation.status_changed` | changed fields (status, resolution and closure details, reopenCount) | same | `{ transition, note }` |
| 7 | `investigation.pinned` | `{ rootCause?, impact? }` digests of the current pins before (`null` when none) | the same after | `{ pinIds }` |
| 8 | `investigation.unpinned` | `{ rootCause }` or `{ impact }` current digest before | after | `{ pinId, kind, reason }` |
| 9 | `investigation.entity_added` | — | `{ entityId, displayName, type }` | — |
| 10 | `investigation.entity_removed` | `{ entityId, displayName, type }` | — | — |
| 11 | `investigation.exception_linked` | — | `{ exceptionId, key, title }` | — |
| 12 | `investigation.exception_unlinked` | `{ exceptionId, key, title }` | — | — |
| 14 | `investigation.decision_recorded` | — | `{ decisionId, statement, rationale, supersedesDecisionId, citationCount }` | `{ decisionId }` |
| 16 | `investigation.note_added` | — | `InvestigationNoteDto` | — |

No-ops write nothing and do not bump the version: a PATCH whose values equal the current ones, unpinning an unpinned pin.

---

## Shared building blocks

```ts
// investigations.ts
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v === undefined || v === '' ? null : v));
const version = z.number().int().min(1);

export const InvestigationStatusSchema = z.enum(INVESTIGATION_STATUSES);
export const InvestigationTransitionActionSchema = z.enum(INVESTIGATION_TRANSITION_ACTIONS);
export const InvestigationCreatedFromSchema = z.enum(['INVESTIGATIONS_AREA', 'ENTITY', 'SEED']);
export const InvestigationViewSchema = z.enum(INVESTIGATION_VIEWS);
export const InvestigationSortSchema = z.enum(INVESTIGATION_SORTS);
export const PinKindSchema = z.enum(['ROOT_CAUSE', 'IMPACT']);
export const PinAnchorSchema = z.enum(['ROOT_CAUSE', 'FOCUS']);
export const ScopeReasonKindSchema = z.enum(SCOPE_REASON_KINDS);
const depth = z.number().int().min(1).max(10).default(INVESTIGATION_LIMITS.defaultDepth);
```

---

## Request schemas

```ts
export const CreateInvestigationRequestSchema = z.object({
  title: trimmed(INVESTIGATION_LIMITS.titleMax),
  description: optionalTrimmed(INVESTIGATION_LIMITS.descriptionMax),
  severity: ExceptionSeveritySchema,
  focusEntityId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),                     // default: the creator
  pin: z.boolean().default(true),
  createdFrom: z.enum(['INVESTIGATIONS_AREA', 'ENTITY']),
}).strict();

export const UpdateInvestigationRequestSchema = z.object({
  expectedVersion: version,
  title: trimmed(INVESTIGATION_LIMITS.titleMax).optional(),
  description: z.string().trim().max(INVESTIGATION_LIMITS.descriptionMax).nullable().optional()
    .transform((v) => (v === '' ? null : v)),
  severity: ExceptionSeveritySchema.optional(),
  ownerId: z.string().uuid().optional(),                     // owner or managers (403 otherwise)
}).strict().refine((b) => Object.keys(b).some((k) => k !== 'expectedVersion'), {
  message: 'At least one field must be provided',
});

export const TransitionInvestigationRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('RESOLVE'), expectedVersion: version, resolutionSummary: trimmed(2000) }).strict(),
  z.object({ action: z.literal('CLOSE'), expectedVersion: version }).strict(),
  z.object({ action: z.literal('REOPEN'), expectedVersion: version, reopenReason: trimmed(500) }).strict(),
]);

export const CreatePinRequestSchema = z.object({
  expectedVersion: version,
  rootCause: z.object({ rootCauseEntityId: z.string().uuid().optional(), depth }).strict().optional(),
  impact: z.object({ anchor: PinAnchorSchema.optional(), depth }).strict().optional(),
}).strict().refine((b) => b.rootCause !== undefined || b.impact !== undefined, {
  message: 'Pin a root cause, an impact, or both', path: ['rootCause'],
});

export const UnpinRequestSchema = z.object({ expectedVersion: version, reason: trimmed(500) }).strict();

export const PinListQuerySchema = PageQuerySchema.extend({ kind: PinKindSchema.optional() });

export const AddScopeEntityRequestSchema = z.object({ entityId: z.string().uuid() }).strict();
export const LinkExceptionRequestSchema = z.object({ exceptionId: z.string().uuid() }).strict();

export const CreateDecisionRequestSchema = z.object({
  expectedVersion: version,
  statement: trimmed(INVESTIGATION_LIMITS.statementMax),
  rationale: trimmed(INVESTIGATION_LIMITS.rationaleMax),
  supersedesDecisionId: z.string().uuid().optional(),
  citations: z.array(CitationInputSchema).max(INVESTIGATION_LIMITS.citationsMax).default([]),
}).strict();

export const CreateInvestigationNoteRequestSchema = z.object({ text: trimmed(INVESTIGATION_LIMITS.noteMax) }).strict();

const csv = /* 007's csv helper, moved to common.ts as `csvArray` and reused by both */;

export const InvestigationListQuerySchema = PageQuerySchema.extend({
  view: InvestigationViewSchema.default('OPEN'),
  status: csv(InvestigationStatusSchema),
  severity: csv(ExceptionSeveritySchema),
  owner: z.string().regex(/^(ME|USER:[0-9a-f-]{36})$/i).optional(),
  entityId: z.string().uuid().optional(),                    // involves (research R8)
  focusEntityId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: InvestigationSortSchema.default('UPDATED'),
  evaluatedAt: z.string().datetime().optional(),
});

export const InvestigationDetailQuerySchema = z.object({ evaluatedAt: z.string().datetime().optional() });

export const InvestigationTimelineQuerySchema = PageQuerySchema.extend({
  entityId: csv(z.string().uuid()),
  entityType: csv(EntityTypeSchema),
  kind: z.enum(['EVENT', 'STATE']).optional(),
  sourceSystem: csv(z.string().trim().min(1).max(100)),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).superRefine(/* from > to → issue on 'to': 'Must not be before from' */);
```

**Semantic validation** (400 `VALIDATION_FAILED`, one detail each):

| Condition | `path` | `message` |
|---|---|---|
| focus entity does not exist | `focusEntityId` | `Entity not found` |
| owner unknown / deactivated | `ownerId` | `User not found` / `User is deactivated` |
| selected root cause not a current candidate | `rootCause.rootCauseEntityId` | `Not a current root-cause candidate of the focus entity` |
| impact anchor ROOT_CAUSE without a root cause | `impact.anchor` | `There is no pinned root cause to use as anchor` |
| pin not of this investigation | (404 `NOT_FOUND`) | — |
| scope entity missing / already added / 40 added | `entityId` | `Entity not found` / `Entity is already added` / `An investigation can add at most 40 entities` |
| remove an entity that was not added | `entityId` | `Only added entities can be removed` |
| exception missing / already linked / 20 linked / not linked (unlink) | `exceptionId` | `Exception not found` / `Exception is already linked` / `An investigation can link at most 20 exceptions` / `Exception is not linked` |
| citation invalid (research R10) | `citations.<i>` | `Source record not found` / `Source record is not evidence of this investigation` / `Evidence note not found or retracted` / `Evidence note is not about an entity in scope` / `Exception evidence not found or detached` / `Exception is not linked` / `Already cited` |
| superseded decision missing / other investigation / already superseded | `supersedesDecisionId` | `Decision not found` / `Decision not found` / `Decision is already superseded` |
| timeline entity filter not in scope | `entityId.<i>` | `Entity is not in the investigation scope` |
| list or timeline cursor mismatch / malformed | `cursor` | `Invalid cursor` |

`ownerId` sent by a contributor who is neither the owner nor a manager is **403** (audited), not 400.

---

## Response schemas

```ts
export const InvestigationDtoSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int().min(1),
  key: z.string(),                                         // formatInvestigationNumber(number)
  title: z.string(),
  description: z.string().nullable(),
  severity: ExceptionSeveritySchema,
  status: InvestigationStatusSchema,
  focus: EntityRefDtoSchema,                               // live
  owner: ActorRefDtoSchema,                                // { id, displayName, active }
  createdFrom: InvestigationCreatedFromSchema,
  createdBy: ActorRefDtoSchema.nullable(),                 // null = System
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  resolution: z.object({ by: ActorRefDtoSchema, at: z.string().datetime(), summary: z.string() }).nullable(),
  closure: z.object({ by: ActorRefDtoSchema, at: z.string().datetime() }).nullable(),
  reopenCount: z.number().int().min(0),
  version: z.number().int().min(1),
});

const PinBase = z.object({
  id: z.string().uuid(),
  takenAt: z.string().datetime(),
  takenBy: ActorRefDtoSchema.nullable(),                   // null = System
  current: z.boolean(),
  unpin: z.object({ by: ActorRefDtoSchema, at: z.string().datetime(), reason: z.string() }).nullable(),
});
export const PinDtoSchema = z.discriminatedUnion('kind', [
  PinBase.extend({ kind: z.literal('ROOT_CAUSE'), payload: RootCauseSnapshotSchema }),
  PinBase.extend({ kind: z.literal('IMPACT'), payload: ImpactSnapshotSchema }),
]);
export const PinListResponseSchema = z.object({
  items: z.array(PinDtoSchema),                            // seq DESC; the UI shows the current pin first
  nextCursor: z.string().nullable(),
});

export const ScopeReasonDtoSchema = z.object({
  kind: ScopeReasonKindSchema,
  roles: z.array(CausalRoleSchema).optional(),
  anchorRole: z.enum(['ROOT_CAUSE', 'SUBJECT']).optional(),
  exception: z.object({ id: z.string().uuid(), key: z.string() }).optional(),
  addedBy: ActorRefDtoSchema.nullable().optional(),
  addedAt: z.string().datetime().optional(),
  text: z.string(),                                        // § Scope reason text
});
export const ScopeEntityDtoSchema = z.object({
  entity: EntityRefDtoSchema,                              // live
  reasons: z.array(ScopeReasonDtoSchema).min(1),
  removable: z.boolean(),                                  // has an ADDED reason and the caller may change scope
});

export const LinkedExceptionDtoSchema = z.object({
  exception: ExceptionSummaryDtoSchema,                    // 007, SLA at evaluatedAt
  linkedBy: ActorRefDtoSchema.nullable(),
  linkedAt: z.string().datetime(),
});

export const InvestigationPermissionsDtoSchema = z.object({
  edit: z.boolean(),
  changeOwner: z.boolean(),
  pin: z.boolean(),
  unpin: z.boolean(),
  changeScope: z.boolean(),
  linkExceptions: z.boolean(),
  decide: z.boolean(),
  addNote: z.boolean(),                                    // always true for signed-in users
  transitions: z.array(InvestigationTransitionActionSchema),
});

export const InvestigationDetailResponseSchema = z.object({
  investigation: InvestigationDtoSchema,
  evaluatedAt: z.string().datetime(),
  currentPins: z.object({ rootCause: PinDtoSchema.nullable(), impact: PinDtoSchema.nullable() }),
  scope: z.array(ScopeEntityDtoSchema).max(100),           // focus first, then type, displayName, id
  linkedExceptions: z.array(LinkedExceptionDtoSchema).max(20),   // unresolved first, then slaDueAt, number
  latest: z.object({ decision: DecisionDtoSchema.nullable(), note: InvestigationNoteDtoSchema.nullable() }),
  counts: z.object({
    pins: z.number().int().min(0), unpinnedPins: z.number().int().min(0),
    decisions: z.number().int().min(0), notes: z.number().int().min(0), addedEntities: z.number().int().min(0),
  }),
  permissions: InvestigationPermissionsDtoSchema,
});

export const InvestigationSummaryDtoSchema = InvestigationDtoSchema.pick({
  id: true, number: true, key: true, title: true, severity: true, status: true, focus: true, owner: true,
  createdAt: true, lastActivityAt: true, version: true,
}).extend({
  rootCause: z.object({
    takenAt: z.string().datetime(),
    status: RootCauseStatusSchema,
    label: z.string().nullable(),
    confidence: ConfidenceSchema.nullable(),
    insufficientEvidence: z.boolean(),
  }).nullable(),                                           // null = not pinned
  impact: z.object({
    takenAt: z.string().datetime(),
    anchor: EntityRefDtoSchema,
    anchorRole: z.enum(['ROOT_CAUSE', 'SUBJECT']),
    orders: z.number().int().min(0), customers: z.number().int().min(0), slaCommitments: z.number().int().min(0),
    exposure: z.array(z.object({ currency: CurrencyCodeSchema, amount: AmountStringSchema })),
    lowerBound: z.boolean(),
  }).nullable(),
  sla: z.object({
    slaCommitmentsAtRisk: z.number().int().min(0),
    worstExceptionSla: z.enum(['BREACHED', 'AT_RISK', 'ON_TRACK']).nullable(),
  }),
  unresolvedExceptionCount: z.number().int().min(0),
  recurrence: z.object({ label: z.string(), rootCauseCount: z.number().int().min(1), windowDays: z.literal(30), text: z.string() }).nullable(),
});

export const InvestigationListResponseSchema = z.object({
  query: z.object({ view: InvestigationViewSchema, sort: InvestigationSortSchema, evaluatedAt: z.string().datetime() }),
  total: z.number().int().min(0),
  items: z.array(InvestigationSummaryDtoSchema),
  nextCursor: z.string().nullable(),
});

export const DecisionDtoSchema = z.object({
  id: z.string().uuid(),
  statement: z.string(),
  rationale: z.string(),
  author: ActorRefDtoSchema,
  createdAt: z.string().datetime(),
  supersedes: z.object({ id: z.string().uuid(), statement: z.string() }).nullable(),
  supersededBy: z.object({ id: z.string().uuid(), statement: z.string(), createdAt: z.string().datetime() }).nullable(),
  context: DecisionContextSchema,                          // data-model §2c, frozen
  laterStatus: z.array(z.object({                          // citations whose source changed since (research R10)
    citationIndex: z.number().int().min(0),
    status: z.enum(['RETRACTED', 'DETACHED']),
  })),
});
export const DecisionListResponseSchema = z.object({
  items: z.array(DecisionDtoSchema),                       // seq DESC
  nextCursor: z.string().nullable(),
});

export const InvestigationNoteDtoSchema = z.object({
  id: z.string().uuid(), author: ActorRefDtoSchema, text: z.string(), createdAt: z.string().datetime(),
});
export const InvestigationNoteListResponseSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(InvestigationNoteDtoSchema),              // seq DESC
  nextCursor: z.string().nullable(),
});

export const InvestigationTimelineItemDtoSchema = z.object({
  item: TimelineItemDtoSchema,                             // existing shape; EVENT.role = role of the first scope entity
  scopeEntityIds: z.array(z.string().uuid()).min(1),       // scope entities it concerns, in link order
});
export const InvestigationTimelineResponseSchema = z.object({
  scope: z.array(EntityRefDtoSchema).max(100),             // for labels and the entity filter
  items: z.array(InvestigationTimelineItemDtoSchema),      // oldest first
  nextCursor: z.string().nullable(),
});

export const InvestigationHistoryEntryDtoSchema = z.object({
  auditId: z.string(),
  occurredAt: z.string().datetime(),
  actor: ActorRefDtoSchema.nullable(),                     // null = System
  action: z.string(),
  sentence: z.string(),
  changes: z.array(HistoryChangeDtoSchema),                // 007's schema, reused
});
export const InvestigationHistoryResponseSchema = z.object({
  items: z.array(InvestigationHistoryEntryDtoSchema),      // audit id ASC
  nextCursor: z.string().nullable(),
});
```

**Cursors**:
- list: research R12;
- pins, decisions, notes: `encodeCursor({ seq })` as a decimal string; next page `seq < cursor` (newest first);
- timeline: `encodeCursor({ at, kindRank, id, f })`, where `f` is a hash of the canonical filters (research R9);
- history: the last audit id; next page `id > cursor`.

---

## Text templates

Notation as in 007 contracts: `iso(d)`, `actor` (display name or `System`), `INV` = `formatInvestigationNumber(number)`, `excerpt(s, n)`, `money(list)`, `words(state)` (005).

### Overview lines (web, `overview-text.ts`, pure)

| Situation | Text |
|---|---|
| root-cause pin, status ROOT_CAUSES_FOUND | `` `Root cause: ${chosen.label} (${chosen.confidence}), pinned ${iso(takenAt)}` ``; LOW: `` `Possible root cause — insufficient evidence: ${label} (LOW), pinned …` `` |
| root-cause pin, NOT_BLOCKED | `` `No root cause: ${focus} is ${STATE} and not blocked (pinned ${iso(takenAt)}).` `` |
| root-cause pin, UNEXPLAINED | `` `No root cause: no recorded dependency explains why ${focus} is ${STATE} (pinned ${iso(takenAt)}).` `` |
| immediate blocker | `` `Immediate blocker: ${step1.entity.displayName} (${step1.entity.currentState})` `` where step1 is the chain step with role IMMEDIATE_BLOCKER; `—` when the pin has no chain |
| impact key numbers | `` `${orders} customer orders, ${customers} customers, ${slaCommitments} SLA commitments at risk, ${money(exposure)} exposed` ``, prefixed `at least ` when `lowerBound`; anchor line `` `Impact of ${anchor} (${anchorRole === 'ROOT_CAUSE' ? 'root cause' : 'focus'}), pinned ${iso(takenAt)}` `` |
| not pinned | `Live — not pinned` before the live value |
| comparison, no difference | `The live analysis matches the pinned results.` |
| comparison, differences | heading `The live analysis differs from the pinned results:` then one line per `DigestDifference`: `` `${label}: pinned ${pinned} → live ${live}` `` |

### Scope reason text (`ScopeReasonDto.text`)

| Kind | Text |
|---|---|
| FOCUS | `Focus` |
| ROOT_CAUSE_CHAIN | `` `On the pinned root-cause chain (${roles.map(roleLabel).join(', ')})` ``, roleLabel: SYMPTOM `symptom`, IMMEDIATE_BLOCKER `immediate blocker`, UPSTREAM_CAUSE `upstream cause`, ROOT_CAUSE `root cause` |
| IMPACT_ANCHOR | `Anchor of the pinned impact` |
| EXCEPTION_SUBJECT | `` `Subject of ${key}` `` |
| EXCEPTION_ROOT_CAUSE | `` `Root cause of ${key}` `` |
| ADDED | `` `Added by ${actor} on ${iso(addedAt)}` `` |

### Recurrence text

`` `Recurring: ${label} on ${rootCauseCount} root causes in the last 30 days` `` (`rootCauseCount` = distinct root-cause entities with that label in the window, research R12).

### History sentences (`investigationHistorySentence`)

| Action | Sentence |
|---|---|
| `investigation.created` | `` `${actor} opened the investigation: ${SEVERITY_LABEL} severity, focus ${focusName}, owner ${ownerName}${pinned ? '; pinned ' + parts : ''}.` ``, `parts` = `rc(after.rootCause)` and/or `imp(after.impact)` joined with `; ` |
| `investigation.updated` | `` `${actor} changed ${labels.join(', ')}.` `` |
| `investigation.status_changed` | `` `${actor} ${VERB}: ${STATUS_LABEL(from)} → ${STATUS_LABEL(to)}.` `` + (note ? `` ` ${NOTE_LABEL}: ${note}` `` : '') |
| `investigation.pinned` | `` `${actor} pinned ${parts.join('; ')}.` ``, each part `` `root cause ${rc(after)} (previously ${rc(before)})` `` or `` `impact ${imp(after)} (previously ${imp(before)})` ``; `before` null → `(previously none)` |
| `investigation.unpinned` | `` `${actor} unpinned the ${kind === 'ROOT_CAUSE' ? 'root cause' : 'impact'} ${x(before)}; now ${x(after)}. Reason: ${reason}` `` |
| `investigation.entity_added` / `entity_removed` | `` `${actor} added ${displayName} (${type}) to the scope.` `` / `` `${actor} removed ${displayName} (${type}) from the added entities.` `` |
| `investigation.exception_linked` / `exception_unlinked` | `` `${actor} linked ${key} "${title}".` `` / `` `${actor} unlinked ${key} "${title}".` `` |
| `investigation.decision_recorded` | `` `${actor} recorded a decision: ${excerpt(statement, 120)}${supersedes ? ' (supersedes an earlier decision)' : ''}` `` |
| `investigation.note_added` | `` `${actor} added a note: ${excerpt(text, 120)}` `` |

- `VERB`: RESOLVE `resolved the investigation`, CLOSE `closed the investigation`, REOPEN `reopened the investigation`.
- `NOTE_LABEL`: RESOLVE `Resolution`, REOPEN `Reason`.
- `rc(d)` and `imp(d)` are 007's (`rc` = `` `${label} (${confidence})` `` or `none`; `imp` = `` `${orders} customer orders, ${customers} customers, ${money(exposure)}` ``, plus ` (at least)` when `lowerBound`). `x(d)` is `rc` or `imp` by kind.
- Field labels: title `Title`, description `Description`, severity `Severity`, owner `Owner`, status `Status`, resolutionSummary `Resolution summary`, resolvedAt `Resolved at`, resolvedBy `Resolved by`, closedAt `Closed at`, closedBy `Closed by`, reopenCount `Reopens`, rootCause `Pinned root cause`, impact `Pinned impact`.

---

## Acceptance fixtures

Users: the seeded **Admin**, **Operations Manager** (M) and **Operations Analyst** (A), plus **Second Analyst** (S, ANALYST) created by the test. Entity names are as in 003–007 fixtures. `investigations-seed.e2e-spec.ts` asserts V1–V3 on a freshly seeded database; the other files assert V4–V8.

### V1. Seeded reference investigation

- `GET /api/investigations?view=ALL` has `total 1`. The item:
  - `key "INV-10001"`, `title "Why is Order #18492 delayed?"`, `severity CRITICAL`, `status OPEN`, `focus` Order #18492 (BLOCKED), `owner` Operations Analyst;
  - `rootCause = { status ROOT_CAUSES_FOUND, label "Budget Code Missing", confidence HIGH, insufficientEvidence false }`;
  - `impact = { anchor Budget code for Order #18492, anchorRole ROOT_CAUSE, orders 17, customers 4, slaCommitments 3, exposure [USD 31400.00], lowerBound false }`;
  - `sla.slaCommitmentsAtRisk 3`; `worstExceptionSla` = EX-10001's SLA status at `evaluatedAt`; `unresolvedExceptionCount 1`; `recurrence null`.
- Detail:
  - `investigation.createdFrom SEED`, `createdBy null`, `version 1`;
  - `currentPins.rootCause.payload`: `query.entityId` = Order #18492, `query.evaluatedAt "2026-09-29T16:00:00.000Z"`, `status ROOT_CAUSES_FOUND`, `summary "Order #18492 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH)."`, `chosen.reason FIRST_RANKED`, `chosen.keyEvidence` = 005 fixture R1's 6 records in order, `chosen.eventCount 7`, `chosen.chain` = 4 steps: Order #18492 `[SYMPTOM]`, Payment PAY-88213 `[IMMEDIATE_BLOCKER]` (PENDING), Finance approval APR-2291 `[UPSTREAM_CAUSE]`, Budget code for Order #18492 `[ROOT_CAUSE]`, each hop REQUIRES, FORWARD, SOURCE / HIGH;
  - `currentPins.impact.payload` = 006 fixture I7 (categories Order 17, Customer 4, Shipment 1, SLA 4 with current 3, Approval 1, Invoice 1, Payment 1; USD 31,400.00 all current);
  - `linkedExceptions` = [EX-10001], `linkedBy null`;
  - `counts.pins 2`, all other counts 0; `latest.decision null`, `latest.note null`.
- Overview lines (web unit test on this payload): `Root cause: Budget Code Missing (HIGH), pinned …`, `Immediate blocker: Payment PAY-88213 (PENDING)`, `17 customer orders, 4 customers, 3 SLA commitments at risk, 31,400.00 USD exposed`.
- Audit: exactly one `investigation.created` row (`actorType 'system'`, `metadata.createdFrom 'SEED'`, 2 `pinIds`) and one `investigation.exception_linked` row for it. `GET …/history` has those 2 entries; the first sentence is `System opened the investigation: Critical severity, focus Order #18492, owner Operations Analyst; pinned Budget Code Missing (HIGH); 17 customer orders, 4 customers, 31,400.00 USD.`
- `analysis_snapshots`: the 2 pins have `investigation_id` set and `exception_id` null; the ROOT_CAUSE pin has `root_cause_label 'Budget Code Missing'`, `root_cause_entity_id` = BR-18492 and `chain_entity_ids` = [Order #18492, PAY-88213, APR-2291, BR-18492]. EX-10001's snapshots have `exception_id` set, `investigation_id` null, and its ROOT_CAUSE row has `root_cause_label 'Budget Code Missing'`.
- Re-running the seed creates nothing and writes no audit row.

### V2. Seeded scope

`scope` of INV-10001, in order, with reason texts:

| Entity | Reasons |
|---|---|
| Order #18492 | `Focus`; `On the pinned root-cause chain (symptom)` |
| Finance approval APR-2291 (Approval) | `On the pinned root-cause chain (upstream cause)` |
| Budget code for Order #18492 (BudgetRequirement) | `On the pinned root-cause chain (root cause)`; `Anchor of the pinned impact`; `Root cause of EX-10001` |
| Payment PAY-88213 (Payment) | `On the pinned root-cause chain (immediate blocker)` |
| Shipment SHP-77120 (consolidated) (Shipment) | `Subject of EX-10001` |

(Focus first, then by entity type name: Approval, BudgetRequirement, Payment, Shipment.) Every `removable` is false. `GET /api/investigations?view=ALL&entityId=<X>` returns INV-10001 for each of these 5 entities and for no other seeded entity (for example not for Customer Acme Corp).

### V3. Seeded timeline

- `GET …/timeline?kind=EVENT` → 8 items, oldest first: EVT-OMS-1001 (09:12, `scopeEntityIds` [Order #18492]), EVT-PAY-2001 (09:14, [PAY-88213, Order #18492]), EVT-FA-3001 (10:03, [APR-2291, PAY-88213]), EVT-FA-3002 (10:05, [APR-2291, BR-18492]), EVT-FA-3003 (10:22, [APR-2291]), EVT-WMS-4001 (11:40, [Order #18492]), EVT-TMS-5001 (14:32, [SHP-77120, Order #18492]), EVT-CLM-6001 (15:10, [SHP-77120]). All on 2026-09-29, UTC.
- `?kind=EVENT&limit=3` paged: [1001, 2001, 3001], [3002, 3003, 4001], [5001, 6001], last `nextCursor null`.
- `?entityId=<APR-2291>&kind=EVENT` → EVT-FA-3001, EVT-FA-3002, EVT-FA-3003. `?entityType=Shipment&kind=EVENT` → EVT-TMS-5001, EVT-CLM-6001. `?sourceSystem=FinanceApprovals` → the 3 FA events plus the state observations of the scope entities reported by FinanceApprovals. `?from=2026-09-29T10:00:00Z&to=2026-09-29T11:00:00Z&kind=EVENT` → the 3 FA events.
- Without filters: the 8 events and every state observation of the 5 scope entities, merged with the existing rule (events before states at equal times); every state observation of the 5 entities appears exactly once.
- `?entityId=<Customer Acme Corp>` → 400 `entityId.0`.
- `GET /api/entities/<Order #18492>/timeline` returns the same body as before this feature (regression).

### V4. Pins (sequence on INV-10001 after V1; versions start at 1)

| # | Actor | Request | Result |
|---|---|---|---|
| 1 | S | `POST …/pins { expectedVersion 1, rootCause: {} }` | 403; one `auth.forbidden` (`metadata.action 'PIN'`) |
| 2 | A | `{ expectedVersion 1, rootCause: { rootCauseEntityId: <PAY-88213> } }` | 400 `rootCause.rootCauseEntityId` |
| 3 | A | `{ expectedVersion 1, rootCause: {} }` | 201; `version 2`; new current root-cause pin with `chosen.reason FIRST_RANKED`, `confidence MEDIUM` (005 R6: STALE_EVIDENCE at the real time); the seeded pin is listed with `current false`, still `confidence HIGH`; `counts.pins 3` |
| 4 | A | `{ expectedVersion 2, impact: { anchor: 'FOCUS' } }` | 201; `version 3`; current impact pin anchored on Order #18492, `anchorRole SUBJECT`, 006 fixture I8 (16 orders, 18,920.00 USD); `slaCommitmentsAtRisk 3` |
| 5 | M | `POST …/pins/<pin of step 4>/unpin { expectedVersion 3, reason "Use the root-cause anchor" }` | 200; `version 4`; current impact pin = the seeded one (BR-18492, 17 orders); the step-4 pin has `current false`, `unpin.reason` set |
| 6 | M | same unpin again with `expectedVersion 4` | 200, version 4, no audit row |
| 7 | M | `{ expectedVersion 3, rootCause: {} }` | 409 `VERSION_CONFLICT`, `Current version is 4` |
| 8 | A | `{ expectedVersion 4, impact: { anchor: 'ROOT_CAUSE' } }` | 201; anchor BR-18492 (root-cause entity of the step-3 pin) |

**Data change after pinning**: the test imports a state observation `Payments PAY-88213 = COMPLETED` (observed now). Then:
- `GET …/pins` returns every pin's `payload` byte-identical to before the import;
- `GET /api/entities/<Order #18492>/root-cause` no longer names "Budget Code Missing" through PAY-88213 (live changed);
- the shared `compareDigests(pinnedDigest, liveDigest)` (unit test with the two payloads) reports a difference on `rootCauseLabel` or `confidence`.

**Anchor rule unit cases** (`pins.service.spec.ts` with stubbed analyses): no root-cause pin + `anchor ROOT_CAUSE` → 400 `impact.anchor`; no anchor + root-cause pin naming BR → BR; no anchor + NOT_BLOCKED pin → focus; both kinds in one request → anchor = the root cause pinned in the same request.

### V5. Scope and exception links (on INV-10001 after V1)

| # | Actor | Request | Result |
|---|---|---|---|
| 1 | A | add Customer Acme Corp | 201, reasons [`Added by Operations Analyst on …`], `removable true`; scope size 6 |
| 2 | A | add Customer Acme Corp again | 400 `entityId` `Entity is already added` |
| 3 | A | add Order #18492 | 201; Order #18492 now has reasons `Focus`, chain, `Added by …` |
| 4 | A | remove Order #18492 | 204; it stays in scope with `Focus` and the chain reason |
| 5 | A | remove Payment PAY-88213 | 400 `Only added entities can be removed` |
| 6 | S | add Warehouse WH-EAST-02 | 403 |
| 7 | M | link EX-10001 again | 400 `Exception is already linked` |
| 8 | M | link a new exception E (subject Warehouse WH-EAST-02, created by 007's API) | 201; scope gains WH-EAST-02 `Subject of EX-<n>` |
| 9 | M | unlink E | 204; WH-EAST-02 leaves the scope |

None of these bumps `version`. Each success writes one audit row; the timeline after step 1 includes EVT-OMS-1001 once (it links both Order #18492 and Acme Corp).

### V6. Lifecycle (on INV-10001; EX-10001 is OPEN)

| # | Actor | Request | Result |
|---|---|---|---|
| 1 | S | `RESOLVE` | 403 |
| 2 | A | `CLOSE` | 409 `INVALID_STATE`, `CLOSE is not allowed while the investigation is OPEN. Allowed: RESOLVE.` |
| 3 | A | `RESOLVE`, `resolutionSummary "Budget code BC-7781 supplied; Order #18492 released"` | 200, `RESOLVED`, `resolution.by` = A |
| 4 | A | `CLOSE` | 409 `INVALID_STATE`, `CLOSE is not allowed while linked exceptions are unresolved: EX-10001.` |
| 5 | — | EX-10001 is resolved, verified and closed through 007's API (X4 steps 2–9) | — |
| 6 | M | `CLOSE` | 200, `CLOSED`; for M (a manager, so a contributor): `permissions.addNote true`, `transitions ['REOPEN']`, every other flag false |
| 7 | A | `PATCH { title }`, pin, add entity, decision | each 409 `INVALID_STATE` `… while the investigation is CLOSED. Reopen it first.` |
| 8 | S | note `Customer confirmed delivery` | 201 (notes are allowed when Closed) |
| 9 | S | `REOPEN` | 403 (not a contributor) |
| 10 | A | `REOPEN`, `reopenReason "Budget code rejected by ERP"` | 200, `OPEN`, `resolution null`, `closure null`, `reopenCount 1` |

History after step 10 has, after the 2 seed entries: resolved, closed, note, reopened (4 entries; refused requests write none). Entry for step 3: `Operations Analyst resolved the investigation: Open → Resolved. Resolution: Budget code BC-7781 supplied; Order #18492 released`.

### V7. Decisions and notes (on INV-10001 after V1, version 1)

1. A records `{ expectedVersion 1, statement "Escalate to Finance Operations and hold the consolidated shipment", rationale "Releasing SHP-77120 without Order #18492 would split the load; Finance confirms the budget code will be issued today.", citations: [SOURCE_RECORD ContractMgmt CON-3982, SOURCE_RECORD FinanceApprovals APR-2291] }` → 201:
   - `context.rootCausePin.digest = { label "Budget Code Missing", entityId BR-18492, confidence HIGH }`, `context.impactPin.digest` orders 17, customers 4, slaCommitments 3, USD 31,400.00;
   - `context.focus.entity.currentState BLOCKED`, `observedAt 2026-09-29T11:40:00.000Z`, `sourceSystem OMS`;
   - `context.exceptions` = [EX-10001, OPEN, CRITICAL, its SLA];
   - citation 1 `via PINNED_KEY_EVIDENCE` (CON-3982 is not in scope; it is pinned key evidence), citation 2 `via SCOPE_ENTITY`;
   - `investigation.version` unchanged (1).
2. A cites a `SOURCE_RECORD` of Customer Acme Corp (not in scope, not pinned key evidence) → 400 `citations.0` `Source record is not evidence of this investigation`.
3. M pins a new root cause (version → 2). A records a decision with `expectedVersion 1` → 409 `VERSION_CONFLICT`.
4. M records `{ expectedVersion 2, statement "Release SHP-77120 without Order #18492", rationale "Finance needs two more days", supersedesDecisionId: <decision 1> }` → 201; `GET …/decisions` → [decision 2 (`supersedes` decision 1), decision 1 (`supersededBy` decision 2)]. Decision 1's `context` is unchanged (still HIGH).
5. Another decision superseding decision 1 → 400 `supersedesDecisionId` `Decision is already superseded`.
6. A adds a 005 evidence note on BR-18492, cites it in a decision (201), then retracts the note through 005's API: the decision's `laterStatus` = [{ citationIndex 0, status RETRACTED }], its frozen text unchanged.
7. S adds note `Customer called again at 15:00; promised update by end of day` → 201; `GET …/notes` newest first.
8. Direct `UPDATE investigation_decisions …`, `DELETE FROM investigation_notes …`, `UPDATE investigation_unpins …` and `UPDATE analysis_snapshots …` each raise an error.

### V8. List (built set on a reset database, `evaluatedAt=2026-10-07T12:00:00Z`)

Built by a test helper, in this order (numbers ascend I1…I8). Entities B1, B2, B3 (BudgetRequirement), P1, P2 (Payment), C1 (Shipment) and focus entities are created by the helper. Pins are inserted with payloads cloned from a fixture root-cause/impact snapshot, overriding `chosen.label`, `chosen.rootCause`, `chosen.chain` and the denormalized columns. Exceptions X1–X3 use 007's `insertExceptionFixture`. Times are 2026, UTC.

| | Status | Sev | Owner | Created | Last activity | Current root-cause pin (label, entity, taken) | `slaCommitmentsAtRisk` | Linked exception |
|---|---|---|---|---|---|---|---|---|
| I1 | OPEN | CRITICAL | A | 10-07 09:00 | 10-07 11:00 | Budget Code Missing, B1, 10-07 09:00 | 3 | — |
| I2 | OPEN | HIGH | M | 10-06 10:00 | 10-07 10:00 | Budget Code Missing, B2, 10-06 10:00 | 0 | X1: IN_PROGRESS, AT_RISK at T |
| I3 | RESOLVED | CRITICAL | A | 10-05 10:00 | 10-06 18:00 | Payment Failed, P1, 10-05 12:00 | 1 | — |
| I4 | CLOSED | LOW | M | 09-01 10:00 | 09-20 10:00 | Budget Code Missing, B3, **09-07 12:00:00.000** | 0 | — |
| I5 | OPEN | MEDIUM | S | 10-07 08:00 | 10-07 08:30 | none | 0 | X2: OPEN, BREACHED at T |
| I6 | OPEN | LOW | A | 10-04 10:00 | 10-05 09:00 | Payment Failed, P1, 10-04 12:00 | 0 | X3: RESOLVED (MET) |
| I7 | OPEN | CRITICAL | M | 10-03 10:00 | 10-04 09:00 | Carrier Capacity Missing, C1, 10-03 12:00 | 0 | — |
| I8 | RESOLVED | MEDIUM | A | 10-02 10:00 | 10-03 09:00 | Budget Code Missing, B1, **09-07 12:00:00.001** | 0 | — |

X1 also has a root-cause snapshot `Payment Failed` on **P2**, taken 10-06 12:00. Occurrences in the window (09-07 12:00, 10-07 12:00]: Budget Code Missing → {B1, B2} (B3's pin is exactly at the lower bound, so outside); Payment Failed → {P1, P2}; Carrier Capacity Missing → {C1}.

| Request | As | Items, in order |
|---|---|---|
| `view=ALL` (sort UPDATED) | any | I1, I2, I5, I3, I6, I7, I8, I4 |
| `view=OPEN` | any | I1, I2, I5, I6, I7 |
| `view=MINE` | A / M | I1, I3, I6, I8 / I2, I7 |
| `view=CRITICAL` | any | I1, I3, I7 |
| `view=SLA_RISK` | any | I1, I2, I5 |
| `view=RECURRING` | any | I1, I2, I3, I6, I8, I4 |
| `view=ALL&sort=NEWEST` | any | I1, I5, I2, I3, I6, I7, I8, I4 |
| `view=ALL&sort=SEVERITY` | any | I1, I3, I7, I2, I5, I8, I6, I4 |
| `view=ALL&status=RESOLVED&severity=CRITICAL` | any | I3 |
| `view=ALL&entityId=<B1>` | any | I1, I8 |
| `view=ALL&limit=3`, following `nextCursor` | any | [I1, I2, I5], [I3, I6, I7], [I8, I4]; `total 8` on every page; last `nextCursor null` |
| `view=ALL&q=INV-<I7 number>` | any | I7 |

Row checks: I1 `recurrence.text "Recurring: Budget Code Missing on 2 root causes in the last 30 days"`; I3 `recurrence.rootCauseCount 2` (P1 and P2); I7 `recurrence null`; I2 `sla.worstExceptionSla AT_RISK`; I5 `BREACHED`; I6 `null` (its exception is resolved), `unresolvedExceptionCount 0`; I5 `rootCause null`.

**Boundary variant**: with `evaluatedAt=2026-10-07T12:00:00.001Z`, I8's pin (09-07 12:00:00.001) falls exactly on the lower bound and leaves the window; Budget Code Missing → {B1, B2} still (I1's pin), so the RECURRING list is unchanged. With `evaluatedAt=2026-10-06T09:00:00Z` (window (09-06 09:00, 10-06 09:00]), I1's and I2's pins and X1's snapshot are later than T and leave the window, while I4's and I8's pins enter it: Budget Code Missing → {B3, B1}, Payment Failed → {P1}, Carrier Capacity Missing → {C1}. RECURRING = I1, I2, I8, I4 (each has a Budget Code Missing pin and the set holds another entity); I3 and I6 are not recurring (P1 only).

Repeating any request 100 times gives identical bodies (SC-007).

### Validation and access

| Request | Expected |
|---|---|
| No token, on any of the 18 routes | 401 |
| `POST /investigations` with `title: '   '` / 201 characters / no `focusEntityId` / `severity: 'URGENT'` / an extra property | 400 on that field |
| `POST /investigations` with `ownerId` of a deactivated user | 400 `ownerId` `User is deactivated` |
| `PATCH` with `ownerId` as the creator who is not the owner and not a manager | 403, audited |
| `GET /investigations?view=SOON` / `sort=AGE` / `limit=201` / `owner=TEAM:<id>` | 400 on that field |
| `POST …/transitions` with `action: 'RESOLVE'` and no `resolutionSummary` / `action: 'VERIFY'` | 400 |
| Any of routes 4, 5, 7, 8, 14 without `expectedVersion` | 400 on `expectedVersion` |
| `POST …/pins {}` (neither kind) | 400 on `rootCause` |
| `POST …/pins` with `rootCause.depth: 11` | 400 |
| `POST …/decisions` with 21 citations | 400 on `citations` |
| `GET …/timeline?from=2026-09-30T00:00:00Z&to=2026-09-29T00:00:00Z` | 400 on `to` |
| `GET /investigations/<unknown uuid>` / malformed id | 404 / 400 |
| `POST …/pins/<pin of another investigation>/unpin` | 404 |

None of the refused requests writes an investigation, pin, unpin, added entity, link, decision or note, or an `investigation.*` audit row.
