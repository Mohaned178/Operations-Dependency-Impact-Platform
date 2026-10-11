# Questions for the orchestrator (feature 006)

## Q1. Existing tests that the mandated T003 change breaks (Phase 2)

Rule 4 of `tasks.md` says every existing test must pass unchanged, except the additions named in T003. Two existing tests cannot pass unchanged once T003 and T011 land. Each was changed minimally so the Phase 2 gate is green:

1. `apps/web/src/pages/explorer/ExplorerToolbar.test.tsx`, "lists the 12 entity types in schema order …": T003 appends `PurchaseOrder` to `EntityTypeSchema`, and the toolbar lists `EntityTypeSchema.options`. The test now expects 13 checkboxes, with `PurchaseOrder` last. This is the only change.
2. `apps/api/src/tracing/neighborhood.service.spec.ts`: it builds a full `GraphRepository` literal. T011 adds `traceImpact` and `findAttributedCustomers` to the interface, so the literal needs two `jest.fn()` entries or ts-jest fails to compile. No assertion changed.

**Question**: accept both edits, or should the tests be restructured differently? Nothing else in the existing suites was touched.
