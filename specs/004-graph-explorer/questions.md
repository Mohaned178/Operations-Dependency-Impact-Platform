# Questions: Graph Explorer (004)

## Notes for the orchestrator (no action blocks the implementer)

1. **T001 baseline.** The baseline gate could not run before the first change (Docker was not running when the session started). T001 was ticked after Phase 2 instead: the full gate (`pnpm lint`, `pnpm typecheck`, `pnpm test`, the whole api e2e suite, `pnpm build`) is green with Phase 2 in place, so no earlier failure was hiding.
2. **ui.md §17 shim differs by one expression.** `observe(target)` in `ResizeObserverStub` is written `this.cb([...], this as unknown as ResizeObserver)` in ui.md §17. ESLint (`no-unnecessary-type-assertion`) rejects it, so `apps/web/src/test-setup.ts` uses `this.cb([...], this)`. Suggest correcting ui.md §17.
3. **Backend fixtures pulled forward.** T018, T037, T041 and T048 are backend-only and were done right after Phase 2, because they validate `composeNeighborhood` and the service against the real seed. N1 (32/60), N3 (35/86) and N2, N4 to N8 and G1 match the hand-derived figures exactly.
4. **Validation paths for list items.** A bad list item is reported with an indexed path (`entityTypes.0`, `expand.0`). The "expand contains the focus" error uses path `expand`, as in api §2 step 2.
