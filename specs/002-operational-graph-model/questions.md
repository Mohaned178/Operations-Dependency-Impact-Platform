# Questions

## Q1 — T038: R17's `formatTimestamp` is unworkable as written

**Where**: `specs/002-operational-graph-model/research.md` R17 ("Times") and `tasks.md` T038.

R17 specifies:

```ts
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  });
}
```

**Problem**: `dateStyle`/`timeStyle` cannot be combined with the `timeZoneName` option. V8 throws before any locale is applied:

```text
$ node -e "new Date('2026-09-29T11:40:00Z').toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short', timeZoneName:'short'})"
TypeError: Invalid option : option
```

The same `RangeError` occurs in browsers, so the web tests cannot pass while the snippet stays as written. R17 itself says to stop and record the problem when a decision is unworkable.

**Options**

1. **Drop `timeZoneName`** — keep `{ dateStyle: 'medium', timeStyle: 'short' }`. Output e.g. `Sep 29, 2026, 11:40 AM` (local time, no zone). Simple, but quickstart step 2 promises "shown in your local time with the timezone".
2. **Use explicit component options** — replace `dateStyle`/`timeStyle` with `{ year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }`. Output e.g. `Sep 29, 2026, 11:40 AM UTC`. Keeps the timezone, differs from "medium/short" only in formatting details.
3. **Compose two formatters** — format with `dateStyle`/`timeStyle`, then append the zone from a second `Intl.DateTimeFormat` with `{ timeZoneName: 'short' }`. Closest to the literal intent, more code.

**Recommendation**: option 2 — one call, deterministic, and it keeps the timezone that quickstart step 2 and R17's own rationale ask for.

**Blocked**: T038 (and the later T041/T042 web tasks that call `formatTimestamp`). Nothing else in the phase is affected.

**Resolved**: the user chose option 2 (explicit component options). T038 now formats with
`{ year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }`.
The rest of R17 is unchanged.

---

## T051 — Performance timings (`RUN_PERF=1 pnpm --filter api test:e2e -- perf-graph`)

Run locally 2026-10-06 against the docker PostgreSQL. All budgets pass.

| Check | Measured | Budget |
|---|---|---|
| SC-003 `GET /entities?type=Order` first page at 50k entities | 35 ms | 2,000 ms |
| SC-003 `GET /entities/:hub` | 48 ms | 2,000 ms |
| SC-003 `GET /entities/:hub/neighbors` | 28 ms | 2,000 ms |
| SC-003 `GET /entities/:hub/timeline` (hub has 1,000 events) | 27 ms | 2,000 ms |
| SC-008 `GET /entities/:hub/neighbors` over 1,000 relationships, two calls identical | 22 ms | 500 ms |
| SC-004 10,000-row JSON import through `POST /api/imports` | 9,881 ms | 60,000 ms |
