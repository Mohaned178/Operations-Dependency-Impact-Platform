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
