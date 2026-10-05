import { z } from 'zod';
import { JsonValueSchema, PageQuerySchema } from './common';

export const EntityTypeSchema = z.enum([
  'Customer',
  'Contract',
  'Order',
  'Product',
  'Payment',
  'Invoice',
  'Approval',
  'Warehouse',
  'Shipment',
  'Supplier',
  'SLA',
  'BudgetRequirement',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const RelationshipTypeSchema = z.enum([
  'HAS',
  'PLACED',
  'GOVERNS',
  'CONTAINS',
  'GENERATES',
  'REQUIRES',
  'DEPENDS_ON',
  'BLOCKS',
  'FULFILLED_BY',
  'SUPPLIED_BY',
  'DEFINES',
  'RELATES_TO',
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RelationshipOriginSchema = z.enum(['SOURCE', 'INFERRED', 'MANUAL']);
export type RelationshipOrigin = z.infer<typeof RelationshipOriginSchema>;

export const ConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const OperationalStateSchema = z.enum([
  'ACTIVE',
  'PENDING',
  'WAITING',
  'BLOCKED',
  'MISSING',
  'DELAYED',
  'AT_RISK',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'SUSPENDED',
  'UNKNOWN',
]);
export type OperationalState = z.infer<typeof OperationalStateSchema>;

/** FR-009. `null` means any entity type is allowed on that side. */
export const RELATIONSHIP_RULES: Record<
  RelationshipType,
  { from: readonly EntityType[] | null; to: readonly EntityType[] | null }
> = {
  HAS: { from: ['Customer'], to: ['Contract'] },
  PLACED: { from: ['Customer'], to: ['Order'] },
  GOVERNS: { from: ['Contract'], to: ['Order'] },
  CONTAINS: { from: ['Order'], to: ['Product'] },
  GENERATES: { from: ['Order'], to: ['Invoice'] },
  FULFILLED_BY: { from: ['Order', 'Shipment'], to: ['Warehouse'] },
  SUPPLIED_BY: { from: ['Product'], to: ['Supplier'] },
  DEFINES: { from: ['Contract'], to: ['SLA', 'BudgetRequirement'] },
  REQUIRES: { from: null, to: null },
  DEPENDS_ON: { from: null, to: null },
  BLOCKS: { from: null, to: null },
  RELATES_TO: { from: null, to: null },
};

/** Types that require attributes.amount + attributes.currency (R10). */
export const MONETARY_ENTITY_TYPES: readonly EntityType[] = ['Order', 'Payment', 'Invoice'];

export const EntityRefDtoSchema = z.object({
  id: z.string().uuid(),
  type: EntityTypeSchema,
  displayName: z.string(),
  currentState: OperationalStateSchema,
});
export type EntityRefDto = z.infer<typeof EntityRefDtoSchema>;

export const IdentifierDtoSchema = z.object({
  sourceSystem: z.string(),
  sourceId: z.string(),
  firstSeenAt: z.string().datetime(),
});
export type IdentifierDto = z.infer<typeof IdentifierDtoSchema>;

export const EntityListItemDtoSchema = z.object({
  id: z.string().uuid(),
  type: EntityTypeSchema,
  displayName: z.string(),
  currentState: OperationalStateSchema,
  primaryIdentifier: IdentifierDtoSchema,
  sourceSystems: z.array(z.string()),
  lastObservedAt: z.string().datetime(),
});
export type EntityListItemDto = z.infer<typeof EntityListItemDtoSchema>;

export const StateObservationDtoSchema = z.object({
  id: z.string().uuid(),
  state: OperationalStateSchema,
  sourceStatus: z.string().nullable(),
  sourceSystem: z.string(),
  sourceId: z.string(),
  observedAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  importId: z.string().uuid(),
});
export type StateObservationDto = z.infer<typeof StateObservationDtoSchema>;

export const EntityDetailDtoSchema = z.object({
  id: z.string().uuid(),
  type: EntityTypeSchema,
  displayName: z.string(),
  attributes: z.record(JsonValueSchema),
  currentState: OperationalStateSchema,
  currentStateObservation: StateObservationDtoSchema.nullable(),
  latestStateBySource: z.array(StateObservationDtoSchema),
  identifiers: z.array(IdentifierDtoSchema),
  sourceSystems: z.array(z.string()),
  lastObservedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  counts: z.object({
    sourceRecords: z.number().int().min(0),
    stateObservations: z.number().int().min(0),
    relationships: z.number().int().min(0),
    events: z.number().int().min(0),
  }),
});
export type EntityDetailDto = z.infer<typeof EntityDetailDtoSchema>;

export const SourceRecordDtoSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['ENTITY', 'RELATIONSHIP', 'EVENT']),
  sourceSystem: z.string(),
  sourceId: z.string(),
  observedAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  importId: z.string().uuid(),
  rawPayload: JsonValueSchema,
});
export type SourceRecordDto = z.infer<typeof SourceRecordDtoSchema>;

export const NeighborDtoSchema = z.object({
  relationship: z.object({
    id: z.string().uuid(),
    type: RelationshipTypeSchema,
    direction: z.enum(['OUT', 'IN']),
    origin: RelationshipOriginSchema,
    confidence: ConfidenceSchema,
    basis: z.string().nullable(),
    sourceSystem: z.string(),
    sourceId: z.string(),
    observedAt: z.string().datetime(),
    importId: z.string().uuid(),
  }),
  neighbor: EntityRefDtoSchema,
});
export type NeighborDto = z.infer<typeof NeighborDtoSchema>;

export const TimelineItemDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('EVENT'),
    id: z.string().uuid(),
    at: z.string().datetime(),
    eventType: z.string(),
    description: z.string().nullable(),
    role: z.enum(['SUBJECT', 'RELATED']),
    entities: z.array(
      z.object({
        entity: EntityRefDtoSchema,
        role: z.enum(['SUBJECT', 'RELATED']),
      }),
    ),
    sourceSystem: z.string(),
    sourceId: z.string(),
    observedAt: z.string().datetime(),
    importId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('STATE'),
    id: z.string().uuid(),
    at: z.string().datetime(),
    state: OperationalStateSchema,
    sourceStatus: z.string().nullable(),
    sourceSystem: z.string(),
    sourceId: z.string(),
    observedAt: z.string().datetime(),
    importId: z.string().uuid(),
  }),
]);
export type TimelineItemDto = z.infer<typeof TimelineItemDtoSchema>;

export const EntityListResponseSchema = z.object({
  items: z.array(EntityListItemDtoSchema),
  nextCursor: z.string().nullable(),
});
export type EntityListResponse = z.infer<typeof EntityListResponseSchema>;

export const NeighborListResponseSchema = z.object({
  items: z.array(NeighborDtoSchema),
  nextCursor: z.string().nullable(),
});
export type NeighborListResponse = z.infer<typeof NeighborListResponseSchema>;

export const TimelineResponseSchema = z.object({
  items: z.array(TimelineItemDtoSchema),
  nextCursor: z.string().nullable(),
});
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

export const StateHistoryResponseSchema = z.object({
  items: z.array(StateObservationDtoSchema),
  nextCursor: z.string().nullable(),
});
export type StateHistoryResponse = z.infer<typeof StateHistoryResponseSchema>;

export const SourceRecordListResponseSchema = z.object({
  items: z.array(SourceRecordDtoSchema),
  nextCursor: z.string().nullable(),
});
export type SourceRecordListResponse = z.infer<typeof SourceRecordListResponseSchema>;

export const SourceSystemListResponseSchema = z.object({
  items: z.array(z.string()),
});
export type SourceSystemListResponse = z.infer<typeof SourceSystemListResponseSchema>;

export const ListEntitiesQuerySchema = PageQuerySchema.extend({
  type: EntityTypeSchema.optional(),
  state: OperationalStateSchema.optional(),
  sourceSystem: z.string().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListEntitiesQuery = z.infer<typeof ListEntitiesQuerySchema>;

export const NeighborQuerySchema = PageQuerySchema.extend({
  direction: z.enum(['OUT', 'IN', 'BOTH']).default('BOTH'),
  relationshipType: RelationshipTypeSchema.optional(),
  neighborType: EntityTypeSchema.optional(),
});
export type NeighborQuery = z.infer<typeof NeighborQuerySchema>;
