# Research: Root-Cause Analysis

**Feature**: `005-root-cause-analysis` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

The spec's two clarifications are resolved (spec FR-008, FR-017 rule 5). The Technical Context has no open unknowns, so this document records **design decisions**. They are binding for the implementer. Each one gives the decision, the rationale and the alternatives rejected.

---

## R1. Module layout: a new `root-cause` bounded context

**Decision**: Add a Nest module `apps/api/src/root-cause/` that owns:
- the analysis endpoint (`GET /api/entities/:id/root-cause`);
- the evidence-note endpoints;
- an `EvidenceReader` that loads evidence rows;
- pure analysis modules in `root-cause/analysis/`.

`TracingModule` adds `exports: [TracingService]`, and `RootCauseModule` imports it.

**Rationale**:
- Root cause (§10) is a different question from dependency tracing (§11). It has its own rules (roles, labels, confidence), its own stored data (notes) and its own mutations.
- `tracing` is read-only by design (003 FR-024). Putting audited note writes there would break that.
- CLAUDE.md lists the planned modules, but root cause isn't among them. This module is the smallest addition that keeps every module single-purpose (see Complexity Tracking in plan.md).

**Alternatives rejected**:
- **Put everything into `tracing`**: this mixes a read-only context with mutations.
- **A separate `evidence` module for notes**: notes exist only to serve root-cause analysis in this feature, so a second module adds wiring with no benefit (YAGNI).

---

## R2. The analysis is built on `TracingService.blockers`, not a new traversal

**Decision**: `RootCauseService.analyze(id, query)` calls:

```ts
tracing.blockers(id, { depth: query.depth, relationshipTypes: [], entityTypes: [] })
```

The empty lists mean the default blocker types and no entity filter. Every candidate, chain and hop is derived from the returned `BlockersResponse`:
- `paths` are already ranked by 003 FR-016;
- they already carry hop DTOs with assertions and state evidence;
- they already carry the 003 explanation sentences;
- `deepestBlockers` already carries `possible`, `continuesBeyondDepth` and `inCycle`;
- `truncation` is reused as is.

`TracingService.blockers` throws 404 for an unknown entity. That error propagates unchanged.

**Rationale**:
- Spec FR-001 requires the analysis to be derived from feature 003's blocker tracing.
- Reuse guarantees that the Blockers section and the Root cause section can never disagree.
- It keeps all traversal inside `GraphRepository`, as the constitution requires.
- It adds no traversal SQL.

**Alternatives rejected**:
- **Calling `GraphRepository.traceBlockers` directly**: this would duplicate the filtering, ranking cut-off, mapping and explanation code in `TracingService`.
- **A new CTE**: forbidden duplication.

---

## R3. Candidates and chains

**Decision** (pure, `analysis/candidates.ts`):

1. **Group paths** by the id of their last hop's entity. Keep the order in which groups first appear in `paths`. Within each group, the first path is the **primary chain** and the rest are **alternative chains**, in `paths` order (spec FR-002).
2. **Order candidates** (spec FR-003):
   1. overall confidence, HIGH first;
   2. then the index in `paths` of each candidate's primary chain, ascending.

   This sort is stable, so equal confidence keeps the 003 ranking.
3. **Limits**: the analysis sees at most the 100 paths that 003 returns (003 FR-021). When `truncation.pathLimit` or `truncation.explorationLimit` is true, the SEARCH_LIMIT rule applies to every candidate (R6, rule 4).

**Roles** (pure, `analysis/roles.ts`, spec FR-006 to FR-009). For a chain with `n ≥ 1` hops, step `0` is the start entity and step `i` is `hops[i-1].entity`:

| Step | Roles |
|---|---|
| 0 | `SYMPTOM` |
| 1 | `IMMEDIATE_BLOCKER`, plus `ROOT_CAUSE` when `n = 1` |
| 2 … n-1 | `UPSTREAM_CAUSE` |
| n (when n ≥ 2) | `ROOT_CAUSE` |

- A step's `possible` flag is true when its entity's state is `UNKNOWN` (FR-009).
- Roles are stored in this fixed order: SYMPTOM, IMMEDIATE_BLOCKER, UPSTREAM_CAUSE, ROOT_CAUSE.

**Rationale**:
- Grouping by deepest blocker is exactly 003's `deepestBlockers` set. Its order matches 003's "first path it appears in" rule (003 research R6).
- The immediate blocker is the first step after the symptom (clarification Q1 = A).

**Alternative rejected**: merging chains that share a prefix into a tree. That is harder to read, and the spec asks for a primary chain plus alternatives.

---

## R4. Evidence gathering (spec FR-011)

**Decision**: `EvidenceReader.load(input)` collects evidence for every entity that appears on any returned chain (the start entity included), and for every relationship assertion on those chains. It runs a fixed set of batched queries, never one per step. All of them are plain reads of non-graph tables, or the new one-hop repository method, so none of them is traversal.

| FR-011 rule | Source | Query |
|---|---|---|
| 1. State record | `state_observations` joined to `source_records`: the current observation, plus the latest observation from each other source system | `DISTINCT ON (entity_id)` and `DISTINCT ON (entity_id, source_system)`, as `StateEvidenceReader` does, joined to `source_records` for `raw_payload` |
| 2. Relationship record | `source_records WHERE relationship_id = ANY($ids)` | one query, ordered by `observed_at DESC, seq DESC` |
| 3. Requirement source | `GraphRepository.findIncomingRelationships(entityIds, ['DEFINES','GOVERNS'])` (new, one hop, no recursion), then rule 1 for the defining entities and their `attributes` | one repository call plus one state-record call |
| 4. Events | `event_entities` joined to `events`, ranked per entity with `ROW_NUMBER() OVER (PARTITION BY ee.entity_id ORDER BY e.occurred_at DESC, e.source_system COLLATE "C", e.source_id COLLATE "C")`, keeping rank ≤ 20, plus a `COUNT(*) … GROUP BY entity_id` | 2 queries, plus 1 query for the entities named by those events |
| 5. Manual notes | `evidence_notes` left-joined to `evidence_note_retractions` and `users`, ranked per target with `ROW_NUMBER() … ORDER BY created_at DESC, id DESC`, keeping rank ≤ 50, plus counts | 2 queries per target kind |
| Label input | `entities.attributes` for root-cause entities | 1 query |

- **Re-sorting**: every list is re-sorted in TypeScript with `compareCodeUnits` from 003 (research R7) before it is returned. SQL ordering is used only to pick the top N.
- **Per-source ordering**: other-source state records are ordered by `sourceSystem`.
- **Requirement-source ordering**: requirement sources are ordered by `(relationshipType, entity.displayName, entity.id)`, and capped at 20, with the total reported.

**Origin of each item** (FR-011):
- state records and events are `SOURCE`;
- relationship records take the origin of their assertion;
- requirement sources take the origin of the defining relationship;
- notes are `MANUAL`.

**Rationale**:
- Each rule matches a single SQL shape, so the query count stays constant: no N+1, and the 1.5 s budget in SC-003 holds.
- `findIncomingRelationships` lives in `GraphRepository` because CLAUDE.md requires relationship reads that follow edges to go through it, even for one hop.

**Alternatives rejected**:
- **Reusing `TimelineService`**: it pages one entity at a time, oldest first.
- **Loading every event**: hubs such as a warehouse have thousands.
- **Following DEFINES/GOVERNS through `traceDependencies`**: a multi-hop traversal is not needed for one hop.

---

## R5. Root-cause label (spec FR-012)

**Decision** (pure, `analysis/label.ts`):

```text
words(state) = STATE.toLowerCase().split('_') each capitalized, joined by ' '
               (MISSING → "Missing", AT_RISK → "At Risk", UNKNOWN → "Unknown")
field        = attributes.requiredField if it is a non-empty string
if field:  label = humanize(field) + ' ' + words(state)   rule = REQUIRED_FIELD
else:      label = displayName + ' ' + words(state)       rule = DISPLAY_NAME_STATE
humanize("budgetCode") = split before each uppercase letter, and on '_' and '-',
                         drop empty parts, capitalize the first letter of each part,
                         join with ' ' → "Budget Code"
```

- `humanize` also handles `cost_center`, which becomes "Cost Center".
- On the seed, `BR-18492` has `requiredField = "budgetCode"` and state MISSING, so its label is "Budget Code Missing".

**Rationale**:
- This is deterministic and readable.
- It reads the one attribute that BudgetRequirement entities carry for this purpose (seed row 25).
- The label rule is returned with the label, so it can be inspected.

**Alternatives rejected**:
- **A per-type cause catalog**: over-built for one vertical (YAGNI).
- **Free-text labels from sources**: not deterministic across sources.

---

## R6. Overall confidence (spec FR-014 to FR-017)

**Decision** (pure, `analysis/confidence.ts`):

```ts
computeConfidence(input: ConfidenceInput): { confidence; outcomes: ConfidenceRuleOutcome[] }
```

It evaluates the 8 rules **in this fixed order** and always returns 8 outcomes. Every rule reads only the **primary chain**.

| # | `rule` | Condition | Effect when applied |
|---|---|---|---|
| 1 | `WEAKEST_LINK` | always | `c = min(effectiveConfidence of hops)`. Always `applied: true`. |
| 2 | `UNKNOWN_STATE` | any step (start included) has state UNKNOWN | `c = LOW` |
| 3 | `CYCLE` | the candidate's deepest blocker has `inCycle` | `c = LOW` |
| 4 | `SEARCH_LIMIT` | the deepest blocker has `continuesBeyondDepth`, or `truncation.pathLimit`, or `truncation.explorationLimit` | `c = min(c, MEDIUM)` |
| 5 | `STALE_EVIDENCE` | any step's current-state observation has `evaluatedAt − observedAt > 72 h` (strictly greater), or has no observation | `c = lower(c)` |
| 6 | `CLASSIFICATION_DISAGREEMENT` | for any step, the classifications of its per-source latest states differ | `c = lower(c)` |
| 7 | `UNCORROBORATED` | the root-cause entity has state observations from exactly one source system, **and** its event total is 0 | `c = lower(c)` |
| 8 | `DISPUTED` | at least one active (unretracted) DISPUTES note targets a primary-chain step's entity, or one of the primary-chain hops' assertion relationship ids | `c = lower(c)` |

- `lower(HIGH) = MEDIUM`, `lower(MEDIUM) = LOW` and `lower(LOW) = LOW`.
- Rules 5 to 8 each fire **at most once**.
- Rules 2 and 3 set LOW whatever came before.
- Each outcome records:
  - `applied`;
  - `confidenceAfter`;
  - `refs`: the step indexes, relationship ids and note ids involved, each sorted;
  - a deterministic `reason` sentence (contracts/api.md § Confidence reasons).

**Notes on rule 6**:
- A disagreement **within one classification** (for example OMS BLOCKED and ERP PENDING) does not apply the rule.
- Its outcome still carries `applied: false`, and its reason names the disagreement (spec Story 1, scenario 2).
- The per-source states come from `EntityStateEvidenceDto.latestBySource`, which 003 fills only when sources disagree.

**Notes on rule 5**:
- `evaluatedAt` comes from the query, or defaults to the request time (R7).
- An observation **after** `evaluatedAt` has a negative age and is not stale.
- A step with no observation at all counts as stale. This cannot happen for data that was imported, but the rule makes the guard explicit.

**Rationale**:
- Every rule is a pure function of data already in the response, so it is fully inspectable (Principle III).
- Fixed order and "at most once" make the result easy to predict by hand.
- Supports and Context notes never raise confidence (spec Assumptions).

**Alternatives rejected**:
- **Numeric scores or percentages**: forbidden (FR-015, §58).
- **Cumulative downgrades per step**: one stale step and four stale steps would give different answers for the same kind of weakness, which is harder to explain.
- **Using alternative chains**: forbidden by FR-016.

---

## R7. Evaluation time and determinism (spec FR-004)

**Decision**:
- `RootCauseQuerySchema.evaluatedAt` is an optional ISO-8601 UTC datetime (`z.string().datetime()`).
- The service reads `computedAt = new Date()` once. `evaluatedAt` defaults to `computedAt.toISOString()`.
- The resolved value is echoed in `query.evaluatedAt`.
- `evaluatedAt` influences **only** rule 5. It is **not** a historical replay: states, paths and events are always current.
- All ordering uses `compareCodeUnits`. No `localeCompare`, no `Date.now()` inside pure modules.

**Rationale**:
- Acceptance fixtures pin `evaluatedAt = 2026-09-29T16:00:00Z` (clarification Q2 = A) and stay valid forever.
- Live use measures real staleness.

**Alternative rejected**: injecting a clock provider into Nest just for tests. An explicit query parameter is simpler, and it is visible to the user.

---

## R8. Explanation text (spec FR-018, FR-021, FR-022)

**Decision**:

**Chain sentences**:
- Reuse `explainBlockingPath` from `tracing/explanation.ts`, extended with an optional third parameter, `mood: 'ASSERTIVE' | 'HEDGED' = 'ASSERTIVE'`.
- HEDGED changes only the subject clause:
  - UNSATISFIED: `X may be <label> because`;
  - SATISFIED + AT_RISK: `X may be at risk because`.
- All other clauses are unchanged.
- 003 call sites are untouched, and their tests must still pass byte-for-byte.
- **Assertive candidates** reuse `BlockingPathDto.explanation` from the blockers response as is.
- **LOW candidates** recompute the sentences with `'HEDGED'`.

**Everything else**:
- The headline, the confidence sentences, the evidence sentence and the summary are new pure functions in `root-cause/analysis/explanation.ts`.
- Exact templates are in contracts/api.md.

**Rationale**:
- The sentences match the Blockers section word for word.
- Hedging satisfies FR-018 without a second template set.

**Alternative rejected**: a separate sentence generator. Two templates for the same hop would drift apart.

---

## R9. Evidence notes storage: two append-only tables

**Decision**: Two tables, both guarded by the existing `forbid_provenance_mutation()` trigger for UPDATE, DELETE and TRUNCATE:

- **`evidence_notes`**
  - Columns: `id`, `entity_id`, `relationship_id`, `stance`, `text`, `reference`, `author_id`, `created_at`.
  - `CHECK (num_nonnulls(entity_id, relationship_id) = 1)`.
  - Length checks on `text` (1 to 2,000 characters) and `reference` (1 to 500).
- **`evidence_note_retractions`**
  - Columns: `note_id` (PK and FK), `retracted_by_id`, `reason`, `retracted_at`.
  - Length check on `reason` (1 to 500).

**Writes**:
- **Retracting** inserts a row. A second retraction hits the primary key and is treated as idempotent: the service returns the current note and writes no audit record.
- **Creating and retracting** each run in one transaction, together with their `AuditService.record` call (FR-025).
- **Audit actions**: `evidence_note.created` and `evidence_note.retracted`, both with `targetType: 'evidence_note'`. The note DTO goes into `after`, and `before` is the note before retraction.

**Rationale**:
- Immutability (FR-024) is enforced by the database, not only by the code, in the same way as provenance tables (002 R16).
- Splitting retractions out keeps both tables strictly insert-only.

**Alternatives rejected**:
- **Nullable retraction columns updated in place**: this needs an UPDATE trigger with column-level rules, which is more fragile.
- **Soft delete**: this violates "never deleted".

**Test reset**: `apps/api/test/helpers.ts → resetDb` must disable and re-enable user triggers on both new tables, and add them to the `TRUNCATE` list.

---

## R10. Note permissions and validation (spec FR-023, FR-024, FR-032)

**Decision**:

**Permissions**:
- Every authenticated role can create and list notes. The global JWT guard applies, and there is no `@Roles`.
- To retract, the service checks `note.authorId === user.id || user.role === 'ADMIN'`. Any other user gets `Errors.forbidden()`, preceded by `audit.recordStandalone({ action: AUTH_FORBIDDEN, metadata: { method, path, role } })`, exactly as `RolesGuard` does.

**Validation** (zod, `packages/shared/src/evidence-notes.ts`):
- `text` and `reason` are trimmed, then length-checked.
- `reference` is trimmed. Empty becomes absent, which is stored as `null`.
- `target` is a discriminated union on `kind`:
  - `{ kind: 'ENTITY', entityId }`;
  - `{ kind: 'RELATIONSHIP', relationshipId }`.

**Missing targets**:
- A missing target entity or relationship returns `400 VALIDATION_FAILED`, with detail `path: 'target.entityId'` or `'target.relationshipId'` and `message: 'Entity not found'` or `'Relationship not found'` (spec Story 3, scenario 6).
- Listing notes for a missing entity or relationship returns `404`.

**Rationale**: this follows the existing patterns. The spec explicitly requires a validation error, not a 404, for a bad note target.

---

## R11. Web: Root cause section and header callout

**Decision**:

**Page order**: `EntityDetailPage` renders Identity, Current state, **Root cause**, Blockers, Dependencies, Relationships, Timeline, Source records (spec FR-028).

**Header callout** (`BlockerCallout`, which keeps its file name), so that both FR-029 here and 003 FR-028 hold above the fold:
1. When the root-cause analysis has candidates:
   - the analysis summary;
   - the first candidate's headline;
   - its chain sentences;
   - a link to `#root-cause`.
2. Always, when blockers exist:
   - the 003 blocker summary line;
   - a link to `#blockers`.
3. When the first candidate's primary chain is **not** the same path as `blockers.paths[0]`, also `paths[0].explanation`. Two paths are the same when their hop `key` sequences are equal.

**Data hooks**:
- `useRootCause(entityId)` uses key `['entities', id, 'root-cause']`.
- `useEvidenceNotes(target)` uses key `['evidence-notes', kind, targetId]`.
- After a note is created or retracted, invalidate with `predicate: q => q.queryKey[0] === 'evidence-notes' || q.queryKey[2] === 'root-cause'`. A note can change any analysis whose chain includes its target.

**Components** (`apps/web/src/pages/entities/`):
- `RootCauseSection`
- `RootCauseCandidate` (headline, explanation, chain, confidence and alternatives)
- `CausalChainView` (ordered steps with `RoleBadge`)
- `StepEvidence` (groups by FR-011 rule)
- `ConfidenceRules`
- `EvidenceNoteForm`
- `EvidenceNoteList`

**Reuse**:
- `OriginBadge`, `StateBadge`, `ExplanationSentence` with `linkTargets`, and `formatTimestamp`.
- `PathView` for alternative chains.

**Retract button**:
- shown only when `user.id === note.author.id` or `user.role === 'ADMIN'`, using `useAuth`;
- the server enforces the same rule regardless.

**Rationale**: this keeps the 003 layout, adds one section, and meets both above-the-fold requirements without a second banner.

**Alternative rejected**: a separate root-cause banner above the blocker callout. Two banners push the Identity section below the fold at 1366×768.

---

## R12. Testing strategy

**Jest unit tests** (pure modules, `root-cause/analysis/*.spec.ts`):
- **`roles`**: chains of 1, 2, 3 and 6 hops, and UNKNOWN steps.
- **`label`**: both rules, `humanize` on camelCase, snake_case, kebab-case and single words, every state's words.
- **`confidence`**:
  - each rule alone;
  - rules 2 and 3 overriding;
  - rule 4 capping HIGH and leaving LOW as LOW;
  - rules 5 to 8 firing once even when several steps trigger them;
  - floor at LOW;
  - rule 6 same-class (not applied, reason still names it) versus cross-class;
  - the 72 h boundary: exactly 72 h is not stale, 72 h + 1 ms is stale;
  - a future observation;
  - a retracted DISPUTES note ignored;
  - SUPPORTS and CONTEXT notes ignored.
- **`candidates`**: grouping, alternative-chain order, confidence-first ordering with stable ties.
- **`key-evidence`**: de-duplication by source record id, chain order.
- **`explanation`**: every template branch, and exact fixture strings R1 to R9 (contracts/api.md).
- **`tracing/explanation.spec.ts`**: new HEDGED cases. Existing cases stay unchanged.

**Jest + supertest e2e** (real Postgres):
- **`root-cause-seed.e2e-spec.ts`**: fixtures R1 to R9 exactly, plus SC-004 (100 identical runs with a pinned `evaluatedAt`, comparing everything except `computedAt`).
- **`root-cause.e2e-spec.ts`**: small built graphs for:
  - each confidence rule end to end;
  - UNEXPLAINED and NOT_BLOCKED;
  - two candidates;
  - a cycle;
  - the depth limit;
  - validation (depth, `evaluatedAt`);
  - 401 and 404.
- **`evidence-notes.e2e-spec.ts`**:
  - create (each target kind), list, paging;
  - retract by the author and by an admin;
  - 403 for another user, with an `auth.forbidden` audit row;
  - idempotent retract;
  - each validation case, including a missing target returning 400;
  - audit rows with before and after;
  - proof that UPDATE and DELETE are refused at the database (SC-006);
  - the effect on a subsequent analysis (fixtures R6 and R7).
- **`authz-matrix.e2e-spec.ts`**: AUTHENTICATED rows for all 5 new routes.
- **`perf-root-cause.e2e-spec.ts`** (`RUN_PERF=1` only): reuses the 003 performance graph (6-hop blocking chain), 20 runs, p95 < 1.5 s (SC-003).

**Vitest**:
- **web**: one test file per new component, an updated `EntityDetailPage.test.tsx` checking section order and callout content, and fixture data in `root-cause-test-data.ts`;
- **shared**: `root-cause.spec.ts` and `evidence-notes.spec.ts` for the schemas.

---

## R13. Performance (spec SC-003)

**Budget at 50k entities and 150k relationships**:

| Stage | Budget |
|---|---|
| 003 blockers | < 1 s p95 (measured in 003) |
| Evidence | about 10 batched queries over at most a few hundred ids, about 150 ms |
| Pure analysis | < 10 ms |

**Decision**:
- No caching or persistence (FR-005).
- If the budget is missed, first verify that these indexes are used:
  - `event_entities(entity_id)`;
  - `source_records(entity_id, observed_at DESC, seq DESC)`;
  - `source_records(relationship_id)`;
  - the new note indexes.

  Then record the timings in quickstart.md.

---

## R14. Dependencies added by this feature

**Decision**: **None.**
- Postgres features used: window functions, `DISTINCT ON`, `num_nonnulls` and `COLLATE "C"`. All are built into PostgreSQL 16.
- The web UI uses existing Tailwind and React primitives.
