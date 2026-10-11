# API Contract: Root-Cause Analysis

**Feature**: `005-root-cause-analysis` | **Date**: 2026-10-06

All schemas live in `@opsgraph/shared`:
- `packages/shared/src/root-cause.ts`
- `packages/shared/src/evidence-notes.ts`

Both are re-exported from `index.ts`. The backend validates every request with them, and the web app parses every response with them.

---

## Routes

| Method | Path | Roles | Success | Errors |
|---|---|---|---|---|
| GET | `/api/entities/:id/root-cause` | all signed-in | 200 `RootCauseResponse` | 400 `VALIDATION_FAILED`, 401, 404 `NOT_FOUND` |
| POST | `/api/evidence-notes` | all signed-in | 201 `EvidenceNoteDto` | 400 `VALIDATION_FAILED` (including a missing target), 401 |
| POST | `/api/evidence-notes/:noteId/retract` | author or ADMIN | 200 `EvidenceNoteDto` | 400, 401, 403 `FORBIDDEN`, 404 `NOT_FOUND` |
| GET | `/api/entities/:id/evidence-notes` | all signed-in | 200 `EvidenceNoteListResponse` | 400, 401, 404 |
| GET | `/api/relationships/:id/evidence-notes` | all signed-in | 200 `EvidenceNoteListResponse` | 400, 401, 404 |

**Controllers** (all in `apps/api/src/root-cause/`):
- `RootCauseController` (`@Controller('entities')`) serves the first route.
- `EvidenceNotesController` (`@Controller()`, explicit paths) serves the other four.

Path ids are validated with `ParseUUIDPipe`, and bodies and queries with `ZodValidationPipe`.

**Writes and audit**:
- `GET /root-cause` writes nothing.
- Creating and retracting a note each write one audit row in the same transaction:

| Route | `action` | `targetType` | `targetId` | `before` | `after` |
|---|---|---|---|---|---|
| create | `evidence_note.created` | `evidence_note` | note id | — | the created `EvidenceNoteDto` |
| retract | `evidence_note.retracted` | `evidence_note` | note id | the note before | the note after |

**Retract behaviour**:
- **Repeat retraction**: retracting a note that is already retracted returns `200` with the current note. It writes **no** audit row and does not change the stored reason.
- **Forbidden retraction**: when the caller is neither the author nor an ADMIN, the service writes `auth.forbidden` (standalone, `metadata: { method, path, role }`) and then throws `403`.

---

## Query and request schemas

```ts
// root-cause.ts
export const RootCauseQuerySchema = z.object({
  depth: TraceDepthSchema,                          // from tracing.ts: 1..10, default 6
  evaluatedAt: z.string().datetime().optional(),    // UTC ISO-8601; default = request time
});

// evidence-notes.ts
const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const EvidenceNoteTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ENTITY'), entityId: z.string().uuid() }),
  z.object({ kind: z.literal('RELATIONSHIP'), relationshipId: z.string().uuid() }),
]);

export const CreateEvidenceNoteRequestSchema = z.object({
  target: EvidenceNoteTargetSchema,
  stance: EvidenceNoteStanceSchema,
  text: trimmed(EVIDENCE_NOTE_LIMITS.textMax),
  reference: z.string().trim().max(EVIDENCE_NOTE_LIMITS.referenceMax).optional()
    .transform((value) => (value === undefined || value === '' ? null : value)),
}).strict();

export const RetractEvidenceNoteRequestSchema = z.object({
  reason: trimmed(EVIDENCE_NOTE_LIMITS.reasonMax),
}).strict();

export const EvidenceNoteListQuerySchema = PageQuerySchema;   // cursor, limit (default 50, max 200)
```

**A missing target** returns 400 `VALIDATION_FAILED`, with one detail:
- `{ path: 'target.entityId', message: 'Entity not found' }`, or
- `{ path: 'target.relationshipId', message: 'Relationship not found' }`.

**Note list cursor**:
- the cursor is `encodeCursor({ createdAt, id })`;
- items are ordered by `createdAt DESC`, then `id DESC`, comparing the ISO string and the uuid with `compareCodeUnits`;
- the next page starts strictly after the cursor.

---

## Response schemas

```ts
// evidence-notes.ts
export const UserRefDtoSchema = z.object({ id: z.string().uuid(), displayName: z.string() });

export const EvidenceNoteDtoSchema = z.object({
  id: z.string().uuid(),
  target: EvidenceNoteTargetSchema,
  stance: EvidenceNoteStanceSchema,
  text: z.string(),
  reference: z.string().nullable(),
  author: UserRefDtoSchema,
  createdAt: z.string().datetime(),
  active: z.boolean(),                               // false iff retraction !== null
  retraction: z.object({
    retractedBy: UserRefDtoSchema,
    reason: z.string(),
    retractedAt: z.string().datetime(),
  }).nullable(),
});

export const EvidenceNoteListResponseSchema = z.object({
  items: z.array(EvidenceNoteDtoSchema),
  nextCursor: z.string().nullable(),
});

// root-cause.ts
const Counted = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().min(0) });

export const StateRecordEvidenceDtoSchema = z.object({
  rule: z.literal('STATE_RECORD'),
  origin: z.literal('SOURCE'),
  current: z.boolean(),                              // true for the observation that set currentState
  observation: StateObservationDtoSchema,
  sourceRecord: SourceRecordDtoSchema,
});

export const RequirementSourceDtoSchema = z.object({
  rule: z.literal('REQUIREMENT_SOURCE'),
  origin: RelationshipOriginSchema,                  // origin of the DEFINES/GOVERNS relationship
  confidence: ConfidenceSchema,
  relationship: z.object({
    id: z.string().uuid(),
    type: z.enum(['DEFINES', 'GOVERNS']),
    fromEntityId: z.string().uuid(),
    toEntityId: z.string().uuid(),
    basis: z.string().nullable(),
    sourceSystem: z.string(),
    sourceId: z.string(),
    observedAt: z.string().datetime(),
  }),
  entity: EntityRefDtoSchema,                        // the defining entity (e.g. the contract)
  attributes: z.record(JsonValueSchema),
  stateRecord: StateRecordEvidenceDtoSchema.nullable(),   // its current state record
});

export const EventEvidenceDtoSchema = z.object({
  rule: z.literal('EVENT'),
  origin: z.literal('SOURCE'),
  id: z.string().uuid(),
  eventType: z.string(),
  occurredAt: z.string().datetime(),
  observedAt: z.string().datetime(),
  description: z.string().nullable(),
  role: z.enum(['SUBJECT', 'RELATED']),              // of the evidenced entity in this event
  entities: z.array(z.object({ entity: EntityRefDtoSchema, role: z.enum(['SUBJECT', 'RELATED']) })),
  sourceSystem: z.string(),
  sourceId: z.string(),
  importId: z.string().uuid(),
});

export const NoteEvidenceDtoSchema = EvidenceNoteDtoSchema.extend({
  rule: z.literal('MANUAL_NOTE'),
  origin: z.literal('MANUAL'),
});

export const EntityEvidenceDtoSchema = z.object({
  entityId: z.string().uuid(),
  stateRecords: z.array(StateRecordEvidenceDtoSchema),   // current first, then other sources by sourceSystem
  requirementSources: Counted(RequirementSourceDtoSchema),  // ≤ 20 items
  events: Counted(EventEvidenceDtoSchema),                  // ≤ 20 items, newest first
  notes: Counted(NoteEvidenceDtoSchema),                    // ≤ 50 items, newest first
});

export const RelationshipEvidenceDtoSchema = z.object({
  relationshipId: z.string().uuid(),
  rule: z.literal('RELATIONSHIP_RECORD'),
  origin: RelationshipOriginSchema,
  confidence: ConfidenceSchema,
  record: SourceRecordDtoSchema.nullable(),          // latest source record of this assertion
  notes: Counted(NoteEvidenceDtoSchema),
});

export const CausalStepDtoSchema = z.object({
  index: z.number().int().min(0),                    // 0 = symptom
  roles: z.array(CausalRoleSchema).min(1),           // in CAUSAL_ROLES order
  possible: z.boolean(),                             // entity state is UNKNOWN
  entity: TracedEntityDtoSchema,
  hop: HopDtoSchema.nullable(),                      // null only at index 0
});

export const CausalChainDtoSchema = z.object({
  steps: z.array(CausalStepDtoSchema).min(2),
  length: z.number().int().min(1),                   // hops = steps.length - 1
  weakestConfidence: ConfidenceSchema,
  nonSourceHops: z.number().int().min(0),
  continuesBeyondDepth: z.boolean(),
  endsInCycle: z.boolean(),
  sentences: z.array(z.string()).min(1),             // 003 templates; HEDGED when candidate is LOW
});

export const KeyEvidenceItemDtoSchema = z.object({
  rule: z.enum(['STATE_RECORD', 'REQUIREMENT_SOURCE']),
  origin: RelationshipOriginSchema,
  entity: EntityRefDtoSchema,
  sourceRecordId: z.string().uuid(),
  sourceSystem: z.string(),
  sourceId: z.string(),
  observedAt: z.string().datetime(),
});

export const ConfidenceRuleOutcomeDtoSchema = z.object({
  rule: ConfidenceRuleSchema,
  applied: z.boolean(),
  confidenceAfter: ConfidenceSchema,
  reason: z.string(),
  refs: z.object({
    stepIndexes: z.array(z.number().int().min(0)),
    relationshipIds: z.array(z.string().uuid()),
    noteIds: z.array(z.string().uuid()),
  }),
});

export const RootCauseCandidateDtoSchema = z.object({
  rootCause: TracedEntityDtoSchema,
  label: z.string(),
  labelRule: LabelRuleSchema,
  possible: z.boolean(),
  inCycle: z.boolean(),
  continuesBeyondDepth: z.boolean(),
  insufficientEvidence: z.boolean(),                 // confidence === 'LOW'
  confidence: ConfidenceSchema,
  confidenceRules: z.array(ConfidenceRuleOutcomeDtoSchema).length(8),
  primaryChain: CausalChainDtoSchema,
  alternativeChains: z.array(CausalChainDtoSchema),
  keyEvidence: z.array(KeyEvidenceItemDtoSchema),
  eventCount: z.number().int().min(0),
  explanation: z.object({
    headline: z.string(),
    chain: z.array(z.string()).min(1),               // = primaryChain.sentences
    confidence: z.array(z.string()).min(1),          // reasons of applied rules, in rule order
    evidence: z.string(),
  }),
});

export const RootCauseResponseSchema = z.object({
  query: z.object({
    entityId: z.string().uuid(),
    depth: z.number().int(),
    evaluatedAt: z.string().datetime(),
  }),
  computedAt: z.string().datetime(),
  status: RootCauseStatusSchema,
  start: TracedEntityDtoSchema,
  summary: z.string(),
  truncation: TruncationDtoSchema,                   // from the 003 blockers response
  candidates: z.array(RootCauseCandidateDtoSchema),  // [] unless ROOT_CAUSES_FOUND
  evidence: z.object({
    entities: z.array(EntityEvidenceDtoSchema),      // first-appearance order (data-model §4)
    relationships: z.array(RelationshipEvidenceDtoSchema),
  }),
});
```

**Status rules**:
- `ROOT_CAUSES_FOUND` when the blockers response has at least one path;
- otherwise `NOT_BLOCKED` when `start.state.classification === 'SATISFIED'`;
- otherwise `UNEXPLAINED`. In this case `evidence.entities` holds exactly the start entity (FR-019).

For `NOT_BLOCKED`, both evidence arrays are empty.

**Key evidence** (FR-013):
- For each step of the primary chain, in order:
  1. its `stateRecords` (rule `STATE_RECORD`);
  2. then its `requirementSources[].stateRecord` (rule `REQUIREMENT_SOURCE`, using that requirement source's `origin`).
- Duplicates are removed by `sourceRecordId`, keeping the first occurrence.
- Requirement sources with a `null` state record are skipped.

**`eventCount`**: the number of distinct event ids among the `events.items` of the primary chain's steps.

---

## Explanation text

All functions live in `apps/api/src/root-cause/analysis/explanation.ts` and are pure. The notation follows 003 contracts/api.md, plus:
- `steps(n)` is reused from 003.
- `iso(d)` = `d.toISOString()`.
- `words(state)`: the state lower-cased, split on `_`, each word capitalized, joined with spaces. For example, AT_RISK becomes "At Risk".
- `kind(origin)`:
  - SOURCE becomes `source-recorded`;
  - INFERRED becomes `inferred`;
  - MANUAL becomes `manually recorded`.
- `events(n)` = `` `${n} operational event${n === 1 ? '' : 's'}` ``.

### Chain sentences

These are `explainBlockingPath(start, path, mood)` from `tracing/explanation.ts`:
- `mood = 'HEDGED'` if and only if the candidate's confidence is LOW.
- HEDGED replaces only the subject clause, and only in these rows:

| Classification of X | ASSERTIVE (unchanged) | HEDGED |
|---|---|---|
| UNSATISFIED | `` `${name(X)} is ${label(X)} because` `` | `` `${name(X)} may be ${label(X)} because` `` |
| SATISFIED and AT_RISK | `` `${name(X)} is at risk because` `` | `` `${name(X)} may be at risk because` `` |

### Headline

```text
display = label
        + (possible ? ' (state unknown)' : '')
        + (inCycle ? ' (circular dependency)' : '')
        + (continuesBeyondDepth ? ` (deepest cause found within ${steps(depth)})` : '')
if confidence == LOW:          `Possible root cause — insufficient evidence: ${display}. Confidence: LOW.`
else if candidates.length > 1: `Possible root cause: ${display}. Confidence: ${confidence}.`
else:                          `Root cause: ${display}. Confidence: ${confidence}.`
```

### Confidence reasons (`reason` on every outcome; `explanation.confidence` = reasons where `applied`)

`C` is the confidence after the rule. `root` is the root-cause entity.

| Rule | Applied | Not applied |
|---|---|---|
| WEAKEST_LINK | `` `Confidence starts at ${C}, the confidence of the weakest link: ${name(from)} ${TYPE} ${name(to)} (${kind(o)}, ${conf} confidence).` ``, where the hop is the **first** hop with the minimal effective confidence, `from`/`to` are the relationship's recorded ends, and `o`/`conf` are its effective origin and confidence | — (always applied) |
| UNKNOWN_STATE | `` `Confidence set to LOW: the state of ${names} is unknown.` `` | `No step has an unknown state.` |
| CYCLE | `` `Confidence set to LOW: ${name(root)} is part of a dependency cycle.` `` | `The chain is not part of a dependency cycle.` |
| SEARCH_LIMIT | if `continuesBeyondDepth`: `` `Confidence is at most MEDIUM: the chain continues beyond the depth limit of ${steps(depth)}, so the true cause may lie deeper.` ``; otherwise: `Confidence is at most MEDIUM: the blocker search was truncated, so other causes may exist.` | `` `The search was complete within ${steps(depth)}.` `` |
| STALE_EVIDENCE | `` `Confidence lowered to ${C}: the state of ${items} was last observed more than 72 hours before ${iso(evaluatedAt)}.` ``, where each item is `` `${name} (${observedAt})` ``, or `` `${name} (never observed)` `` | `` `Every step's state was observed within 72 hours before ${iso(evaluatedAt)}.` `` |
| CLASSIFICATION_DISAGREEMENT | `` `Confidence lowered to ${C}: sources disagree on whether a step can progress: ${details}.` ``, where `details` covers only the entities whose classifications differ | with same-class disagreements: `` `Sources report different states for ${details}, but each step's states share one classification, so confidence is not lowered.` ``; with none: `All sources agree on each step's state.` |
| UNCORROBORATED (at most one source system and no events) | one source: `` `Confidence lowered to ${C}: the state of ${name(root)} comes from a single source (${sourceSystem}) and no operational event mentions it.` ``; no source record at all: `` `Confidence lowered to ${C}: the state of ${name(root)} has no source record and no operational event mentions it.` `` | when the event total is above 0: `` `The state of ${name(root)} is corroborated by ${events(total)}.` ``; otherwise: `` `The state of ${name(root)} is reported by ${k} source systems.` `` |
| DISPUTED | `` `Confidence lowered to ${C}: ${n} active disputing note${n === 1 ? '' : 's'}: ${items}.` ``, where each item is `` `${author.displayName} on ${createdAt}: "${excerpt}"` `` and `excerpt` is the first 80 characters of the text, plus `…` when it is longer | `No active note disputes this chain.` |

**List formats**:
- `names`, `items` and `details` are joined with `', '`. Within `details`, entity entries are joined with `'; '`.
- A `details` entry is `` `${name} (${src1} ${STATE1}, ${src2} ${STATE2}, …)` ``, with sources in `sourceSystem` order.
- Steps are listed in chain order.
- Notes are listed `createdAt` ascending, then `id` ascending.

**Refs**:
- `refs.stepIndexes` holds the triggering steps. For WEAKEST_LINK, it is the index of the step reached by the chosen hop.
- `refs.relationshipIds`:
  - WEAKEST_LINK: that hop's assertion ids;
  - DISPUTED: the relationship-targeted notes' relationship ids.
- `refs.noteIds`: the DISPUTED notes.
- All refs are sorted ascending. When a rule is not applied, every ref list is empty.

### Evidence sentence

```text
`Evidence: ${keyEvidence.map(k => `${name(k.entity)} (${k.sourceSystem} ${k.sourceId})`).join(', ')}; ${events(eventCount)}.`
```

### Summary (FR-022)

```text
ROOT_CAUSES_FOUND, 1 candidate, not LOW:  `${name(start)} is ${STATE(start)}. 1 root cause found: ${label} (${C}).`
ROOT_CAUSES_FOUND, 1 candidate, LOW:      `${name(start)} is ${STATE(start)}. 1 possible root cause found, with insufficient evidence: ${label} (LOW).`
ROOT_CAUSES_FOUND, k > 1:                 `${name(start)} is ${STATE(start)}. ${k} possible root causes found; highest ranked: ${label₀} (${C₀}).`
NOT_BLOCKED:                              `${name(start)} is ${STATE(start)}. It is not blocked: no unsatisfied dependency was found within ${steps(depth)}, so no root cause applies.`
UNEXPLAINED:                              `${name(start)} is ${STATE(start)}, but no recorded dependency within ${steps(depth)} explains this state. No root cause can be named.`
```

---

## Acceptance fixtures (seeded §39 scenario)

Entity keys and display names are as in 003 contracts/api.md § Acceptance fixtures. In addition:
- `Contract/ContractMgmt/CON-3982` = "Contract CON-3982"
- `Order/OMS/18532` = "Order #18532"

Unless stated otherwise:
- requests use `?evaluatedAt=2026-09-29T16:00:00Z` and default depth 6;
- the echoed `query.evaluatedAt` is `2026-09-29T16:00:00.000Z`;
- `truncation` is all false.

`root-cause-seed.e2e-spec.ts` asserts every line of this section.

### R1. Order #18492

- **Result**: `status ROOT_CAUSES_FOUND`, exactly 1 candidate.
- **`summary`**: `Order #18492 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH).`
- **Candidate**:
  - `rootCause` is BR-18492;
  - `label "Budget Code Missing"`, `labelRule REQUIRED_FIELD`;
  - `confidence HIGH`, `insufficientEvidence false`;
  - `possible`, `inCycle` and `continuesBeyondDepth` are false;
  - `alternativeChains = []`.
- **`primaryChain.steps`**:

  | index | entity | roles | hop |
  |---|---|---|---|
  | 0 | Order #18492 | `[SYMPTOM]` | `null` |
  | 1 | Payment PAY-88213 | `[IMMEDIATE_BLOCKER]` | REQUIRES, FORWARD, SOURCE / HIGH |
  | 2 | Finance approval APR-2291 | `[UPSTREAM_CAUSE]` | REQUIRES, FORWARD, SOURCE / HIGH |
  | 3 | Budget code for Order #18492 | `[ROOT_CAUSE]` | REQUIRES, FORWARD, SOURCE / HIGH |

- **`confidenceRules`** (in order; `confidenceAfter` is HIGH throughout; `applied` is true only for WEAKEST_LINK):
  1. WEAKEST_LINK, `refs.stepIndexes [1]`: `Confidence starts at HIGH, the confidence of the weakest link: Order #18492 REQUIRES Payment PAY-88213 (source-recorded, high confidence).`
  2. UNKNOWN_STATE: `No step has an unknown state.`
  3. CYCLE: `The chain is not part of a dependency cycle.`
  4. SEARCH_LIMIT: `The search was complete within 6 steps.`
  5. STALE_EVIDENCE: `Every step's state was observed within 72 hours before 2026-09-29T16:00:00.000Z.`
  6. CLASSIFICATION_DISAGREEMENT: `Sources report different states for Order #18492 (ERP PENDING, OMS BLOCKED), but each step's states share one classification, so confidence is not lowered.`
  7. UNCORROBORATED: `The state of Budget code for Order #18492 is corroborated by 1 operational event.`
  8. DISPUTED: `No active note disputes this chain.`
- **`explanation`**:
  - `headline`: `Root cause: Budget Code Missing. Confidence: HIGH.`
  - `chain`: the 3 sentences of 003 fixture F2, starting with `Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.`
  - `confidence`: `[<WEAKEST_LINK reason above>]`
  - `evidence`: `Evidence: Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 7 operational events.`
- **`keyEvidence`**: 6 items, in this order:

  | # | rule | record |
  |---|---|---|
  | 1 | STATE_RECORD | OMS 18492 |
  | 2 | STATE_RECORD | ERP SO-18492 |
  | 3 | REQUIREMENT_SOURCE | ContractMgmt CON-3982 |
  | 4 | STATE_RECORD | Payments PAY-88213 |
  | 5 | STATE_RECORD | FinanceApprovals APR-2291 |
  | 6 | STATE_RECORD | FinanceApprovals BR-18492 |

  This covers the spec's contract, payment record and approval record. `eventCount 7` (EVT-OMS-1001 … EVT-TMS-5001).
- **`evidence.entities`**, in order: Order #18492, PAY-88213, APR-2291, BR-18492.
  - **Order #18492**:
    - `stateRecords` = [OMS 18492 BLOCKED `current true` (observed 2026-09-29T11:40:00.000Z), ERP SO-18492 PENDING `current false`];
    - `requirementSources.items` = [CON-3982 via GOVERNS, `attributes.clause` = "Orders above 10,000.00 USD require finance approval with a budget code"];
    - `events.total 4`, items newest first: EVT-TMS-5001, EVT-WMS-4001, EVT-PAY-2001, EVT-OMS-1001.
  - **BR-18492**:
    - `requirementSources.items` = [CON-3982 via DEFINES];
    - `events.total 1` = [EVT-FA-3002, role RELATED].
  - **APR-2291**: `events.total 3`.
  - Every entity has `notes.total 0`.
- **`evidence.relationships`**: the 3 REQUIRES assertions, each with `rule RELATIONSHIP_RECORD`, `origin SOURCE` and a non-null `record`.

### R2. Shipment SHP-77120 (consolidated)

- **Result**: 1 candidate (BR-18492), `confidence HIGH`.
- **`summary`**: `Shipment SHP-77120 (consolidated) is DELAYED. 1 root cause found: Budget Code Missing (HIGH).`
- **`primaryChain`**: steps SHP-77120 `[SYMPTOM]`, Order #18492 `[IMMEDIATE_BLOCKER]`, PAY-88213 `[UPSTREAM_CAUSE]`, APR-2291 `[UPSTREAM_CAUSE]`, BR-18492 `[ROOT_CAUSE]`. `sentences` = 003 F1 `paths[0].explanation`.
- **`alternativeChains`**: exactly 1.
  - Steps: SHP-77120 `[SYMPTOM]`, PAY-88213 `[IMMEDIATE_BLOCKER]` (hop BLOCKS, REVERSE, MANUAL / MEDIUM), APR-2291 `[UPSTREAM_CAUSE]`, BR-18492 `[ROOT_CAUSE]`.
  - `weakestConfidence MEDIUM`.
  - `sentences` = 003 F1 `paths[1].explanation`.
- **WEAKEST_LINK**: `Confidence starts at HIGH, the confidence of the weakest link: Shipment SHP-77120 (consolidated) DEPENDS_ON Order #18492 (source-recorded, high confidence).`
- **CLASSIFICATION_DISAGREEMENT**: identical to R1.
- **`explanation.evidence`**: `Evidence: Shipment SHP-77120 (consolidated) (TMS SHP-77120), Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 8 operational events.`
- **`evidence.relationships`**: includes the BLOCKS assertion (ManualEntry) with `origin MANUAL`, `confidence MEDIUM`.

### R3. Acme Corp delivery SLA

- **Result**: 1 candidate (BR-18492), `confidence MEDIUM`.
- **`summary`**: `Acme Corp delivery SLA is AT_RISK. 1 root cause found: Budget Code Missing (MEDIUM).`
- **`headline`**: `Root cause: Budget Code Missing. Confidence: MEDIUM.`
- **`primaryChain`**: steps SLA `[SYMPTOM]`, SHP-77120 `[IMMEDIATE_BLOCKER]`, Order #18492, PAY-88213 and APR-2291 `[UPSTREAM_CAUSE]`, BR-18492 `[ROOT_CAUSE]`.
- **`chain[0]`**: 003 F3 `paths[0].explanation[0]` (it states "inferred, medium confidence").
- **`alternativeChains`**: 1 (003 F3 `paths[1]`).
- **WEAKEST_LINK** (`applied`, `confidenceAfter MEDIUM`, `refs.stepIndexes [1]`): `Confidence starts at MEDIUM, the confidence of the weakest link: Acme Corp delivery SLA DEPENDS_ON Shipment SHP-77120 (consolidated) (inferred, medium confidence).`
- **Rules 2–8**: none applied.
- **`explanation.evidence`**: `Evidence: Acme Corp delivery SLA (ContractMgmt SLA-3982-DEL), Contract CON-3982 (ContractMgmt CON-3982), Shipment SHP-77120 (consolidated) (TMS SHP-77120), Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 8 operational events.`

### R4. Warehouse WH-EAST-02

- **Result**: `status NOT_BLOCKED`, `candidates []`, `evidence.entities []`, `evidence.relationships []`.
- **`summary`**: `East Distribution Center 02 is ACTIVE. It is not blocked: no unsatisfied dependency was found within 6 steps, so no root cause applies.`

### R5. Order #18532 (PENDING, no blocker relationships)

- **Result**: `status UNEXPLAINED`, `candidates []`.
- **`summary`**: `Order #18532 is PENDING, but no recorded dependency within 6 steps explains this state. No root cause can be named.`
- **`evidence.entities`**: exactly [Order #18532]:
  - `stateRecords` = [OMS 18532 PENDING `current true`];
  - `requirementSources.items` = [Contract CON-4330 via GOVERNS];
  - `events.total 0`.

### R6. Order #18492, evaluated at `2026-10-06T12:00:00Z`

- **Result**: identical to R1 except:
  - STALE_EVIDENCE is `applied`, with `confidenceAfter MEDIUM` and `refs.stepIndexes [0,1,2,3]`. Its reason is: `Confidence lowered to MEDIUM: the state of Order #18492 (2026-09-29T11:40:00.000Z), Payment PAY-88213 (2026-09-29T10:05:00.000Z), Finance approval APR-2291 (2026-09-29T10:05:00.000Z), Budget code for Order #18492 (2026-09-29T10:05:00.000Z) was last observed more than 72 hours before 2026-10-06T12:00:00.000Z.`
  - rules 6–8 have `confidenceAfter MEDIUM`;
  - candidate `confidence MEDIUM`;
  - `headline` `Root cause: Budget Code Missing. Confidence: MEDIUM.`;
  - `summary` ends `(MEDIUM).`;
  - `explanation.confidence` has 2 entries (WEAKEST_LINK, STALE_EVIDENCE).
- **Unchanged**: label, steps, key evidence and chain sentences.

### R7. Evidence notes change the analysis (sequence, against R1)

Users: analyst A and analyst B, both ANALYST, and admin C.

1. **A adds a SUPPORTS note**:
   - target ENTITY BR-18492, text `Finance confirmed the budget code was never submitted; requested from account manager on 2026-09-30`, reference `Call with Finance, ticket FIN-4410`.
   - Result: `201`, `active true`, and one audit `evidence_note.created`.
   - R1 again: `confidence HIGH`, and the BR-18492 evidence `notes.items[0]` is this note (`rule MANUAL_NOTE`, `origin MANUAL`).
2. **B adds a DISPUTES note**:
   - target RELATIONSHIP = the `REQUIRES:APR-2291:BR-18492` assertion, text `Approval record APR-2291 is out of date; Finance says the budget code was supplied on 2026-09-30.`
   - R1 again: DISPUTED is `applied`, `confidenceAfter MEDIUM`, `refs.noteIds = [note]`, and `refs.relationshipIds = [that relationship]`.
   - Its reason is `Confidence lowered to MEDIUM: 1 active disputing note: <B.displayName> on <createdAt>: "Approval record APR-2291 is out of date; Finance says the budget code was suppli…".` (the template's final period included). The text has 97 characters, so the excerpt is its first 80 characters followed by `…`.
   - Candidate `confidence MEDIUM`.
   - R2 (Shipment) also becomes MEDIUM, because its primary chain contains the same assertion.
3. **A tries to retract B's note**:
   - Result: `403 FORBIDDEN`, and one `auth.forbidden` audit row.
   - The note is unchanged.
4. **B retracts with reason `Confirmed with Finance: the approval record is current.`**:
   - Result: `200`, `active false`, `retraction.reason` as given, and one audit `evidence_note.retracted`. The audit row's `before.active` is true and `after.active` is false.
   - R1 again: `confidence HIGH`. The note still appears in the relationship's `notes.items`, with `active false`.
5. **B retracts again**: `200`, unchanged, and no new audit row.
6. **Direct database `UPDATE evidence_notes …` or `DELETE FROM evidence_note_retractions …`**: raises an error (append-only).

### R8. Role assignment on short chains

- **Finance approval APR-2291**:
  - 1 candidate, steps APR-2291 `[SYMPTOM]` and BR-18492 `[IMMEDIATE_BLOCKER, ROOT_CAUSE]`;
  - `summary` `Finance approval APR-2291 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH).`
- **Payment PAY-88213**:
  - steps PAY-88213 `[SYMPTOM]`, APR-2291 `[IMMEDIATE_BLOCKER]`, BR-18492 `[ROOT_CAUSE]`;
  - no UPSTREAM_CAUSE step;
  - `confidence HIGH`.

### R9. Budget code for Order #18492 itself

- **Result**: `status UNEXPLAINED`.
- **`summary`**: `Budget code for Order #18492 is MISSING, but no recorded dependency within 6 steps explains this state. No root cause can be named.`

### Validation and access

| Request | Expected |
|---|---|
| `GET …/root-cause?depth=0`, `depth=11` or `depth=abc` | 400 `VALIDATION_FAILED` on `depth` |
| `GET …/root-cause?evaluatedAt=yesterday` | 400 on `evaluatedAt` |
| An unknown entity id | 404 |
| A malformed id | 400 |
| No token, on any of the 5 routes | 401 |
| `POST /evidence-notes` with `text: '   '` | 400 on `text` |
| `POST /evidence-notes` with 2,001 characters of text | 400 on `text` |
| `POST /evidence-notes` with `stance: 'MAYBE'` | 400 on `stance` |
| `POST /evidence-notes` with an unknown `target.kind` | 400 on `target.kind` |
| `POST /evidence-notes` with a nonexistent `entityId` | 400, `{ path: 'target.entityId', message: 'Entity not found' }` |
| `POST /evidence-notes` with an extra property | 400 (strict) |

None of the refused note requests writes a note or an `evidence_note.*` audit row.
