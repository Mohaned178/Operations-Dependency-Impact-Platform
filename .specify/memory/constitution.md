<!--
Sync Impact Report
- Version change: (template, unversioned) → 1.0.0
- Principles defined (initial ratification):
  I. Source Traceability
  II. Fact vs Inference
  III. Explainability & Determinism
  IV. Auditability
  V. Test-Gated Changes
  VI. MVP Scope Discipline
- Added sections: Technical Constraints, Development Workflow, Governance
- Removed sections: none
- Templates:
  ✅ .specify/templates/plan-template.md — "Constitution Check" gates are derived from this file
     at plan time (generic placeholder; no edit required)
  ✅ .specify/templates/spec-template.md — no mandatory section changes required
  ✅ .specify/templates/tasks-template.md — test tasks are optional in the template; Principle V
     makes them mandatory for OpsGraph (enforced at /speckit-tasks time, no template edit)
  ✅ CLAUDE.md / AGENTS.md — runtime guidance already aligned with these principles
- Deferred TODOs: none
-->

# OpsGraph Constitution

## Core Principles

### I. Source Traceability

Every persisted operational fact (entity, relationship, state, event, evidence) MUST record its
provenance: source system, source identifier, and `observed_at` timestamp. Normalization into
unified concepts MUST NOT erase source-specific fields; the original source payload MUST remain
retrievable. Any value shown to a user MUST be able to answer "where did this come from, and when?"

*Rationale*: Enterprise trust in OpsGraph depends entirely on being able to trace conclusions back
to the systems of record (Product Overview §18, §27, §54, §55).

### II. Fact vs Inference

Relationships and conclusions MUST carry `origin` (`SOURCE` | `INFERRED` | `MANUAL`) and
`confidence` (`HIGH` | `MEDIUM` | `LOW`). The UI and API MUST NOT present inferred data as fact.
When sources disagree, all conflicting values MUST be stored with their sources and timestamps and
surfaced as a conflict; the system MUST NOT silently choose one.

*Rationale*: Weak inference presented as fact causes severe operational errors (§10, §29, §30, §53).

### III. Explainability & Determinism

Root-cause, impact, and risk results MUST return the dependency path, contributing factors, and
evidence that produced them. Given the same graph state, these computations MUST be deterministic.
Opaque scores are forbidden. AI/LLM components MAY assist interaction but MUST NOT be the source of
truth for any conclusion.

*Rationale*: Every major automated conclusion must be inspectable (§15, §57, §58).

### IV. Auditability

Every mutation (user action, automated action, data change, workflow transition) MUST write an
audit record containing actor, action, target entity, before value, after value, and timestamp.
Audit records MUST be append-only.

*Rationale*: Investigations, approvals, and exceptions require a durable history of who changed what
and why (§37).

### V. Test-Gated Changes

No change merges unless lint, typecheck, and tests pass in CI. Every API endpoint MUST have its
request/response schema defined with zod in `packages/shared` and at least one e2e test. Graph
traversal logic MUST have unit tests covering cycles and depth limits.

*Rationale*: Code is implemented by a lower-cost model; automated gates are the primary defense
against regressions.

### VI. MVP Scope Discipline

The MVP targets the Logistics/Commerce vertical. Every feature MUST answer at least one of the
twelve questions in Product Overview §65 and MUST NOT violate the §62 non-goals. Build only what the
current feature spec requires (YAGNI); speculative abstractions require justification in the plan's
Complexity Tracking table.

*Rationale*: The biggest product risk is trying to support everything at once (§60, §61).

## Technical Constraints

- TypeScript in strict mode across all packages; `any` is prohibited.
- pnpm workspaces monorepo: `apps/api` (NestJS + Prisma + PostgreSQL), `apps/web` (React + Vite),
  `packages/shared` (zod schemas and shared types).
- All graph traversal MUST go through `GraphRepository`, and every traversal MUST enforce a maximum
  depth and a cycle guard. Traversal SQL MUST NOT appear elsewhere.
- New runtime dependencies require explicit listing in the feature plan.

## Development Workflow

- Roles: Claude Opus authors specs, plans, and tasks and performs code review; the implementer
  model (DeepSeek) works only from `specs/<feature>/tasks.md` and MUST NOT modify spec, plan,
  constitution, or `CLAUDE.md`. Ambiguities go to `specs/<feature>/questions.md`.
- One feature branch per Spec Kit feature; merge to `main` only after review findings are resolved
  and CI is green.
- Commits follow Conventional Commits (`feat(scope): ...`, `fix(scope): ...`).

## Governance

This constitution supersedes other practices and guidance files. Every plan's Constitution Check
and every code review MUST verify compliance with these principles; violations MUST be fixed or
explicitly justified in Complexity Tracking.

Amendments are made via `/speckit-constitution`, recorded with a Sync Impact Report, and versioned
semantically: MAJOR for removing or redefining a principle, MINOR for adding a principle or section
or materially expanding guidance, PATCH for clarifications and wording. Runtime guidance lives in
`CLAUDE.md`.

**Version**: 1.0.0 | **Ratified**: 2026-10-05 | **Last Amended**: 2026-10-05
