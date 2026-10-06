# Questions

## Q1 — T001: e2e baseline cannot run, so the database is unreachable

**Where**: `tasks.md` T001 (baseline gate), which also blocks every later e2e checkpoint, starting with T009.

**Result so far** (branch `003-dependency-tracing`, no code changed):

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile`, shared build, `prisma generate` | OK |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass (shared 37, web 38, api 128 tests) |
| `pnpm test:e2e` | **fails in globalSetup** |

**Error** (`apps/api/test/global-setup.ts` runs `prisma migrate reset --force --skip-seed`):

```text
Datasource "db": PostgreSQL database "opsgraph_test", schema "public" at "localhost:5432"
Error: P1010: User was denied access on the database `(not available)`
```

**Environment facts**:
- `apps/api/.env.test` uses `postgresql://opsgraph:opsgraph@localhost:5432/opsgraph_test`.
- `apps/api/.env` points at port 5433, so the dev database differs from the test one.
- Something is listening on 5432, but it rejects the `opsgraph` user. It may be a different, locally installed Postgres instead of the project's container.
- `docker compose ps` fails: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`. Docker Desktop is not running.

**Options**

1. **Start Docker Desktop**, then `docker compose up -d db`. If the container conflicts on 5432 with the other Postgres, stop that service or remap the port.
2. **Provide credentials** for the Postgres already on 5432, with a role `opsgraph` allowed to create and reset `opsgraph_test`.
3. **Point `.env.test` at another database** that you confirm is disposable.

`migrate reset --force` wipes the target database, so I will not choose or alter a database on my own.

**Recommendation**: option 1.

**Blocked**: ticking T001, and all e2e checkpoints from Phase 2 on. Pure unit work (T002–T008) is not blocked.

## Q2 — T009: CTE smoke test is written but has not been run (same cause as Q1)

**Where**: `tasks.md` T009, plus the Phase 2 checkpoint item `pnpm --filter api test:e2e -- graph-repository`.

**Status**: the test is in `apps/api/test/graph-repository.e2e-spec.ts` (new `describe` at the end of the file). It imports the 3-node REQUIRES cycle, runs the exact R3 step-1 SQL and asserts 3 rows with depths A 0, B 1, C 2. **It has not been executed**, so T009 is **not ticked**.

**Why**: the database is unreachable, as in Q1. Docker Desktop is still not running. The only server on 5432 is the Windows service `postgresql-x64-18`, which is not the project's container and rejects the `opsgraph` role. `prisma migrate reset --force` would wipe whatever it points at, so I did not touch it.

```text
$ pnpm test:e2e -- graph-repository
Datasource "db": PostgreSQL database "opsgraph_test", schema "public" at "localhost:5432"
Error: P1010: User was denied access on the database `(not available)`
```

**What is unverified**: whether Postgres accepts the `CROSS JOIN LATERAL ( ... UNION ALL ... )` shape, and whether Prisma's `$queryRaw` accepts a JS string array against `::"RelationshipType"[]` (including the empty array). If either fails, R3 says to switch to the fallback SQL and record it here. T015 (`traceBlockers`) and T032 (`traceDependencies`) depend on the outcome.

**Needed from you**: one of the Q1 options (start Docker Desktop and `docker compose up -d db`, which is the recommendation), then run `pnpm --filter api test:e2e -- graph-repository`.

**Typos in `tasks.md`** (not edited, per the implementer rules): T008 says T015 and T026 replace the two stubs, and T009 says to use the fallback shape in T015 and T026. The second stub is removed by T032 (`traceDependencies`), and T026 is the web `BlockersSection`.

**T001 tick is unsupported**: T001 is ticked in `tasks.md`, but Q1 says the e2e baseline could not run, and no e2e suite has run on this branch. Lint, typecheck and unit tests pass. I left the tick as found, so please confirm or untick it.

## Resolution of Q1 and Q2 (Phase 3 session)

**Status**: resolved. The baseline gate is green and T001 and T009 are verified.

- **Cause**: `.env.test` says port 5432, which is the Windows `postgresql-x64-18` service. `docker-compose.override.yml` maps the project's container to **5433**. Docker Desktop is now running.
- **How the e2e suite runs**: `DATABASE_URL=postgresql://opsgraph:opsgraph@localhost:5433/opsgraph_test`, set in the shell only (`load-env.ts` never overrides an existing variable). No file was changed. `apps/api/.env.test` still points at 5432, so anyone else running e2e needs the same override or a stopped 5432 service.
- **Prisma consent guard**: `prisma migrate reset --force` (run by `global-setup.ts`) refuses to run from Claude Code without the user's explicit consent. The user consented to resetting `opsgraph_test` at localhost:5433 only.
- **Baseline at `056fc17`**: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. `pnpm test:e2e`: 14 suites passed, 2 skipped (`RUN_PERF`), 198 tests passed, 4 skipped.
- **T009 outcome**: Postgres accepts the R3 `CROSS JOIN LATERAL ( … UNION ALL … )` shape, and Prisma binds string arrays (including `[]`) against `::"RelationshipType"[]`. The R3 fallback SQL is **not** needed. The first version of the test failed in its own setup (Order imports need `attributes.amount` as a decimal string and `attributes.currency`), not in the SQL.

## FYI — cycle-closing sort order (Phase 3)

research R5 sorts cycle-closing hops by `(sourceId, type, targetId)` (walk direction), while plan KDN 3.7 and data-model §2b say `(fromEntityId, relationshipType, toEntityId)` (as recorded). I follow KDN 3.7. No Phase 3 assertion depends on the order.
