# Quickstart: Impact Analysis

This guide is for verifying the feature by hand and in CI after implementation. It assumes the 001–003 setup works (`pnpm install`, Docker DB, `.env`).

## 1. Migrate and seed

```bash
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev          # applies <ts>_purchase_order_entity_type
pnpm --filter api prisma db seed              # §39 + §40 datasets; idempotent
```

The seed prints `§39 scenario seeded` (or `already present`) and `§40 scenario seeded` (or `already present`). A second run creates nothing.

## 2. Try the API

Sign in and capture a token, then look up ids from the entity list.

```bash
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"manager@opsgraph.local","password":"OpsGraph-Dev-2026!"}' | jq -r .accessToken)
SUP=$(curl -s "localhost:3000/api/entities?q=Fabrikam" -H "authorization: Bearer $TOKEN" | jq -r '.items[0].id')

# Summary: expect contracts/api.md fixture I1
curl -s "localhost:3000/api/entities/$SUP/impact" -H "authorization: Bearer $TOKEN" | jq '.summary, .categories, .exposure'

# Drill down: current customer orders (fixture I2)
curl -s "localhost:3000/api/entities/$SUP/impact/items?list=category&type=Order&bucket=current" \
  -H "authorization: Bearer $TOKEN" | jq '.total, [.items[] | {name: .entity.displayName, value: .value.current, paths: .pathCount}]'

# Exposure list adds up to the figure (fixture I2)
curl -s "localhost:3000/api/entities/$SUP/impact/items?list=exposure&currency=USD&bucket=current" \
  -H "authorization: Bearer $TOKEN" | jq '.sum, [.items[].value.current.amount]'
```

## 3. Try the UI

`pnpm dev`, then sign in as `manager@opsgraph.local`.

1. **Entities**: search for "Fabrikam" and open **Fabrikam Components**.
2. **Placement**: the **Impact** section sits after Blockers and before Dependencies. Check its summary and table against fixture I1.
3. **Drill-down**: select **6** in *Customer orders / Current*. The list opens in place and the address gains `ilist=category.Order.current`. Expand **SO-20404**: 6 paths are shown, with 5 alternatives.
4. **Exposure**: select **51,250.00 USD**. The list total row equals the figure.
5. **Depth**: change the depth to 3. The address gains `idepth=3`, and a "lower bounds" sentence appears if impact continues further.
6. **Shared link**: copy the address and open it in another browser as `analyst@opsgraph.local`. The same depth, list and results appear.
7. **Empty case**: open **Invoice INV-55120**. The Impact section is one line: "Nothing is affected within 6 steps."
8. **Other entities**: open **Payment PAY-88213** and **East Distribution Center 02**. Compare them with fixtures I6 and I9; the warehouse shows no current impact.

## 4. Gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
RUN_PERF=1 pnpm --filter api test:e2e -- perf-impact      # SC-003, records timings below
```

## 5. Performance record (fill in after T-perf)

| Measure | Budget | p95 | Runs |
|---|---|---|---|
| `GET /impact` (hub supplier, ≥ 2,000 reached) | < 2,000 ms | _tbd_ | 20 |
| `GET /impact/items` first page (`category.Order.total`) | < 2,000 ms | _tbd_ | 20 |
| `GET /impact/items` first page (`exposure.USD.total`) | < 2,000 ms | _tbd_ | 20 |
