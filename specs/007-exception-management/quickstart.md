# Quickstart: Exception Management and Ownership

**Feature**: `007-exception-management`

Use this to check the feature by hand after implementation. Exact expected values are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures; the automated suite asserts them. Features 005 and 006 must already be merged (plan.md § Prerequisites).

## 1. Set up

```bash
pnpm install
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev        # applies <timestamp>_exceptions_teams_notifications
pnpm --filter api prisma db seed            # users, §39, §40, then teams + the §16 reference exception
pnpm dev                                    # api :3000, web :5173
```

The seed prints `exceptions seeded` (or `exceptions already present`). A second run creates nothing.

## 2. API checks

```bash
login() { curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"OpsGraph-Dev-2026!\"}" | jq -r .accessToken; }
MGR=$(login manager@opsgraph.local); ANA=$(login analyst@opsgraph.local); ADM=$(login admin@opsgraph.local)

# X2: the seeded reference exception
EX=$(curl -s "localhost:3000/api/exceptions?view=ALL" -H "authorization: Bearer $ANA" | jq -r '.items[0].id')
curl -s "localhost:3000/api/exceptions/$EX" -H "authorization: Bearer $ANA" \
  | jq '.exception.key, .exception.owner.team.name, .rootCause.payload.chosen.label, .rootCause.payload.chosen.confidence,
        [.impact.payload.categories[] | select(.type=="Order" or .type=="Customer") | .total], .impact.payload.exposure.byCurrency[0].total.amount'
# "EX-10001"  "Finance Operations"  "Budget Code Missing"  "HIGH"  [17,4]  "31400.00"

# X3: the manager's notification
curl -s localhost:3000/api/notifications -H "authorization: Bearer $MGR" | jq '.items[0].message'

# X4 (start): the analyst is refused, the manager (Finance Operations member) can start work
curl -s -X POST "localhost:3000/api/exceptions/$EX/transitions" -H "authorization: Bearer $ANA" \
  -H 'content-type: application/json' -d '{"action":"START","expectedVersion":1}' | jq '.error.code'      # "FORBIDDEN"
curl -s -X POST "localhost:3000/api/exceptions/$EX/transitions" -H "authorization: Bearer $MGR" \
  -H 'content-type: application/json' -d '{"action":"START","expectedVersion":1}' | jq '.exception.status, .exception.version'

# History = audit rows
curl -s "localhost:3000/api/exceptions/$EX/history" -H "authorization: Bearer $ANA" | jq '[.items[].sentence]'
curl -s "localhost:3000/api/audit?targetType=exception&targetId=$EX" -H "authorization: Bearer $ADM" | jq '.items | length'

# X8-style list views
curl -s "localhost:3000/api/exceptions?view=SLA_AT_RISK&sort=SEVERITY" -H "authorization: Bearer $MGR" | jq '.total, [.items[] | {key, sla: .sla.status}]'
```

## 3. Web checks (1366×768 window)

1. Sign in as **manager@opsgraph.local**. The header bell shows **1**. Open it: "System assigned EX-10001 … to Finance Operations." Select it; the exception opens and the bell drops to 0.
2. On **EX-10001**, check the header (Critical, P1, Open, Finance Operations, SLA countdown) and the Overview tab: root cause "Budget Code Missing" (HIGH, analyzed 2026-09-29T16:00Z) and impact of Budget code for Order #18492 (17 customer orders, 4 customers, 31,400.00 USD).
3. Select **Start work**, then **Wait** with a reason, then **Resolve** with a note. Only the allowed actions are shown at each step. Then sign in as **admin** and **Verify**, then **Close**. Sign in as **analyst** and **Reopen** with a reason.
4. Open the **History** tab: every step is listed with actor, time, sentence and before → after values.
5. Open **Exceptions**: it opens on **Unresolved**, sorted by SLA due. Switch to **Critical**, **Assigned to me**, **My teams** and **SLA at risk**; copy the address and open it in another browser: the same list appears.
6. Open **Shipment SHP-77120** on the Entity 360 page. The header says "1 unresolved exception"; the **Exceptions** section sits after Impact and before Dependencies. In the Root cause section, select **Create exception from this root cause**: the form shows the suggested type "Shipment delay", the title "Shipment SHP-77120 (consolidated) Delayed", and the existing EX-10001 as a possible duplicate.
7. As the analyst, create it with severity **Medium** and owner **Finance Operations**. In another browser signed in as the manager, the bell shows the assignment within 30 seconds. As the manager, **Escalate** it to **High** with owner **Warehouse Operations** and a reason: priority becomes P2, the SLA due time tightens, and the analyst's bell shows the escalation within 30 seconds.
8. As **admin**, open **Admin → Teams**: create a team, rename it, add and remove a member. As the analyst, the Teams admin page is refused.

## 4. Gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
RUN_PERF=1 pnpm --filter api test:e2e -- perf-exceptions     # SC-005, record below
```

| Measurement (10,000 exceptions, 20 runs) | Target | Recorded |
|---|---|---|
| `GET /exceptions` first page, every view × sort, p95 | < 1 s (SC-005) | _fill in_ |
| `GET /exceptions/:id` p95 | < 2 s (SC-005) | _fill in_ |
| `GET /notifications/unread-count` p95 | < 100 ms (research R18) | _fill in_ |
