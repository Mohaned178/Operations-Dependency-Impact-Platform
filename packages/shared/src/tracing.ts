import { z } from 'zod';
import { PageQuerySchema } from './common';
import {
  ConfidenceSchema,
  EntityRefDtoSchema,
  EntityTypeSchema,
  OperationalStateSchema,
  RelationshipOriginSchema,
  RelationshipTypeSchema,
  StateObservationDtoSchema,
  type Confidence,
  type OperationalState,
  type RelationshipOrigin,
} from './graph';

export const TraceableRelationshipTypeSchema = RelationshipTypeSchema.exclude(['RELATES_TO']);
export type TraceableRelationshipType = z.infer<typeof TraceableRelationshipTypeSchema>;

export const BlockerRelationshipTypeSchema = z.enum(['REQUIRES', 'DEPENDS_ON', 'BLOCKS']);
export type BlockerRelationshipType = z.infer<typeof BlockerRelationshipTypeSchema>;

export const TRACEABLE_RELATIONSHIP_TYPES = TraceableRelationshipTypeSchema.options;
export const BLOCKER_RELATIONSHIP_TYPES = BlockerRelationshipTypeSchema.options;

export type DependencyDirection = 'FROM_DEPENDS_ON_TO' | 'TO_DEPENDS_ON_FROM';

/** Spec FR-002: which end of a relationship as recorded is the dependent one. */
export const DEPENDENCY_DIRECTION: Record<TraceableRelationshipType, DependencyDirection> = {
  REQUIRES: 'FROM_DEPENDS_ON_TO',
  DEPENDS_ON: 'FROM_DEPENDS_ON_TO',
  FULFILLED_BY: 'FROM_DEPENDS_ON_TO',
  SUPPLIED_BY: 'FROM_DEPENDS_ON_TO',
  CONTAINS: 'FROM_DEPENDS_ON_TO',
  BLOCKS: 'TO_DEPENDS_ON_FROM',
  PLACED: 'TO_DEPENDS_ON_FROM',
  HAS: 'TO_DEPENDS_ON_FROM',
  GOVERNS: 'TO_DEPENDS_ON_FROM',
  DEFINES: 'TO_DEPENDS_ON_FROM',
  GENERATES: 'TO_DEPENDS_ON_FROM',
};

export const StateClassificationSchema = z.enum(['SATISFIED', 'UNSATISFIED', 'INDETERMINATE']);
export type StateClassification = z.infer<typeof StateClassificationSchema>;

/** Spec FR-006. */
export const STATE_CLASSIFICATION: Record<OperationalState, StateClassification> = {
  ACTIVE: 'SATISFIED',
  COMPLETED: 'SATISFIED',
  AT_RISK: 'SATISFIED',
  PENDING: 'UNSATISFIED',
  WAITING: 'UNSATISFIED',
  BLOCKED: 'UNSATISFIED',
  MISSING: 'UNSATISFIED',
  DELAYED: 'UNSATISFIED',
  FAILED: 'UNSATISFIED',
  CANCELLED: 'UNSATISFIED',
  SUSPENDED: 'UNSATISFIED',
  UNKNOWN: 'INDETERMINATE',
};

export const SATISFIED_STATES: readonly OperationalState[] = OperationalStateSchema.options.filter(
  (state) => STATE_CLASSIFICATION[state] === 'SATISFIED',
);

export const TRACING_LIMITS = {
  defaultDepth: 6,
  minDepth: 1,
  maxDepth: 10,
  maxReachedEntities: 10_000,
  maxBlockingPaths: 100,
  maxEnumeratedPaths: 1_000,
  maxCycleClosingHops: 100,
} as const;

export const CONFIDENCE_RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
export const ORIGIN_RANK: Record<RelationshipOrigin, number> = {
  SOURCE: 3,
  MANUAL: 2,
  INFERRED: 1,
};

/** "A,B,,A" → ["A","B"] in schema option order. Absent or "" → []. Each item is validated. */
function commaList<T extends [string, ...string[]]>(item: z.ZodEnum<T>) {
  return z
    .string()
    .optional()
    .transform((raw) =>
      (raw ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== ''),
    )
    .pipe(z.array(item))
    .transform((values) => item.options.filter((option) => values.includes(option)));
}

export const TraceDepthSchema = z.coerce
  .number()
  .int()
  .min(TRACING_LIMITS.minDepth)
  .max(TRACING_LIMITS.maxDepth)
  .default(TRACING_LIMITS.defaultDepth);

export const TraceDirectionParamSchema = z.enum(['upstream', 'downstream']);
export type TraceDirectionParam = z.infer<typeof TraceDirectionParamSchema>;

export const DependenciesQuerySchema = PageQuerySchema.extend({
  direction: TraceDirectionParamSchema,
  depth: TraceDepthSchema,
  relationshipTypes: commaList(TraceableRelationshipTypeSchema),
  entityTypes: commaList(EntityTypeSchema),
});
export type DependenciesQuery = z.infer<typeof DependenciesQuerySchema>;

export const BlockersQuerySchema = z.object({
  depth: TraceDepthSchema,
  relationshipTypes: commaList(BlockerRelationshipTypeSchema),
  entityTypes: commaList(EntityTypeSchema),
});
export type BlockersQuery = z.infer<typeof BlockersQuerySchema>;

export const EntityStateEvidenceDtoSchema = z.object({
  classification: StateClassificationSchema,
  observation: StateObservationDtoSchema.nullable(),
  latestBySource: z.array(StateObservationDtoSchema),
});
export type EntityStateEvidenceDto = z.infer<typeof EntityStateEvidenceDtoSchema>;

export const TracedEntityDtoSchema = EntityRefDtoSchema.extend({
  state: EntityStateEvidenceDtoSchema,
});
export type TracedEntityDto = z.infer<typeof TracedEntityDtoSchema>;

export const HopAssertionDtoSchema = z.object({
  relationshipId: z.string().uuid(),
  origin: RelationshipOriginSchema,
  confidence: ConfidenceSchema,
  basis: z.string().nullable(),
  sourceSystem: z.string(),
  sourceId: z.string(),
  observedAt: z.string().datetime(),
  importId: z.string().uuid(),
});
export type HopAssertionDto = z.infer<typeof HopAssertionDtoSchema>;

export const HopDtoSchema = z.object({
  key: z.string().uuid(),
  relationshipType: TraceableRelationshipTypeSchema,
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  traversal: z.enum(['FORWARD', 'REVERSE']),
  effectiveOrigin: RelationshipOriginSchema,
  effectiveConfidence: ConfidenceSchema,
  assertions: z.array(HopAssertionDtoSchema).min(1),
  entity: TracedEntityDtoSchema,
});
export type HopDto = z.infer<typeof HopDtoSchema>;

export const PathDtoSchema = z.object({
  hops: z.array(HopDtoSchema).min(1),
  length: z.number().int().min(1),
  weakestConfidence: ConfidenceSchema,
  nonSourceHops: z.number().int().min(0),
  continuesBeyondDepth: z.boolean(),
});
export type PathDto = z.infer<typeof PathDtoSchema>;

export const BlockingPathDtoSchema = PathDtoSchema.extend({
  endsInCycle: z.boolean(),
  explanation: z.array(z.string()).min(1),
});
export type BlockingPathDto = z.infer<typeof BlockingPathDtoSchema>;

export const TraceQueryEchoSchema = z.object({
  entityId: z.string().uuid(),
  kind: z.enum(['upstream', 'downstream', 'blockers']),
  depth: z.number().int(),
  relationshipTypes: z.array(TraceableRelationshipTypeSchema).min(1),
  entityTypes: z.array(EntityTypeSchema),
});
export type TraceQueryEcho = z.infer<typeof TraceQueryEchoSchema>;

export const TruncationDtoSchema = z.object({
  depthLimit: z.boolean(),
  explorationLimit: z.boolean(),
  pathLimit: z.boolean(),
});
export type TruncationDto = z.infer<typeof TruncationDtoSchema>;

export const CycleClosingHopDtoSchema = z.object({
  key: z.string().uuid(),
  relationshipType: TraceableRelationshipTypeSchema,
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  relationshipIds: z.array(z.string().uuid()).min(1),
});
export type CycleClosingHopDto = z.infer<typeof CycleClosingHopDtoSchema>;

export const DependencyItemDtoSchema = z.object({
  entity: TracedEntityDtoSchema,
  distance: z.number().int().min(1),
  path: PathDtoSchema,
});
export type DependencyItemDto = z.infer<typeof DependencyItemDtoSchema>;

export const DependenciesResponseSchema = z.object({
  query: TraceQueryEchoSchema,
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  truncation: TruncationDtoSchema,
  totalReached: z.number().int().min(0),
  items: z.array(DependencyItemDtoSchema),
  nextCursor: z.string().nullable(),
  cycleClosingHops: z.array(CycleClosingHopDtoSchema),
  cycleClosingHopCount: z.number().int().min(0),
});
export type DependenciesResponse = z.infer<typeof DependenciesResponseSchema>;

export const BlockerDtoSchema = z.object({
  entity: TracedEntityDtoSchema,
  pathLength: z.number().int().min(1),
  possible: z.boolean(),
  continuesBeyondDepth: z.boolean(),
  inCycle: z.boolean(),
});
export type BlockerDto = z.infer<typeof BlockerDtoSchema>;

export const BlockersResponseSchema = z.object({
  query: TraceQueryEchoSchema,
  computedAt: z.string().datetime(),
  start: TracedEntityDtoSchema,
  truncation: TruncationDtoSchema,
  summary: z.string(),
  totalPaths: z.number().int().min(0),
  paths: z.array(BlockingPathDtoSchema),
  directBlockers: z.array(BlockerDtoSchema),
  deepestBlockers: z.array(BlockerDtoSchema),
  cycleClosingHops: z.array(CycleClosingHopDtoSchema),
  cycleClosingHopCount: z.number().int().min(0),
});
export type BlockersResponse = z.infer<typeof BlockersResponseSchema>;
