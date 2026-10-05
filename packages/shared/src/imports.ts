import { z } from 'zod';
import { JsonValueSchema, type JsonValue } from './common';
import {
  ConfidenceSchema,
  EntityTypeSchema,
  MONETARY_ENTITY_TYPES,
  OperationalStateSchema,
  RelationshipOriginSchema,
  RelationshipTypeSchema,
  type EntityType,
} from './graph';

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 10_000;

export const ImportKindSchema = z.enum(['entities', 'relationships', 'events']);
export type ImportKind = z.infer<typeof ImportKindSchema>;

export const ImportFormatSchema = z.enum(['json', 'csv']);
export type ImportFormat = z.infer<typeof ImportFormatSchema>;

export const SourceSystemSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/);
export const SourceIdSchema = z.string().min(1).max(200).regex(/^[^|;\r\n]+$/);
export const TimestampSchema = z.string().datetime({ offset: true });

export const EntityKeyRefSchema = z
  .object({
    entityType: EntityTypeSchema,
    sourceSystem: SourceSystemSchema,
    sourceId: SourceIdSchema,
  })
  .strict();
export type EntityKeyRef = z.infer<typeof EntityKeyRefSchema>;

export const EntityIdRefSchema = z.object({ id: z.string().uuid() }).strict();
export type EntityIdRef = z.infer<typeof EntityIdRefSchema>;

export const EntityRefSchema = z.union([EntityIdRefSchema, EntityKeyRefSchema]);
export type EntityRef = z.infer<typeof EntityRefSchema>;

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,12})(\.\d{1,4})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function checkMoney(
  value: { type: EntityType; attributes: Record<string, JsonValue> },
  ctx: z.RefinementCtx,
): void {
  const amount = value.attributes['amount'];
  const currency = value.attributes['currency'];
  const hasAmount = amount !== undefined;
  const hasCurrency = currency !== undefined;

  if (hasAmount && (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attributes', 'amount'],
      message: 'amount must be a decimal string with at most 4 decimal places',
    });
  }
  if (hasCurrency && (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attributes', 'currency'],
      message: 'currency must be a 3-letter uppercase code',
    });
  }
  if (hasAmount && !hasCurrency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attributes', 'currency'],
      message: 'attributes.currency is required when attributes.amount is present',
    });
  }
  if (MONETARY_ENTITY_TYPES.includes(value.type) && !(hasAmount && hasCurrency)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attributes'],
      message: `${value.type} requires attributes.amount and attributes.currency`,
    });
  }
}

function checkBasis(
  value: { origin: z.infer<typeof RelationshipOriginSchema>; basis?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.origin !== 'SOURCE' && value.basis === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['basis'],
      message: 'basis is required unless origin is SOURCE',
    });
  }
}

export const EntityImportRowSchema = z
  .object({
    type: EntityTypeSchema,
    sourceSystem: SourceSystemSchema,
    sourceId: SourceIdSchema,
    displayName: z.string().trim().min(1).max(200),
    observedAt: TimestampSchema,
    state: OperationalStateSchema.optional(),
    sourceStatus: z.string().max(100).optional(),
    attributes: z.record(JsonValueSchema).default({}),
    entityRef: EntityRefSchema.optional(),
  })
  .superRefine(checkMoney);
export type EntityImportRow = z.infer<typeof EntityImportRowSchema>;
export type EntityImportRowInput = z.input<typeof EntityImportRowSchema>;

export const RelationshipImportRowSchema = z
  .object({
    type: RelationshipTypeSchema,
    sourceSystem: SourceSystemSchema,
    sourceId: SourceIdSchema,
    from: EntityRefSchema,
    to: EntityRefSchema,
    origin: RelationshipOriginSchema,
    confidence: ConfidenceSchema,
    basis: z.string().trim().min(1).max(500).optional(),
    observedAt: TimestampSchema,
  })
  .superRefine(checkBasis);
export type RelationshipImportRow = z.infer<typeof RelationshipImportRowSchema>;
export type RelationshipImportRowInput = z.input<typeof RelationshipImportRowSchema>;

export const EventImportRowSchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  sourceSystem: SourceSystemSchema,
  sourceId: SourceIdSchema,
  occurredAt: TimestampSchema,
  observedAt: TimestampSchema,
  subject: EntityRefSchema,
  related: z.array(EntityRefSchema).max(50).default([]),
  description: z.string().max(2000).optional(),
});
export type EventImportRow = z.infer<typeof EventImportRowSchema>;
export type EventImportRowInput = z.input<typeof EventImportRowSchema>;

/** Used only for tooling; the parser checks the top level by hand (R6). */
export const ImportDocumentSchema = z
  .object({
    entities: z.array(z.unknown()).optional(),
    relationships: z.array(z.unknown()).optional(),
    events: z.array(z.unknown()).optional(),
  })
  .strict();

export type ImportDocument = {
  entities?: EntityImportRowInput[];
  relationships?: RelationshipImportRowInput[];
  events?: EventImportRowInput[];
};

export const ImportCountsSchema = z.object({
  received: z.number().int().min(0),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  rejected: z.number().int().min(0),
});
export type ImportCounts = z.infer<typeof ImportCountsSchema>;

export const ImportRowErrorSchema = z.object({
  kind: ImportKindSchema,
  row: z.number().int().min(1),
  field: z.string().nullable(),
  message: z.string(),
  dependsOn: z
    .object({ kind: ImportKindSchema, row: z.number().int() })
    .nullable(),
});
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;

export const ImportReportSchema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(['APPLIED', 'REJECTED', 'DRY_RUN']),
  countsAreProjected: z.boolean(),
  trigger: z.enum(['API', 'SEED']),
  format: ImportFormatSchema,
  kind: ImportKindSchema.nullable(),
  dryRun: z.boolean(),
  fileName: z.string(),
  byteSize: z.number().int(),
  receivedAt: z.string().datetime(),
  submittedBy: z.object({ id: z.string().uuid(), email: z.string() }).nullable(),
  counts: z.object({
    entities: ImportCountsSchema,
    relationships: ImportCountsSchema,
    events: ImportCountsSchema,
  }),
  fileErrors: z.array(z.string()),
  rowErrors: z.array(ImportRowErrorSchema),
});
export type ImportReport = z.infer<typeof ImportReportSchema>;

export const ImportSummaryDtoSchema = ImportReportSchema.omit({
  rowErrors: true,
  fileErrors: true,
}).extend({ errorCount: z.number().int() });
export type ImportSummaryDto = z.infer<typeof ImportSummaryDtoSchema>;

export const ImportListResponseSchema = z.object({
  items: z.array(ImportSummaryDtoSchema),
  nextCursor: z.string().nullable(),
});
export type ImportListResponse = z.infer<typeof ImportListResponseSchema>;

export const ImportRequestFieldsSchema = z
  .object({
    format: ImportFormatSchema,
    kind: ImportKindSchema.optional(),
    dryRun: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((fields, ctx) => {
    if (fields.format === 'csv' && fields.kind === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: 'kind is required when format is csv',
      });
    }
    if (fields.format === 'json' && fields.kind !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: 'kind must not be provided when format is json',
      });
    }
  });
export type ImportRequestFields = z.infer<typeof ImportRequestFieldsSchema>;
