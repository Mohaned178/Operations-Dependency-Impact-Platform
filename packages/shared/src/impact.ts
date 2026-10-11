import { z } from 'zod';
import { PageQuerySchema } from './common';
import {
  ConfidenceSchema,
  EntityRefDtoSchema,
  EntityTypeSchema,
  OperationalStateSchema,
  RelationshipOriginSchema,
  type EntityType,
  type OperationalState,
} from './graph';
import { AmountStringSchema, CurrencyCodeSchema, MoneyDtoSchema } from './money';
import {
  CycleClosingHopDtoSchema,
  PathDtoSchema,
  TraceDepthSchema,
  TracedEntityDtoSchema,
} from './tracing';

export const ImpactStateClassSchema = z.enum(['IMPAIRED', 'UNIMPAIRED', 'TERMINAL', 'INDETERMINATE']);
export type ImpactStateClass = z.infer<typeof ImpactStateClassSchema>;

/** Spec FR-003, research R3. Exhaustive over OperationalState. */
export const IMPACT_STATE_CLASS: Record<OperationalState, ImpactStateClass> = {
  PENDING: 'IMPAIRED',
  WAITING: 'IMPAIRED',
  BLOCKED: 'IMPAIRED',
  MISSING: 'IMPAIRED',
  DELAYED: 'IMPAIRED',
  FAILED: 'IMPAIRED',
  SUSPENDED: 'IMPAIRED',
  AT_RISK: 'IMPAIRED',
  ACTIVE: 'UNIMPAIRED',
  COMPLETED: 'TERMINAL',
  CANCELLED: 'TERMINAL',
  UNKNOWN: 'INDETERMINATE',
};
export const IMPAIRED_STATES: readonly OperationalState[] = OperationalStateSchema.options.filter(
  (state) => IMPACT_STATE_CLASS[state] === 'IMPAIRED',
);
export const TERMINAL_STATES: readonly OperationalState[] = OperationalStateSchema.options.filter(
  (state) => IMPACT_STATE_CLASS[state] === 'TERMINAL',
);

/** Spec FR-012: always shown, in this order. */
export const IMPACT_HEADLINE_TYPES = [
  'Product',
  'PurchaseOrder',
  'Order',
  'Customer',
  'Shipment',
  'SLA',
] as const satisfies readonly EntityType[];

/** Research R9. Exhaustive over EntityType. [singular, plural]. */
export const IMPACT_NOUNS: Record<EntityType, readonly [string, string]> = {
  Customer: ['customer', 'customers'],
  Contract: ['contract', 'contracts'],
  Order: ['customer order', 'customer orders'],
  Product: ['product', 'products'],
  Payment: ['payment', 'payments'],
  Invoice: ['invoice', 'invoices'],
  Approval: ['approval', 'approvals'],
  Warehouse: ['warehouse', 'warehouses'],
  Shipment: ['shipment', 'shipments'],
  Supplier: ['supplier', 'suppliers'],
  SLA: ['SLA commitment', 'SLA commitments'],
  BudgetRequirement: ['budget requirement', 'budget requirements'],
  PurchaseOrder: ['purchase order', 'purchase orders'],
};

/** Category label in the table: the capitalized plural ("Customer orders", "SLA commitments"). */
export function impactCategoryLabel(type: EntityType): string {
  const plural = IMPACT_NOUNS[type][1];
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

export const IMPACT_LIMITS = {
  maxAlternativePaths: 20,
  maxEnumeratedPaths: 21,
  pathSearchBudget: 5_000,
  maxAttributionPreviews: 5,
  maxAttributions: 200,
  defaultPageSize: 50,
  maxPageSize: 200,
} as const;

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

export const ImpactQuerySchema = z.object({ depth: TraceDepthSchema });
export type ImpactQuery = z.infer<typeof ImpactQuerySchema>;

export const ImpactCategoryBucketSchema = z.enum([
  'total',
  'direct',
  'indirect',
  'current',
  'potential',
  'inferredOnly',
  'stateUnknown',
]);
export type ImpactCategoryBucket = z.infer<typeof ImpactCategoryBucketSchema>;

export const ImpactExposureBucketSchema = z.enum(['total', 'current', 'potential', 'inferredOnly']);
export type ImpactExposureBucket = z.infer<typeof ImpactExposureBucketSchema>;

export const ImpactListSelectorSchema = z.discriminatedUnion('list', [
  z.object({
    list: z.literal('category'),
    type: EntityTypeSchema,
    bucket: ImpactCategoryBucketSchema,
  }),
  z.object({
    list: z.literal('exposure'),
    currency: CurrencyCodeSchema,
    bucket: ImpactExposureBucketSchema,
  }),
  z.object({ list: z.literal('valueUnknown') }),
  z.object({ list: z.literal('notCounted'), type: EntityTypeSchema.nullable() }),
]);
export type ImpactListSelector = z.infer<typeof ImpactListSelectorSchema>;

type ImpactListKind = ImpactListSelector['list'];
type FlatListQuery = {
  list: ImpactListKind;
  type?: EntityType | undefined;
  bucket?: string | undefined;
  currency?: string | undefined;
};
type SelectorIssue = { path: 'type' | 'bucket' | 'currency'; message: string };

function forbidden(
  query: FlatListQuery,
  fields: readonly ('type' | 'bucket' | 'currency')[],
): SelectorIssue[] {
  return fields
    .filter((field) => query[field] !== undefined)
    .map((field) => ({ path: field, message: `${field} is not allowed for list=${query.list}` }));
}

function bucketIssue<T extends string>(
  query: FlatListQuery,
  schema: z.ZodEnum<[T, ...T[]]>,
): { bucket: T | null; issues: SelectorIssue[] } {
  if (query.bucket === undefined) {
    return {
      bucket: null,
      issues: [{ path: 'bucket', message: `bucket is required for list=${query.list}` }],
    };
  }
  const parsed = schema.safeParse(query.bucket);
  if (!parsed.success) {
    return {
      bucket: null,
      issues: [
        {
          path: 'bucket',
          message: `bucket must be one of: ${schema.options.join(', ')}`,
        },
      ],
    };
  }
  return { bucket: parsed.data, issues: [] };
}

function resolveSelector(query: FlatListQuery): {
  selector: ImpactListSelector | null;
  issues: SelectorIssue[];
} {
  switch (query.list) {
    case 'category': {
      const issues = forbidden(query, ['currency']);
      if (query.type === undefined) {
        issues.push({ path: 'type', message: 'type is required for list=category' });
      }
      const { bucket, issues: bucketIssues } = bucketIssue(query, ImpactCategoryBucketSchema);
      issues.push(...bucketIssues);
      if (issues.length > 0 || query.type === undefined || bucket === null) {
        return { selector: null, issues };
      }
      return { selector: { list: 'category', type: query.type, bucket }, issues };
    }
    case 'exposure': {
      const issues = forbidden(query, ['type']);
      if (query.currency === undefined) {
        issues.push({ path: 'currency', message: 'currency is required for list=exposure' });
      }
      const { bucket, issues: bucketIssues } = bucketIssue(query, ImpactExposureBucketSchema);
      issues.push(...bucketIssues);
      if (issues.length > 0 || query.currency === undefined || bucket === null) {
        return { selector: null, issues };
      }
      return { selector: { list: 'exposure', currency: query.currency, bucket }, issues };
    }
    case 'valueUnknown': {
      const issues = forbidden(query, ['type', 'bucket', 'currency']);
      return {
        selector: issues.length > 0 ? null : { list: 'valueUnknown' },
        issues,
      };
    }
    case 'notCounted': {
      const issues = forbidden(query, ['bucket', 'currency']);
      return {
        selector:
          issues.length > 0 ? null : { list: 'notCounted', type: query.type ?? null },
        issues,
      };
    }
  }
}

/**
 * Flat query string → { depth, cursor, limit, selector }.
 * - list=category:     type and bucket (category bucket) required; currency forbidden
 * - list=exposure:     currency and bucket (exposure bucket) required; type forbidden
 * - list=valueUnknown: type, bucket and currency forbidden
 * - list=notCounted:   type optional; bucket and currency forbidden
 */
export const ImpactListQuerySchema = PageQuerySchema.extend({
  depth: TraceDepthSchema,
  list: z.enum(['category', 'exposure', 'valueUnknown', 'notCounted']),
  type: EntityTypeSchema.optional(),
  bucket: z.string().optional(),
  currency: CurrencyCodeSchema.optional(),
})
  .superRefine((query, ctx) => {
    for (const issue of resolveSelector(query).issues) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  })
  .transform((query) => {
    const { selector } = resolveSelector(query);
    if (selector === null) {
      throw new Error('impact list query: selector unresolved after validation');
    }
    return { depth: query.depth, cursor: query.cursor, limit: query.limit, selector };
  });
export type ImpactListQuery = z.output<typeof ImpactListQuerySchema>;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const ImpactClassificationSchema = z.enum(['CURRENT', 'POTENTIAL', 'NOT_COUNTED']);
export type ImpactClassification = z.infer<typeof ImpactClassificationSchema>;

export const ImpactQueryEchoSchema = z.object({
  entityId: z.string().uuid(),
  depth: z.number().int(),
});
export type ImpactQueryEcho = z.infer<typeof ImpactQueryEchoSchema>;

export const ImpactLimitsDtoSchema = z.object({
  depthLimit: z.boolean(),
  explorationLimit: z.boolean(),
  lowerBound: z.boolean(),
});
export type ImpactLimitsDto = z.infer<typeof ImpactLimitsDtoSchema>;

export const ImpactCategoryDtoSchema = z.object({
  type: EntityTypeSchema,
  label: z.string(),
  headline: z.boolean(),
  total: z.number().int().min(0),
  direct: z.number().int().min(0),
  indirect: z.number().int().min(0),
  current: z.number().int().min(0),
  potential: z.number().int().min(0),
  inferredOnly: z.number().int().min(0),
  stateUnknown: z.number().int().min(0),
});
export type ImpactCategoryDto = z.infer<typeof ImpactCategoryDtoSchema>;

export const ExposureShareDtoSchema = z.object({
  amount: AmountStringSchema,
  orderCount: z.number().int().min(0),
});
export type ExposureShareDto = z.infer<typeof ExposureShareDtoSchema>;

export const ExposureFigureDtoSchema = z.object({
  currency: CurrencyCodeSchema,
  total: ExposureShareDtoSchema,
  current: ExposureShareDtoSchema,
  potential: ExposureShareDtoSchema,
  inferredOnly: z.object({
    total: ExposureShareDtoSchema,
    current: ExposureShareDtoSchema,
    potential: ExposureShareDtoSchema,
  }),
  disagreementOrderCount: z.number().int().min(0),
  range: z.object({ low: AmountStringSchema, high: AmountStringSchema }).nullable(),
});
export type ExposureFigureDto = z.infer<typeof ExposureFigureDtoSchema>;

export const ImpactResponseSchema = z.object({
  query: ImpactQueryEchoSchema,
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  startClass: ImpactStateClassSchema,
  startOwnValue: MoneyDtoSchema.nullable(),
  limits: ImpactLimitsDtoSchema,
  summary: z.array(z.string()).min(1),
  countedTotal: z.number().int().min(0),
  categories: z.array(ImpactCategoryDtoSchema).min(6),
  exposure: z.object({
    byCurrency: z.array(ExposureFigureDtoSchema),
    valueUnknownCount: z.number().int().min(0),
  }),
  notCounted: z.object({
    total: z.number().int().min(0),
    byType: z.array(z.object({ type: EntityTypeSchema, count: z.number().int().min(1) })),
  }),
  cycleClosingHops: z.array(CycleClosingHopDtoSchema),
  cycleClosingHopCount: z.number().int().min(0),
});
export type ImpactResponse = z.infer<typeof ImpactResponseSchema>;

export const OrderValueDtoSchema = z.object({
  current: MoneyDtoSchema.nullable(),
  bySource: z.array(
    z.object({
      sourceSystem: z.string(),
      sourceId: z.string(),
      observedAt: z.string().datetime(),
      amount: AmountStringSchema,
      currency: CurrencyCodeSchema,
    }),
  ),
  disagreement: z.boolean(),
  currencyMismatch: z.boolean(),
});
export type OrderValueDto = z.infer<typeof OrderValueDtoSchema>;

export const AttributionPreviewDtoSchema = z.object({
  entity: EntityRefDtoSchema,
  classification: z.enum(['CURRENT', 'POTENTIAL']),
  link: PathDtoSchema,
});
export type AttributionPreviewDto = z.infer<typeof AttributionPreviewDtoSchema>;

export const AffectedEntityDtoSchema = z.object({
  entity: TracedEntityDtoSchema,
  classification: ImpactClassificationSchema,
  notCountedReason: z.enum(['TERMINAL']).nullable(),
  directness: z.enum(['DIRECT', 'INDIRECT']),
  distance: z.number().int().min(1).nullable(),
  primaryPath: PathDtoSchema.nullable(),
  shortestPath: PathDtoSchema.nullable(),
  pathCount: z.number().int().min(0),
  morePaths: z.boolean(),
  flags: z.object({
    stateUnknown: z.boolean(),
    otherCause: z.boolean(),
    inferredOnly: z.boolean(),
  }),
  weakest: z.object({ origin: RelationshipOriginSchema, confidence: ConfidenceSchema }).nullable(),
  value: OrderValueDtoSchema.nullable(),
  attributionCount: z.number().int().min(0),
  attributions: z.array(AttributionPreviewDtoSchema).max(5),
});
export type AffectedEntityDto = z.infer<typeof AffectedEntityDtoSchema>;

export const ImpactListResponseSchema = z.object({
  query: ImpactQueryEchoSchema.extend({ selector: ImpactListSelectorSchema }),
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  total: z.number().int().min(0),
  sum: MoneyDtoSchema.nullable(),
  items: z.array(AffectedEntityDtoSchema),
  nextCursor: z.string().nullable(),
});
export type ImpactListResponse = z.infer<typeof ImpactListResponseSchema>;

export const AttributionDetailDtoSchema = AttributionPreviewDtoSchema.extend({
  primaryPath: PathDtoSchema,
});
export type AttributionDetailDto = z.infer<typeof AttributionDetailDtoSchema>;

export const ImpactItemDetailResponseSchema = z.object({
  query: ImpactQueryEchoSchema,
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  item: AffectedEntityDtoSchema,
  alternativePaths: z.array(PathDtoSchema).max(20),
  attributions: z.array(AttributionDetailDtoSchema).max(200),
  attributionCount: z.number().int().min(0),
});
export type ImpactItemDetailResponse = z.infer<typeof ImpactItemDetailResponseSchema>;
