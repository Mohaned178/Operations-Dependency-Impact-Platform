# Questions for the orchestrator: Root-Cause Analysis

Nothing here blocked Phase 1–2. Each item was resolved by the only reading that satisfies contracts/api.md. Please confirm, or tell the implementer to change it.

## Q1. `ConfidenceInput` needs the query `depth` (data-model §3c) — RESOLVED, confirm

- **Conflict**: the SEARCH_LIMIT reason must say `The search was complete within 6 steps.` (fixture R1) and `…the depth limit of ${steps(depth)}…`. data-model §3c lists `ConfidenceInput` without a depth, and nothing else in the input carries the number (`chain.length` and `deepest.pathLength` are not the query depth; `truncation.depthLimit` is a boolean).
- **Done**: added `depth: number` to `ConfidenceInput` in `apps/api/src/root-cause/analysis/types.ts`. `computeConfidence` passes it to `searchLimitReason`.
- **Effect on later tasks**: T019 (`RootCauseService.analyze`) must pass `query.depth` into `computeConfidence`.

## Q2. `refs.stepIndexes` where the contract is silent — RESOLVED, confirm

contracts/api.md § Refs defines `stepIndexes` as "the triggering steps" and fixes only WEAKEST_LINK and the not-applied case (all empty). No fixture pins the others, so the implementation uses:

| Rule | `stepIndexes` when applied |
|---|---|
| UNKNOWN_STATE | the steps whose state is UNKNOWN |
| CYCLE | the root-cause step (last index) |
| SEARCH_LIMIT | the root-cause step when `continuesBeyondDepth`; `[]` when only `truncation` triggered it |
| STALE_EVIDENCE | the stale steps (fixture R6: `[0,1,2,3]`) |
| CLASSIFICATION_DISAGREEMENT | the steps whose per-source states cross classifications |
| UNCORROBORATED | the root-cause step |
| DISPUTED | the step of each disputing entity note; for a relationship note, the step reached by that hop (same convention as WEAKEST_LINK) |

`relationshipIds` and `noteIds` follow the contract exactly.

## Q3. Naming: `toCausalChain` vs `assignRoles` — no action needed

plan.md and data-model §4 call the roles function `assignRoles`; tasks.md T013/T019 call it `toCausalChain`. Implemented as `toCausalChain` (tasks.md is the implementer's authority), with no alias.

## Q4. Fixture R7 DISPUTED reason: trailing period — OPEN, needs a contract fix before the Phase 3 e2e

- **Conflict**: contracts/api.md fixture R7 shows the reason ending `…suppli…"` with no final period, but the DISPUTED template (§ Confidence reasons) is `…: ${items}.`, which ends `…suppli…".`.
- **Done**: the code follows the template (`explanation.ts`, asserted in `explanation.spec.ts`). The template is the more specific source.
- **Needed**: settle which is right in the contract before the e2e for R7 copies the fixture string literally.

## Q5. Rule 8 sees only the capped notes list — OPEN, decide for Phase 3 (T018)

- **Gap**: `computeConfidence` reads `notes.items`, which the evidence reader caps at the 50 newest notes per target, retracted ones included (research R4). An old active DISPUTES note behind 50 newer SUPPORTS or retracted notes would be missed, and DISPUTED would not apply.
- **Done**: implemented exactly as research R4/R6 describe. This is not an implementation error.
- **Needed**: if it matters, T018 should also return the active DISPUTES notes uncapped (or a separate list) for rule 8. That changes the evidence bundle shape, so it needs your decision.

## Q6. T022 "a GOVERNS and a DEFINES into one step" cannot be built through the importer — RESOLVED, confirm

- **Conflict**: `RELATIONSHIP_RULES` (enforced by the import planner) only allows GOVERNS into an Order and DEFINES into an SLA or BudgetRequirement, so no entity can be the `to` end of both through an import.
- **Done**: `root-cause.e2e-spec.ts` imports two DEFINES into one BudgetRequirement and inserts the GOVERNS row directly with Prisma (bypassing the planner). It asserts the requirement sources are ordered by `(type, displayName, id)`: DEFINES Alpha, DEFINES Beta, then GOVERNS Aaa.
- **Needed**: nothing, unless you prefer the task text to be reworded.

## Q7. Note cursor precision for Phase 5 (T036–T037) — OPEN, decide before Phase 5

- **Risk**: `created_at` is `timestamptz(6)` (microseconds), but DTOs and TypeScript comparisons use ISO strings truncated to milliseconds (`evidence-note.mapper.ts`, `evidence.reader.ts`). A note-list cursor built from `{createdAt, id}` as a millisecond ISO string could skip a row: page 1 ends at `.123456` (cursor `.123Z`), and a next note at `.123200` with a smaller id is neither `< .123` nor `= .123`.
- **Needed**: the T037 list query should compare at millisecond precision (for example `date_trunc('milliseconds', created_at)`) or encode the full value in the cursor. Please confirm which.
- **Also for T045**: `StepEvidence` currently receives only `relationships`, not the hop, so offering "the link" as a note target needs the hop (or its label) passed down. `StepEvidence` already takes an optional `relationshipLabel`.
