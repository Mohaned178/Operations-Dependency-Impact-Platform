# Quickstart: Graph Explorer

## Setup

```bash
pnpm install                       # picks up @xyflow/react
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev && pnpm --filter api prisma db seed
pnpm dev                           # api :3000, web :5173
```

No migration is added by this feature.

## API smoke check

```bash
TOKEN=...   # from POST /api/auth/login
ORDER=...   # id of Order #18492: GET /api/entities?q=18492
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/entities/$ORDER/neighborhood" | jq '{n: (.nodes|length), e: (.edges|length), omitted: .totals.omitted}'
# → {"n":32,"e":60,"omitted":0}   (contracts/api.md fixture N1)

curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/entities/$ORDER/neighborhood?blockers=true" | jq '[.nodes[1:4][].displayName]'
# → ["Payment PAY-88213","Finance approval APR-2291","Budget code for Order #18492"]   (N2)
```

## Manual walkthrough (spec SC-001, SC-004)

1. Sign in, open **Entities → Shipment SHP-77120**, select **Open in Graph Explorer**.
2. Check the header reads `Shipment SHP-77120 (consolidated) — all directions, 2 steps: 35 entities, 86 relationships`.
3. Turn on **Highlight blockers**. The Budget code appears (marked *Blocking path*, *Deepest blocker*), off-path elements dim, and the right column shows the same summary and explanation as Entity 360.
4. Select **Path 2**: only the path through the dotted MANUAL `BLOCKS` edge stays red, labelled `Manual · MEDIUM`.
5. Click the Budget code: the side panel shows MISSING, source FinanceApprovals, *Blocked by* none, *Blocks* Finance approval APR-2291, and source records. Target: steps 1–5 under 30 s.
6. Select **Explore from here** on Payment PAY-88213, then the browser **Back** button: you return to the shipment.
7. Open the Budget code with **Downstream only**, **Steps 4**, entity types **Order, Shipment**: 21 entities; APR-2291 and PAY-88213 show as dashed *Connector* nodes.
8. Copy the URL into another signed-in browser session: same view.
9. **Performance (SC-004)**: with `RUN_PERF=1` data loaded, open the highest-degree warehouse. Expect `Showing 200 of … entities — … more`. Pan, zoom and click nodes: each response should feel immediate (< 100 ms). Record the browser and machine in the table below.

## Automated gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
RUN_PERF=1 pnpm --filter api test:e2e -- perf-explorer   # SC-003
```

## Recorded timings

| Date | Machine | Default neighborhood p95 | Expansion p95 | 200-node interaction |
|---|---|---|---|---|
| _fill in after phase "Performance"_ | | | | |
