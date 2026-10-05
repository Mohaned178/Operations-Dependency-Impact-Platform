# Quickstart: Core Operational Graph Model

These are the exact steps to validate this feature end to end. Local setup is unchanged from 001; the seed now also loads the §39 scenario.

## Local setup
```bash
pnpm install
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed      # users + §39 scenario (FR-035)
pnpm dev                              # api :3000, web :5173
```

## Quality gate (same as CI)
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build
RUN_PERF=1 pnpm test:e2e -- perf-graph   # SC-003 / SC-004 / SC-008, run locally before merge
```

## Manual validation script

1. **US1: Entity list.** Sign in as `analyst@opsgraph.local`. Click **Entities**. You see 44 entities. Filter by type = Order to get 20. Search `18492` to get Order #18492, shown as BLOCKED with source systems ERP and OMS. You should get there within 30 s (SC-001).
2. **US1: Entity detail.** Open Order #18492.
   - **Identity**: OMS `18492` and ERP `SO-18492`. Attributes include amount **12,480.00 USD**.
   - **Current state**: BLOCKED, from OMS, observed 29 Sep 2026 11:40 UTC (shown in your local time with the timezone). The "By source" list shows OMS BLOCKED and ERP PENDING. History has 4 entries.
   - **Relationships**: Acme Corp (PLACED, incoming), CON-3982 (GOVERNS), PAY-88213 (REQUIRES), WH-EAST-02 (FULFILLED_BY), SHP-77120 (DEPENDS_ON, incoming), PRD-5521, INV-55120. Each row has a `Source · HIGH` badge.
   - **Timeline**: order.created 09:12 → state PENDING (OMS) → payment.initiated 09:14 (related) → state WAITING (OMS) → state PENDING (ERP, 09:20) → warehouse.fulfillment_held 11:40 → state BLOCKED (OMS) → shipment.delayed 14:32 (related). At equal times, events come before state changes.
   - **Source records**: 4 records. Expand one to see the raw payload.
3. **US1: Inference labelling.** Open Product PRD-5521. The Contoso Metals relationship shows `Inferred · LOW` with its basis text. Open Shipment SHP-77120. The PAY-88213 BLOCKS relationship shows `Manual · MEDIUM`.
4. **US2: Chain.** From BR-18492 (MISSING), go to APR-2291 (BLOCKED, incoming REQUIRES), then PAY-88213 (PENDING), then Order #18492. That proves the chain can be followed hop by hop.
5. **US2: Idempotency.** Run `pnpm --filter api prisma db seed` again. Under Admin → Audit, no new `entity.*`, `relationship.*` or `event.*` entries appear, and the entity count is still 44.
6. **US3: Import as Admin.** Sign in as admin in the browser and copy the access token from devtools (Application → network response of `/api/auth/login`). Then:
   ```bash
   TOKEN=...   # admin access token
   curl -s -H "Authorization: Bearer $TOKEN" \
     -F format=csv -F kind=entities -F file=@docs/examples/import/entities.csv \
     -F dryRun=true localhost:3000/api/imports | jq '.outcome, .counts.entities'
   # "DRY_RUN", {received:3, created:3, ...}; nothing stored
   curl -s -H "Authorization: Bearer $TOKEN" \
     -F format=csv -F kind=entities -F file=@docs/examples/import/entities.csv \
     localhost:3000/api/imports | jq '.outcome'          # "APPLIED"
   ```
   Then edit a copy of `relationships.csv`, set one `type` to `PLACEDD`, and submit it. The result is `"REJECTED"`. `rowErrors[0]` has `row: 2`, `field: "type"`, and a message listing the allowed values. No relationship from that file appears in the UI.
7. **US3: Forbidden.** Repeat the curl with the analyst's token. You get 403, and the audit trail shows `auth.forbidden`.
8. **US3: Too large.** Submit a file larger than 10 MB. You get 413 `IMPORT_TOO_LARGE`, and the audit trail shows `import.refused`.
9. **US4: Multiple sources and history.** Import a JSON entity row for `Order` / `OMS` / `18492` with `observedAt` = `2026-09-29T08:00:00Z`, state `CANCELLED`, and the same `displayName` and amount/currency attributes. The report counts it as `updated`. The detail page shows the new observation in the history, and the current state stays BLOCKED (FR-022).
10. **Audit.** As admin, filter the audit trail by `import.applied`. Each import appears with its counts. Filter by target `entity` plus the Order's id to see `entity.observed` with before and after values.
11. **Append-only provenance.**
    ```bash
    docker compose exec db psql -U opsgraph -c "DELETE FROM source_records;"
    ```
    This fails with `source_records is append-only`.
