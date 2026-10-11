# Quickstart: Investigation Workspace

**Feature**: `008-investigation-workspace`

Use this to check the feature by hand after implementation. Exact expected values are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures; the automated suite asserts them. Features 004 to 007 must already be merged (plan.md § Prerequisites).

## 1. Set up

```bash
pnpm install
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev        # applies <timestamp>_investigations (renames exception_snapshots → analysis_snapshots)
pnpm --filter api prisma db seed            # users, §39, §40, teams + EX-10001, then INV-10001
pnpm dev                                    # api :3000, web :5173
```

The seed prints `investigations seeded` (or `investigations already present`). A second run creates nothing.

Check the snapshot generalization on the database:

```bash
docker compose exec db psql -U opsgraph -d opsgraph -c \
  "select kind, exception_id is not null as exc, investigation_id is not null as inv, root_cause_label from analysis_snapshots order by seq"
# 4 rows: EX-10001's ROOT_CAUSE + IMPACT (exc), INV-10001's ROOT_CAUSE + IMPACT (inv); both ROOT_CAUSE rows say "Budget Code Missing"
```

## 2. API checks

```bash
login() { curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"OpsGraph-Dev-2026!\"}" | jq -r .accessToken; }
MGR=$(login manager@opsgraph.local); ANA=$(login analyst@opsgraph.local); ADM=$(login admin@opsgraph.local)

# V1: the seeded reference investigation
INV=$(curl -s "localhost:3000/api/investigations?view=ALL" -H "authorization: Bearer $ANA" | jq -r '.items[0].id')
curl -s "localhost:3000/api/investigations/$INV" -H "authorization: Bearer $ANA" \
  | jq '.investigation.key, .currentPins.rootCause.payload.chosen.label, .currentPins.rootCause.payload.chosen.confidence,
        [.currentPins.rootCause.payload.chosen.chain[] | {n: .entity.displayName, r: .roles}],
        [.currentPins.impact.payload.categories[] | select(.type=="Order" or .type=="Customer" or .type=="SLA") | {type, total, current}],
        .currentPins.impact.payload.exposure.byCurrency[0].total.amount, [.linkedExceptions[].exception.key]'
# "INV-10001"  "Budget Code Missing"  "HIGH"  [Order #18492 SYMPTOM, PAY-88213 IMMEDIATE_BLOCKER, APR-2291, BR-18492]
# Order 17/17, Customer 4/4, SLA 4/3   "31400.00"   ["EX-10001"]

# V2: scope with reasons
curl -s "localhost:3000/api/investigations/$INV" -H "authorization: Bearer $ANA" \
  | jq '[.scope[] | {n: .entity.displayName, why: [.reasons[].text]}]'

# V3: the §19-style timeline
curl -s "localhost:3000/api/investigations/$INV/timeline?kind=EVENT" -H "authorization: Bearer $ANA" \
  | jq '[.items[] | "\(.item.at) \(.item.eventType)"]'

# V4 (start): pin the live root cause (now MEDIUM: stale evidence) — the seeded pin stays HIGH
curl -s -X POST "localhost:3000/api/investigations/$INV/pins" -H "authorization: Bearer $ANA" \
  -H 'content-type: application/json' -d '{"expectedVersion":1,"rootCause":{}}' \
  | jq '.investigation.version, .currentPins.rootCause.payload.chosen.confidence, .counts.pins'
curl -s "localhost:3000/api/investigations/$INV/pins?kind=ROOT_CAUSE" -H "authorization: Bearer $ANA" \
  | jq '[.items[] | {current, c: .payload.chosen.confidence, at: .takenAt}]'

# History = audit rows
curl -s "localhost:3000/api/investigations/$INV/history" -H "authorization: Bearer $ANA" | jq '[.items[].sentence]'
curl -s "localhost:3000/api/audit?targetType=investigation&targetId=$INV" -H "authorization: Bearer $ADM" | jq '.items | length'

# List views
curl -s "localhost:3000/api/investigations?view=SLA_RISK" -H "authorization: Bearer $MGR" | jq '.total, [.items[] | {key, sla}]'
curl -s "localhost:3000/api/investigations?view=MINE" -H "authorization: Bearer $ANA" | jq '[.items[].key]'

# Regression: the per-entity timeline is unchanged
curl -s "localhost:3000/api/entities/$(curl -s "localhost:3000/api/investigations/$INV" -H "authorization: Bearer $ANA" | jq -r .investigation.focus.id)/timeline" \
  -H "authorization: Bearer $ANA" | jq '.items | length'
```

## 3. Web checks (1366×768 window)

1. Sign in as **analyst@opsgraph.local** and open **Investigations**. It opens on **Open**; INV-10001 shows Critical, Open, owner Operations Analyst, root cause "Budget Code Missing (HIGH)", 17 orders, 4 customers, 31,400.00 USD, SLA indicator "3 SLA commitments at risk".
2. Open **INV-10001**. The **Overview** shows current state BLOCKED (live), root cause, immediate blocker Payment PAY-88213, the key numbers, key evidence, EX-10001, and "The live analysis differs from the pinned results: Confidence: pinned HIGH → live MEDIUM".
3. Open each tab in turn: **Graph** (explorer focused on Order #18492 with blocker paths and the list), **Root Cause** (live analysis with **Pin this result**, and the pinned list), **Impact** (anchor switch root cause / focus, **Pin**), **Timeline** (09:12 order created … 15:10 SLA at risk; filter by entity APR-2291), **Related Entities** (5 entities with reasons; add Acme Corp), **Evidence**, **Actions**, **Decisions**, **Notes**, **History**. Reload on any tab: the same tab opens.
4. On **Decisions**, record a decision citing Contract CON-3982 and APR-2291. Expand it: "Evidence at decision time" shows the pinned root cause (HIGH), the impact figures, Order #18492 BLOCKED and EX-10001's status.
5. In a second browser as **manager**, pin a new root cause. Back in the first browser, try to record another decision without reloading: the conflict message appears.
6. On **Actions**, select **Create exception**: 007's form opens pre-filled with Order #18492 and the pinned root cause. Create it; you return to the Actions tab with the new exception linked.
7. **Resolve** the investigation with a summary, then try **Close**: it is refused while EX-10001 is unresolved, naming it.
8. Open **Order #18492** on the Entity 360 page: the **Investigations** section lists INV-10001 with the reason "Focus"; **Start investigation** opens the form with the title "Why is Order #18492 blocked?" and lists INV-10001 as an existing investigation.
9. Open **Shipment SHP-77120**: its Investigations section lists INV-10001 with the reason "Subject of EX-10001".

## 4. Gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
RUN_PERF=1 pnpm --filter api test:e2e -- perf-investigations     # SC-005, record below
```

| Measurement (10,000 investigations, 20 runs) | Target | Recorded |
|---|---|---|
| `GET /investigations` first page, every view × sort, p95 | < 1 s (SC-005) | _fill in_ |
| `GET /investigations/:id` p95 | < 2 s (SC-005) | _fill in_ |
| `GET /investigations/:id/timeline` first page, 100-entity scope, p95 | < 1 s (SC-005) | _fill in_ |
| `POST /investigations/:id/pins` (both kinds) p95 | < 5 s (research R18) | _fill in_ |
