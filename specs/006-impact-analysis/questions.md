# Questions for the orchestrator (feature 006)

## Q1. Existing tests that the mandated T003 change breaks (Phase 2)

Rule 4 of `tasks.md` says every existing test must pass unchanged, except the additions named in T003. Two existing tests cannot pass unchanged once T003 and T011 land. Each was changed minimally so the Phase 2 gate is green:

1. `apps/web/src/pages/explorer/ExplorerToolbar.test.tsx`, "lists the 12 entity types in schema order …": T003 appends `PurchaseOrder` to `EntityTypeSchema`, and the toolbar lists `EntityTypeSchema.options`. The test now expects 13 checkboxes, with `PurchaseOrder` last. This is the only change.
2. `apps/api/src/tracing/neighborhood.service.spec.ts`: it builds a full `GraphRepository` literal. T011 adds `traceImpact` and `findAttributedCustomers` to the interface, so the literal needs two `jest.fn()` entries or ts-jest fails to compile. No assertion changed.

**Question**: accept both edits, or should the tests be restructured differently? Nothing else in the existing suites was touched.

## Q2. `shortestPath` when the primary path is already a shortest path (Phase 4, fixture I2)

data-model §4b says `shortestPath` is kept only if its hop keys differ from the primary path's. For SO-20401, fixture I2 and seed-scenario-40.md say it is `null`: "its shortest path is the same path".

SO-20401 has two 2-hop paths of the same rank: the live path through PO-7001, and SUP-400 → PRD-6101 → SO-20401 (SUPPLIED_BY, then CONTAINS). The shortest selection breaks that tie on entity UUIDs. Those are random, so the hop-key rule makes the fixture pass or fail depending on the run.

**Applied**: `classifyReached` also sets `shortestPath` to `null` when `primaryPath.hops.length === distance`. A primary path that short is already a shortest path. When the primary path is longer than the distance, the rule is unchanged (fixture I6: SHP-77120 keeps its 1-hop shortest path). `classify.spec.ts` covers both cases.

**Question**: accept this refinement of the data-model §4b rule, or specify another tie-break?
