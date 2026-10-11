# Research: Investigation Workspace

**Feature**: `008-investigation-workspace` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

The spec has no clarification markers; its defaults are listed in its Assumptions. This document records the **design decisions**. They are binding for the implementer. Each one gives the decision, the rationale and the alternatives rejected. Section numbers (R1–R18) are referenced from plan.md, data-model.md and contracts/api.md.

Codebase facts this research relies on (state of `008-investigation-workspace`: 001–003 implemented; 004–007 specified and planned, and **all four must be merged before this feature starts**, see plan.md § Prerequisites):

- `TimelineService.list(entityId, query)` (`apps/api/src/graph/timeline.service.ts`) merges one entity's events and state observations, oldest first, with a keyset cursor `{ at, kindRank, id }` (events before states at equal times). `GraphModule` does not export it yet.
- `TimelineItemDtoSchema` (`packages/shared/src/graph.ts`) is a discriminated union of `EVENT` (with `role` of the entity, `entities`, source fields) and `STATE` items.
- `AuditService.record(tx, input)` / `recordStandalone(input)` and the append-only `audit_entries` table with an index on `(target_type, target_id, id DESC)` (007 research facts still hold).
- `forbid_provenance_mutation()` is the append-only trigger function, reused by 005 and 007.
- `encodeCursor` / `decodeCursor(schema, cursor)` exist; `PageQuerySchema` gives `cursor` and `limit` (default 50, max 200).
- The web app has an `/investigations` route showing `ComingSoonPage` and a nav link to it.
- **005** plans `RootCauseService.analyze(id, { depth, evaluatedAt? })`, the `RootCauseSection` / `RootCauseCandidate` components and `useRootCause(entityId)`.
- **006** plans `ImpactService.summary(id, { depth })`, `ImpactSection` and `useImpact(id, depth)`.
- **004** plans `ExplorerPage` with an internal `ExplorerView`, `NodeDetailsPanel({ node, onExploreFrom })` and the `explorer-params.ts` defaults.
- **007** plans:
  - the `exception_snapshots` table (append-only, `kind`, `anchor_entity_id`, `taken_at`, `taken_by_id`, `payload`, `seq`), enum `ExceptionSnapshotKind`;
  - `RootCauseSnapshotSchema`, `ImpactSnapshotSchema`, `SnapshotEnvelopeSchema` and `SnapshotDigest` in `packages/shared/src/exceptions.ts`;
  - pure mappers `toRootCauseSnapshot`, `toImpactSnapshot`, `digestOf` in `apps/api/src/exceptions/snapshot.mapper.ts`, and `SnapshotService.take(subjectId, chosenRootCauseId, now, opts)` in `exceptions/snapshot.service.ts`;
  - `ExceptionsQueryService`, `exception.mapper.ts` (`ExceptionSummaryDto` with SLA at an evaluation time), `computeSlaStatus` and `UNRESOLVED_STATUSES` in shared, the `exceptions` columns `status`, `sla_at_risk_at`, `sla_due_at`;
  - `ExceptionCreatePage` (`/exceptions/new?subject=&rootCause=&from=`), `RootCauseSnapshotView`, `ImpactSnapshotView`, `SeverityBadge`, `StatusBadge`, `SlaBadge`, `OwnerLabel`;
  - `ExceptionSeverity` (Prisma enum, `CRITICAL` first), `EXCEPTION_SEVERITIES`, `SEVERITY_LABELS`, the `actor.ts` pattern, and the `ActorRefDtoSchema`/`UserRefDtoSchema` naming note.

---

## R1. Module layout

**Decision**:
- **`investigations`** (new Nest module, `apps/api/src/investigations/`): investigations, pins (through the shared snapshot service), unpins, added entities, exception links, decisions, notes, the timeline and history read views, the seed of the reference investigation, and pure rule modules in `investigations/rules/`.
- **`ExceptionsModule`** adds `exports: [SnapshotService, ExceptionsQueryService]`. `InvestigationsModule` imports `ExceptionsModule` and `GraphModule`. Users, entities, source records and 005 evidence notes (citation checks, R10) are read through `PrismaService`; no other module is needed.
- **`GraphModule`** adds `exports: [TimelineService]` (R9).
- No new module outside CLAUDE.md's list: `investigations` is listed there.

**Rationale**:
- One bounded context, as CLAUDE.md prescribes.
- `investigations → exceptions` is the natural direction: investigations link exceptions and show their status; exceptions never need to know about investigations.
- Taking snapshots stays in one service (R2), so 007 and 008 cannot drift apart.

**Alternatives rejected**:
- **A separate `snapshots` module**: cleaner in theory, but it moves 007 files a second time for one extra consumer. If a third consumer appears (risk, §14), extract it then.
- **Calling `RootCauseService`/`ImpactService` directly from investigations**: would duplicate 007's candidate choice, anchor rule and payload mapping.

---

## R2. One snapshot mechanism for exceptions and investigations

**Decision**: generalize 007's snapshots instead of copying them.

1. **Shared content and pure code move to `packages/shared/src/analysis-snapshots.ts`** (pure move, names unchanged, re-exported from `index.ts`; `exceptions.ts` imports them):
   - `RootCauseSnapshotSchema`, `ImpactSnapshotSchema`, `SnapshotEnvelopeSchema`, `SnapshotDigest`;
   - the pure mappers `toRootCauseSnapshot`, `toImpactSnapshot`, `digestOf`, moved from `apps/api/src/exceptions/snapshot.mapper.ts` (they use only shared types; the API file re-exports them or is deleted and its imports updated).

   This lets the web compute the "live vs pinned" comparison (R6) with exactly the code that built the pins.
2. **Additive content changes** (data-model §2), backward-compatible with snapshots 007 already stored:
   - `RootCauseSnapshotSchema.chosen.chain` (**optional**): the chosen candidate's primary-chain steps as `{ index, roles, entity: EntityRefDto, hop: { relationshipType, origin, confidence } | null }`. The mapper always fills it from now on; it is absent only in 007 snapshots taken before this feature.
   - `SnapshotDigest.impact.slaCommitments` (**optional** when read): `categories[type=SLA].current`. 007's history sentences ignore it.
3. **Storage is generalized** by this feature's migration (data-model §1b):
   - `exception_snapshots` is renamed **`analysis_snapshots`** and the enum `ExceptionSnapshotKind` **`AnalysisSnapshotKind`**; the Prisma model becomes `AnalysisSnapshot`;
   - `exception_id` becomes nullable, a nullable `investigation_id` is added, and `CHECK (num_nonnulls(exception_id, investigation_id) = 1)` keeps exactly one owner;
   - three denormalized columns, written once at insert like the rest of the row: `root_cause_entity_id` and `root_cause_label` (the chosen candidate's, ROOT_CAUSE kind only, else null), and `chain_entity_ids uuid[]` (the chain step entity ids, else empty);
   - existing rows are backfilled from their payload in the same migration (the append-only trigger is disabled for that one statement and re-enabled);
   - the append-only triggers are renamed with the table and keep working.
   - 007 code is updated mechanically: `prisma.exceptionSnapshot` → `prisma.analysisSnapshot`, `ExceptionSnapshotKind` → `AnalysisSnapshotKind`, `resetDb` table name. 007's behaviour, responses and audit rows do not change.
4. **`SnapshotService` is split** (still in `exceptions/`, now exported):
   - `takeRootCause(subjectId, chosenRootCauseId | null, now, { depth, evaluatedAt?, fallbackToFirstRanked? })` → `{ payload, rootCauseEntityId, chainEntityIds }`;
   - `takeImpact(anchorId, anchorRole, now, { depth })` → `{ payload }`;
   - `take(...)`, used by 007, is now `takeRootCause` then `takeImpact` with 007's anchor rule, and returns exactly what it returned before (depth 6).
   - `rowData(taken, owner, takenById, now)` builds the insert data, including the three denormalized columns, so both features insert rows the same way.

**Rationale**:
- The user story requires pins "stored so history stays accurate", which is exactly 007's snapshot: same analyses, same subset, same validation, same append-only guarantee. One table and one service mean an exception snapshot and an investigation pin of the same analysis are byte-identical in content (spec FR-013).
- The denormalized columns make the recurrence rule (R12) and the "involves entity" filter (R8) plain indexed `WHERE` clauses over both owners, without JSON path queries.
- Additive optional fields keep every stored 007 snapshot valid.

**Alternatives rejected**:
- **A second table `investigation_pins` with the same columns**: two tables with one meaning, two append-only trigger sets, and the recurrence query would have to union them and read labels from JSON.
- **A link table between investigations and exception snapshots**: a pin is not an exception's snapshot; the owner would be wrong.
- **Storing whole 005/006 responses**: unbounded size (007 R9).
- **Changing 007's plan documents**: 007 is already planned and may be implemented by the time this lands; the migration here is the single, explicit point of generalization.

---

## R3. Investigation numbers

**Decision**: `investigations.number INTEGER UNIQUE` from an identity sequence restarted at **10001** (`ALTER SEQUENCE investigations_number_seq RESTART WITH 10001`). Shown as `INV-${number}` by `formatInvestigationNumber` in shared. Search accepts `INV-10001`, `inv-10001` or `10001`.

**Rationale**: same as 007 R3 (human-readable, never reused). The seed's reference investigation is INV-10001 on a fresh database.

**Tests**: never assert absolute numbers after `resetDb`, except on a freshly migrated and seeded database.

---

## R4. Status machine as data

**Decision**: the transition table (spec FR-018) is a constant in `packages/shared/src/investigations.ts`:

```ts
export const INVESTIGATION_TRANSITIONS = {
  RESOLVE: { from: ['OPEN'],               to: 'RESOLVED', input: 'resolutionSummary' },
  CLOSE:   { from: ['RESOLVED'],           to: 'CLOSED',   input: null },
  REOPEN:  { from: ['RESOLVED', 'CLOSED'], to: 'OPEN',     input: 'reopenReason' },
} as const satisfies Record<InvestigationTransition, InvestigationTransitionRule>;
```

- `allowedInvestigationTransitionsFrom(status)` returns the actions whose `from` contains `status`, in key order.
- Pure `applyInvestigationTransition(row, action, input, actor, now)` (`investigations/rules/transitions.ts`):
  - RESOLVE sets `resolvedAt`, `resolvedById`, `resolutionSummary`;
  - CLOSE sets `closedAt`, `closedById`;
  - REOPEN clears all five and sets `reopenCount + 1`.
- A disallowed pair: 409 `INVALID_STATE` (007's code), message `` `${ACTION} is not allowed while the investigation is ${STATUS}. Allowed: ${list or 'none'}.` ``
- CLOSE with unresolved linked exceptions: 409 `INVALID_STATE`, message `` `CLOSE is not allowed while linked exceptions are unresolved: ${keys.join(', ')}.` `` (keys in number order). The service checks it inside the transaction by counting linked exceptions with `status ∈ UNRESOLVED_STATUSES`.
- Any other mutation of a CLOSED investigation (except notes): 409 `INVALID_STATE`, `` `${ACTION} is not allowed while the investigation is CLOSED. Reopen it first.` `` (spec FR-019).
- Database CHECKs mirror the path-independent invariants (data-model §1b).

**Rationale and alternatives**: as 007 R4. One `POST /transitions` with `action`.

---

## R5. Permission policy (pure)

**Decision**: `investigations/rules/policy.ts`:

```ts
interface Actor { id: string; role: Role }
interface InvestigationPolicyRow { status; ownerId; createdById }

isOwner(row, a)       = row.ownerId === a.id
isManager(a)          = a.role === 'OPS_MANAGER' || a.role === 'ADMIN'
isContributor(row, a) = isManager(a) || isOwner(row, a) || row.createdById === a.id

permissionsFor(row, a): InvestigationPermissionsDto
canEdit, canChangeOwner, canPin, canChangeScope, canLinkExceptions, canDecide, canTransition(row, a, action), canAddNote
```

Exactly spec FR-020:
- `canEdit`, `canPin`, `canChangeScope`, `canLinkExceptions`, `canDecide`, REOPEN: `isContributor`;
- `canChangeOwner`, RESOLVE, CLOSE: `isOwner || isManager`;
- `canAddNote`: true.

`permissionsFor` combines the policy with the status (FR-019), so the UI never offers an action the status refuses.

**Order of checks** in every mutating service method (as 007 R5): 404 → 403 (`auth.forbidden` standalone, `metadata: { method, path, role, investigationId, action }`) → 409 `VERSION_CONFLICT` → 409 `INVALID_STATE` → 400 `VALIDATION_FAILED`.

**Rationale**: one place to test every row; the detail's `permissions` and the enforcement share the same functions. Teams play no part (owner is a user, spec Assumptions), so no team lookup per request.

---

## R6. Pins

**Decision**:

**Request** (`POST /api/investigations/:id/pins`, contracts/api.md): `{ expectedVersion, rootCause?: { rootCauseEntityId?, depth? }, impact?: { anchor?: 'ROOT_CAUSE' | 'FOCUS', depth? } }`, at least one of `rootCause` and `impact`. Depth 1..10, default 6.

**Steps** (`PinsService.pin`):
1. `now = new Date()` once. Load the row: 404, 403 (`canPin`), version, status (CLOSED → 409).
2. **Root cause** (if requested): `SnapshotService.takeRootCause(focusId, rootCauseEntityId ?? null, now, { depth })`. A `rootCauseEntityId` that is not a current candidate → 400 `rootCause.rootCauseEntityId`, `Not a current root-cause candidate of the focus entity`.
3. **Impact** (if requested): resolve the anchor (spec FR-012):
   - `ROOT_CAUSE`: the root-cause entity of the root-cause pin taken in step 2, else of the current root-cause pin; none → 400 `impact.anchor`, `There is no pinned root cause to use as anchor`;
   - `FOCUS`: the focus entity;
   - omitted: `ROOT_CAUSE` when one exists by the rule above, otherwise `FOCUS`.

   Then `SnapshotService.takeImpact(anchorId, anchorRole, now, { depth })`, with `anchorRole` `ROOT_CAUSE` or `SUBJECT` (007's enum: the focus plays the subject role).
4. Both analyses run **before** the transaction (007 R9). In one `$transaction`:
   - insert the snapshot rows with `investigationId`, `takenById = actor.id`, `takenAt = now`;
   - conditional update of the investigation: `currentRootCausePinId`, `currentImpactPinId`, `slaCommitmentsAtRisk` (impact pins only: `categories[type=SLA].current`), `lastActivityAt`, `version + 1`;
   - one audit row `investigation.pinned`: `before` / `after` = `{ rootCause?: digest, impact?: digest }` of the current pins before and after, `metadata.pinIds`.

**Unpin** (`POST /api/investigations/:id/pins/:pinId/unpin`, `{ expectedVersion, reason }`):
- insert `investigation_unpins (snapshot_id, unpinned_by_id, reason, unpinned_at)`;
- if it was the current pin of its kind, the new current pin is the highest-`seq` pin of that kind of this investigation without an unpin row, or null; recompute `slaCommitmentsAtRisk` from the new current impact pin (0 when none);
- conditional update with version + 1; one audit row `investigation.unpinned` (before/after = the current-pin digests, `metadata: { pinId, reason }`);
- unpinning an unpinned pin: 200, no change, no audit row (as 007's detach).

**Current pins** are stored as two nullable foreign keys on the investigation and changed only in these two transactions under the version check, so they always equal "the latest non-unpinned pin of each kind" (spec FR-009). A unit test of the rule and an e2e consistency check guard it.

**Live vs pinned** (spec FR-014): computed in the **web app** on the Overview, with shared pure code:
- live root cause: `useRootCause(focusId)` (005 hook, depth of the current pin) → `toRootCauseSnapshot(response, index, reason)` where `index` is the candidate whose root-cause entity equals the pinned one, else 0;
- live impact: `useImpact(anchorId, depth)` (006 hook) for the current impact pin's anchor → `toImpactSnapshot`;
- `compareDigests(pinned, live): DigestDifference[]` (shared, pure, R2) lists differences in fixed order: root-cause label, root-cause entity, confidence, orders, customers, SLA commitments, exposure per currency (currency order). Each difference is `{ field, label, pinned, live }`.

The comparison is skipped for Closed investigations (the live tabs remain available).

**Rationale**:
- Pins are computed by the server (never accepted from the client, 007 R9).
- Running the comparison in the browser keeps the detail endpoint cheap (spec SC-005: Overview < 2 s) and reuses the analyses the tabs load anyway (TanStack Query cache).
- Pinning both kinds in one request gives one audit row and one version bump for the common "pin what I see" action, and lets the impact anchor follow the root cause pinned in the same step.

**Alternatives rejected**:
- **Computing the comparison in `GET /investigations/:id`**: two analyses (up to 3.5 s) on every page load.
- **Deleting pins to unpin**: violates spec FR-007 and Constitution IV.
- **Querying the current pin with `MAX(seq)` on every read and filter**: works for detail, but the list filters (SLA risk, recurrence) need it as an indexed column.

---

## R7. Creation

**Decision**:
- `POST /api/investigations` body: `title`, `description?`, `severity`, `focusEntityId`, `ownerId?` (default the creator), `pin` (default `true`), `createdFrom` (`INVESTIGATIONS_AREA` | `ENTITY`; `SEED` not accepted from the API).
- Steps: `now` once; validate focus (400 `focusEntityId` `Entity not found`) and owner (400 `ownerId` `User not found` / `User is deactivated`); when `pin`, take both snapshots with R6 steps 2–3 (no selected root cause, default depth, anchor by the omitted-anchor rule); then one transaction: insert the investigation (`version 1`), the pin rows, set current pins and `slaCommitmentsAtRisk`, and one audit row `investigation.created` (`after` = `InvestigationCore` + the pin digests, `metadata: { createdFrom, pinIds }`).
- **Suggested title** (spec FR-005): pure `suggestInvestigationTitle(entity: EntityRefDto)` in shared:
  - `STATE_CLASSIFICATION[state] === 'UNSATISFIED'` or `state === 'AT_RISK'` → `` `Why is ${displayName} ${words(state).toLowerCase()}?` ``;
  - otherwise `` `Investigation of ${displayName}` ``.

  `words` is 005's rule (`stateWords` in shared, see 007 data-model §2a note).
- **Duplicate hint** (spec FR-006): the form calls `GET /api/investigations?view=ALL&focusEntityId=<id>&status=OPEN,RESOLVED&limit=5`. The server does not block.

**Rationale**: one transaction makes the investigation, its pins and its audit row appear together (007 R10).

---

## R8. Scope

**Decision**:
- **Stored inputs**: `investigation_entities` (user-added entities: `investigation_id`, `entity_id`, `added_by_id`, `added_at`; insert and delete, max 40) and `investigation_exceptions` (links: `investigation_id`, `exception_id`, `linked_by_id`, `linked_at`; insert and delete, max 20).
- **Computation**: pure `computeScope(input): ScopeEntry[]` (`investigations/rules/scope.ts`). Input: focus id, current root-cause pin's `chain` (or `[]`), current impact pin's anchor id and role, linked exceptions' `(key, number, subjectEntityId, rootCauseEntityId | null)`, added entities `(entityId, addedBy name)`. Output: one entry per distinct entity id with ordered reasons:

  | Reason `kind` | Detail | Order |
  |---|---|---|
  | `FOCUS` | — | 1 |
  | `ROOT_CAUSE_CHAIN` | the step's roles (005 `CausalRole` values) | 2 |
  | `IMPACT_ANCHOR` | anchor role | 3 |
  | `EXCEPTION_SUBJECT` | exception id and key | 4, by exception number |
  | `EXCEPTION_ROOT_CAUSE` | exception id and key | 5, by exception number |
  | `ADDED` | added by, added at | 6 |

  Entries are ordered: focus first, then by entity type name, display name, id (`compareCodeUnits`). Maximum size: 1 + 11 + 1 + 40 + 40 = 93 ≤ 100 (spec FR-015); the service asserts ≤ 100 and fails with an internal error otherwise (it is unreachable by construction).
- **The detail response** carries the scope with live `EntityRefDto`s (one `entity.findMany`).
- **Removing an added entity** deletes the `investigation_entities` row only. The entity stays in scope if another reason holds (it then shows its remaining reasons). Removing an entity that was not added: 400 `entityId`, `Only added entities can be removed`.
- **"Involves entity" filter** (list and Entity 360 section, spec FR-024/FR-037), as one Prisma `where` built by pure `involvesEntity(entityId)`:

  ```text
  OR:
    focusEntityId = e
    addedEntities some { entityId = e }
    currentRootCausePin { chainEntityIds has e }          (covers the root cause and every chain step)
    currentImpactPin { anchorEntityId = e }
    exceptionLinks some { exception: { subjectEntityId = e } }
    exceptionLinks some { exception: { links some { entityId = e, role = ROOT_CAUSE } } }
  ```

  This is exactly the scope rule, evaluated in SQL. `chain_entity_ids` has a GIN index (data-model §1b).
- **Neighbors** for the Related Entities tab come from the existing `GET /api/entities/:id/neighbors` (no change).

**Rationale**: the scope is derived from stored facts, so it can never disagree with the pins and links that justify it, and every entry explains itself (Constitution III). Impact results are not added to the scope (spec Assumptions).

**Alternatives rejected**: storing the scope as a list (it would go stale when pins or links change); including all impacted entities (thousands of rows, and the timeline would drown in unrelated events).

---

## R9. Merged timeline

**Decision**:
- **Generalize** `TimelineService` (`apps/api/src/graph/timeline.service.ts`) instead of writing a second one:
  - new `listForEntities(entityIds: readonly string[], filters: TimelineFilters, query: PageQuery): Promise<{ items: Array<{ item: TimelineItemDto; scopeEntityIds: string[] }>, nextCursor }>`;
  - `list(entityId, query)` becomes `listForEntities([entityId], {}, query)` mapped to `TimelineItemDto`, and its output is byte-identical to today (the existing tests must pass unchanged);
  - events: `where: { entities: { some: { entityId: { in: ids }, entity?: { type: { in: types } } } }, sourceSystem?: { in }, occurredAt?: { gte: from, lte: to } }`; states: `where: { entityId: { in: ids }, entity?: { type: { in } }, sourceSystem?, observedAt? }`; filter `entityIds` narrows `ids`; filter `kind` skips one of the two queries;
  - `mergeTimeline` and the cursor `{ at, kindRank, id }` are unchanged, so every event appears once (it is one row in `events`) and paging has no gaps;
  - an event's `role` is the role of its first scope entity in link order (SUBJECT first), and `scopeEntityIds` lists every scope entity it links, in link order.
- **Route**: `GET /api/investigations/:id/timeline` (contracts/api.md), served by `InvestigationsController`, which computes the scope (R8) and calls `listForEntities`.
- **Filters**: `entityId` (csv, each must be in scope, else 400), `entityType` (csv), `kind` (`EVENT` | `STATE`), `sourceSystem` (csv), `from`, `to` (ISO-8601 UTC, `from ≤ to`). Changing filters restarts paging; a cursor is valid only with the same filters (it encodes a filter hash, 400 `cursor` otherwise).

**Rationale**:
- One merge implementation for one entity and many (CLAUDE.md: no duplicated logic). The existing per-entity endpoint cannot merge across entities without one request per entity and client-side merging that breaks paging (spec FR-030, SC-005).
- This is one of the two read views the spec allows beyond the listed write capabilities (spec Assumptions "Reused capabilities").

**Alternatives rejected**:
- **Client-side merge** of up to 100 per-entity timelines: 100 requests, and a correct merged cursor is impossible.
- **A `GET /entities/timeline?ids=` endpoint**: a generic multi-entity endpoint that any caller could aim at thousands of ids; the investigation-scoped route bounds the set at 100 by construction.

---

## R10. Decisions

**Decision**:
- `POST /api/investigations/:id/decisions` body: `{ expectedVersion, statement (1..500), rationale (1..4000), supersedesDecisionId?, citations: Citation[] (≤ 20) }`.
- **`expectedVersion`** must equal the current version (409 `VERSION_CONFLICT` otherwise), but recording a decision does **not** bump it (it changes no field of the investigation). So a decision always sees the pins its author saw (spec Story 4 scenario 4).
- **Citations** (discriminated union, each validated; one 400 detail per bad item at `citations.<i>`):

  | `kind` | Input | Valid when | Frozen copy |
  |---|---|---|---|
  | `SOURCE_RECORD` | `sourceRecordId` | checked in this order, the first match sets `via`: the record's `entityId` is in scope (`SCOPE_ENTITY`); it is in the current root-cause pin's `chosen.keyEvidence` (`PINNED_KEY_EVIDENCE`); it is an EVENT record whose event links a scope entity (`SCOPE_EVENT`) | record kind, source system, source id, observed time, entity ref (or the event's subject), `via` |
  | `EVIDENCE_NOTE` | `noteId` | a 005 note that is active, targeting a scope entity, or a relationship with an end in scope | stance, text, reference, author, created time, target |
  | `EXCEPTION_EVIDENCE` | `exceptionId`, `evidenceId` | an active (not detached) evidence item of a linked exception | the 007 `ExceptionEvidenceDto.item`, added by, created time, exception key |

  Duplicates (same kind and id) are refused (400 `citations.<i>`, `Already cited`).
- **Context** (built inside the transaction from the rows read there, pure `buildDecisionContext`):

  ```text
  { focus: EntityRefDto + { observedAt, sourceSystem } of its current state,
    rootCausePin: { id, takenAt, digest } | null,
    impactPin:    { id, takenAt, anchor, digest } | null,
    exceptions:   [{ id, key, title, status, severity, sla: { status, dueAt } }] (by number),
    citations:    [frozen copies, in request order] }
  ```

  SLA status uses 007's `computeSlaStatus` at `now`.
- **Supersession**: `supersedesDecisionId` must be a decision of the same investigation that is not yet superseded (400 `supersedesDecisionId` otherwise); a partial unique index makes "superseded once" a database guarantee.
- **Storage**: `investigation_decisions` (append-only trigger), with `context` JSON validated by `DecisionContextSchema` on write and read.
- **Audit**: `investigation.decision_recorded`, `after` = the `DecisionDto` without the full citations (statement, rationale, supersedes, citation count and ids), `metadata: { decisionId }`.
- **Later state of cited items** (spec Edge Cases): the decision list response marks citations whose note was retracted or whose exception evidence was detached since (`laterStatus: 'RETRACTED' | 'DETACHED' | null`), computed at read time with two `findMany`s.

**Rationale**: §37 requires "decision" and "evidence available at the time". Freezing a copy (not only ids) keeps the decision readable even if the underlying items are later retracted, detached, or superseded by new imports.

**Alternatives rejected**: storing only ids (the text of a retracted note would still be readable, but the pins' figures would need joins and the focus state would be lost); letting decisions bump the version (two analysts writing decisions at the same time would conflict for no reason).

---

## R11. Notes

**Decision**: `investigation_notes` (append-only trigger), text 1..4000 trimmed, author, time. `POST /api/investigations/:id/notes` (every signed-in user, any status), `GET …/notes` newest first (`seq DESC`, cursor = last seq). Touches `lastActivityAt` with a plain update; no version. Audit `investigation.note_added` with `after` = the note.

---

## R12. Investigations list: views, recurrence, SLA risk, sorts

**Decision**:
- **Query** (`InvestigationListQuerySchema`): `view`, `status[]`, `severity[]`, `owner` (`ME` | `USER:<uuid>`), `entityId` (involves, R8), `focusEntityId`, `q`, `sort`, `evaluatedAt`, `cursor`, `limit`.
- **Views** (pure `buildInvestigationWhere`, data-model §5a):
  - `OPEN`: status OPEN; `MINE`: ownerId = caller ∧ status ≠ CLOSED; `CRITICAL`: severity CRITICAL ∧ status ≠ CLOSED; `ALL`: {};
  - `SLA_RISK`: status OPEN ∧ (`slaCommitmentsAtRisk > 0` ∨ exceptionLinks some { exception: { status ∈ UNRESOLVED_STATUSES ∧ slaAtRiskAt ≤ T } }). 007 R7 makes `slaAtRiskAt ≤ T` mean "At risk or Breached" for unresolved exceptions.
  - `RECURRING`: see below.
- **Recurrence** (spec Story 6 scenario 1; pure `recurrence.ts`):
  1. `occurrences = analysisSnapshot.findMany({ where: { kind: ROOT_CAUSE, rootCauseLabel: { not: null }, takenAt: { gt: T − 30 d, lte: T } }, distinct: ['rootCauseLabel', 'rootCauseEntityId'], select: { rootCauseLabel, rootCauseEntityId } })`, covering investigation pins and exception snapshots alike (R2);
  2. `labelEntities: Map<label, Set<entityId>>`;
  3. an investigation is recurring when its current root-cause pin has label `L` and `labelEntities.get(L)` contains an entity other than the pin's own `rootCauseEntityId`;
  4. as a `where`: `OR` over labels `L` with at least one entity: `currentRootCausePin { rootCauseLabel = L }` and, when `L` has exactly one entity `E`, also `currentRootCausePin { rootCauseEntityId ≠ E }`. No labels → matches nothing.
  5. Each list row carries `recurrence: { label, rootCauseCount, windowDays: 30, text } | null`, where `rootCauseCount = |labelEntities.get(L)|` (distinct root-cause entities with that label **in the window**; at least 2 whenever the row is recurring and its own pin is in the window, and at least 1 otherwise, so the schema's minimum is 1), computed from the same map (spec Story 6 scenario 2).

  Window boundaries: an occurrence taken exactly at `T − 30 d` is outside; exactly at `T` is inside. Unpinned pins still count as occurrences (they were recorded); the investigation's **own current** pin decides its label.
- **Sorts** (unique tie-breaks):

  | `sort` | Order |
  |---|---|
  | `UPDATED` (default) | `lastActivityAt DESC, number DESC` |
  | `NEWEST` | `createdAt DESC, number DESC` |
  | `SEVERITY` | `severity ASC` (enum order), `lastActivityAt DESC, number DESC` |

- **Cursor**: `encodeCursor({ s: sort, k: [...keys, number] })`, keyset `OR` chain by pure `investigationKeysetWhere` (007 R14 pattern); mismatched sort → 400 `cursor`.
- **Rows**: `InvestigationSummaryDto` built from the page's rows plus one `findMany` of their current pins (payload parsed for digests) and one query of their linked exceptions (`status`, `slaDueAt`, `slaAtRiskAt`, `slaOutcome`, `createdAt`, `resolvedAt` for `computeSlaStatus`). The SLA indicator is `{ slaCommitmentsAtRisk, worstExceptionSla: 'BREACHED' | 'AT_RISK' | 'ON_TRACK' | null, unresolvedExceptionCount }` (worst over unresolved linked exceptions, in that order).
- **Total**: `count({ where })`.
- **Indexes**: `investigations (status, last_activity_at DESC, number DESC)`, `(owner_id, status)`, `(severity, last_activity_at DESC)`, `(created_at DESC, number DESC)`, `(last_activity_at DESC, number DESC)`, `(focus_entity_id)`, `(sla_commitments_at_risk) WHERE sla_commitments_at_risk > 0`; `analysis_snapshots (kind, taken_at, root_cause_label)`, GIN on `chain_entity_ids`; `investigation_exceptions (exception_id)`, `investigation_entities (entity_id)`.

**Rationale**: every rule is a published comparison of stored columns (Constitution III); results are deterministic for a pinned `evaluatedAt` (spec SC-007).

**Alternatives rejected**:
- **Recurrence by root-cause entity**: the same budget code seen by an exception and an investigation is one problem (spec Assumptions).
- **Recurrence over current snapshots only**: needs "latest per owner" queries (`DISTINCT ON`, raw SQL); "recorded in the window" is simpler and matches §44's "over the last 30 days".
- **Storing a `recurring` flag**: it changes with time and with other cases' pins.

---

## R13. Exception links and "Create exception"

**Decision**:
- `POST /api/investigations/:id/exceptions` `{ exceptionId }` (contributors, not Closed): 404-style 400 `exceptionId` `Exception not found`; `Exception is already linked`; `An investigation can link at most 20 exceptions`. `DELETE /api/investigations/:id/exceptions/:exceptionId` (contributors, not Closed): 400 if not linked. No version (spec FR-021); touch `lastActivityAt`. Audit `investigation.exception_linked` / `investigation.exception_unlinked` with `{ exceptionId, key, title }`.
- **Linked exceptions in the detail**: up to 20 `ExceptionSummaryDto` built by 007's `ExceptionsQueryService`/mapper at `evaluatedAt`, ordered unresolved first, then `slaDueAt ASC, number ASC`.
- **Create exception** (web only): the Actions tab navigates to 007's `/exceptions/new?subject=<focus>&rootCause=<current pin's root cause, if any>&from=ROOT_CAUSE|ENTITY&investigation=<id>`. `ExceptionCreatePage` gains one optional behaviour: when `investigation` is present, after a successful create it calls `POST /api/investigations/:id/exceptions` and navigates to `/investigations/:id?tab=actions`. If linking fails, it shows the error with a link to the new exception and to the investigation; the exception remains (two requests, not atomic). If 007 refuses the root cause as stale, its form shows the error and the user can clear it.

**Rationale**: reuses 007's form, rules, snapshots and notifications unchanged (spec FR-039). An atomic "create and link" endpoint would duplicate 007's creation.

**Alternatives rejected**: adding `investigationId` to 007's create request (changes 007's contract for a 008 concern).

---

## R14. Audit and history

**Decision**:
- One audit row per user action, same transaction, `targetType: 'investigation'`, `targetId` = investigation id (007 R11).
- **New `AUDIT_ACTIONS`**:

  ```ts
  INVESTIGATION_CREATED: 'investigation.created',
  INVESTIGATION_UPDATED: 'investigation.updated',
  INVESTIGATION_STATUS_CHANGED: 'investigation.status_changed',
  INVESTIGATION_PINNED: 'investigation.pinned',
  INVESTIGATION_UNPINNED: 'investigation.unpinned',
  INVESTIGATION_ENTITY_ADDED: 'investigation.entity_added',
  INVESTIGATION_ENTITY_REMOVED: 'investigation.entity_removed',
  INVESTIGATION_EXCEPTION_LINKED: 'investigation.exception_linked',
  INVESTIGATION_EXCEPTION_UNLINKED: 'investigation.exception_unlinked',
  INVESTIGATION_DECISION_RECORDED: 'investigation.decision_recorded',
  INVESTIGATION_NOTE_ADDED: 'investigation.note_added',
  ```
- **History** (`GET /api/investigations/:id/history`): audit rows of the investigation, `id ASC`, cursor = last audit id, sentences by pure `investigationHistorySentence` (templates in contracts/api.md), changes in `INVESTIGATION_FIELD_ORDER`. Open to every signed-in user. Refusals (`auth.forbidden`) are not in the history (no target), as in 007.
- The seed writes `actorType: 'system'`.

**Rationale**: as 007 R11; this is the second read view the spec allows (an ADMIN-only `/api/audit` cannot serve it).

---

## R15. Seed

**Decision**: `InvestigationsSeedService.seedReference()` (`investigations/seed/`) runs from `prisma/seed.ts` after the 007 exceptions seed, idempotently (skipped when an investigation with `createdFrom = 'SEED'` exists):
1. `InvestigationsService.create` with the system actor and `rootCauseEvaluatedAt = '2026-09-29T16:00:00Z'` (an internal option, not exposed by the API):
   - title `Why is Order #18492 delayed?`, description `Acme Corp asked why Order #18492 has not shipped. Opened from the customer call.`, severity `CRITICAL`, focus Order #18492, owner `analyst@opsgraph.local`, `pin: true`;
   - root-cause pin: 005 fixture R1 (one candidate, BR-18492, "Budget Code Missing", HIGH, `FIRST_RANKED`, chain Order #18492 → PAY-88213 → APR-2291 → BR-18492);
   - impact pin: anchor BR-18492 (`ROOT_CAUSE`), 006 fixture I7.
2. Link the 007 reference exception (the one with `createdFrom = 'SEED'`) through the link method with the system actor.

It prints `investigations seeded` or `investigations already present`. No decision or note is seeded: decisions are human acts.

**Rationale**: spec FR-038 and SC-002; going through the services exercises the same code as the API, including audit rows.

---

## R16. Web design

**Decision**:

**Routes** (`router.tsx`): `investigations` → `InvestigationsListPage` (replaces `ComingSoonPage`); `investigations/new` → `InvestigationCreatePage` (`?focus=<id>&from=ENTITY`); `investigations/:id` → `InvestigationPage` (`?tab=overview|graph|root-cause|impact|timeline|entities|evidence|actions|decisions|notes|history`, plus timeline filter params when `tab=timeline`).

**List page** (`pages/investigations/`): quick-view tabs (Open, Mine, Critical, SLA risk, Recurring root cause, All), filters, sort, search, table; URL state in `investigations-params.ts`; `useInvestigations(params)` infinite query, key `['investigations', 'list', params]`.

**Create page**: focus picker (`GET /api/entities?q=`) or prefilled focus; title from `suggestInvestigationTitle`; duplicate hint (R7); severity; owner picker (007's owner directory, users only); "Pin the current root cause and impact" checkbox (checked). On success → `/investigations/:id`.

**Investigation page**: header (key, title, `SeverityBadge`, `InvestigationStatusBadge`, owner with "deactivated" mark, focus link, actions from `permissions`: Edit, Change owner, Resolve, Close, Reopen) and the tabs. Each tab is a component that loads and fails on its own (spec FR-026):

| Tab | Component | Data | Reused |
|---|---|---|---|
| Overview | `OverviewTab` | detail; `useRootCause`, `useImpact` for the comparison | `StateBadge`, `SeverityBadge`, `StatusBadge`, `SlaBadge`; shared `compareDigests` |
| Graph | `GraphTab` | 004 | `ExplorerView` (exported, R17) |
| Root Cause | `RootCauseTab` | `useRootCause`, `usePins('ROOT_CAUSE')` | 005 `RootCauseSection`/`RootCauseCandidate` (with an `actions` slot), 007 `RootCauseSnapshotView` |
| Impact | `ImpactTab` | `useImpact(anchor, depth)`, `usePins('IMPACT')` | 006 `ImpactSection` (with `entityId`, `depth` and a `headerActions` slot), 007 `ImpactSnapshotView` |
| Timeline | `TimelineTab` | `useInvestigationTimeline` (infinite) | `TimelineSection` item rendering |
| Related Entities | `ScopeTab` | detail scope; `GET /entities/:id/neighbors` | `StateBadge`, entity search |
| Evidence | `EvidenceTab` | detail (pinned key evidence), decisions, 007 `GET /exceptions/:id/evidence` per linked exception (`useQueries`) | 007 evidence item rendering |
| Actions | `ActionsTab` | detail `linkedExceptions` | 007 badges, `OwnerLabel` |
| Decisions | `DecisionsTab` | `useDecisions` (infinite), `DecisionForm` with `CitationPicker` | — |
| Notes | `NotesTab` | `useNotes` (infinite) | — |
| History | `HistoryTab` | `useInvestigationHistory` | 007 history change table |

**Pinned vs live labels**: every pinned value shows `Pinned <time>`; every live value shows `Live`. The Overview's comparison block lists differences as `` `${label}: pinned ${pinned} → live ${live}` ``.

**Version handling**: mutations send `expectedVersion` from the loaded detail; 409 `VERSION_CONFLICT` shows "This investigation was changed by someone else. Reload to see the latest version." with a Reload button (as 007).

**Entity 360**: `EntityInvestigationsSection` (`id="investigations"`) after the Exceptions section, using `GET /api/investigations?view=ALL&entityId=<id>&limit=20` sorted client-side Open first; a "Start investigation" button in the header next to "Create exception".

**Cache invalidation**: investigation mutations invalidate `['investigations']`; links also invalidate `['exceptions']`.

**Rules**: parse every response through `apiFetch` with its shared schema; badges are text plus colour; never use `localeCompare`.

**Rationale**: spec Stories 1–6, FR-026 to FR-033; same patterns as 003–007.

---

## R17. Changes to 004–007 code (small, listed exhaustively)

| Feature | File | Change |
|---|---|---|
| 004 | `pages/explorer/ExplorerPage.tsx` | export `ExplorerView({ focusId, params, onParamsChange, nodeActions? })`; the page passes URL params as today |
| 004 | `pages/explorer/NodeDetailsPanel.tsx` | optional `actions?: (node) => ReactNode` rendered after the existing actions |
| 005 | `pages/entities/RootCauseSection.tsx`, `RootCauseCandidate.tsx` | optional `entityId` prop (default the page entity) and `candidateActions?: (candidate) => ReactNode` |
| 006 | `pages/entities/impact/ImpactSection.tsx` | optional `entityId`, `depth` and `headerActions?: ReactNode` props |
| 007 | shared `exceptions.ts` | snapshot schemas move to `analysis-snapshots.ts` (R2) |
| 007 | `exceptions/snapshot.service.ts`, `snapshot.mapper.ts` | split `take` (R2); mappers move to shared |
| 007 | `exceptions.module.ts` | export `SnapshotService`, `ExceptionsQueryService` |
| 007 | every `prisma.exceptionSnapshot` / `ExceptionSnapshotKind` use, `test/helpers.ts` | renamed (R2) |
| 007 | `pages/exceptions/ExceptionCreatePage.tsx` | the `investigation` query parameter (R13) |
| 003 | `graph/timeline.service.ts`, `graph.module.ts` | `listForEntities`, export (R9) |

Each change keeps the existing tests passing unchanged; default props reproduce today's behaviour.

---

## R18. Testing, performance, dependencies

**Jest unit tests** (pure modules): `rules/transitions.spec.ts` (3 × 3 pairs, field changes, messages), `rules/policy.spec.ts` (every FR-020 row × owner, creator, analyst, manager, admin, each status), `rules/scope.spec.ts` (every reason, merge, order, cap), `rules/recurrence.spec.ts` (window boundaries, own entity excluded, labels with 1 and 2+ entities), `rules/list-query.spec.ts` (every view, filter, sort, keyset), `rules/history.spec.ts` (every sentence), `rules/decision-context.spec.ts`, `rules/current-pin.spec.ts`; shared Vitest: `suggestInvestigationTitle`, `compareDigests`, the moved mappers (007's mapper tests move with them), schemas. `timeline.service.spec.ts` gains multi-entity merge cases; its existing cases stay.

**Jest + supertest e2e**: `investigations-seed.e2e-spec.ts` (fixtures V1–V3), `investigations.e2e-spec.ts` (create, edit, owner, transitions, conflicts, Closed refusals, audit = history), `investigation-pins.e2e-spec.ts` (V4, stale selected candidate, anchor rules, unpin, data change after pin), `investigation-scope.e2e-spec.ts` (V5, timeline V6), `investigation-decisions.e2e-spec.ts` (V7, notes), `investigations-list.e2e-spec.ts` (V8, determinism), `analysis-snapshots-migration.e2e-spec.ts` (rename, owner CHECK, backfill, append-only still enforced), `authz-matrix.e2e-spec.ts` (+ 18 rows), 007's e2e suites unchanged and green, `perf-investigations.e2e-spec.ts` (`RUN_PERF=1`).

**Performance** (spec SC-005):

| Operation | Budget | How |
|---|---|---|
| List first page, 10k investigations, any view/sort | < 1 s p95 | indexed `WHERE`, keyset, one `count`, recurrence map from one indexed `distinct` query |
| Detail (header, scope, current pins, linked exceptions) | < 2 s | ~8 queries, no analysis |
| Timeline first page, 100-entity scope | < 1 s | `event_entities (entity_id)` and `state_observations (entity_id, observed_at, seq)` indexes, `take limit + 1` per stream |
| Pin both / create with pins | < 5 s | 005 + 006 + one short transaction |

**Dependencies**: **none**. Postgres features used: identity sequence, `CHECK`, partial and GIN indexes, array column, triggers, `ALTER TABLE/TYPE … RENAME`.
