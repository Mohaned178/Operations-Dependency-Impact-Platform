# API Contract: Risk Detection and SLA Management

**Feature**: `009-risk-sla` | **Date**: 2026-10-07

All schemas live in `@opsgraph/shared`:
- `packages/shared/src/sla-clock.ts` (data-model §2a);
- `packages/shared/src/risk.ts` (constants, configuration, payloads: data-model §2b–§2e; request and response schemas below);
- `packages/shared/src/sla-terms.ts` (term schemas below).

All three are re-exported from `index.ts`. The backend validates every request with them, and the web app parses every response with them. `EntityRefDtoSchema`, `PageQuerySchema`, `ConfidenceSchema`, `EntityTypeSchema`, `OperationalStateSchema` and 007's `OwnerRefSchema`, `OwnerDtoSchema`, `ExceptionTypeSchema`, `SlaStatusSchema`, `formatDuration`, `formatExceptionNumber` are reused unchanged.

---

## Routes

| # | Method | Path | Roles | Success | Errors |
|---|---|---|---|---|---|
| 1 | GET | `/api/risks` | all signed-in | 200 `RiskListResponse` | 400, 401 |
| 2 | GET | `/api/risks/:id` | all signed-in | 200 `RiskDetailResponse` | 400, 401, 404 |
| 3 | GET | `/api/risks/:id/assessments` | all signed-in | 200 `RiskAssessmentListResponse` | 400, 401, 404 |
| 4 | GET | `/api/risk-alerts` | all signed-in | 200 `RiskAlertListResponse` | 400, 401 |
| 5 | GET | `/api/risk-preview` | all signed-in | 200 `RiskPreviewResponse` | 400, 401, 404 (entity or version) |
| 6 | GET | `/api/risk-evaluations` | all signed-in | 200 `RiskEvaluationListResponse` | 400, 401 |
| 7 | GET | `/api/risk-evaluations/:id` | all signed-in | 200 `RiskEvaluationDto` | 400, 401, 404 |
| 8 | POST | `/api/risk-evaluations` | ADMIN | 201 `RiskEvaluationDto` | 400, 401, 403, 409 `EVALUATION_IN_PROGRESS` |
| 9 | GET | `/api/risk-config` | all signed-in | 200 `RiskConfigVersionDto` | 401 |
| 10 | GET | `/api/risk-config/versions` | all signed-in | 200 `RiskConfigVersionListResponse` | 400, 401 |
| 11 | GET | `/api/risk-config/versions/:version` | all signed-in | 200 `RiskConfigVersionDto` | 400, 401, 404 |
| 12 | PUT | `/api/risk-config/rules/:type` | ADMIN | 200 `RiskConfigVersionDto` | 400, 401, 403, 409 `VERSION_CONFLICT` |
| 13 | GET | `/api/sla-terms` | all signed-in | 200 `SlaTermListResponse` | 400, 401 |
| 14 | POST | `/api/sla-terms` | ADMIN | 201 `SlaTermDto` | 400, 401, 403, 409 `SLA_TERM_CODE_TAKEN` |
| 15 | GET | `/api/sla-terms/:id` | all signed-in | 200 `SlaTermDto` | 400, 401, 404 |
| 16 | PATCH | `/api/sla-terms/:id` | ADMIN | 200 `SlaTermDto` | 400, 401, 403, 404, 409 `VERSION_CONFLICT`, `SLA_TERM_CODE_TAKEN` |
| 17 | GET | `/api/sla-clocks` | all signed-in | 200 `SlaClockListResponse` | 400, 401 |

**Controllers** (`apps/api/src/risk/`): `RisksController` (routes 1–5), `RiskEvaluationsController` (6–8), `RiskConfigController` (9–12), `SlaTermsController` (13–16), `SlaClocksController` (17). `@Roles('ADMIN')` on 8, 12, 14, 16, so `RolesGuard` audits refusals. Path ids use `ParseUUIDPipe` (route 11: `ParseIntPipe`, route 12: `RiskTypeSchema`); bodies and queries use `ZodValidationPipe`.

**Error codes** (new in `ErrorCodeSchema`, with `Errors` factories):

| Code | Status | Message | When |
|---|---|---|---|
| `EVALUATION_IN_PROGRESS` | 409 | `A risk evaluation is already running (#N, started <iso>)` | route 8 while a RUNNING row exists (research R10) |
| `SLA_TERM_CODE_TAKEN` | 409 | `Contract <name> already has an SLA term with this code` | routes 14, 16 (unique index violation `P2002`) |
| `VERSION_CONFLICT` (007) | 409 | `The <risk configuration | SLA term> was changed by someone else` + detail `{ path: 'expectedVersion', message: 'Current version is N' }` | routes 12, 16. `Errors.versionConflict(current, noun = 'exception')` gains the optional noun; 007's calls are unchanged. |

---

## Audit rows

| Source | `action` | `targetType` / `targetId` | `actorType` | `before` | `after` | `metadata` |
|---|---|---|---|---|---|---|
| route 14, seed | `sla_term.created` | `sla_term` / term id | user / system | — | `SlaTermDto` without `clockCounts` | — |
| route 16 | `sla_term.updated` | `sla_term` / term id | user | changed fields | changed fields | `{ version }` |
| seed, first evaluation | `risk.config_initialized` | `risk_config` / `1` | system | — | `{ version: 1 }` | — |
| route 12 | `risk.config_updated` | `risk_config` / new version | user | the rule before | the rule after | `{ note, version, type }` |
| runner | `risk.evaluation_started` | `risk_evaluation` / id | system, or user (MANUAL) | — | `{ number, trigger, asOf, configVersion }` | — |
| runner | `risk.evaluation_completed` | `risk_evaluation` / id | system, or user (MANUAL) | — | `RiskEvaluationDto` without `autoExceptions` | `{ autoExceptionCount }` |
| runner | `risk.evaluation_failed` | `risk_evaluation` / id | system, or user (MANUAL) | — | `{ status: 'FAILED', error }` | — |
| lifecycle | `risk.raised` | `risk` / id | system | — | `{ number, type, entityId, level, score, confidence }` | `{ evaluationId, assessmentId }` |
| lifecycle | `risk.level_changed` | `risk` / id | system | `{ level, score, confidence }` | same | `{ evaluationId, assessmentId }` |
| lifecycle | `risk.rescored` | `risk` / id | system | `{ score, confidence }` (only those that changed; `{}` when only factor anchors changed) | same | `{ evaluationId, assessmentId, changedFactorKeys }` |
| lifecycle | `risk.cleared` | `risk` / id | system | `{ status: 'OPEN', level, score }` | `{ status: 'CLEARED', clearReason }` | `{ evaluationId }` |
| auto-exception | `exception.created` (007) | `exception` / id | system | — | 007's | 007's + `{ riskId, riskNumber, evaluationId }`, `createdFrom 'RISK'` |
| auto-exception | `risk.exception_created` | `risk` / id | system | — | `{ exceptionId, number }` | `{ evaluationId }` |
| auto-exception | `risk.exception_failed` | `risk` / id | system | — | `{ attempts, error }` | `{ evaluationId }` |

Unchanged risks, no-op term updates and no-op rule updates write nothing. Skipped and deferred auto-creations write nothing (they are recorded on the evaluation).

---

## Request schemas

```ts
// risk.ts
const isoUtc = z.string().datetime();
const csvEnumArray = <T extends [string, ...string[]]>(values: T) =>   // repeated keys or comma-separated, as 007
  z.preprocess(splitCsv, z.array(z.enum(values)).max(values.length)).optional();

export const RiskListQuerySchema = z.object({
  status: z.enum(['OPEN', 'CLEARED', 'ALL']).default('OPEN'),
  level: csvEnumArray(RISK_LEVELS),
  type: csvEnumArray(RISK_TYPES),
  entityType: csvEnumArray(EntityTypeSchema.options),
  confidence: csvEnumArray(['HIGH', 'MEDIUM', 'LOW']),
  entityId: z.string().uuid().optional(),
  raisedSince: isoUtc.optional(),
  hasException: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sort: z.enum(['SCORE', 'LEVEL', 'NEWEST', 'CHANGED']).default('SCORE'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const RiskAssessmentListQuerySchema = PageQuerySchema;          // cursor = last seq, limit ≤ 200, default 50
export const RiskAlertListQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(RISK_LIMITS.alertsMaxDays).default(7),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const RiskPreviewQuerySchema = z.object({
  entityId: z.string().uuid(),
  asOf: isoUtc.optional(),                                           // default: request time, echoed
  configVersion: z.coerce.number().int().min(1).optional(),          // default: current
});
export const RiskEvaluationListQuerySchema = PageQuerySchema;          // newest first, cursor = number
export const RunRiskEvaluationRequestSchema = z.object({ asOf: isoUtc.optional() });

export const UpdateRiskRuleRequestSchema = z.object({
  expectedVersion: z.number().int().min(1),
  note: z.string().trim().min(1).max(500),
  rule: RiskRuleConfigSchema,                                        // data-model §2b; `rule.type` must equal the path type (400 on `rule.type`)
});

// sla-terms.ts
const eventType = z.string().trim().min(1).max(100).regex(/^[a-z0-9_.-]+$/);
export const CreateSlaTermRequestSchema = z.object({
  contractEntityId: z.string().uuid(),
  code: z.string().trim().regex(/^[A-Za-z0-9-]{1,32}$/),
  name: z.string().trim().min(1).max(200),
  clause: z.string().trim().min(1).max(2000),
  targetType: z.literal('Order').default('Order'),
  startEventTypes: z.array(eventType).min(1).max(5).default(['order.created']),
  stopEventTypes: z.array(eventType).max(5).default(['shipment.departed', 'shipment.delivered']),
  windowMinutes: z.number().int().min(1).max(129_600),
  atRiskPercent: z.number().int().min(1).max(99).default(25),
}).superRefine(distinctEventTypes);                                   // 400 on startEventTypes.i / stopEventTypes.i: "Duplicate event type"
export const UpdateSlaTermRequestSchema = z.object({
  expectedVersion: z.number().int().min(1),
  code: …optional, name: …optional, clause: …optional, startEventTypes: …optional, stopEventTypes: …optional,
  windowMinutes: …optional, atRiskPercent: …optional,
  active: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 1, { message: 'Nothing to change', path: [] });
export const SlaTermListQuerySchema = z.object({
  contractId: z.string().uuid().optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  asOf: isoUtc.optional(),                                           // for clockCounts
});
export const SlaClockListQuerySchema = z.object({
  status: csvEnumArray(SLA_CLOCK_STATUSES),
  contractId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
  source: z.enum(['TERM', 'SLA_RECORD']).optional(),
  asOf: isoUtc.optional(),
  cursor: z.string().optional(),                                     // { asOf, offset } (research R15)
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
```

Validation that needs the database: `contractEntityId` must be an existing Contract (400 `contractEntityId`, `Not a contract`); `autoException.owner` (400 as 007 R13); route 8's `asOf` rule (data-model §1c); route 5's `configVersion` must exist (404 `Risk configuration version`).

---

## Response schemas

```ts
// sla-clock.ts
export const SlaClockDtoSchema = z.object({
  key: z.string(),                                     // `term:<termId>:<entityId>` or `record:<slaEntityId>`
  source: z.enum(['TERM', 'SLA_RECORD']),
  entity: EntityRefDtoSchema,                          // the governed order or the SLA record
  term: z.object({ id: z.string().uuid(), code: z.string(), name: z.string(), clause: z.string(),
                   contract: EntityRefDtoSchema, atRiskPercent: z.number().int(), windowMinutes: z.number().int(),
                   authoredBy: z.string() }).nullable(),          // "System" or display name
  attachment: z.object({ origin: RelationshipOriginSchema, relationshipIds: z.array(z.string().uuid()) }).nullable(), // TERM only
  start: z.object({
    at: z.string().datetime(),
    basis: z.enum(['EVENT', 'ATTRIBUTE', 'FIRST_OBSERVATION']),
    fallback: z.boolean(),                             // FIRST_OBSERVATION
    citation: z.object({ sourceSystem: z.string(), sourceId: z.string(), observedAt: z.string().datetime(),
                         eventType: z.string().nullable() }),
  }),
  dueAt: z.string().datetime(),
  stop: z.object({ at: z.string().datetime(), basis: z.enum(['EVENT', 'STATE']), cancelled: z.boolean(),
                   citation: z.object({ sourceSystem: z.string(), sourceId: z.string(), observedAt: z.string().datetime(),
                                        eventType: z.string().nullable() }) }).nullable(),
  evaluatedAt: z.string().datetime(),
  status: SlaClockStatusSchema,
  elapsedMs: z.number().int().min(0),
  remainingMs: z.number().int().nullable(),            // negative when overdue; null when stopped or cancelled
  windowMs: z.number().int().min(0),
  remainingPercent: z.string().nullable(),             // "25%", "47.2%"; null when stopped or cancelled
  sentence: z.string(),                                // § Clock sentences
  sourceState: z.object({ state: OperationalStateSchema, sourceSystem: z.string(), observedAt: z.string().datetime() }).nullable(), // SLA_RECORD
  disagreement: z.string().nullable(),                 // § Clock sentences
});
export const SlaClockListResponseSchema = z.object({
  asOf: z.string().datetime(), items: z.array(SlaClockDtoSchema), total: z.number().int(), nextCursor: z.string().nullable(),
});

// sla-terms.ts
export const SlaTermDtoSchema = z.object({
  id: z.string().uuid(), contract: EntityRefDtoSchema, code: z.string(), name: z.string(), clause: z.string(),
  targetType: z.literal('Order'), startEventTypes: z.array(z.string()), stopEventTypes: z.array(z.string()),
  windowMinutes: z.number().int(), atRiskPercent: z.number().int(), active: z.boolean(),
  createdBy: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),   // null = System
  createdAt: z.string().datetime(),
  updatedBy: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  updatedAt: z.string().datetime(),
  version: z.number().int().min(1),
  clockCounts: z.object({ asOf: z.string().datetime(), governed: z.number().int(),
                          byStatus: z.record(SlaClockStatusSchema, z.number().int()) }),   // every status key present
});
export const SlaTermListResponseSchema = z.object({ items: z.array(SlaTermDtoSchema) });

// risk.ts
export const RiskSummaryDtoSchema = z.object({
  id: z.string().uuid(), number: z.number().int(), key: z.string(),          // "RSK-10001"
  type: RiskTypeSchema, typeLabel: z.string(),
  entity: EntityRefDtoSchema,                                                // current name, type, state
  status: RiskStatusSchema, level: RiskLevelSchema, score: z.number().int(), confidence: ConfidenceSchema,
  peakLevel: RiskLevelSchema,
  headline: z.string(),                                                      // latest assessment
  raisedAt: z.string().datetime(), lastChangedAt: z.string().datetime(),
  clearedAt: z.string().datetime().nullable(), clearReason: RiskClearReasonSchema.nullable(),
  autoException: z.object({ id: z.string().uuid(), key: z.string(), status: ExceptionStatusSchema }).nullable(),
});
export const RiskListResponseSchema = z.object({
  latestEvaluation: z.object({ id: z.string().uuid(), number: z.number().int(), asOf: z.string().datetime(),
                               finishedAt: z.string().datetime() }).nullable(),
  items: z.array(RiskSummaryDtoSchema), total: z.number().int(), nextCursor: z.string().nullable(),
});

export const RiskAssessmentDtoSchema = z.object({
  id: z.string().uuid(), seq: z.string(), evaluation: z.object({ id: z.string().uuid(), number: z.number().int() }),
  asOf: z.string().datetime(), level: RiskLevelSchema, score: z.number().int(), confidence: ConfidenceSchema,
  configVersion: z.number().int(),
  changedFactorKeys: z.array(z.string()),                                    // vs the previous assessment; all keys for the first
  payload: RiskAssessmentPayloadSchema,                                      // data-model §2e
});
export const RiskAssessmentListResponseSchema = z.object({ items: z.array(RiskAssessmentDtoSchema), nextCursor: z.string().nullable() });

export const RiskDetailResponseSchema = z.object({
  risk: RiskSummaryDtoSchema,
  current: RiskAssessmentDtoSchema,                                          // latest assessment
  rule: RiskRuleConfigSchema,                                                // of current.configVersion
  confirmedBy: z.object({ number: z.number().int(), asOf: z.string().datetime() }).nullable(), // latest completed evaluation, while OPEN
  clearance: z.object({ at: z.string().datetime(), reason: RiskClearReasonSchema, sentence: z.string(),
                        evaluation: z.object({ id: z.string().uuid(), number: z.number().int() }) }).nullable(),
  autoException: z.object({ id: z.string().uuid(), key: z.string(), title: z.string(), status: ExceptionStatusSchema,
                            createdAt: z.string().datetime() }).nullable(),
  autoExceptionError: z.object({ attempts: z.number().int(), error: z.string() }).nullable(),
  linkedExceptions: z.array(z.object({ id: z.string().uuid(), key: z.string(), title: z.string(),
                                       status: ExceptionStatusSchema, severity: ExceptionSeveritySchema,
                                       role: ExceptionEntityRoleSchema })),  // unresolved, linked to the entity, ≤ 20
  links: z.object({ entity: z.string(), impact: z.string() }),               // "/entities/<id>", "/entities/<id>#impact"
});

export const RiskAlertDtoSchema = z.object({
  auditId: z.string(), at: z.string().datetime(),
  kind: z.enum(['RAISED', 'LEVEL_UP', 'LEVEL_DOWN', 'CLEARED']),
  risk: z.object({ id: z.string().uuid(), key: z.string(), type: RiskTypeSchema, entity: EntityRefDtoSchema }),
  before: z.object({ level: RiskLevelSchema, score: z.number().int() }).nullable(),
  after: z.object({ level: RiskLevelSchema, score: z.number().int() }).nullable(),
  sentence: z.string(),                                                      // § Alert sentences
});
export const RiskAlertListResponseSchema = z.object({ days: z.number().int(), items: z.array(RiskAlertDtoSchema), nextCursor: z.string().nullable() });

export const RiskPreviewResponseSchema = z.object({
  entity: EntityRefDtoSchema, asOf: z.string().datetime(), configVersion: z.number().int(),
  graphVersion: z.string().nullable(), termsDigest: z.string().nullable(),
  rules: z.array(z.discriminatedUnion('outcome', [
    z.object({ type: RiskTypeSchema, outcome: z.literal('NOT_APPLICABLE'), reason: z.string() }),
    z.object({ type: RiskTypeSchema, outcome: z.literal('DISABLED') }),
    z.object({ type: RiskTypeSchema, outcome: z.literal('BELOW_THRESHOLD'), score: z.number().int(), factors: z.array(RiskFactorDtoSchema) }),
    z.object({ type: RiskTypeSchema, outcome: z.literal('RISK'), assessment: RiskAssessmentPayloadSchema }),
  ])).length(6),                                                             // rule order
  clocks: z.array(SlaClockDtoSchema),                                        // the entity's own clocks
});

export const RiskEvaluationDtoSchema = z.object({
  id: z.string().uuid(), number: z.number().int(), trigger: RiskEvaluationTriggerSchema,
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']),
  requestedBy: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  asOf: z.string().datetime(), startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nullable(),
  configVersion: z.number().int(), graphVersion: z.string().nullable(), termsDigest: z.string().nullable(),
  consistent: z.boolean().nullable(),
  counts: EvaluationCountsSchema.nullable(),                                 // data-model §2d
  autoExceptions: z.array(AutoExceptionOutcomeSchema),
  error: z.string().nullable(),
});
export const RiskEvaluationListResponseSchema = z.object({ items: z.array(RiskEvaluationDtoSchema.omit({ autoExceptions: true })), nextCursor: z.string().nullable() });

export const RiskConfigVersionDtoSchema = z.object({
  version: z.number().int(), note: z.string(), createdBy: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  createdAt: z.string().datetime(), config: RiskConfigSchema,
  definitions: z.array(z.object({ type: RiskTypeSchema, label: z.string(), appliesTo: z.string(), gate: z.string(),
                                  factors: z.array(z.object({ key: z.string(), label: z.string(), measure: RiskMeasureSchema,
                                                              direction: z.enum(['AT_LEAST', 'AT_MOST', 'BOOLEAN']),
                                                              unit: z.enum(['NONE', 'MINUTES', 'PERCENT', 'COUNT']),
                                                              meaning: z.string() })) })).length(6),   // § Default configuration texts
});
export const RiskConfigVersionListResponseSchema = z.object({
  items: z.array(RiskConfigVersionDtoSchema.pick({ version: true, note: true, createdBy: true, createdAt: true })),
  nextCursor: z.string().nullable(),
});
```

---

## Sorts (route 1)

Each sort ends with a unique tie-break; keyset cursors as 007 R14 (`{ s, k }`; a cursor for another sort is 400 on `cursor`).

| `sort` | Order |
|---|---|
| `SCORE` (default) | `score DESC, level ASC` (enum order HIGH…LOW), `number ASC` |
| `LEVEL` | `level ASC, score DESC, number ASC` |
| `NEWEST` | `raisedAt DESC, number DESC` |
| `CHANGED` | `lastChangedAt DESC, number DESC` |

**Numbering** (research R12): within one evaluation, raised risks get consecutive numbers in the order: score descending, rule order (`RISK_TYPES`), entity display name (`compareCodeUnits`), entity id. Tests assert this relative order, never absolute numbers, except on a freshly migrated database.

---

## Default configuration (version 1)

Every rule: thresholds **HIGH ≥ 70, MEDIUM ≥ 40, LOW ≥ 20**; depth **upstream 3, downstream 6**; `enabled: true`; `autoException: { enabled: false, owner: null, exceptionType: <below> }`. Durations in minutes, percents in whole percent. Bands of `AT_MOST` factors are listed with decreasing thresholds; the points are those of the last band whose condition holds (research R7).

| Rule (exception type) | Factor key | Label | Measure (params) | Weight | Bands → points |
|---|---|---|---|---|---|
| SLA breach likely (`SLA_RISK`) | `slaRemaining` | SLA remaining | `SLA_REMAINING_SHARE` | 35 | ≤ 50 → 50; ≤ 25 → 80; ≤ 0 → 100 |
| | `longestUnresolvedDependency` | Longest unresolved dependency | `UPSTREAM_MAX_STATE_AGE` | 25 | ≥ 60 → 30; ≥ 120 → 50; ≥ 240 → 80; ≥ 480 → 100 |
| | `warehouseUtilization` | Warehouse utilization | `UPSTREAM_MAX_UTILIZATION` | 15 | ≥ 80 → 40; ≥ 90 → 80; ≥ 95 → 100 |
| | `downstreamShipments` | Downstream shipments | `DOWNSTREAM_TOTAL_COUNT` (`[Shipment]`) | 10 | ≥ 1 → 50; ≥ 2 → 100 |
| | `ownState` | Own state | `OWN_IMPAIRED` | 15 | yes → 100 |
| Payment unresolved too long (`FAILED_PAYMENT`) | `unresolvedFor` | Unresolved for | `OWN_STATE_AGE` | 50 | ≥ 60 → 30; ≥ 120 → 50; ≥ 240 → 80; ≥ 480 → 100 |
| | `tightestDownstreamSla` | Tightest downstream SLA | `DOWNSTREAM_MIN_SLA_SHARE` | 30 | ≤ 50 → 50; ≤ 25 → 80; ≤ 0 → 100 |
| | `currentlyAffected` | Currently affected downstream | `DOWNSTREAM_CURRENT_COUNT` (any) | 20 | ≥ 1 → 30; ≥ 5 → 60; ≥ 10 → 100 |
| Approval delayed (`MISSING_APPROVAL`) | `pendingFor` | Pending for | `OWN_STATE_AGE` | 50 | ≥ 120 → 40; ≥ 240 → 70; ≥ 480 → 100 |
| | `tightestDownstreamSla` | Tightest downstream SLA | `DOWNSTREAM_MIN_SLA_SHARE` | 30 | ≤ 50 → 50; ≤ 25 → 80; ≤ 0 → 100 |
| | `currentlyAffected` | Currently affected downstream | `DOWNSTREAM_CURRENT_COUNT` (any) | 20 | ≥ 1 → 30; ≥ 5 → 60; ≥ 10 → 100 |
| Supplier disruption (`SHIPMENT_DELAY`) | `supplierState` | Supplier state | `OWN_IMPAIRED` | 40 | yes → 100 |
| | `impairedDirectDependents` | Directly impaired dependents | `DIRECT_IMPAIRED_DEPENDENTS` | 20 | ≥ 1 → 50; ≥ 3 → 100 |
| | `affectedOrders` | Currently affected orders | `DOWNSTREAM_CURRENT_COUNT` (`[Order]`) | 25 | ≥ 1 → 40; ≥ 5 → 80; ≥ 10 → 100 |
| | `tightestDownstreamSla` | Tightest downstream SLA | `DOWNSTREAM_MIN_SLA_SHARE` | 15 | ≤ 50 → 50; ≤ 25 → 80; ≤ 0 → 100 |
| Warehouse capacity pressure (`SHIPMENT_DELAY`) | `utilization` | Utilization | `OWN_UTILIZATION` | 40 | ≥ 80 → 40; ≥ 90 → 80; ≥ 95 → 100 |
| | `impairedDirectDependents` | Directly impaired dependents | `DIRECT_IMPAIRED_DEPENDENTS` | 40 | ≥ 5 → 40; ≥ 10 → 70; ≥ 20 → 100 |
| | `holdEvents` | Fulfilment holds | `RECENT_EVENTS` (`['warehouse.fulfillment_held']`, 1,440 min) | 20 | ≥ 1 → 50; ≥ 3 → 100 |
| High downstream dependency (`BLOCKED_ORDER`) | `dependentOrders` | Dependent orders | `DOWNSTREAM_TOTAL_COUNT` (`[Order]`) | 40 | ≥ 5 → 40; ≥ 10 → 70; ≥ 20 → 100 |
| | `dependentShipments` | Dependent shipments | `DOWNSTREAM_TOTAL_COUNT` (`[Shipment]`) | 20 | ≥ 2 → 50; ≥ 5 → 100 |
| | `dependentSlas` | Dependent SLA commitments | `DOWNSTREAM_TOTAL_COUNT` (`[SLA]`) | 20 | ≥ 1 → 50; ≥ 3 → 100 |
| | `ownState` | Own state | `OWN_IMPAIRED` | 20 | yes → 100 |

Count nouns (singular / plural) are part of `RULE_DEFINITIONS`: `downstreamShipments` shipment/shipments; `currentlyAffected` affected record/affected records; `impairedDirectDependents` impaired dependent/impaired dependents; `affectedOrders`, `dependentOrders` order/orders; `dependentShipments` shipment/shipments; `dependentSlas` SLA commitment/SLA commitments; `holdEvents` event/events.

Measure meanings (`definitions[].factors[].meaning`, one sentence each) are the R6 table's "Value" column of research.md, verbatim.

---

## Text templates

Notation: `iso(d)` = `d.toISOString()`; `dur(ms)` = 007's `formatDuration`; `pct` = `remainingPercentText`; `name(e)` = `e.displayName`; `LABEL(type)` = `RISK_TYPE_LABELS[type]`; `RSK` = `formatRiskNumber(n)`.

### Clock sentences (`SlaClockDto.sentence`)

| Status | Sentence |
|---|---|
| ON_TRACK | `` `Due ${iso(due)}; ${dur(remaining)} remaining of the ${dur(window)} window (${pct}).` `` |
| AT_RISK | `` `Due ${iso(due)}; only ${dur(remaining)} remaining, within the last ${p}% of the ${dur(window)} window.` `` |
| BREACHED | `` `Due ${iso(due)}; overdue by ${dur(−remaining)}.` `` |
| MET | `` `Stopped ${iso(stop)}, ${dur(due − stop)} before the due time ${iso(due)}.` ``; when equal: `` `Stopped ${iso(stop)}, at the due time.` `` |
| MISSED | `` `Stopped ${iso(stop)}, ${dur(stop − due)} after the due time ${iso(due)}.` `` |
| CANCELLED | `` `Cancelled ${iso(stop)}; the commitment no longer applies.` `` |

- When `start.fallback`: append `` ` Start falls back to the first observation (${sourceSystem} ${sourceId}, ${iso(observedAt)}) because no ${startEventTypes.join(' or ')} event is recorded.` `` (SLA records: `` `… because the record has no startAt.` ``).
- **Disagreement** (`SLA_RECORD` only), when the source state and the status disagree (AT_RISK vs ON_TRACK; ACTIVE vs AT_RISK or BREACHED; COMPLETED vs ON_TRACK, AT_RISK or BREACHED): `` `${sourceSystem} reports ${STATE} (observed ${iso(observedAt)}); OpsGraph computes ${SLA_STATUS_LABELS[status]} from the due time ${iso(due)}. Both are shown; neither replaces the other.` ``

007's AT_RISK sentence is the same template with `p = 25` and its own wording ("SLA window"); it is unchanged.

### Factor sentences (`RiskFactorDto.valueText`)

| Measure / value kind | Sentence |
|---|---|
| `OWN_IMPAIRED` | `` `${STATE} (impaired)` `` / `` `${STATE} (not impaired)` `` |
| `OWN_STATE_AGE` | `` `unresolved for ${dur(ms)} (${STATE} since ${iso(since)})` `` |
| `UPSTREAM_MAX_STATE_AGE` | `` `${name(e)} unresolved for ${dur(ms)} (since ${iso(since)})` `` |
| `SLA_REMAINING_SHARE`, `DOWNSTREAM_MIN_SLA_SHARE` | running: `` `${prefix}${dur(remaining)} remaining of the ${dur(window)} SLA window (${pct}), due ${iso(due)}` ``; breached: `` `${prefix}overdue by ${dur(−remaining)} (due ${iso(due)})` ``; `prefix` = `` `${name(e)}: ` `` for `DOWNSTREAM_MIN_SLA_SHARE`, empty otherwise |
| utilization | `` `${name(e)} at ${hundredths / 100}% utilization` `` (no trailing zeros) |
| `COUNT` | `` `${count}${lowerBound ? '+' : ''} ${noun}` `` + (1 ≤ count ≤ 3 ? `` ` (${names.join(', ')})` `` : '') + (nonSourceOnly > 0 ? `` `, ${nonSourceOnly} only through inferred or manual links` `` : '') |
| `RECENT_EVENTS` | `` `${count} ${eventTypes.join(' or ')} ${noun} in the last ${dur(window)}` `` |
| `NONE` | SLA measures `no running SLA commitment`; upstream age `no unresolved dependency`; utilization `no warehouse in scope` |
| `UNAVAILABLE` | `` `not available (${note})` ``, `note` = `no utilizationPct reported` or `utilizationPct is not a percentage` |

`band` = `` `${op} ${threshold}${unit} → ${points} points` `` with `op` `≥` / `≤`, `unit` `min` shown as `dur(threshold × 60000)` (`≥ 8h → 100 points`), `%`, or nothing; booleans `yes → 100 points`; null when no band matched.

### Headline (`RiskAssessmentPayload.headline`)

`` `${name(entity)}: ${LABEL(type)}, ${level} (${score}), confidence ${confidence}. ${top.map((f) => `${f.label}: ${f.valueText}`).join('; ')}.` ``

`top` = up to 3 factors with points > 0, by `weight × points` descending, then factor order.

### Confidence reasons

| Condition | Sentence (one per factor or clock, factor order) |
|---|---|
| HIGH | `All contributing values come from source relationships and records.` |
| LOW | `` `Without inferred or manual links the level would be ${sourceOnlyLevel ?? 'below LOW (no risk)'} (score ${sourceOnlyScore}).` `` (first), then the MEDIUM sentences that apply |
| factor depends on non-source links | `` `${label}: ${points} points, ${sourceOnlyPoints} from source links only.` `` |
| clock start fallback | `` `${label}: the SLA clock of ${name(e)} starts at its first observation, not at a recorded start event.` `` |
| state conflict | `` `${label}: sources disagree on the state of ${name(e)} (${list of "SOURCE STATE"}).` `` |

### Clearance sentences

`BELOW_THRESHOLD`: `` `Cleared by evaluation #${n} at ${iso(asOf)}: score ${score} is below the LOW threshold ${low}.` ``; `RULE_DISABLED`: `` `Cleared by evaluation #${n} at ${iso(asOf)}: the rule is disabled.` ``; `NOT_APPLICABLE`: `` `Cleared by evaluation #${n} at ${iso(asOf)}: the rule no longer applies to ${name(entity)} (${STATE}).` ``

### Alert sentences

| Kind | Sentence |
|---|---|
| RAISED | `` `${RSK} raised: ${name(e)}, ${LABEL(type)}, ${level} (${score}).` `` |
| LEVEL_UP / LEVEL_DOWN | `` `${RSK} ${up ? 'rose' : 'fell'} from ${beforeLevel} (${beforeScore}) to ${afterLevel} (${afterScore}): ${name(e)}, ${LABEL(type)}.` `` |
| CLEARED | `` `${RSK} cleared: ${name(e)}, ${LABEL(type)}.` `` |

### Auto-created exception

- title: `` `${name(entity)}: ${LABEL(type)} (${RSK})` ``, cut to 200 characters with `…`;
- description: headline, blank line, `` `Level ${level}, score ${score}, confidence ${confidence} (configuration version ${v}, as of ${iso(asOf)}).` ``, then one line per factor `` `- ${label}: ${valueText} (${weight} × ${points})` ``, cut to 4,000 characters with `…`.

---

## Acceptance fixtures

Seeded database: 001 users, §39 (002), §40 (006), 007's teams and EX-10001, 008's INV-10001, and this feature's seed (configuration version 1, term SHIP-24H on CON-3982). The scheduler is disabled in tests. **T1** = `2026-09-29T16:00:00Z`, **T2** = `2026-09-30T03:12:00Z`, **T3** = `2026-10-05T16:00:00Z`. Fixtures K1–K8 are asserted both by `evaluate-entity.spec.ts` (hand-built inputs) and through the API (`GET /api/risk-preview?entityId=…&asOf=…`, and an evaluation at that time). If a computed value differs from a value below, stop and write the derivation in `questions.md`; do not change the expectation.

### K1. Order #18492, SLA breach likely, at T2

`level HIGH`, `score 73`, `confidence HIGH`, `sourceOnlyScore 73`, `confidenceReasons = ['All contributing values come from source relationships and records.']`, `understatedBy = ['Warehouse utilization']`.

| key | value | points | contribution | sourceOnlyPoints |
|---|---|---|---|---|
| `slaRemaining` | SHARE `remainingMs 21600000`, `windowMs 86400000`, `dueAt 2026-09-30T09:12:00.000Z`, clock `term:<SHIP-24H>:<18492>`; text `6h remaining of the 1d SLA window (25%), due 2026-09-30T09:12:00.000Z`; band `≤ 25% → 80 points` | 80 | `28.0` | 80 |
| `longestUnresolvedDependency` | DURATION `ms 61620000`, `since 2026-09-29T10:05:00.000Z`, entity Payment PAY-88213; text `Payment PAY-88213 unresolved for 17h 7m (since 2026-09-29T10:05:00.000Z)` | 100 | `25.0` | 100 |
| `warehouseUtilization` | UNAVAILABLE `no utilizationPct reported` | 0 | `0.0` | 0 |
| `downstreamShipments` | COUNT `1`, `nonSourceOnly 0`, entities [Shipment SHP-77120 (consolidated)]; text `1 shipment (Shipment SHP-77120 (consolidated))` | 50 | `5.0` | 50 |
| `ownState` | BOOLEAN `true`, `BLOCKED` | 100 | `15.0` | 100 |

Headline: `Order #18492: SLA breach likely, HIGH (73), confidence HIGH. SLA remaining: 6h remaining of the 1d SLA window (25%), due 2026-09-30T09:12:00.000Z; Longest unresolved dependency: Payment PAY-88213 unresolved for 17h 7m (since 2026-09-29T10:05:00.000Z); Own state: BLOCKED (impaired).`

Evidence: the clock (start EVENT OMS EVT-OMS-1001 `order.created` 2026-09-29T09:12:00Z); the state observation of PAY-88213 (Payments, PAY-88213, 2026-09-29T10:05:00Z). The tie between PAY-88213, APR-2291 and BR-18492 (all since 10:05) is broken by depth (PAY-88213 at depth 1).

**At T1**: `MEDIUM`, `40`, `HIGH`: `slaRemaining` 0 (71.6% remaining), `longestUnresolvedDependency` 80 (5h 55m), `downstreamShipments` 50, `ownState` 100.

### K2. Payment PAY-88213, Payment unresolved too long, at T2

`HIGH`, `94`, `HIGH`. `unresolvedFor` DURATION 61,620,000 ms since 2026-09-29T10:05:00Z → 100 (`50.0`); `tightestDownstreamSla` SHARE of Order #18492 (25%) → 80 (`24.0`); `currentlyAffected` COUNT 22 (`nonSourceOnly 3`: the three AT_RISK SLA records reached only through inferred DEPENDS_ON links) → 100 (`20.0`), source-only 100. The 22 are Order #18492, Shipment SHP-77120, Invoice INV-55120, the 16 affected orders and SLA-3982-DEL, SLA-4107-DEL, SLA-4215-DEL, which equals the sum of 006's `current` counts for PAY-88213 at depth 6 (FR-021). **At T1**: `MEDIUM`, `60` (`unresolvedFor` 80, `tightestDownstreamSla` 0, `currentlyAffected` 100).

### K3. Finance approval APR-2291 and Budget code for Order #18492, Approval delayed, at T2

Both `HIGH`, `94`, `HIGH`: `pendingFor` 17h 7m → 100; `tightestDownstreamSla` Order #18492 (25%) → 80; `currentlyAffected` 23 (APR-2291) / 24 (BR-18492), `nonSourceOnly 3` → 100. **At T1**: both `MEDIUM`, `55`.

### K4. Order #18493, SLA breach likely, at T2

`MEDIUM`, `58`, `confidence MEDIUM`. `slaRemaining` SHARE `remainingMs 40800000`, `windowMs 86400000`, due 2026-09-30T14:32:00Z, clock start fallback (OMS 18493 first observation 2026-09-29T14:32:00Z) → 50 (`17.5`); `longestUnresolvedDependency` Order #18492 unresolved for 18h (since 2026-09-29T09:12:00Z, depth 2 through Shipment SHP-77120) → 100 (`25.0`); `warehouseUtilization` UNAVAILABLE; `downstreamShipments` COUNT 0 → 0; `ownState` WAITING → 100 (`15.0`). Sum 5,750 → 58. Reasons: `['SLA remaining: the SLA clock of Order #18493 starts at its first observation, not at a recorded start event.']`. Orders #18494, #18495 and #18496 give the same values with their own names.

### K5. Shipment SHP-77120 (consolidated), High downstream dependency, at T1 and T2

`MEDIUM`, `68`, `confidence MEDIUM`, `sourceOnlyScore 48`. `dependentOrders` 16 → 70 (`28.0`); `dependentShipments` 0 → 0; `dependentSlas` 4 (`nonSourceOnly 4`) → 100 (`20.0`), source-only 0; `ownState` DELAYED → 100 (`20.0`). Reasons: `['Dependent SLA commitments: 100 points, 0 from source links only.']`.

### K6. SLA clocks at T2 (`GET /api/sla-clocks?asOf=2026-09-30T03:12:00Z`)

- `total` = 5 term clocks (Orders #18492–#18496, SHIP-24H) + 8 SLA-record clocks (§39: 4, §40: 4) = 13.
- First five items, in order: Order #18492 (`AT_RISK`, remaining 6h, `25%`, start EVENT); Orders #18493, #18494, #18495, #18496 (`ON_TRACK`, remaining 11h 20m, `47.2%`, start FIRST_OBSERVATION, `fallback true`).
- Acme Corp delivery SLA: `source SLA_RECORD`, start FIRST_OBSERVATION 2026-09-29T15:10:00Z, due 2026-10-02T17:00:00Z, `ON_TRACK`, remaining 2d 13h 48m, `sourceState AT_RISK (ContractMgmt)`, `disagreement` = `ContractMgmt reports AT_RISK (observed 2026-09-29T15:10:00.000Z); OpsGraph computes On track from the due time 2026-10-02T17:00:00.000Z. Both are shown; neither replaces the other.`
- Boundaries on Order #18492: `asOf 2026-09-30T03:11:59.999Z` → `ON_TRACK`; `03:12:00.000Z` → `AT_RISK`; `09:12:00.000Z` → `AT_RISK`; `09:12:00.001Z` → `BREACHED`.
- `GET /api/sla-terms?contractId=<CON-3982>&asOf=…T2` → one term, `clockCounts.governed 5`, `byStatus.AT_RISK 1`, `byStatus.ON_TRACK 4`, all other statuses 0.

### K7. East Distribution Center 02, Warehouse capacity pressure, at T1 and T2

`LOW`, `38`, `HIGH`. `utilization` UNAVAILABLE → 0; `impairedDirectDependents` 18 (17 orders FULFILLED_BY it and Shipment SHP-77120) → 70 (`28.0`); `holdEvents` 1 (WMS EVT-WMS-4001 `warehouse.fulfillment_held`, 2026-09-29T11:40:00Z) → 50 (`10.0`). `understatedBy ['Utilization']`. West Distribution Center 01 has no risk.

### K8. Fabrikam Components (SUP-400), Supplier disruption, at T3

`HIGH`, `80`, `HIGH`. `supplierState` SUSPENDED → 100 (`40.0`); `impairedDirectDependents` 3 (PO-7001, PO-7002, PO-7003) → 100 (`20.0`); `affectedOrders` 6 (SO-20401 … SO-20406, equal to 006 fixture I1's current orders) → 80 (`20.0`); `tightestDownstreamSla` SHARE of Proseware Systems delivery SLA (`remainingMs 1299600000`, `windowMs 1674000000`, `77.6%`, reached at depth 4 through PRD-6103, SO-20409 and SHP-8003) → 0. Tailspin Parts (SUP-410) has no Supplier disruption risk.

### K9. Lifecycle and determinism (fresh seeded database)

1. As Admin, `POST /api/risk-evaluations { asOf: T1 }` → 201, `status COMPLETED`, `trigger MANUAL`, `configVersion 1`, `consistent true`, `graphVersion` = `max(source_records.seq)`. Open risks include K1 (MEDIUM 40), K2 (MEDIUM 60), K3 (MEDIUM 55 ×2), K5, K7. Raised numbers follow § Numbering (K2's PAY-88213 before K3's two approvals).
2. `POST { asOf: T1 }` again → completed with `raised 0, changed 0, cleared 0`; no `risk.*` audit rows other than the evaluation's own two; no new assessments.
3. `POST { asOf: T2 }` → K1 `risk.level_changed` MEDIUM (40) → HIGH (73); K2, K3 level changes to HIGH 94; K5 and K7 unchanged (no assessment, no audit row); Order #18493 to #18496: level changed LOW (35) → MEDIUM (58) (at T1: `slaRemaining` 0, `longestUnresolvedDependency` 80, `ownState` 100, confidence HIGH because the fallback factor has 0 points).
4. `POST { asOf: T1 }` now → 400 on `asOf` (`asOf must not be earlier than evaluation #3 (2026-09-30T03:12:00.000Z)`).
5. `GET /api/risk-preview?entityId=<18492>&asOf=T2` 100 times → identical bodies; its `rules[0].assessment` equals K1's stored assessment payload byte for byte.
6. Import PAY-88213 as ACTIVE (a new Payments observation), then `POST { asOf: T2 }`:
   - K2's risk: `risk.cleared`, `clearReason NOT_APPLICABLE` (the gate requires an impaired payment);
   - K1: `risk.level_changed` HIGH (73) → MEDIUM (48): `longestUnresolvedDependency` becomes NONE, because APR-2291 and BR-18492 are now reached only through the unimpaired payment (research R5: upstream chains must be impaired);
   - K3: both `risk.rescored` 94 → 74 (`currentlyAffected` 0, since the chain stops at the payment), `changedFactorKeys ['currentlyAffected']`;
   - PAY-88213's High downstream dependency risk: `risk.rescored` 68 → 48 (`ownState` 0);
   - K5 and K7: unchanged.
7. `GET /api/risk-alerts?days=90` lists, newest first: the clearance and K1's level change of step 6, then the level changes of step 3, then the raises of step 1. Rescorings are not listed.

### K10. Automatic exceptions (fresh seeded database)

1. As Admin, `PUT /api/risk-config/rules/PAYMENT_UNRESOLVED` with `autoException { enabled: true, owner: { kind: TEAM, teamId: <Finance Operations> }, exceptionType: FAILED_PAYMENT }`, `expectedVersion 1` → version 2; audit `risk.config_updated`.
2. Same for `APPROVAL_DELAYED` (`expectedVersion 2`, owner Finance Operations, `MISSING_APPROVAL`) → version 3.
3. `POST /api/risk-evaluations { asOf: T2 }` → `autoExceptions`:
   - PAY-88213: `CREATED`; the exception: title `Payment PAY-88213: Payment unresolved too long (RSK-n)`, `type FAILED_PAYMENT`, `severity HIGH`, `priority P2`, `status OPEN`, owner Finance Operations, `createdFrom RISK`, `createdBy null`, `sla.windowMs 86400000`, subject PAY-88213; 007 `exception.created` row with `actorType 'system'` and `metadata.riskId`; one ASSIGNED notification for Operations Manager, message `System assigned EX-… "Payment PAY-88213: Payment unresolved too long (RSK-n)" to Finance Operations.`; risk `autoException` set, audit `risk.exception_created`;
   - APR-2291: `CREATED` (type `MISSING_APPROVAL`);
   - BR-18492: `SKIPPED_LINKED`, `linkedExceptionNumbers [10001]` (EX-10001's root-cause link).
4. `POST { asOf: T2 }` again → `autoExceptions` empty; still 2 exceptions created by risk.
5. Resolution SLA rule: with a built dataset (an Order with `order.created` 20 hours before the real current time, governed by a contract with a 24-hour term, BLOCKED, with an unresolved REQUIRES Payment), enable auto-creation for `SLA_BREACH_LIKELY`; after an evaluation, the exception's `sla.dueAt` equals the clock's `dueAt` (4 hours ahead), not creation + 24 h.
6. Failure: with an owner team id that is then made invalid in the stored configuration (test-only direct insert of a version), the outcome is `FAILED`, `risk.exception_failed` is written, `autoExceptionAttempts 1`, and the next evaluation retries.
7. Cap: with 25 eligible HIGH risks (built dataset), one evaluation creates 20 (`CREATED`, highest score then number) and records 5 `DEFERRED`; the next evaluation creates the 5.

### Validation and access

- Every route: 401 without a token.
- Routes 8, 12, 14, 16 as Analyst and as Operations Manager: 403 and one `auth.forbidden` row; nothing else written.
- Route 12: weights summing to 99 → 400 `rule.factors` `Weights must sum to 100 (currently 99)`; thresholds `{ high: 40, medium: 40, low: 20 }` → 400 `rule.thresholds`; increasing thresholds on `slaRemaining` → 400 `rule.factors.0.bands`; a renamed factor key → 400 `rule.factors`; stale `expectedVersion` → 409 `VERSION_CONFLICT`; identical rule → 200 with the same version, no audit.
- Route 14: non-Contract `contractEntityId` → 400; duplicate code in a different case → 409 `SLA_TERM_CODE_TAKEN`; `windowMinutes 0` → 400; duplicate start event types → 400.
- Route 17: a cursor from another `asOf` → 400 `cursor`.
- Routes 2, 3, 7, 15 with an unknown id → 404; route 11 with an unknown version → 404.
