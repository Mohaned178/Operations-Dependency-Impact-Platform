# Data Model: Risk Detection and SLA Management

**Feature**: `009-risk-sla` | **Date**: 2026-10-07

This feature stores **SLA terms**, **risk configuration versions**, **risk evaluations**, **risks** and their **assessments**. SLA clocks, previews and the alerts feed are computed, not stored (research R2, R16, R17). Response schemas and the default configuration are in [contracts/api.md](./contracts/api.md). The reasons for every decision are in [research.md](./research.md).

---

## §1 Storage (Prisma + migration `<timestamp>_risk_sla`)

The migration must run **after** 007's and 008's migrations. Do not edit earlier migrations.

### §1a Prisma schema additions (`apps/api/prisma/schema.prisma`)

```prisma
/// Declaration order is the sort order: HIGH sorts first (research R15).
enum RiskLevel {
  HIGH
  MEDIUM
  LOW
}

enum RiskType {
  SLA_BREACH_LIKELY
  PAYMENT_UNRESOLVED
  APPROVAL_DELAYED
  SUPPLIER_DISRUPTION
  WAREHOUSE_CAPACITY_PRESSURE
  HIGH_DOWNSTREAM_DEPENDENCY
}

enum RiskStatus {
  OPEN
  CLEARED
}

enum RiskClearReason {
  BELOW_THRESHOLD
  RULE_DISABLED
  NOT_APPLICABLE
}

enum RiskEvaluationTrigger {
  SCHEDULE
  DATA_CHANGE
  CONFIG_CHANGE
  MANUAL
}

enum RiskEvaluationStatus {
  RUNNING
  COMPLETED
  FAILED
}

enum SlaTermTargetType {
  Order
}

model SlaTerm {
  id               String            @id @default(uuid()) @db.Uuid
  contractEntityId String            @map("contract_entity_id") @db.Uuid
  code             String
  name             String
  clause           String
  targetType       SlaTermTargetType @default(Order) @map("target_type")
  startEventTypes  String[]          @map("start_event_types")
  stopEventTypes   String[]          @map("stop_event_types")
  windowMinutes    Int               @map("window_minutes")
  atRiskPercent    Int               @default(25) @map("at_risk_percent")
  active           Boolean           @default(true)
  createdById      String?           @map("created_by_id") @db.Uuid      // null = system (seed)
  createdAt        DateTime          @map("created_at") @db.Timestamptz(6)
  updatedById      String?           @map("updated_by_id") @db.Uuid
  updatedAt        DateTime          @map("updated_at") @db.Timestamptz(6)
  version          Int               @default(1)

  contract  Entity @relation("SlaTermContract", fields: [contractEntityId], references: [id], onDelete: Restrict)
  createdBy User?  @relation("SlaTermCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  updatedBy User?  @relation("SlaTermUpdatedBy", fields: [updatedById], references: [id], onDelete: Restrict)

  @@index([contractEntityId, active])
  @@map("sla_terms")
}

model RiskConfigVersion {
  version     Int      @id
  config      Json                                                  // RiskConfig (§2b), validated on write and read
  note        String
  createdById String?  @map("created_by_id") @db.Uuid               // null = system (initialization)
  createdAt   DateTime @map("created_at") @db.Timestamptz(6)

  createdBy   User?            @relation("RiskConfigCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  evaluations RiskEvaluation[]

  @@map("risk_config_versions")
}

model RiskEvaluation {
  id              String                @id @default(uuid()) @db.Uuid
  number          Int                   @unique @default(autoincrement())
  trigger         RiskEvaluationTrigger
  status          RiskEvaluationStatus  @default(RUNNING)
  requestedById   String?               @map("requested_by_id") @db.Uuid     // MANUAL only
  asOf            DateTime              @map("as_of") @db.Timestamptz(6)
  startedAt       DateTime              @map("started_at") @db.Timestamptz(6)
  heartbeatAt     DateTime              @map("heartbeat_at") @db.Timestamptz(6)
  finishedAt      DateTime?             @map("finished_at") @db.Timestamptz(6)
  configVersion   Int                   @map("config_version")
  graphVersion    BigInt?               @map("graph_version")                // max(source_records.seq); null for an empty graph
  termsDigest     String?               @map("terms_digest") @db.Char(64)
  consistent      Boolean?                                                    // research R8
  counts          Json?                                                       // EvaluationCounts (§2d)
  autoExceptions  Json?                 @map("auto_exceptions")              // AutoExceptionOutcome[] (§2d)
  error           String?

  requestedBy User?             @relation("RiskEvaluationRequestedBy", fields: [requestedById], references: [id], onDelete: Restrict)
  config      RiskConfigVersion @relation(fields: [configVersion], references: [version], onDelete: Restrict)
  raised      Risk[]            @relation("RiskRaisedBy")
  cleared     Risk[]            @relation("RiskClearedBy")
  assessments RiskAssessment[]

  @@index([status, asOf(sort: Desc)])
  @@index([number(sort: Desc)])
  @@map("risk_evaluations")
}

model Risk {
  id                     String           @id @default(uuid()) @db.Uuid
  number                 Int              @unique @default(autoincrement())
  type                   RiskType
  entityId               String           @map("entity_id") @db.Uuid
  status                 RiskStatus       @default(OPEN)
  level                  RiskLevel
  score                  Int
  confidence             Confidence                                           // existing enum HIGH | MEDIUM | LOW
  peakLevel              RiskLevel        @map("peak_level")
  raisedAt               DateTime         @map("raised_at") @db.Timestamptz(6)          // asOf of the raising evaluation
  raisedEvaluationId     String           @map("raised_evaluation_id") @db.Uuid
  lastChangedAt          DateTime         @map("last_changed_at") @db.Timestamptz(6)    // asOf of the latest assessment
  latestAssessmentSeq    BigInt           @map("latest_assessment_seq")
  clearedAt              DateTime?        @map("cleared_at") @db.Timestamptz(6)
  clearedEvaluationId    String?          @map("cleared_evaluation_id") @db.Uuid
  clearReason            RiskClearReason? @map("clear_reason")
  autoExceptionId        String?          @unique @map("auto_exception_id") @db.Uuid
  autoExceptionCreatedAt DateTime?        @map("auto_exception_created_at") @db.Timestamptz(6)
  autoExceptionAttempts  Int              @default(0) @map("auto_exception_attempts")
  autoExceptionError     String?          @map("auto_exception_error")

  entity            Entity           @relation("RiskEntity", fields: [entityId], references: [id], onDelete: Restrict)
  raisedEvaluation  RiskEvaluation   @relation("RiskRaisedBy", fields: [raisedEvaluationId], references: [id], onDelete: Restrict)
  clearedEvaluation RiskEvaluation?  @relation("RiskClearedBy", fields: [clearedEvaluationId], references: [id], onDelete: Restrict)
  autoException     Exception?       @relation("RiskAutoException", fields: [autoExceptionId], references: [id], onDelete: Restrict)
  assessments       RiskAssessment[]

  @@index([status, score(sort: Desc), number])
  @@index([status, level, score(sort: Desc), number])
  @@index([status, raisedAt(sort: Desc), number(sort: Desc)])
  @@index([status, lastChangedAt(sort: Desc), number(sort: Desc)])
  @@index([entityId, status])
  @@index([type, status])
  @@map("risks")
}

model RiskAssessment {
  id            String     @id @default(uuid()) @db.Uuid
  seq           BigInt     @unique @default(autoincrement())
  riskId        String     @map("risk_id") @db.Uuid
  evaluationId  String     @map("evaluation_id") @db.Uuid
  asOf          DateTime   @map("as_of") @db.Timestamptz(6)
  level         RiskLevel
  score         Int
  confidence    Confidence
  configVersion Int        @map("config_version")
  payload       Json                                                   // RiskAssessmentPayload (§2c), validated on write and read
  materialKey   String     @map("material_key") @db.Char(64)          // SHA-256 of the canonical material key (research R12)

  risk       Risk           @relation(fields: [riskId], references: [id], onDelete: Restrict)
  evaluation RiskEvaluation @relation(fields: [evaluationId], references: [id], onDelete: Restrict)

  @@index([riskId, seq])
  @@map("risk_assessments")
}
```

**007 enum change**: add `RISK` at the end of `ExceptionCreatedFrom` (research R14).

Back-relations to add:
- **`User`**: `slaTermsCreated @relation("SlaTermCreatedBy")`, `slaTermsUpdated @relation("SlaTermUpdatedBy")`, `riskConfigVersions @relation("RiskConfigCreatedBy")`, `riskEvaluationsRequested @relation("RiskEvaluationRequestedBy")`.
- **`Entity`**: `slaTerms SlaTerm[] @relation("SlaTermContract")`, `risks Risk[] @relation("RiskEntity")`.
- **`Exception`**: `autoCreatedForRisk Risk? @relation("RiskAutoException")`.

### §1b Hand-written SQL appended to the generated migration

```sql
-- 007's creation origin gains RISK (not used in this migration)
ALTER TYPE "ExceptionCreatedFrom" ADD VALUE IF NOT EXISTS 'RISK';

-- Risk numbers start at 10001 (research R12); check the generated sequence name first
ALTER SEQUENCE risks_number_seq RESTART WITH 10001;

-- SLA terms
CREATE UNIQUE INDEX sla_terms_contract_code_key ON sla_terms (contract_entity_id, lower(code));
ALTER TABLE sla_terms
  ADD CONSTRAINT sla_terms_code_format CHECK (code ~ '^[A-Za-z0-9-]{1,32}$'),
  ADD CONSTRAINT sla_terms_name_length CHECK (char_length(name) BETWEEN 1 AND 200),
  ADD CONSTRAINT sla_terms_clause_length CHECK (char_length(clause) BETWEEN 1 AND 2000),
  ADD CONSTRAINT sla_terms_start_events CHECK (cardinality(start_event_types) BETWEEN 1 AND 5),
  ADD CONSTRAINT sla_terms_stop_events CHECK (cardinality(stop_event_types) BETWEEN 0 AND 5),
  ADD CONSTRAINT sla_terms_window CHECK (window_minutes BETWEEN 1 AND 129600),
  ADD CONSTRAINT sla_terms_at_risk CHECK (at_risk_percent BETWEEN 1 AND 99),
  ADD CONSTRAINT sla_terms_version CHECK (version >= 1);

-- Configuration versions
ALTER TABLE risk_config_versions
  ADD CONSTRAINT risk_config_versions_version CHECK (version >= 1),
  ADD CONSTRAINT risk_config_versions_note_length CHECK (char_length(note) BETWEEN 1 AND 500);

-- One running evaluation across all instances (research R10)
CREATE UNIQUE INDEX risk_evaluations_one_running ON risk_evaluations ((true)) WHERE status = 'RUNNING';
ALTER TABLE risk_evaluations
  ADD CONSTRAINT risk_evaluations_finished CHECK ((status = 'RUNNING') = (finished_at IS NULL)),
  ADD CONSTRAINT risk_evaluations_failed CHECK ((status = 'FAILED') = (error IS NOT NULL)),
  ADD CONSTRAINT risk_evaluations_manual CHECK ((trigger = 'MANUAL') = (requested_by_id IS NOT NULL));

-- At most one open risk per type and entity (research R12)
CREATE UNIQUE INDEX risks_one_open ON risks (type, entity_id) WHERE status = 'OPEN';
ALTER TABLE risks
  ADD CONSTRAINT risks_score CHECK (score BETWEEN 0 AND 100),
  ADD CONSTRAINT risks_cleared CHECK (
    (status = 'CLEARED') = (cleared_at IS NOT NULL AND cleared_evaluation_id IS NOT NULL AND clear_reason IS NOT NULL)),
  ADD CONSTRAINT risks_auto_attempts CHECK (auto_exception_attempts >= 0);

ALTER TABLE risk_assessments
  ADD CONSTRAINT risk_assessments_score CHECK (score BETWEEN 0 AND 100);

-- Append-only tables; forbid_provenance_mutation() already exists, do not redefine it
CREATE TRIGGER risk_config_versions_append_only BEFORE UPDATE OR DELETE ON risk_config_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER risk_config_versions_append_only_truncate BEFORE TRUNCATE ON risk_config_versions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER risk_assessments_append_only BEFORE UPDATE OR DELETE ON risk_assessments
  FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();
CREATE TRIGGER risk_assessments_append_only_truncate BEFORE TRUNCATE ON risk_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
```

`ALTER TYPE … ADD VALUE` cannot run inside a transaction block on PostgreSQL < 12 only; on PostgreSQL 16 it can, but the new value must not be **used** in the same transaction. Nothing in this migration uses it.

**`apps/api/test/helpers.ts → resetDb`**:
- `DISABLE TRIGGER USER` / `ENABLE TRIGGER USER` on `risk_config_versions` and `risk_assessments`;
- add `risk_assessments, risks, risk_evaluations, risk_config_versions, sla_terms` to the `TRUNCATE` list, before `exceptions`, `entities` and `users`.

### §1c Validation rules (zod in `packages/shared` and CHECKs in the database)

| Field | Rule |
|---|---|
| term `code` | trimmed; `^[A-Za-z0-9-]{1,32}$`; unique per contract ignoring case (409 `SLA_TERM_CODE_TAKEN`) |
| term `name` / `clause` | trimmed; 1 to 200 / 1 to 2,000 |
| term `contractEntityId` | an existing entity of type Contract (400 on the field otherwise); immutable after creation |
| `startEventTypes` / `stopEventTypes` | 1 to 5 / 0 to 5 distinct strings, each trimmed, 1 to 100 characters, `^[a-z0-9_.-]+$` |
| `windowMinutes` | integer 1 to 129,600 (90 days) |
| `atRiskPercent` | integer 1 to 99 |
| `expectedVersion` | integer ≥ 1 (terms: the term's version; configuration: the configuration version) |
| configuration `note` | trimmed; 1 to 500 |
| configuration rule | §2c refinements |
| evaluation `asOf` | ISO-8601 UTC; ≥ the latest completed evaluation's `asOf` (400 on `asOf`, message `asOf must not be earlier than evaluation #N (<iso>)`) |
| preview `asOf` | ISO-8601 UTC; any value |
| alerts `days` | integer 1 to 90, default 7 |

---

## §2 Shared constants and schemas

### §2a `packages/shared/src/sla-clock.ts`

```ts
export const SLA_CLOCK_STATUSES = [...SLA_STATUSES, 'CANCELLED'] as const;      // SLA_STATUSES from exceptions.ts (007)
export type SlaClockStatus = (typeof SLA_CLOCK_STATUSES)[number];
export const SLA_STATUS_LABELS: Record<SlaClockStatus, string> = {
  ON_TRACK: 'On track', AT_RISK: 'At risk', BREACHED: 'Breached', MET: 'Met', MISSED: 'Missed', CANCELLED: 'Cancelled',
};
export interface ClockTiming { startAt: Date; dueAt: Date; stoppedAt: Date | null; cancelled: boolean; atRiskPercent: number }
export interface ClockClassification { status: SlaClockStatus; elapsedMs: number; remainingMs: number | null; windowMs: number; atRiskAt: Date }
export function slaAtRiskAtFor(startAt: Date, dueAt: Date, percent: number): Date;
export function classifySlaClock(t: ClockTiming, evaluatedAt: Date): ClockClassification;   // research R2
export function slaSentence(c: ClockClassification, t: ClockTiming): string;                 // contracts § Clock sentences
export function compareClockUrgency(a: ClockClassification & { dueAt: Date; key: string }, b: …): number; // research R2
export function remainingPercentText(remainingMs: number, windowMs: number): string;        // floor(r × 1000 / w) / 10, "25%", "47.2%"
```

007's `slaAtRiskAt(createdAt, dueAt)` = `slaAtRiskAtFor(createdAt, dueAt, 25)`; 007's `computeSlaStatus` uses `classifySlaClock` for unresolved statuses and keeps its MET/MISSED branch on the stored `slaOutcome` (research R3).

### §2b `packages/shared/src/risk.ts`: constants and configuration

```ts
export const RISK_TYPES = ['SLA_BREACH_LIKELY','PAYMENT_UNRESOLVED','APPROVAL_DELAYED','SUPPLIER_DISRUPTION',
  'WAREHOUSE_CAPACITY_PRESSURE','HIGH_DOWNSTREAM_DEPENDENCY'] as const;            // rule order
export const RISK_TYPE_LABELS = {
  SLA_BREACH_LIKELY: 'SLA breach likely', PAYMENT_UNRESOLVED: 'Payment unresolved too long',
  APPROVAL_DELAYED: 'Approval delayed', SUPPLIER_DISRUPTION: 'Supplier disruption',
  WAREHOUSE_CAPACITY_PRESSURE: 'Warehouse capacity pressure', HIGH_DOWNSTREAM_DEPENDENCY: 'High downstream dependency',
} as const;
export const RISK_LEVELS = ['HIGH','MEDIUM','LOW'] as const;                       // rank = index
export const RISK_STATUSES = ['OPEN','CLEARED'] as const;
export const RISK_CLEAR_REASONS = ['BELOW_THRESHOLD','RULE_DISABLED','NOT_APPLICABLE'] as const;
export const RISK_EVALUATION_TRIGGERS = ['SCHEDULE','DATA_CHANGE','CONFIG_CHANGE','MANUAL'] as const;
export const RISK_MEASURES = ['OWN_IMPAIRED','OWN_STATE_AGE','OWN_UTILIZATION','SLA_REMAINING_SHARE',
  'UPSTREAM_MAX_STATE_AGE','UPSTREAM_MAX_UTILIZATION','DOWNSTREAM_MIN_SLA_SHARE','DOWNSTREAM_CURRENT_COUNT',
  'DOWNSTREAM_TOTAL_COUNT','DIRECT_IMPAIRED_DEPENDENTS','RECENT_EVENTS'] as const;
export const MEASURE_DIRECTION: Record<RiskMeasure, 'AT_LEAST' | 'AT_MOST' | 'BOOLEAN'> = {
  OWN_IMPAIRED: 'BOOLEAN', SLA_REMAINING_SHARE: 'AT_MOST', DOWNSTREAM_MIN_SLA_SHARE: 'AT_MOST', /* every other: 'AT_LEAST' */ };
export const MEASURE_UNIT: Record<RiskMeasure, 'NONE' | 'MINUTES' | 'PERCENT' | 'COUNT'> = {
  OWN_IMPAIRED: 'NONE', OWN_STATE_AGE: 'MINUTES', UPSTREAM_MAX_STATE_AGE: 'MINUTES',
  OWN_UTILIZATION: 'PERCENT', UPSTREAM_MAX_UTILIZATION: 'PERCENT', SLA_REMAINING_SHARE: 'PERCENT',
  DOWNSTREAM_MIN_SLA_SHARE: 'PERCENT', DOWNSTREAM_CURRENT_COUNT: 'COUNT', DOWNSTREAM_TOTAL_COUNT: 'COUNT',
  DIRECT_IMPAIRED_DEPENDENTS: 'COUNT', RECENT_EVENTS: 'COUNT' };            // band thresholds are in this unit
export const RISK_LIMITS = {
  maxBands: 6, minDepth: 1, maxDepth: 6, maxEventTypes: 10, eventWindowMinMinutes: 1, eventWindowMaxMinutes: 43200,
  autoExceptionsPerEvaluation: 20, citedEntitiesMax: 20, alertsMaxDays: 90, abandonedAfterMs: 600_000,
  reachBatchSize: 100, readAttempts: 3,
} as const;
export function formatRiskNumber(n: number): string { return `RSK-${n}`; }

/** Fixed per rule (research R9); the configuration may not change these. */
export const RULE_DEFINITIONS: Record<RiskType, {
  appliesTo: readonly EntityType[] | 'CLOCK_TARGETS';
  gate: 'NONE' | 'OWN_IMPAIRED' | 'IMPAIRED_OR_DIRECT_IMPAIRED_DEPENDENT' | 'HAS_DIRECT_DEPENDENT' | 'RUNNING_CLOCK';
  factors: ReadonlyArray<{ key: string; label: string; measure: RiskMeasure; typeParam?: 'ENTITY_TYPES' | 'EVENTS' }>;
}>;   // values in contracts § Default configuration, column "key / measure"
```

`EntityType` and the per-rule applicable types: SLA_BREACH_LIKELY `CLOCK_TARGETS` (Orders and SLA records with a running clock); PAYMENT_UNRESOLVED `['Payment']`; APPROVAL_DELAYED `['Approval','BudgetRequirement']`; SUPPLIER_DISRUPTION `['Supplier']`; WAREHOUSE_CAPACITY_PRESSURE `['Warehouse']`; HIGH_DOWNSTREAM_DEPENDENCY: every `EntityTypeSchema` option except `Customer`, `Contract`, `SLA`.

**Configuration schema** (`RiskConfigSchema`):

```ts
const BandSchema = z.object({ threshold: z.number().int().min(0).max(1_000_000), points: z.number().int().min(0).max(100) });
const FactorConfigSchema = z.object({
  key: z.string(),
  weight: z.number().int().min(0).max(100),
  bands: z.array(BandSchema).max(RISK_LIMITS.maxBands),         // empty for BOOLEAN measures
  points: z.number().int().min(0).max(100).nullable(),          // BOOLEAN measures only, else null
  params: z.object({
    entityTypes: z.array(EntityTypeSchema).max(20).nullable(),  // count measures; null = any applicable type
    eventTypes: z.array(EventTypeStringSchema).min(1).max(RISK_LIMITS.maxEventTypes).nullable(),  // RECENT_EVENTS only
    windowMinutes: z.number().int().min(1).max(43_200).nullable(),                                 // RECENT_EVENTS only
  }),
});
export const RiskRuleConfigSchema = z.object({
  type: RiskTypeSchema,
  enabled: z.boolean(),
  thresholds: z.object({ high: z.number().int(), medium: z.number().int(), low: z.number().int() }),
  depth: z.object({ upstream: z.number().int().min(1).max(6), downstream: z.number().int().min(1).max(6) }),
  factors: z.array(FactorConfigSchema),
  autoException: z.object({
    enabled: z.boolean(),
    owner: OwnerRefSchema.nullable(),                           // 007
    exceptionType: ExceptionTypeSchema,                         // 007
  }),
}).superRefine(validateRule);                                    // §2c
export const RiskConfigSchema = z.object({ rules: z.array(RiskRuleConfigSchema).length(6) })
  .superRefine(/* rules[i].type === RISK_TYPES[i] */);
```

### §2c `validateRule` refinements (issue paths relative to the rule)

| Check | Path | Message |
|---|---|---|
| factor keys and order equal `RULE_DEFINITIONS[type].factors` | `factors` | `Factors cannot be added, removed or reordered` |
| Σ weight = 100 | `factors` | `Weights must sum to 100 (currently N)` |
| BOOLEAN measure: `bands` empty, `points` not null | `factors.i.points` | `A yes/no factor has points and no bands` |
| other measures: `points` null, thresholds strictly increasing (`AT_LEAST`) or strictly decreasing (`AT_MOST`) | `factors.i.bands` | `Band thresholds must be strictly increasing` / `… decreasing` |
| PERCENT unit: thresholds ≤ 100 | `factors.i.bands.j.threshold` | `A percentage threshold must be at most 100` |
| `params.entityTypes` only on count measures, and ⊆ the rule's applicable types (any type for downstream counts) | `factors.i.params.entityTypes` | `Not allowed for this factor` |
| `params.eventTypes`, `params.windowMinutes` required on `RECENT_EVENTS`, null elsewhere | `factors.i.params` | `Required for this factor` / `Not allowed for this factor` |
| `1 ≤ low < medium < high ≤ 100` | `thresholds` | `Thresholds must satisfy 1 ≤ low < medium < high ≤ 100` |
| owner exists and is active (server-side, not zod) | `autoException.owner.userId` / `.teamId` | as 007 R13 |

### §2d Evaluation payloads

```ts
export const EvaluationCountsSchema = z.object({
  candidates: z.number().int().min(0),       // (entity, rule) pairs evaluated
  entities: z.number().int().min(0),         // distinct entities evaluated
  raised: z.number().int().min(0), changed: z.number().int().min(0), cleared: z.number().int().min(0),
  open: z.object({ HIGH: z.number().int(), MEDIUM: z.number().int(), LOW: z.number().int() }),
  readAttempts: z.number().int().min(1).max(3),
});
export const AutoExceptionOutcomeSchema = z.object({
  riskId: z.string().uuid(), riskNumber: z.number().int(),
  outcome: z.enum(['CREATED', 'SKIPPED_LINKED', 'FAILED', 'DEFERRED']),
  exceptionId: z.string().uuid().nullable(), exceptionNumber: z.number().int().nullable(),
  linkedExceptionNumbers: z.array(z.number().int()),
  error: z.string().nullable(),
});
```

### §2e `RiskAssessmentPayload` (stored in `risk_assessments.payload`, returned by the API)

```ts
const EvidenceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('STATE_OBSERVATION'), entity: EntityRefDtoSchema, state: OperationalStateSchema,
             sourceSystem: z.string(), sourceId: z.string(), observedAt: z.string().datetime() }),
  z.object({ kind: z.literal('EVENT'), eventId: z.string().uuid(), type: z.string(), occurredAt: z.string().datetime(),
             sourceSystem: z.string(), sourceId: z.string() }),
  z.object({ kind: z.literal('ATTRIBUTE'), entity: EntityRefDtoSchema, attribute: z.string(), value: z.string(),
             sourceSystem: z.string(), sourceId: z.string(), observedAt: z.string().datetime() }),
  z.object({ kind: z.literal('CLOCK'), clock: SlaClockDtoSchema }),            // contracts § SLA clock
]);

const FactorValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('BOOLEAN'), value: z.boolean(), state: OperationalStateSchema }),
  z.object({ kind: z.literal('DURATION'), ms: z.number().int().min(0), since: z.string().datetime(), entity: EntityRefDtoSchema }),
  z.object({ kind: z.literal('PERCENT'), hundredths: z.number().int().min(0).max(10_000), entity: EntityRefDtoSchema }),
  z.object({ kind: z.literal('SHARE'), remainingMs: z.number().int(), windowMs: z.number().int().min(0),
             dueAt: z.string().datetime(), clockKey: z.string(), entity: EntityRefDtoSchema }),
  z.object({ kind: z.literal('COUNT'), count: z.number().int().min(0), lowerBound: z.boolean(),
             nonSourceOnly: z.number().int().min(0), entities: z.array(EntityRefDtoSchema).max(20) }),
  z.object({ kind: z.literal('NONE') }),
  z.object({ kind: z.literal('UNAVAILABLE'), note: z.string() }),
]);

export const RiskFactorDtoSchema = z.object({
  key: z.string(), label: z.string(), measure: RiskMeasureSchema,
  value: FactorValueSchema,
  valueText: z.string(),                    // contracts § Factor sentences
  weight: z.number().int(), points: z.number().int(), contribution: z.string(),   // "28.0"
  band: z.string().nullable(),              // "≥ 8h → 100 points", null when no band matched
  sourceOnlyPoints: z.number().int(),
  conflict: z.string().nullable(),          // contracts § Confidence reasons, state-conflict sentence
  fallback: z.string().nullable(),          // clock start fallback sentence
  evidence: z.array(EvidenceRefSchema).max(25),
});

export const RiskAssessmentPayloadSchema = z.object({
  type: RiskTypeSchema,
  entity: EntityRefDtoSchema,               // name, type and state at assessment time
  asOf: z.string().datetime(),
  configVersion: z.number().int().min(1),
  graphVersion: z.string().nullable(),      // bigint as decimal string
  termsDigest: z.string().length(64).nullable(),
  score: z.number().int().min(0).max(100),
  level: RiskLevelSchema,
  thresholds: z.object({ high: z.number().int(), medium: z.number().int(), low: z.number().int() }),
  confidence: ConfidenceSchema,
  confidenceReasons: z.array(z.string()).min(1),
  sourceOnlyScore: z.number().int().min(0).max(100),
  factors: z.array(RiskFactorDtoSchema).min(1),
  headline: z.string(),                     // contracts § Headline
  understatedBy: z.array(z.string()),       // labels of UNAVAILABLE factors
});
```

---

## §3 Graph repository additions (`apps/api/src/graph/`)

### §3a `reachBatch` (in `prisma-graph.repository.ts`, the only file allowed to hold traversal SQL)

`followFrom` / `followTo` are computed from `DEPENDENCY_DIRECTION` exactly as 003 does for its directions: for **DOWNSTREAM** (towards dependents), follow `from → to` on the `TO_DEPENDS_ON_FROM` types and `to → from` on the `FROM_DEPENDS_ON_TO` types; **UPSTREAM** is the reverse.

```sql
WITH RECURSIVE walk(start_id, entity_id, depth, live, sourced) AS (
  SELECT s.id, s.id, 0,
         ${startAlwaysLive} OR e.current_state = ANY(${impaired}::"OperationalState"[]),
         true
  FROM unnest(${startIds}::uuid[]) AS s(id)
  JOIN entities e ON e.id = s.id
  UNION
  SELECT w.start_id, step.next_id, w.depth + 1,
         w.live AND n.current_state = ANY(${impaired}::"OperationalState"[]),
         w.sourced AND step.origin = 'SOURCE'
  FROM walk w
  JOIN entities cur ON cur.id = w.entity_id
  CROSS JOIN LATERAL (
    SELECT r.to_entity_id AS next_id, r.origin
    FROM relationships r
    WHERE r.from_entity_id = w.entity_id AND r.type = ANY(${followFromTypes}::"RelationshipType"[])
    UNION ALL
    SELECT r.from_entity_id AS next_id, r.origin
    FROM relationships r
    WHERE r.to_entity_id = w.entity_id AND r.type = ANY(${followToTypes}::"RelationshipType"[])
  ) step
  JOIN entities n ON n.id = step.next_id
  WHERE w.depth < ${maxDepth}
    AND (w.depth = 0 OR NOT (cur.current_state = ANY(${terminal}::"OperationalState"[])))
    AND step.next_id <> w.start_id
)
SELECT start_id::text, entity_id::text, min(depth)::int AS depth,
       bool_or(live) AS live, bool_or(sourced) AS sourced, bool_or(live AND sourced) AS live_sourced
FROM walk
WHERE depth > 0
GROUP BY start_id, entity_id
```

- Cycle guard: `UNION` over the 5-tuple (each `(start, entity, depth)` appears at most 4 times); depth bound: `w.depth < maxDepth` (validated 1..6 by the caller; the method throws for other values).
- The method validates `startIds.length ≤ 100` and returns rows sorted by `(startId, depth, entityId)` in code units (`compareCodeUnits`).
- Unit-free contract: no entity details are returned; the reader loads entity rows once per evaluation.

### §3b `directLinks` and `dependentCounts`

```ts
directLinks({ entityIds, relationshipTypes, side }): Promise<Array<{
  entityId: string; neighborId: string; relationshipId: string; type: RelationshipType;
  origin: RelationshipOrigin; confidence: Confidence }>>
// side 'FROM': rows where from_entity_id ∈ entityIds (neighbor = to); 'TO': the reverse. Fixed-shape, non-recursive,
// chunks of 1,000 ids, ordered by (entityId, neighborId, relationshipId).

dependentCounts(entityIds): Promise<Map<string, number>>
// number of distinct entities that depend directly on each id (DEPENDENCY_DIRECTION), counting all origins;
// used only for the HAS_DIRECT_DEPENDENT and IMPAIRED_OR_DIRECT_IMPAIRED_DEPENDENT gates.
```

### §3c `GraphChangeNotifier` (`graph/graph-change.notifier.ts`)

```ts
@Injectable() export class GraphChangeNotifier {
  onImportApplied(listener: (info: { importId: string }) => void): () => void;   // returns an unsubscribe function
  importApplied(info: { importId: string }): void;   // calls listeners synchronously; a listener error is logged, never thrown
}
```

---

## §4 Engine (`apps/api/src/risk/engine/`, pure)

### §4a Candidates (`candidates.ts`)

| Gate | Candidate when |
|---|---|
| `RUNNING_CLOCK` | the entity has at least one clock with status ON_TRACK, AT_RISK or BREACHED |
| `OWN_IMPAIRED` | `IMPACT_STATE_CLASS[currentState] = 'IMPAIRED'` |
| `IMPAIRED_OR_DIRECT_IMPAIRED_DEPENDENT` | impaired, or `dependentCounts > 0` and at least one depth-1 downstream row is impaired (checked after the reach) |
| `HAS_DIRECT_DEPENDENT` | `dependentCounts > 0` |
| `NONE` | always |

Terminal entities and entities of non-applicable types are never candidates. A rule that is disabled has no candidates.

### §4b `evaluateEntity(input, rule, asOf) → RuleOutcome`

```ts
type RuleOutcome =
  | { kind: 'NOT_APPLICABLE' }
  | { kind: 'BELOW_THRESHOLD'; score: number; factors: RiskFactorDto[] }
  | { kind: 'RESULT'; payload: RiskAssessmentPayload; materialKey: string };

interface EntityInput {
  entity: EntityRefDto; attributes: Record<string, unknown>;
  observations: ObservationRow[];                    // own, ordered (observedAt, seq)
  perSourceClasses: ImpactStateClass[];              // R6 conflicts
  clocks: SlaClock[];                                // own clocks (all statuses)
  downstream: ReachView; upstream: ReachView;        // rows + entity rows + their observations, clocks, attributes
  events: EventRow[];                                // linked events of the relevant types
}
```

Steps: measures (R6) → points per factor (R7 bands) → score → level → if a level, source-only pass → confidence and reasons → factor texts → headline → `materialKey = sha256(canonicalJson(key parts of R12))`.

### §4c Lifecycle plan (`lifecycle.ts`)

```ts
planLifecycle(outcomes: Map<`${RiskType}:${entityId}`, RuleOutcome>, open: OpenRiskRow[], disabled: Set<RiskType>)
  → { raises: RaisePlan[] /* in numbering order, R12 */; changes: ChangePlan[]; clears: ClearPlan[] }
```

- `RESULT` with no open risk → raise; with an open risk whose latest `materialKey` differs → change; equal → nothing.
- open risk with `BELOW_THRESHOLD` → clear `BELOW_THRESHOLD`; type disabled → `RULE_DISABLED`; no outcome or `NOT_APPLICABLE` → `NOT_APPLICABLE`.

---

## §5 Service algorithms

| Service | Method | Writes (one transaction unless stated) | Audit |
|---|---|---|---|
| `SlaTermsService` | `create(actor, input)` | insert term (`createdAt = updatedAt = now`) | `sla_term.created` (after = `SlaTermDto` without counts) |
| | `update(actor, id, input)` | conditional update on `version`; immutable `contractEntityId`; no-op → 200, nothing written | `sla_term.updated` (changed fields) |
| `RiskConfigService` | `ensureInitialized()` | insert version 1 if none | `risk.config_initialized` (system) |
| | `updateRule(actor, type, input)` | insert `version + 1` | `risk.config_updated` (rule before/after, `{ note, version }`) |
| `RiskEvaluationService` | `run(...)` | research R10 steps 1, 7, 9 (three transactions) | `risk.evaluation_started`, risk rows, `risk.evaluation_completed` / `_failed` |
| `RiskLifecycle` | `apply(tx, plan, evaluation)` | inserts risks (in order) and assessments; updates changed and cleared risks | `risk.raised`, `risk.level_changed` / `risk.rescored`, `risk.cleared` (via `recordMany`) |
| `AutoExceptionService` | `process(evaluation, config)` | per risk: 007 create (its own transaction), then update risk | `exception.created` (007), `risk.exception_created` / `risk.exception_failed` |

After `create`/`update` of a term and `updateRule`, the service calls `RiskScheduler.trigger('CONFIG_CHANGE')` after its transaction commits.

---

## §6 Entities (spec Key Entities → this model)

| Spec entity | Where |
|---|---|
| SLA Term | `sla_terms` (stored), `SlaTermDto` |
| SLA Clock | computed by `classifySlaClock` over `ClockInputsReader` data, `SlaClockDto` |
| Risk Configuration Version | `risk_config_versions` (stored, append-only), `RiskConfigVersionDto` |
| Risk Rule | `RiskRuleConfig` inside a version + `RULE_DEFINITIONS` (code) |
| Risk Evaluation | `risk_evaluations` (stored), `RiskEvaluationDto` |
| Risk | `risks` (stored), `RiskSummaryDto`, `RiskDetailResponse` |
| Risk Assessment | `risk_assessments` (stored, append-only), `RiskAssessmentDto` |
| Risk Factor | `RiskFactorDto` inside an assessment payload |
