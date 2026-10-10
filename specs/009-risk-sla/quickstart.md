# Quickstart: Risk Detection and SLA Management

**Feature**: `009-risk-sla`

Use this to check the feature by hand after implementation. Exact expected values are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures. The automated suite asserts them. Features 005–008 must already be merged (plan.md § Prerequisites).

## 1. Set up

```bash
pnpm install
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev        # applies <timestamp>_risk_sla
pnpm --filter api prisma db seed            # users, §39, §40, 007, 008, then risk config v1 + SLA term SHIP-24H
RISK_SCHEDULER_ENABLED=false pnpm dev       # api :3000, web :5173; scheduler off so the pinned evaluations below are accepted
```

The seed prints `risk seeded`, or `risk already present` on a second run, which creates nothing. The seed never runs an evaluation.

With the scheduler on (the default), the first evaluation runs about 10 s after start, as of the real current time. A later manual evaluation as of 2026-09-30 is then refused, because evaluation times must never move backwards. Previews accept any time.

## 2. API checks

```bash
login() { curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"OpsGraph-Dev-2026!\"}" | jq -r .accessToken; }
ADM=$(login admin@opsgraph.local); ANA=$(login analyst@opsgraph.local)
T1=2026-09-29T16:00:00Z; T2=2026-09-30T03:12:00Z
ORDER=$(curl -s "localhost:3000/api/entities?q=Order%20%2318492" -H "authorization: Bearer $ANA" | jq -r '.items[0].id')

# K6: the order's SLA commitment at T2
curl -s "localhost:3000/api/sla-clocks?entityId=$ORDER&asOf=$T2" -H "authorization: Bearer $ANA" \
  | jq '.items[0] | {status, remainingPercent, sentence}'          # AT_RISK, "25%"

# K1 via preview (no writes; any time)
curl -s "localhost:3000/api/risk-preview?entityId=$ORDER&asOf=$T2" -H "authorization: Bearer $ANA" \
  | jq '.rules[0].assessment | {level, score, confidence, factors: [.factors[] | {key, points, contribution}]}'
# HIGH 73 HIGH; points 80, 100, 0, 50, 100

# K9: persisted evaluations (scheduler off)
curl -s -X POST localhost:3000/api/risk-evaluations -H "authorization: Bearer $ADM" \
  -H 'content-type: application/json' -d "{\"asOf\":\"$T1\"}" | jq '.status, .counts'
curl -s -X POST localhost:3000/api/risk-evaluations -H "authorization: Bearer $ADM" \
  -H 'content-type: application/json' -d "{\"asOf\":\"$T2\"}" | jq '.counts'
curl -s "localhost:3000/api/risks?sort=SCORE&limit=10" -H "authorization: Bearer $ANA" \
  | jq '.latestEvaluation.asOf, [.items[] | {key, level, score, confidence, entity: .entity.displayName, type}]'
curl -s "localhost:3000/api/risk-alerts?days=90" -H "authorization: Bearer $ANA" | jq '[.items[].sentence]'

# Analysts cannot evaluate or configure
curl -s -X POST localhost:3000/api/risk-evaluations -H "authorization: Bearer $ANA" | jq '.error.code'   # "FORBIDDEN"

# Determinism (SC-002): 20 previews, one distinct body
for i in $(seq 20); do curl -s "localhost:3000/api/risk-preview?entityId=$ORDER&asOf=$T2" -H "authorization: Bearer $ANA" | sha256sum; done | sort -u | wc -l   # 1
```

## 3. Web checks (1366×768 window)

1. Sign in as **analyst**. Open **Risks & Alerts**. The header says "As of evaluation #2, 2026-09-30T03:12:00Z". The list is sorted by score: the payment and approval risks (94) first, then Fabrikam Components (80), then Order #18492 (73).
2. Open Order #18492's risk. Check:
   - the five factors with weight, points and contribution, and the sum line "28.0 + 25.0 + 0.0 + 5.0 + 15.0 = 73";
   - confidence HIGH with its reason;
   - "may be understated: Warehouse utilization not available";
   - the evidence (OMS order.created, Payments PAY-88213);
   - the assessment history (MEDIUM 40, then HIGH 73).

   Select **Preview now**: it shows the live result as of the current time. Follow the links to Entity 360 and to its Impact section.
3. Open Shipment SHP-77120's High downstream dependency risk. Confidence is MEDIUM, and the reason names the SLA commitments reached only through inferred links.
4. On the **SLA commitments** tab, filter to At risk and Breached. Open Acme Corp delivery SLA: the disagreement sentence shows ContractMgmt's AT_RISK next to the computed status.
5. Open **Order #18492** on Entity 360. The header shows **Risk HIGH**. The **Risk & SLA** section sits after Impact and before Exceptions, with the SHIP-24H clock. The Exceptions section's column reads "Resolution SLA". Open **Contract CON-3982**: the section lists SHIP-24H with its clock counts.
6. Sign in as **admin**. Open **Admin → Risk rules**:
   - enter weights for Payment unresolved too long that sum to 99: the form refuses them;
   - change a band and save with a note: the version becomes 2;
   - open **Audit** and find `risk.config_updated` with the rule before and after.
7. In **Admin → SLA terms**, edit SHIP-24H (window 48 h): the audit shows before and after. Deactivate it: the order's clocks disappear at the next evaluation. Reactivate it.
8. Enable **auto-create exception** for Payment unresolved too long, with owner Finance Operations. Select **Evaluate now** (no time, so as of now). Check that:
   - a new exception "Payment PAY-88213: Payment unresolved too long (RSK-…)" appears, created by System from the risk;
   - the manager's bell shows the assignment;
   - Budget code for Order #18492 is listed as skipped (linked to EX-10001).

## 4. Gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
RUN_PERF=1 pnpm --filter api test:e2e -- perf-risk     # SC-004, record below
```

| Measurement (20 runs) | Target | Recorded |
|---|---|---|
| Full evaluation, 50k entities / ≥ 150k relationships | < 2 min (SC-004) | _fill in_ |
| `GET /risks` first page, 10k open risks, every sort, p95 | < 1 s (SC-004) | _fill in_ |
| `GET /risk-preview` for a hub supplier, p95 | < 2 s (SC-004) | _fill in_ |
| `GET /sla-clocks` first page, 10k governed orders, p95 | < 1 s (research R21) | _fill in_ |
