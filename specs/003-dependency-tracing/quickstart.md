# Quickstart: Dependency Tracing & Entity 360

These are the exact steps to validate this feature end to end. Local setup is unchanged from 002. There are no new migrations, and the seed is unchanged.

## Local setup
```bash
pnpm install
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed      # users + §39 scenario
pnpm dev                              # api :3000, web :5173
```

## Quality gate (same as CI)
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build
RUN_PERF=1 pnpm --filter api test:e2e -- perf-tracing   # SC-003 / SC-004; run locally before merge
```

## Manual validation script

1. **US1: Blockers of a shipment.** Sign in as `analyst@opsgraph.local`. Open **Entities**, search `SHP-77120`, and open it.
   - Under the title, the callout reads `Shipment SHP-77120 (consolidated) is DELAYED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 4 steps away.`, followed by the four sentences of contracts/api.md F1 `paths[0]`.
   - At 1366×768 the callout is visible without scrolling (FR-028).
   - Click **See all blocking paths**. The Blockers section shows Path 1 (all `Source · HIGH`) and Path 2, whose first hop carries a `Manual · MEDIUM` badge and the analyst's basis in the sentence.
   - Expand **Evidence** on the Order #18492 hop. You see the DEPENDS_ON assertion (TMS, `DEPENDS_ON:SHP-77120:18492`, observed 29 Sep 2026 15:00 UTC), `State: Blocked — reported by OMS`, and **Sources disagree**: ERP Pending, OMS Blocked.
   - Click **Budget code for Order #18492** in a sentence. Its Entity 360 page opens.
2. **US1: Order and SLA.**
   - Open Order #18492. The callout's first sentence is `Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.`
   - Open **Acme Corp delivery SLA**. The first sentence mentions `(inferred, medium confidence: "SLA measures on-time delivery…")`.
3. **US1: No blockers.** Open **East Distribution Center 02**. There is no callout. The Blockers section is one line: `East Distribution Center 02 is ACTIVE. No blockers found within 6 steps.`
4. **US2: Downstream.** Open **Budget code for Order #18492** and switch Dependencies to **Downstream**.
   - The list shows 25 entities. Payment PAY-88213 shows `2 steps`, and Shipment SHP-77120 shows `3 steps · path shown: 4 steps`.
   - Tick entity type **Order**. The list shows 17 orders.
   - The URL now contains `dep=downstream&types=Order`. Copy it into a private window, sign in as `manager@opsgraph.local`, and confirm the same tab, filter and 17 results (FR-030).
   - Set depth to 2. The list shows 2 entities, with a notice that more exist beyond depth 2.
5. **US2: Upstream.** Open Order #18492 and choose **Upstream**. The list shows 9 entities. Contoso Metals' path ends with an `Inferred · LOW` badge.
6. **US3: Section order.** On any entity, the sections run Identity → Current state → Blockers → Dependencies → Relationships → Timeline → Source records. There is no graph diagram, and no risks, exceptions or impact sections.
7. **API spot checks** (copy an access token as in 002's quickstart):
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" "localhost:3000/api/entities/<SHP id>/blockers" | jq '.summary, (.paths | length)'
   curl -s -H "Authorization: Bearer $TOKEN" "localhost:3000/api/entities/<SHP id>/blockers?depth=11" | jq '.error.details'
   # [{"path":"depth","message":"Number must be less than or equal to 10"}]
   curl -s -H "Authorization: Bearer $TOKEN" \
     "localhost:3000/api/entities/<BR id>/dependencies?direction=downstream&relationshipTypes=RELATES_TO" | jq '.error.details[0].path'
   # "relationshipTypes.0"
   ```
8. **Read-only check.** Under Admin → Audit, no new entries appear after steps 1–7.

## Performance

Record the measured p95 values here after the first `RUN_PERF=1` run:

| Measurement | Budget | Measured |
|---|---|---|
| Blockers, 6-hop chain, 50k entities / 150k relationships | < 1,000 ms | _tbd_ |
| Downstream of chain-0 Budget requirement (g=6) | < 2,000 ms | _tbd_ |
| Downstream of a hub warehouse (g=7) | < 2,000 ms | _tbd_ |
| Upstream of chain-0 Shipment (g=0) | < 2,000 ms | _tbd_ |
