# Quickstart: Home Overview and Search

**Feature**: `010-home-dashboard-search`

Use this to check the feature by hand after implementation. Exact expected values are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures. The automated suite asserts them. Features 004–009 must already be merged (plan.md § Prerequisites).

## 1. Set up

```bash
pnpm install
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev        # applies <timestamp>_overview_search (creates the pg_trgm extension)
pnpm --filter api prisma db seed            # unchanged: users, §39, §40, 007, 008, 009 seeds; nothing new
RISK_SCHEDULER_ENABLED=false pnpm dev       # api :3000, web :5173; scheduler off so the pinned evaluation below is accepted
```

Check the extension: `docker compose exec db psql -U opsgraph -d opsgraph -c '\dx pg_trgm'` lists it.

With the scheduler on (the default), each risk evaluation (every 5 minutes, as of the real time) triggers a revenue-at-risk snapshot automatically (`OVERVIEW_SNAPSHOT_AUTO=true`).

## 2. API checks

```bash
login() { curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"OpsGraph-Dev-2026!\"}" | jq -r .accessToken; }
ADM=$(login admin@opsgraph.local); MGR=$(login manager@opsgraph.local); ANA=$(login analyst@opsgraph.local)
T3=2026-10-05T16:00:00Z

# Setup S: evaluation and snapshot as of T3
curl -s -X POST localhost:3000/api/risk-evaluations -H "authorization: Bearer $ADM" \
  -H 'content-type: application/json' -d "{\"asOf\":\"$T3\"}" | jq '.status'                 # "COMPLETED"
curl -s -X POST localhost:3000/api/overview/snapshots -H "authorization: Bearer $ADM" | jq '.status, .counts'
# "COMPLETED", { orders 25, analyzed 25, notAnalyzed 0, failed 0 }

# H1/H5: Home as the manager
curl -s "localhost:3000/api/overview?evaluatedAt=$T3" -H "authorization: Bearer $MGR" \
  | jq '.layout, .revenueAtRisk.data.currencies[0] | {total: .total.text, cats: [.categories[] | {category, a: .amount.text, n: .orderCount}]}?'
# TOTALS_FIRST; 89,065.00 USD: SUPPLIER 51,250.00 (6), PAYMENT 0.00, WAREHOUSE 0.00, APPROVAL 31,400.00 (17), OTHER 6,415.00 (2)
curl -s "localhost:3000/api/overview?evaluatedAt=$T3" -H "authorization: Bearer $ANA" | jq '.layout, .assigned.data.investigationsMine.value'
# ASSIGNED_FIRST, 1

# Drill-down: the APPROVAL orders add up to the figure
curl -s "localhost:3000/api/overview/at-risk-orders?category=APPROVAL&limit=50" -H "authorization: Bearer $ANA" \
  | jq '.summary, [.items[] | {o: .order.displayName, v: .value.text, rc: .rootCause.label}][0:3]'
curl -s "localhost:3000/api/overview/blockers" -H "authorization: Bearer $ANA" | jq '[.items[] | .sentence]'

# H4: freshness
curl -s "localhost:3000/api/source-systems/freshness?evaluatedAt=$T3" -H "authorization: Bearer $ANA" \
  | jq '.staleCount, [.items[] | "\(.sourceSystem) \(.status)"]'                        # 4; FinanceApprovals STALE …

# H7: search
curl -s "localhost:3000/api/search?q=18492" -H "authorization: Bearer $ANA" \
  | jq '[.entities.items[] | {n: .entity.displayName, tier}], [.investigations.items[] | .key]'
curl -s "localhost:3000/api/search?q=fabrikam%20componets" -H "authorization: Bearer $ANA" | jq '.entities.items[0] | {n: .entity.displayName, tier}'

# H6: built-in filter and a saved filter
curl -s "localhost:3000/api/entity-finder?type=Order&stateClass=IMPAIRED&rootCauseCategory=APPROVAL&limit=50" \
  -H "authorization: Bearer $ANA" | jq '.items | length, .meta.snapshot.number'                  # 17
curl -s -X POST localhost:3000/api/saved-filters -H "authorization: Bearer $ANA" -H 'content-type: application/json' \
  -d '{"name":"Other at-risk orders","criteria":{"type":["Order"],"stateClass":["IMPAIRED"],"rootCauseCategory":["OTHER"]}}' | jq '.id, .valid'

# Only Administrators request snapshots
curl -s -X POST localhost:3000/api/overview/snapshots -H "authorization: Bearer $ANA" | jq '.error.code'  # "FORBIDDEN"
```

## 3. Web checks (1366×768 window)

1. Sign in as **manager**. Home opens with the **totals** first, then **Assigned to me** (EX-10001 through Finance Operations). Add `?evaluatedAt=2026-10-05T16:00:00Z` to the address to pin the view.
2. On **Revenue at risk**, read 89,065.00 USD and the five categories with their order counts and the snapshot line. Select **Approval issues**: 17 orders, highest value first, total row 31,400.00 USD. Open Order #18492's row: reasons (BLOCKED from OMS, the open risk, SLA commitment Breached), root cause "Budget Code Missing" (HIGH), links to Entity 360, the budget code and the Graph Explorer.
3. Select **Other**: Order SO-20408 and Order #18532, each saying no root cause can be named.
4. **Unresolved blockers**: Budget code for Order #18492 (17 orders, EX-10001) and Fabrikam Components (6 orders). Open each blocker's order list and its Impact section.
5. Select the **SLA commitments breached** count: the Risks & Alerts SLA tab opens filtered to Breached with 8 rows. Select **Critical open exceptions**: the Exceptions area opens on Critical with EX-10001.
6. **Data freshness**: FinanceApprovals, ManualEntry, Payments and WMS are Stale.
7. Sign in as **analyst**: **Assigned to me** comes first with INV-10001.
8. Press **/** (not inside a field): the search box opens. Type `18492`: Order #18492 first with "18492" highlighted, then Budget code for Order #18492; INV-10001 under Investigations. Use ↓ and Enter to open the order. Press **Ctrl+K**, type `PAY-88213`, Enter. Type `Fabrikam Componets`: Fabrikam Components appears as a similar match. Narrow to **Exceptions** with the type filter.
9. Open **Entities**. Choose **Orders blocked by approvals** (17 rows). Add criteria and **Save** as "My approval view"; it appears under **My filters**; rename and delete it. Open **Audit** as admin and find `saved_filter.created`, `.updated`, `.deleted`.

## 4. Gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
RUN_PERF=1 pnpm --filter api test:e2e -- perf-search perf-overview     # SC-004 to SC-006, record below
```

| Measurement (20 runs) | Target | Recorded |
|---|---|---|
| `GET /search` (5 queries: identifier, prefix, contains, typo, 2 characters), 50k entities / 10k exceptions / 10k investigations, p95 | < 1 s (SC-004) | _fill in_ |
| `GET /overview`, same dataset, 10k open risks, p95 | < 2 s (SC-005) | _fill in_ |
| `GET /overview/at-risk-orders` and `/blockers` first page, p95 | < 1 s (SC-005) | _fill in_ |
| Snapshot of 1,000 at-risk orders on the 50k graph | < 2 min (SC-006) | _fill in_ |
| `GET /source-systems/freshness`, p95 | < 200 ms (research R18) | _fill in_ |
