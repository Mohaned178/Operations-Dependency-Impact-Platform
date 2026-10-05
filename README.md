# OpsGraph

OpsGraph is an operations dependency and impact platform. It sits above existing systems (orders, payments, warehouse, shipping…), builds a graph of how their records connect, and explains **why something is blocked, what it affects, and what evidence proves it**. It is not a graph viewer: every graph view is paired with a textual explanation, structured data and a timeline. See [Product Overview.md](./Product%20Overview.md) for the full vision.

## Prerequisites

- Node.js 22 LTS, pnpm 9 (`corepack enable`), Docker Desktop

## Local setup (target: under 15 minutes)

```bash
pnpm install
docker compose up -d db
cp apps/api/.env.example apps/api/.env      # dev defaults work as-is
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed
pnpm dev                                     # api :3000, web :5173
```

Open http://localhost:5173 and sign in as `admin@opsgraph.local` / `OpsGraph-Dev-2026!`.

## Quality gate (same as CI)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build
```

## Seeded users (dev only)

| Email | Role | Password |
|---|---|---|
| admin@opsgraph.local | Administrator | `SEED_PASSWORD` (default `OpsGraph-Dev-2026!`) |
| manager@opsgraph.local | Operations Manager | same |
| analyst@opsgraph.local | Operations Analyst | same |

## Project structure

```text
apps/api                 NestJS + Prisma + PostgreSQL API (:3000)
  prisma/                schema, migrations, seed
  src/                   auth, users, audit, health, prisma, common
  test/                  Jest + Supertest e2e suites
apps/web                 React + Vite SPA (:5173, proxies /api)
packages/shared          zod schemas and types shared by api and web
.github/workflows/ci.yml Lint, typecheck, unit tests and e2e tests
```

## Workflow

See [CLAUDE.md](./CLAUDE.md) for the Spec Kit workflow, the stack, invariants, commands and the definition of done.
