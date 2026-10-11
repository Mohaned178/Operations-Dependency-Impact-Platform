# API Contract: Home Overview and Search

**Feature**: `010-home-dashboard-search` | **Date**: 2026-10-07

All schemas live in `@opsgraph/shared`:
- `packages/shared/src/overview.ts` (constants, snapshot payloads: data-model §2a–§2b; overview, snapshot, at-risk order, blocker, frequent root cause and freshness schemas below);
- `packages/shared/src/search.ts` (search and entity finder schemas);
- `packages/shared/src/saved-filters.ts` (saved and built-in filters).

All three are re-exported from `index.ts`. The backend validates every request with them, and the web app parses every response with them. Reused unchanged: `EntityRefDtoSchema`, `IdentifierDtoSchema`, `EntityListResponseSchema`, `PageQuerySchema`, `ConfidenceSchema`, `EntityTypeSchema`, `OperationalStateSchema` (002); 007's `ExceptionSummaryDtoSchema`, `ExceptionStatusSchema`, `ExceptionSeveritySchema`, `ExceptionEntityRoleSchema`, `csv`, `formatDuration`, `formatExceptionNumber`; 008's `InvestigationSummaryDtoSchema`, `InvestigationStatusSchema`; 009's `RiskSummaryDtoSchema`, `SlaClockDtoSchema`, `RiskLevelSchema`, `RiskTypeSchema`, `SLA_STATUS_LABELS`; 006's money formatting (`formatAmount`, `formatMoneyText`, `CURRENCY_PATTERN`).

---

## Routes

| # | Method | Path | Roles | Success | Errors |
|---|---|---|---|---|---|
| 1 | GET | `/api/overview` | all signed-in | 200 `OverviewResponse` | 400, 401 |
| 2 | GET | `/api/overview/at-risk-orders` | all signed-in | 200 `AtRiskOrderListResponse` | 400, 401, 404 (snapshot) |
| 3 | GET | `/api/overview/blockers` | all signed-in | 200 `BlockerListResponse` | 400, 401, 404 (snapshot) |
| 4 | GET | `/api/overview/frequent-root-causes` | all signed-in | 200 `FrequentRootCauseListResponse` | 400, 401 |
| 5 | GET | `/api/overview/snapshots` | all signed-in | 200 `SnapshotListResponse` | 400, 401 |
| 6 | POST | `/api/overview/snapshots` | ADMIN | 201 `SnapshotDto` | 401, 403, 409 `SNAPSHOT_IN_PROGRESS`, `NO_RISK_EVALUATION` |
| 7 | GET | `/api/source-systems/freshness` | all signed-in | 200 `SourceFreshnessResponse` | 400, 401 |
| 8 | GET | `/api/search` | all signed-in | 200 `SearchResponse` | 400, 401 |
| 9 | GET | `/api/entity-finder` | all signed-in | 200 `EntityFinderResponse` | 400, 401 |
| 10 | GET | `/api/saved-filters` | all signed-in | 200 `SavedFilterListResponse` | 401 |
| 11 | POST | `/api/saved-filters` | all signed-in | 201 `SavedFilterDto` | 400, 401, 409 `SAVED_FILTER_NAME_TAKEN`, `SAVED_FILTER_LIMIT` |
| 12 | PATCH | `/api/saved-filters/:id` | owner | 200 `SavedFilterDto` | 400, 401, 404, 409 `SAVED_FILTER_NAME_TAKEN` |
| 13 | DELETE | `/api/saved-filters/:id` | owner | 204 | 400, 401, 404 |
| 007 | GET | `/api/exceptions` | unchanged | unchanged | + 400 on `rootCauseLabel` / `rootCauseWindowEnd` |

**Controllers**: `OverviewController` (route 1), `AtRiskOrdersController` (2), `BlockersController` (3), `FrequentRootCausesController` (4), `SnapshotsController` (5, 6) in `apps/api/src/overview/`; `SourceSystemsController` (7, existing, in `graph`; `@Get('freshness')` declared before any `:param` route); `SearchController` (8), `EntityFinderController` (9), `SavedFiltersController` (10–13) in `apps/api/src/search/`. `@Roles('ADMIN')` on 6, so `RolesGuard` audits refusals. Path ids use `ParseUUIDPipe`; queries and bodies use `ZodValidationPipe`. Routes 1, 4, 7 and 9 read `now` once in the controller.

**Error codes** (new in `ErrorCodeSchema`, with `Errors` factories):

| Code | Status | Message | When |
|---|---|---|---|
| `SNAPSHOT_IN_PROGRESS` | 409 | `A revenue-at-risk snapshot is already running (#N, started <iso>)` | route 6 while a RUNNING row exists (research R3) |
| `NO_RISK_EVALUATION` | 409 | `No risk evaluation has completed yet` | route 6 before any COMPLETED evaluation |
| `SAVED_FILTER_NAME_TAKEN` | 409 | `You already have a saved filter named "<name>"` | routes 11, 12 (`P2002`) |
| `SAVED_FILTER_LIMIT` | 409 | `You can keep at most 50 saved filters` | route 11 |

---

## Audit rows

As research R15. Reads write nothing. Route 6 writes `overview.snapshot_completed` (or `_failed`) with `actorType 'user'`; automatic snapshots write them with `actorType 'system'`. Pruning writes `overview.snapshots_pruned` only when it deletes at least one snapshot. A no-op `PATCH` (same name and criteria) returns 200 and writes nothing.

---

## Request schemas

```ts
// overview.ts
const isoUtc = z.string().datetime();
export const OverviewQuerySchema = z.object({ evaluatedAt: isoUtc.optional() });     // routes 1, 4, 7
export const AtRiskOrderListQuerySchema = z.object({
  snapshotId: z.string().uuid().optional(),                    // default: latest COMPLETED
  category: CauseCategorySchema.optional(),
  currency: z.string().regex(CURRENCY_PATTERN).optional(),
  valueUnknown: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),   // excludes currency (400 on valueUnknown)
  rootCauseEntityId: z.string().uuid().optional(),             // blocker drill-down
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const BlockerListQuerySchema = z.object({
  snapshotId: z.string().uuid().optional(), cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const SnapshotListQuerySchema = PageQuerySchema;           // newest first, cursor = number

// search.ts
export const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  groups: csv(z.enum(SEARCH_GROUPS)),                          // default: all
  entityTypes: csv(EntityTypeSchema),                          // only with ENTITY in groups (400 on entityTypes)
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const EntityFinderQuerySchema = /* data-model §2c */;

// saved-filters.ts
export const CreateSavedFilterRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  criteria: StoredCriteriaSchema,                              // at least one criterion (400 on criteria)
}).strict();
export const UpdateSavedFilterRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  criteria: StoredCriteriaSchema.optional(),
}).strict().refine((b) => b.name !== undefined || b.criteria !== undefined, { message: 'Nothing to change', path: [] });

// 007 exceptions.ts (addition)
ExceptionListQuerySchema += {
  rootCauseLabel: z.string().trim().min(1).max(200).optional(),
  rootCauseWindowEnd: isoUtc.optional(),                       // both or neither (superRefine, issue on the missing one)
};
```

---

## Response schemas

```ts
// overview.ts
export const DrillTargetSchema = z.object({
  kind: z.enum(['EXCEPTIONS', 'INVESTIGATIONS', 'RISKS', 'SLA_CLOCKS', 'AT_RISK_ORDERS', 'BLOCKERS',
                'FREQUENT_ROOT_CAUSES', 'ENTITY_FINDER']),
  query: z.record(z.string()),          // API query parameters of that list (research R13); e2e: parses with the list's schema
});
export const FigureSchema = z.object({ value: z.number().int().min(0), drill: DrillTargetSchema });
export const MoneyDtoSchema = z.object({ amount: z.string(), currency: z.string().length(3), text: z.string() });  // "51250.00", "USD", "51,250.00 USD"
export const MoneyFigureSchema = MoneyDtoSchema.extend({ drill: DrillTargetSchema });

const section = <T extends z.ZodTypeAny>(data: T) => z.discriminatedUnion('status', [
  z.object({ status: z.literal('OK'), data }),
  z.object({ status: z.literal('UNAVAILABLE'), reason: z.string() }),
]);

export const SnapshotRefSchema = z.object({
  id: z.string().uuid(), number: z.number().int(), trigger: z.enum(['AFTER_EVALUATION', 'MANUAL']),
  asOf: isoUtc, finishedAt: isoUtc, consistent: z.boolean(),
  riskEvaluation: z.object({ id: z.string().uuid(), number: z.number().int() }),
});

export const RevenueAtRiskDtoSchema = z.object({
  snapshot: SnapshotRefSchema,
  orderCount: z.number().int(), notAnalyzedCount: z.number().int(), failedCount: z.number().int(),
  currencies: z.array(z.object({
    currency: z.string().length(3), total: MoneyFigureSchema, orderCount: z.number().int(),
    range: z.object({ low: MoneyDtoSchema, high: MoneyDtoSchema }).nullable(),
    categories: z.array(z.object({
      category: CauseCategorySchema, label: z.string(), amount: MoneyFigureSchema, orderCount: z.number().int(),
      lowConfidence: MoneyDtoSchema, disagreement: MoneyDtoSchema,
    })).length(5),
  })),
  categoryOrders: z.array(z.object({ category: CauseCategorySchema, label: z.string(), orders: FigureSchema,
                                     valueUnknownCount: z.number().int() })).length(5),
  valueUnknown: FigureSchema,
  staleSources: z.array(z.string()),
  categoryMapping: z.record(EntityTypeSchema, CauseCategorySchema),
  sentences: z.array(z.string()),                              // § Revenue sentences
});

export const BlockerDtoSchema = z.object({
  entity: EntityRefDtoSchema, label: z.string(), category: CauseCategorySchema,
  orders: FigureSchema,                                        // drill: AT_RISK_ORDERS with rootCauseEntityId
  valueUnknownCount: z.number().int(), amounts: z.array(MoneyDtoSchema),
  confidences: z.object({ HIGH: z.number().int(), MEDIUM: z.number().int(), LOW: z.number().int() }),
  exceptions: z.array(z.object({ id: z.string().uuid(), key: z.string(), title: z.string(),
                                 status: ExceptionStatusSchema, severity: ExceptionSeveritySchema,
                                 role: ExceptionEntityRoleSchema })).max(3),
  exceptionTotal: z.number().int(),
  sentence: z.string(),
  links: z.object({ entity: z.string(), impact: z.string(), graph: z.string() }),   // /entities/:id, /entities/:id#impact, /graph/:id
});

export const FrequentRootCauseDtoSchema = z.object({
  label: z.string(), exceptionCount: FigureSchema,              // drill: EXCEPTIONS view=ALL&rootCauseLabel&rootCauseWindowEnd
  rootCauseEntityCount: z.number().int(), unresolvedExceptionCount: z.number().int(),
  recurring: z.boolean(), recurrenceText: z.string().nullable(), // 008's text when recurring
  sentence: z.string(),
});

export const SourceFreshnessDtoSchema = z.object({
  sourceSystem: z.string(), newestObservedAt: isoUtc, newestReceivedAt: isoUtc,
  ageMs: z.number().int().min(0), ageText: z.string(), observedAfterEvaluation: z.boolean(),
  status: z.enum(['FRESH', 'STALE']), sentence: z.string(),
});
export const SourceFreshnessResponseSchema = z.object({
  evaluatedAt: isoUtc, staleAfterMs: z.number().int(), staleCount: z.number().int(),
  items: z.array(SourceFreshnessDtoSchema),
});

export const OverviewResponseSchema = z.object({
  evaluatedAt: isoUtc, generatedAt: isoUtc, layout: z.enum(OVERVIEW_LAYOUTS),
  exceptions: section(z.object({ critical: FigureSchema, top: z.array(ExceptionSummaryDtoSchema).max(5) })),
  risks: section(z.object({
    latestEvaluation: z.object({ id: z.string().uuid(), number: z.number().int(), asOf: isoUtc, finishedAt: isoUtc }).nullable(),
    high: FigureSchema, medium: FigureSchema, top: z.array(RiskSummaryDtoSchema).max(5),
  })),
  sla: section(z.object({
    commitments: z.object({ asOf: isoUtc, atRisk: FigureSchema, breached: FigureSchema, top: z.array(SlaClockDtoSchema).max(5) }),
    resolution: z.object({ atRisk: FigureSchema, breached: FigureSchema }),
  })),
  revenueAtRisk: section(RevenueAtRiskDtoSchema.nullable()),
  blockers: section(z.object({ snapshot: SnapshotRefSchema, count: FigureSchema, top: z.array(BlockerDtoSchema).max(5) }).nullable()),
  frequentRootCauses: section(z.object({
    windowDays: z.literal(30), minExceptions: z.literal(3), windowStart: isoUtc, windowEnd: isoUtc,
    count: FigureSchema, top: z.array(FrequentRootCauseDtoSchema).max(5),
  })),
  freshness: section(SourceFreshnessResponseSchema),
  assigned: section(z.object({
    exceptionsMine: FigureSchema, exceptionsMyTeams: FigureSchema, investigationsMine: FigureSchema,
    exceptions: z.array(ExceptionSummaryDtoSchema).max(5),      // mine first, then my teams, no duplicates
    investigations: z.array(InvestigationSummaryDtoSchema).max(5),
  })),
});

export const AtRiskOrderDtoSchema = z.object({
  order: EntityRefDtoSchema, customer: EntityRefDtoSchema.nullable(), analysisRank: z.number().int(),
  reasons: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('IMPAIRED'), state: OperationalStateSchema, sourceSystem: z.string(),
               sourceId: z.string(), observedAt: isoUtc }),
    z.object({ kind: z.literal('RISK'), risk: z.object({ id: z.string().uuid(), key: z.string() }), level: RiskLevelSchema }),
    z.object({ kind: z.literal('SLA'), clockKey: z.string(), status: z.enum(['AT_RISK', 'BREACHED']), dueAt: isoUtc }),
  ])).min(1),
  reasonText: z.string(),
  value: MoneyDtoSchema.nullable(), disagreement: z.boolean(),
  sourceValues: z.array(SourceValueSchema), range: z.object({ low: MoneyDtoSchema, high: MoneyDtoSchema }).nullable(),
  outcome: RootCauseOutcomeSchema,
  rootCause: z.object({ entity: EntityRefDtoSchema, label: z.string(), confidence: ConfidenceSchema,
                        candidateCount: z.number().int().min(1) }).nullable(),
  otherCategories: z.array(CauseCategorySchema),
  category: CauseCategorySchema, categoryLabel: z.string(), categoryReason: z.string(),
  error: z.string().nullable(),
  links: z.object({ entity: z.string(), rootCause: z.string().nullable(), graph: z.string() }),
});
export const AtRiskOrderListResponseSchema = z.object({
  snapshot: SnapshotRefSchema,
  filter: z.object({ category: CauseCategorySchema.nullable(), currency: z.string().nullable(),
                     valueUnknown: z.boolean(), rootCauseEntityId: z.string().uuid().nullable() }),
  summary: z.object({ orderCount: z.number().int(), sums: z.array(MoneyDtoSchema) }),    // per currency, equals the figure
  items: z.array(AtRiskOrderDtoSchema), nextCursor: z.string().nullable(),
});
export const BlockerListResponseSchema = z.object({ snapshot: SnapshotRefSchema, total: z.number().int(),
  items: z.array(BlockerDtoSchema), nextCursor: z.string().nullable() });
export const FrequentRootCauseListResponseSchema = z.object({ evaluatedAt: isoUtc, windowStart: isoUtc, windowEnd: isoUtc,
  items: z.array(FrequentRootCauseDtoSchema) });

export const SnapshotDtoSchema = SnapshotRefSchema.omit({ finishedAt: true, consistent: true }).extend({
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']), startedAt: isoUtc, finishedAt: isoUtc.nullable(),
  durationMs: z.number().int().nullable(), consistent: z.boolean().nullable(),
  graphVersionStart: z.string(), graphVersionEnd: z.string().nullable(),        // bigint as decimal string
  requestedBy: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  counts: z.object({ orders: z.number().int(), analyzed: z.number().int(), notAnalyzed: z.number().int(),
                     failed: z.number().int() }).nullable(),
  error: z.string().nullable(),
});
export const SnapshotListResponseSchema = z.object({ items: z.array(SnapshotDtoSchema), nextCursor: z.string().nullable() });

// search.ts
export const SearchMatchSchema = z.object({
  field: z.enum(['displayName', 'identifier', 'title', 'number']), value: z.string(),
  sourceSystem: z.string().nullable(),                         // identifiers only
  ranges: z.array(z.tuple([z.number().int().min(0), z.number().int().min(1)])),   // [start, end), UTF-16 units
});
const group = <T extends z.ZodTypeAny>(hit: T) => z.object({ total: z.number().int(), totalIsLowerBound: z.boolean(), items: z.array(hit) });
export const SearchResponseSchema = z.object({
  query: z.object({ q: z.string(), groups: z.array(z.enum(SEARCH_GROUPS)), entityTypes: z.array(EntityTypeSchema) }),
  entities: group(z.object({ entity: EntityRefDtoSchema, primaryIdentifier: IdentifierDtoSchema.extend({ sourceSystem: z.string() }),
                             tier: z.enum(SEARCH_TIERS), matches: z.array(SearchMatchSchema) })).optional(),
  exceptions: group(z.object({ id: z.string().uuid(), key: z.string(), title: z.string(), severity: ExceptionSeveritySchema,
                               status: ExceptionStatusSchema, subject: EntityRefDtoSchema,
                               tier: z.enum(SEARCH_TIERS), matches: z.array(SearchMatchSchema) })).optional(),
  investigations: group(z.object({ id: z.string().uuid(), key: z.string(), title: z.string(), severity: ExceptionSeveritySchema,
                                   status: InvestigationStatusSchema, focus: EntityRefDtoSchema,
                                   tier: z.enum(SEARCH_TIERS), matches: z.array(SearchMatchSchema) })).optional(),
});
export const EntityFinderResponseSchema = EntityListResponseSchema.extend({
  meta: z.object({ evaluatedAt: isoUtc, snapshot: SnapshotRefSchema.nullable(), notes: z.array(z.string()) }),
});

// saved-filters.ts
export const SavedFilterDtoSchema = z.object({
  id: z.string().uuid(), name: z.string(), criteria: z.record(z.unknown()),   // StoredCriteria when valid
  valid: z.boolean(), issues: z.array(z.object({ path: z.string(), message: z.string() })),
  createdAt: isoUtc, updatedAt: isoUtc,
});
export const BuiltInFilterDtoSchema = z.object({ id: z.string().startsWith('builtin:'), name: z.string(),
                                                 description: z.string(), criteria: StoredCriteriaSchema });
export const SavedFilterListResponseSchema = z.object({ builtIn: z.array(BuiltInFilterDtoSchema),
                                                        mine: z.array(SavedFilterDtoSchema) });
```

**Matches order**: `displayName`, then `number`, then `title`, then identifiers (primary first, then by `seq`), at most 3 identifiers. A field is listed when it contains the query or equals it; SIMILAR hits list `displayName`/`title` with `ranges: []`.

---

## Category mapping

| `CauseCategory` | Label | Root-cause entity types | Other outcomes |
|---|---|---|---|
| `SUPPLIER` | Supplier issues | Supplier, Product, PurchaseOrder | — |
| `PAYMENT` | Payment issues | Payment, Invoice | — |
| `WAREHOUSE` | Warehouse and shipping issues | Warehouse, Shipment | — |
| `APPROVAL` | Approval issues | Approval, BudgetRequirement | — |
| `OTHER` | Other | Order, Customer, Contract, SLA | `NOT_BLOCKED`, `UNEXPLAINED`, `NOT_ANALYZED`, `FAILED` |

---

## Built-in filters

| `id` | `name` | `criteria` |
|---|---|---|
| `builtin:orders-blocked-by-payment` | Orders blocked by payment issues | `{ type: ['Order'], stateClass: ['IMPAIRED'], rootCauseCategory: ['PAYMENT'] }` |
| `builtin:orders-blocked-by-supplier` | Orders blocked by supplier issues | `{ type: ['Order'], stateClass: ['IMPAIRED'], rootCauseCategory: ['SUPPLIER'] }` |
| `builtin:orders-blocked-by-approval` | Orders blocked by approvals | `{ type: ['Order'], stateClass: ['IMPAIRED'], rootCauseCategory: ['APPROVAL'] }` |
| `builtin:orders-blocked-by-warehouse` | Orders blocked by warehouse or shipping issues | `{ type: ['Order'], stateClass: ['IMPAIRED'], rootCauseCategory: ['WAREHOUSE'] }` |
| `builtin:orders-at-risk-of-sla-breach` | Orders at risk of SLA breach | `{ type: ['Order'], slaStatus: ['AT_RISK', 'BREACHED'] }` |
| `builtin:entities-with-high-risk` | Entities with a HIGH risk | `{ riskLevel: ['HIGH'] }` |
| `builtin:entities-with-unresolved-exception` | Entities with an unresolved exception | `{ hasUnresolvedException: true }` |

`description` = one sentence restating the criteria (for example `Customer orders whose state is impaired and whose first-ranked root cause is a payment or invoice, from the latest revenue-at-risk snapshot.`).

---

## Text templates

`money` = 006's `formatMoneyText`; `dur` = 007's `formatDuration`; `STATE` = the state code; `name(e)` = display name.

### Revenue sentences (`RevenueAtRiskDto.sentences`)

1. Per currency, in currency order: `` `Revenue at risk: ${money(total)} across ${n} customer ${n === 1 ? 'order' : 'orders'} (snapshot #${number}, as of ${asOf}).` ``
2. No at-risk order: `No customer order needs attention in snapshot #${number} (as of ${asOf}).`
3. When `valueUnknown.value > 0`: `` `${k} at-risk ${k === 1 ? 'order has' : 'orders have'} no usable value and ${k === 1 ? 'is' : 'are'} not in any sum.` ``
4. When a currency has a range: `` `Sources disagree on some order values: the ${C} total could be between ${money(low)} and ${money(high)}.` ``
5. When `notAnalyzedCount > 0`: `` `${k} orders were not analyzed (limit 5,000) and are counted in Other.` ``
6. When `consistent` is false: `Data changed while this snapshot was computed.`
7. When `staleSources` is not empty: `` `Based partly on stale sources: ${staleSources.join(', ')}.` ``

### Reason text (`AtRiskOrderDto.reasonText`)

Parts joined with `; `: IMPAIRED `` `${STATE} (${sourceSystem} ${sourceId}, observed ${observedAt})` ``; RISK `` `${riskKey} ${typeLabel} ${level}` ``; SLA `` `SLA commitment ${SLA_STATUS_LABELS[status]}, due ${dueAt}` ``.

### Category reason (`AtRiskOrderDto.categoryReason`)

| Outcome | Template |
|---|---|
| `ROOT_CAUSES_FOUND` | `` `${CATEGORY_LABEL}: root cause ${name(rc)} (${rc.type}), "${label}", confidence ${confidence}.` `` + (LOW: ` This is a possible root cause (insufficient evidence).`) + (others: `` ` Also involves: ${labels.join(', ')} (not counted).` ``) |
| `NOT_BLOCKED` | `` `Other: ${name(order)} is ${STATE} and not blocked; it is at risk because of ${reasonText}.` `` |
| `UNEXPLAINED` | `` `Other: ${name(order)} is ${STATE}, but no recorded dependency explains this state, so no root cause can be named.` `` |
| `NOT_ANALYZED` | `Other: not analyzed, because a snapshot analyzes at most 5,000 orders.` |
| `FAILED` | `` `Other: the root-cause analysis failed (${error}).` `` |

### Blocker sentence

`` `${name(e)} (${STATE}) holds ${n} at-risk ${n === 1 ? 'order' : 'orders'} worth ${amounts.map(money).join(' and ')}.` `` (+ `` ` ${k} without a usable value.` `` when `valueUnknownCount > 0`; amounts empty → `worth no known value`).

### Frequent root cause sentence

`` `${label}: behind ${n} exceptions (${u} unresolved) on ${m} root-cause ${m === 1 ? 'entity' : 'entities'} in the last 30 days.` `` `recurrenceText` is 008's `` `Recurring: ${label} on ${count} root causes in the last 30 days` `` with `count` = 008's distinct-entity count, or `null`.

### Freshness sentence

`` `${system}: newest record observed ${newestObservedAt}, ${dur(ageMs)} before the evaluation time; ${Fresh|Stale} (stale after 1d).` `` When `observedAfterEvaluation`: `` `${system}: newest record observed ${newestObservedAt}, after the evaluation time; Fresh.` ``

### Empty states

- Assigned to me: `Nothing is assigned to you or your teams.`
- Frequent root causes: `No root cause was behind 3 or more exceptions in the last 30 days.`
- Blockers: `No unresolved blocker holds an at-risk order.`
- No evaluation (risks section `latestEvaluation null`): `No risk evaluation has run yet.`
- No snapshot: `No revenue-at-risk snapshot is available yet.`

---

## Acceptance fixtures

Seeded database: 001 users, §39 (002), §40 (006), 007's teams and EX-10001, 008's INV-10001, 009's configuration and SHIP-24H. The risk scheduler and automatic snapshots are disabled in tests. **T3** = `2026-10-05T16:00:00Z`. **Setup S**: as Admin, `POST /api/risk-evaluations { asOf: T3 }`, then `POST /api/overview/snapshots`. If a computed value differs from a value below, stop and write the derivation in `questions.md`; do not change the expectation.

### H1. Revenue at risk at T3 (setup S)

- Route 6 → 201, `status COMPLETED`, `trigger MANUAL`, `asOf T3`, `riskEvaluation.number` = the evaluation of setup S, `consistent true`, `counts { orders 25, analyzed 25, notAnalyzed 0, failed 0 }`; audit `overview.snapshot_completed` with `actorType 'user'`.
- `totals.outcomes`: `ROOT_CAUSES_FOUND 23`, `UNEXPLAINED 2`, all others 0.
- One currency, **USD**: total **89,065.00** (25 orders), `range null`:

  | Category | Amount | Orders | Rows (route 2, in order) |
  |---|---|---|---|
  | SUPPLIER | 51,250.00 | 6 | SO-20402 12,400.00; SO-20404 10,600.00; SO-20401 9,800.00; SO-20403 7,250.00; SO-20405 5,900.00; SO-20406 5,300.00 |
  | PAYMENT | 0.00 | 0 | — |
  | WAREHOUSE | 0.00 | 0 | — |
  | APPROVAL | 31,400.00 | 17 | Order #18492 12,480.00; #18511 1,480.00; #18495 1,430.00; #18514 1,350.00; #18501 1,320.00; #18503 1,275.00; #18493 1,250.00; #18512 1,210.00; #18505 1,165.00; #18496 1,140.00; #18522 1,090.00; #18523 1,070.00; #18513 1,060.00; #18521 1,060.00; #18502 1,050.00; #18504 990.00; #18494 980.00 |
  | OTHER | 6,415.00 | 2 | Order SO-20408 4,800.00 (`UNEXPLAINED`); Order #18532 1,615.00 (`UNEXPLAINED`) |

  `categoryOrders`: SUPPLIER 6, PAYMENT 0, WAREHOUSE 0, APPROVAL 17, OTHER 2; `valueUnknownCount` 0 everywhere.
- **Root causes**: every APPROVAL row has root cause Budget code for Order #18492 (BudgetRequirement, MISSING), label `Budget Code Missing`; every SUPPLIER row has Fabrikam Components (Supplier, SUSPENDED). For **every** row, `outcome`, root-cause entity, `label`, `confidence` and `candidateCount` equal `GET /api/entities/:orderId/root-cause?evaluatedAt=T3` (`status`, `candidates[0]`, `candidates.length`). Order #18492's confidence is HIGH (008 V1). `otherCategories` is empty on every row.
- **Reasons**: Orders #18492–#18496 have `[IMPAIRED, RISK, SLA]`: RISK = their open SLA breach likely risk (level equal to `GET /api/risks?entityId=…`'s, HIGH under the default configuration), SLA = `BREACHED` (due 2026-09-30T09:12:00Z for #18492, 2026-09-30T14:32:00Z for the others). Every other row has `[IMPAIRED]` from its OMS observation. Order #18531 (ACTIVE), SO-20407, SO-20409–SO-20412, SO-20414, SO-20415 (ACTIVE) and the COMPLETED orders are absent.
- **Customers**: #18492–#18496 Acme Corp; #18501–#18505 Globex Retail; #18511–#18514 Initech Supplies; #18521–#18523 and #18532 Umbrella Logistics; SO-20401, SO-20402 Blue Yonder Machinery; SO-20403, SO-20404, SO-20408 Woodgrove Manufacturing; SO-20405, SO-20406 Litware Industrial.
- **Category reason** of Order #18532: `Other: Order #18532 is PENDING, but no recorded dependency explains this state, so no root cause can be named.`
- **Cross-checks with 006**: SUPPLIER = 006 fixture I1's current exposure of Fabrikam Components (51,250.00, the same 6 orders); APPROVAL = the current exposure of Budget code for Order #18492 (31,400.00, 007 X2's impact payload).
- **Determinism**: a second `POST /api/overview/snapshots` (no data change) gives a snapshot whose rows (all columns but `snapshot_id`) and `totals` are identical.
- **Route 2 sums**: for each category and for the total, `summary.orderCount` and `summary.sums` equal the figure.

### H2. Unresolved blockers at T3 (setup S)

`GET /api/overview/blockers` → `total 2`:
1. Budget code for Order #18492 (BudgetRequirement, MISSING), `label "Budget Code Missing"`, `category APPROVAL`, `orders.value 17`, `amounts [31,400.00 USD]`, `exceptions [EX-10001 (role ROOT_CAUSE, CRITICAL, OPEN)]`, `exceptionTotal 1`, `confidences` = the per-row confidences of H1's APPROVAL rows; sentence `Budget code for Order #18492 (MISSING) holds 17 at-risk orders worth 31,400.00 USD.`
2. Fabrikam Components (Supplier, SUSPENDED), `label` = 005's label for it (FR-012 generic rule), `category SUPPLIER`, `orders.value 6`, `amounts [51,250.00 USD]`, `exceptions []`, `exceptionTotal 0`.

Each `orders.drill` (route 2 with `rootCauseEntityId`) returns exactly the H1 rows of that root cause.

### H3. Frequent root causes (built set)

Reset database plus 001 users. Test-only inserts: root-cause entities B1, B2 (BudgetRequirement), C1 (Shipment), P1, P2 (Payment); exceptions X1–X9 (any subject); `analysis_snapshots` rows (`kind ROOT_CAUSE`, `exception_id` set) with:

| Exception | Status | Label | Entity | `taken_at` |
|---|---|---|---|---|
| X1 | OPEN | Budget Code Missing | B1 | 2026-10-01T09:00:00Z and 2026-10-03T09:00:00Z |
| X2 | RESOLVED | Budget Code Missing | B1 | 2026-10-02T09:00:00Z |
| X3 | OPEN | Budget Code Missing | B2 | 2026-10-05T12:00:00Z |
| X4 | CLOSED | Carrier Capacity Missing | C1 | 2026-09-20T09:00:00Z |
| X5 | OPEN | Carrier Capacity Missing | C1 | 2026-09-25T09:00:00Z |
| X6 | IN_PROGRESS | Carrier Capacity Missing | C1 | 2026-10-06T09:00:00Z |
| X7 | OPEN | Payment Failed | P1 | 2026-10-04T09:00:00Z |
| X8 | OPEN | Payment Failed | P2 | 2026-10-04T09:00:00Z |
| X9 | CLOSED | Budget Code Missing | B1 | 2026-09-07T12:00:00Z |

`GET /api/overview/frequent-root-causes?evaluatedAt=2026-10-07T12:00:00Z` → window `(2026-09-07T12:00:00Z, 2026-10-07T12:00:00Z]`:
1. `Budget Code Missing`: `exceptionCount 3` (X1, X2, X3; X1 once; X9 on the lower bound is outside), `rootCauseEntityCount 2`, `unresolvedExceptionCount 2`, `recurring true`, `recurrenceText "Recurring: Budget Code Missing on 2 root causes in the last 30 days"`;
2. `Carrier Capacity Missing`: `3`, `1`, `2`, `recurring false`, `recurrenceText null`.

`Payment Failed` (2 exceptions) is absent, although 008 would call it recurring. Drill: `GET /api/exceptions?view=ALL&rootCauseLabel=Budget%20Code%20Missing&rootCauseWindowEnd=2026-10-07T12:00:00Z` → `total 3` (X1, X2, X3).

Variants: `evaluatedAt=2026-10-05T12:00:00Z` → only `Budget Code Missing` with `exceptionCount 4` (X1, X2, X3 at the upper bound, X9), `rootCauseEntityCount 2`, `unresolvedExceptionCount 2`; Carrier Capacity Missing has 2 (X6 is later) and is absent. `evaluatedAt=2026-10-05T11:59:59.999Z` → `Budget Code Missing` `3` (X1, X2, X9), `rootCauseEntityCount 1`, `recurring false`.

### H4. Data freshness (seeded database)

`GET /api/source-systems/freshness?evaluatedAt=2026-10-05T16:00:00Z` → `staleCount 4`, items in order:

| # | System | `newestObservedAt` | Status |
|---|---|---|---|
| 1 | FinanceApprovals | 2026-09-29T15:00:00Z | STALE |
| 2 | ManualEntry | 2026-09-29T15:00:00Z | STALE |
| 3 | Payments | 2026-09-29T15:00:00Z | STALE |
| 4 | WMS | 2026-09-29T15:00:00Z | STALE |
| 5 | CRM | 2026-10-05T12:00:00Z | FRESH |
| 6 | ERP | 2026-10-05T12:00:00Z | FRESH |
| 7 | InferenceRules | 2026-10-05T12:00:00Z | FRESH |
| 8 | OMS | 2026-10-05T12:00:00Z | FRESH |
| 9 | PIM | 2026-10-05T12:00:00Z | FRESH |
| 10 | TMS | 2026-10-05T12:00:00Z | FRESH |
| 11 | ContractMgmt | 2026-10-05T12:01:00Z | FRESH |

Payments' sentence: `Payments: newest record observed 2026-09-29T15:00:00.000Z, 6d 1h before the evaluation time; Stale (stale after 1d).` (The §39 relationship records are observed 2026-09-29T15:00:00Z; the §40 relationship records 2026-10-05T12:00:00Z; ContractMgmt's newest are the §40 `sla.at_risk` events observed at 12:01.)

Boundaries: `evaluatedAt=2026-09-30T15:00:00.000Z` → the four §39-only systems are FRESH (exactly 24 h), the seven others are FRESH with `observedAfterEvaluation true` and `ageMs 0`, `staleCount 0`; `evaluatedAt=2026-09-30T15:00:00.001Z` → the four are STALE.

### H5. Home (setup S)

`GET /api/overview?evaluatedAt=T3`:
- As **Operations Manager**: `layout TOTALS_FIRST`. `exceptions.critical.value 1`, `top [EX-10001]`. `risks.latestEvaluation.asOf T3`; `high.value` and `medium.value` equal the `total` of `GET /api/risks?status=OPEN&level=HIGH` and `…&level=MEDIUM`. `sla.commitments.atRisk.value 0`, `breached.value 8` (Orders #18492–#18496 and the delivery SLAs of Acme Corp, Globex Retail and Initech Supplies), each equal to `GET /api/sla-clocks?asOf=T3&status=…`'s `total`. `sla.resolution` values equal `GET /api/exceptions?view=UNRESOLVED&sla=AT_RISK|BREACHED&evaluatedAt=T3` totals. `revenueAtRisk` = H1 (`staleSources []`: every impaired reason comes from OMS, fresh at T3). `blockers.count.value 2`, `top` = H2. `frequentRootCauses.count.value 0`. `freshness` = H4. `assigned`: `exceptionsMine 0`, `exceptionsMyTeams 1` (EX-10001, Finance Operations), `investigationsMine 0`.
- As **Operations Analyst**: `layout ASSIGNED_FIRST`; `assigned`: `exceptionsMine 0`, `exceptionsMyTeams 0`, `investigationsMine 1` (INV-10001). Every other section deep-equals the manager's.
- As **Admin**: `layout TOTALS_FIRST`.
- For every `Figure` in the response, calling the API of its `drill.kind` with `drill.query` (and the caller's identity) returns `total` = `value`; for every `MoneyFigure`, route 2's `summary.sums` equals it.
- Before setup S (no evaluation): `risks.data.latestEvaluation null` with values 0, `revenueAtRisk.data null`, `blockers.data null`; all other sections `OK`.
- Section isolation: with `SlaClockService.clocks` overridden to throw (test module), `sla.status UNAVAILABLE`, every other section `OK`.
- 20 calls with the same `evaluatedAt` → identical bodies except `generatedAt`.

### H6. Entity finder and saved filters (setup S)

- `builtin:orders-blocked-by-approval` → 17 items (the APPROVAL orders of H1, by display name), `meta.snapshot` = H1's; `…-by-supplier` → SO-20401 … SO-20406; `…-by-payment` and `…-by-warehouse` → 0 items.
- `builtin:orders-at-risk-of-sla-breach` with `evaluatedAt=T3` → Orders #18492, #18493, #18494, #18495, #18496.
- `builtin:entities-with-high-risk` → exactly the distinct entities of `GET /api/risks?status=OPEN&level=HIGH`.
- `builtin:entities-with-unresolved-exception` → Budget code for Order #18492, Shipment SHP-77120 (consolidated).
- `type=Order&stateClass=IMPAIRED&rootCauseCategory=OTHER` → Order #18532, Order SO-20408.
- `type=Order,Payment&state=PENDING` → Order #18532, Order SO-20408, Payment PAY-88213. `type=Order` alone returns exactly what `GET /api/entities?type=Order` returns (same items, same cursor behaviour).
- `rootCauseCategory=APPROVAL` before any snapshot → 0 items, `meta.snapshot null`, `meta.notes ["No revenue-at-risk snapshot is available yet, so root-cause categories match nothing."]`.
- Saved filters as Operations Analyst: `POST { name: "Approval-blocked orders with a case", criteria: { type: ['Order'], stateClass: ['IMPAIRED'], rootCauseCategory: ['APPROVAL'], hasUnresolvedException: true } }` → 201, audit `saved_filter.created`; applying its criteria → 0 items (no order is linked to an unresolved exception). `POST` with name `"approval-blocked ORDERS with a case"` → 409 `SAVED_FILTER_NAME_TAKEN`. As Operations Manager, `GET /api/saved-filters` → `mine []`, 7 `builtIn`; `PATCH`/`DELETE` of the analyst's id → 404. As the analyst: `PATCH { name: "Approval orders" }` → 200, audit `saved_filter.updated` with before/after names; `DELETE` → 204, audit `saved_filter.deleted`. 50 filters, then a 51st → 409 `SAVED_FILTER_LIMIT`, nothing stored.

### H7. Search (seeded database)

| Query | Result |
|---|---|
| `q=18492` | **entities** `total 2`: Order #18492 `EXACT` (matches: displayName `[[7,12]]`; identifier OMS `18492` `[[0,5]]`; identifier ERP `SO-18492` `[[3,8]]`), Budget code for Order #18492 `CONTAINS` (displayName `[[23,28]]`; identifier FinanceApprovals `BR-18492` `[[3,8]]`). **exceptions** `total 0`. **investigations** `total 1`: INV-10001 `CONTAINS` (title `Why is Order #18492 delayed?` `[[14,19]]`). |
| `q=PAY-88213` | entities: Payment PAY-88213 `EXACT` (displayName `[[8,17]]`, identifier Payments `PAY-88213` `[[0,9]]`); exceptions and investigations empty |
| `q=order #1849` | entities `total 6`: Orders #18492, #18493, #18494, #18495, #18496 (`PREFIX`), then Budget code for Order #18492 (`CONTAINS`); no `SIMILAR` rows although other "Order #…" names exceed the threshold |
| `q=fabrikam componets` | entities: Fabrikam Components `SIMILAR` (no exact, prefix or substring match, so the similar fallback runs), `ranges []`, and nothing else |
| `q=EX-10001` | exceptions: EX-10001 `EXACT` (number `EX-10001` `[[0,8]]`) |
| `q=10001` | exceptions: EX-10001 `EXACT`; investigations: INV-10001 `EXACT`; entities: none |
| `q=18492&groups=ENTITY&entityTypes=BudgetRequirement` | only `entities`: Budget code for Order #18492; `exceptions` and `investigations` keys absent |
| `q=100%` and `q=o_d` | every group `total 0` (literal matching) |
| `q=a`, `q=` + 101 characters | 400 `VALIDATION_FAILED` on `q` |
| `q=18492&groups=EXCEPTION&entityTypes=Order` | 400 on `entityTypes` |

Repeating any query gives an identical body.

### Validation and access

- Every route: 401 without a token.
- Route 6 as Analyst and as Operations Manager: 403 and one `auth.forbidden` row; nothing else written. Route 6 on a fresh database before any evaluation: 409 `NO_RISK_EVALUATION`. Route 6 while a RUNNING row exists (test-only insert): 409 `SNAPSHOT_IN_PROGRESS`.
- Routes 2, 3 with an unknown `snapshotId` → 404 `Snapshot`; with a pruned snapshot → 404 with message `This snapshot is no longer available; open the latest one.`
- Route 2: `valueUnknown=true&currency=USD` → 400 on `valueUnknown`; `category=FOO` → 400.
- Routes 1, 4, 7, 9: `evaluatedAt=yesterday` → 400.
- Route 9: `riskLevel=HIGHEST` → 400 on `riskLevel`; `slaStatus=ON_TRACK` → 400.
- Routes 11, 12: name of 81 characters → 400; `criteria {}` → 400 on `criteria`; unknown keys → 400; `PATCH {}` → 400 `Nothing to change`.
- Routes 12, 13 with `builtin:…` → 400 (not a uuid); with an unknown uuid → 404.
- 007 list: `rootCauseLabel` without `rootCauseWindowEnd` → 400 on `rootCauseWindowEnd`.
- Pruning: with a COMPLETED snapshot whose `finished_at` is 25 hours old (test-only update) and a newer one, completing a snapshot deletes the old one and writes `overview.snapshots_pruned` `{ count: 1 }`; the latest completed is never deleted.
