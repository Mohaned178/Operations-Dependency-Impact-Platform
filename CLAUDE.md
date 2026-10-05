# OpsGraph — Agent Guide

OpsGraph is an operational dependency and impact platform. It sits above existing systems (orders, payments, warehouse, shipping…), builds a graph of how their records connect, and explains **why something is blocked, what it affects, and what evidence proves it**.

- Full vision: `Product Overview.md` (2,400 lines). **Do not read it in full.** Grep for the relevant `# N.` section.
- MVP scope is §61, non-goals are §62, and the reference scenario is §39 (Acme Corp / Order #18492).
- MVP vertical: **Logistics/Commerce** (Customer → Contract → Order → Payment → Approval → Warehouse → Shipment; Supplier → Product).

## Stack
- pnpm workspaces monorepo, TypeScript strict everywhere
- `apps/api`: NestJS + Prisma + PostgreSQL 16 (Docker locally)
- `apps/web`: React + Vite, TanStack Query, React Router, Tailwind, React Flow (graph explorer)
- `packages/shared`: zod schemas and inferred types. This is the single source of truth for DTOs used by both apps.
- Tests: Vitest (web/shared), Jest (api, Nest default), Supertest for e2e API, Playwright later

## Commands (planned; they become real once the Foundation slice lands)
```
pnpm install
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev && pnpm --filter api prisma db seed
pnpm dev              # api :3000 + web :5173 (Vite proxies /api)
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e   # must pass before a task is "done"
```

## Domain glossary (§6)
Entity (operational thing, e.g. Order) · SourceRecord (the raw record from an external system) · Relationship (typed, meaningful edge, e.g. `Payment BLOCKS Shipment`) · Event (something that happened at time T) · State (current condition) · Dependency (A relies on B) · Evidence (what supports a fact or conclusion) · Risk (possible future problem, with reasons) · Exception (a problem as a structured case) · Action · Investigation (a workspace that preserves the whole analysis).

## Non-negotiable invariants
1. **Provenance:** every entity, relationship, state and event stores its source (system, source id, observed_at). Never drop source details when normalizing (§27, §55).
2. **Fact vs inference:** relationships and conclusions carry `origin: SOURCE | INFERRED | MANUAL` and `confidence: HIGH | MEDIUM | LOW`. Never present an inference as fact (§10, §30).
3. **Conflicts are visible:** if sources disagree, store both values and flag a conflict. Never silently pick one (§29, §53).
4. **Audit everything:** every mutation writes an audit row (actor, action, entity, before, after, timestamp) (§37).
5. **Explainable and deterministic:** root cause, impact and risk results return the path, factors and evidence that produced them. No opaque scores (§15, §58).
6. **Not a graph viewer:** every graph view is paired with textual explanation, structured data and a timeline (§3, §45).

## Code conventions
- One Nest module per bounded context: `graph`, `ingestion`, `tracing`, `impact`, `exceptions`, `investigations`, `risk`, `audit`, `auth`.
- Controllers are thin: validate (zod pipe with schemas from `packages/shared`) → call a service → return a DTO. Business logic lives in services.
- Graph traversal goes **only** through `GraphRepository` (recursive CTEs via `prisma.$queryRaw`, always with a max depth and cycle guard). No traversal SQL anywhere else.
- No `any`. No new dependencies unless the task explicitly lists them.
- Name files in kebab-case (`impact.service.ts`). Put tests next to their code (`*.spec.ts`), with e2e tests in `apps/api/test/`.
- Seed data lives in `apps/api/prisma/seed.ts` and must include the §39 scenario.

## Workflow (Spec Kit)
- **Orchestrator/reviewer (Claude Opus):** `/speckit-specify` → `/speckit-clarify` (if needed) → `/speckit-plan` → `/speckit-tasks`, then `/code-review` of the branch.
- **Implementer (DeepSeek):** works only from `specs/<feature>/tasks.md`, one phase at a time, on the feature branch.
  - Do **not** edit `spec.md`, `plan.md`, the constitution, or this file.
  - If a task is ambiguous or conflicts with an invariant, stop and write the question in `specs/<feature>/questions.md`. Don't guess.
  - After each phase, run lint, typecheck and test, then tick the task checkbox in `tasks.md`.
- Commits: Conventional Commits (`feat(graph): …`), one commit per task or small group of tasks.

## Definition of done
- [ ] Acceptance criteria in the task are met
- [ ] Lint, typecheck and tests pass locally and in CI
- [ ] New endpoints have a zod schema in `packages/shared` and an e2e test
- [ ] Mutations are audited; data has provenance
- [ ] No TODOs, dead code or unused deps left behind
