# Quickstart: Root-Cause Analysis

**Feature**: `005-root-cause-analysis`

Use this to check the feature by hand after implementation. Exact expected values are in [contracts/api.md](./contracts/api.md) § Acceptance fixtures. The automated suite asserts them.

## 1. Set up

```bash
pnpm install
docker compose up -d db
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev        # applies <timestamp>_evidence_notes
pnpm --filter api prisma db seed
pnpm dev                                    # api :3000, web :5173
```

## 2. API checks

Sign in as the seeded analyst. Use the access token as `$T`, and look up the entity ids through `GET /api/entities?q=…`.

```bash
# R1: root cause of Order #18492, pinned evaluation time
curl -s -H "Authorization: Bearer $T" \
  "http://localhost:3000/api/entities/$ORDER/root-cause?evaluatedAt=2026-09-29T16:00:00Z" | jq '.summary, .candidates[0].label, .candidates[0].confidence'
# "Order #18492 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH)."
# "Budget Code Missing"
# "HIGH"

# R6: same, evaluated now → stale evidence lowers confidence
curl -s -H "Authorization: Bearer $T" \
  "http://localhost:3000/api/entities/$ORDER/root-cause" | jq '.candidates[0].confidence, [.candidates[0].confidenceRules[] | select(.applied) | .rule]'
# "MEDIUM"
# ["WEAKEST_LINK","STALE_EVIDENCE"]

# R5: unexplained state
curl -s -H "Authorization: Bearer $T" "http://localhost:3000/api/entities/$ORDER_18532/root-cause" | jq '.status, .summary'

# R7: dispute a link, then retract it
curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d "{\"target\":{\"kind\":\"RELATIONSHIP\",\"relationshipId\":\"$REL_APR_BR\"},\"stance\":\"DISPUTES\",\"text\":\"Approval record is out of date\"}" \
  http://localhost:3000/api/evidence-notes | jq '.id, .active'
# then: R1 shows DISPUTED applied and MEDIUM; POST /api/evidence-notes/<id>/retract {"reason":"…"} restores HIGH
```

Check the audit trail as admin with `GET /api/audit?action=evidence_note.created`. There is exactly one row per note created.

## 3. Web checks (1366×768 window)

1. Open **Order #18492**.
   - The header callout shows the root-cause summary, the headline "Root cause: Budget Code Missing. Confidence: …" and the 3 chain sentences, without scrolling.
   - The sections appear in this order: Identity, Current state, **Root cause**, Blockers, Dependencies, Relationships, Timeline, Source records.
2. In **Root cause**:
   - steps show the role badges Symptom, Immediate Blocker, Upstream Cause and Root Cause;
   - expanding the Budget code step shows its evidence grouped as State record, Requirement source (Contract CON-3982 with its clause), Events (1) and Notes;
   - expanding Confidence shows all 8 rules with their outcomes.
3. Open **Shipment SHP-77120**. The alternative chain through the manual BLOCKS link is listed and labeled "manually recorded, medium confidence".
4. Add a **Disputes** note on the "Finance approval APR-2291 REQUIRES Budget code…" link.
   - Confidence drops one level, and the reason quotes the note.
   - Retract it as its author: confidence returns, and the note shows as retracted.
   - Sign in as another analyst: the retract button is not shown on that note.
5. Open **Warehouse WH-EAST-02**. The Root cause section is a single line: "…It is not blocked…".

## 4. Gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
RUN_PERF=1 pnpm --filter api test:e2e -- perf-root-cause   # record p95 below
```

| Measurement (50k entities / 150k relationships, 6-hop chain, 20 runs) | Target | Recorded |
|---|---|---|
| `GET /root-cause` p95 | < 1.5 s (SC-003) | 55 ms (runs 30–69 ms; 2026-10-11, local Docker Postgres 16) |

The dataset is the `perf-tracing` graph plus the evidence tables: one state observation and source record per entity, one source record per relationship, one event per entity, and 25 extra events on each chain entity (so the 20-event cap is exercised). The index check in research R13 was not needed because the budget was met with a wide margin.
