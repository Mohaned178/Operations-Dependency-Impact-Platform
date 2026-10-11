import { z } from 'zod';
import {
  ConfidenceSchema,
  EntityTypeSchema,
  RelationshipOriginSchema,
  RelationshipTypeSchema,
} from './graph';
import {
  BlockersResponseSchema,
  HopAssertionDtoSchema,
  TracedEntityDtoSchema,
  commaList,
} from './tracing';

export const EXPLORER_LIMITS = {
  defaultDepth: 2,
  minDepth: 1,
  maxDepth: 4,
  maxVisibleNodes: 200,
  maxExpansions: 50,
} as const;

export const NeighborhoodDirectionSchema = z.enum(['all', 'upstream', 'downstream']);
export type NeighborhoodDirection = z.infer<typeof NeighborhoodDirectionSchema>;

/** "a,b,,a" → ["a","b"]: trimmed, empties dropped, de-duplicated, FIRST-OCCURRENCE order kept. */
const ExpandListSchema = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== ''),
  )
  .pipe(z.array(z.string().uuid()))
  .transform((ids) => [...new Set(ids)])
  .pipe(z.array(z.string().uuid()).max(EXPLORER_LIMITS.maxExpansions));

const BooleanFlagSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const explorerSettingsShape = {
  direction: NeighborhoodDirectionSchema.default('all'),
  depth: z.coerce
    .number()
    .int()
    .min(EXPLORER_LIMITS.minDepth)
    .max(EXPLORER_LIMITS.maxDepth)
    .default(EXPLORER_LIMITS.defaultDepth),
  relationshipTypes: commaList(RelationshipTypeSchema),
  entityTypes: commaList(EntityTypeSchema),
  blockers: BooleanFlagSchema,
};

function relatesToOnlyWithAll(
  value: { direction: NeighborhoodDirection; relationshipTypes: readonly string[] },
  ctx: z.RefinementCtx,
): void {
  if (value.direction !== 'all' && value.relationshipTypes.includes('RELATES_TO')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['relationshipTypes'],
      message: 'RELATES_TO is only allowed when direction is all',
    });
  }
}

/** Page URL (/graph/:id?...). Same names and formats as the API, without expand. */
export const ExplorerUrlParamsSchema = z
  .object(explorerSettingsShape)
  .superRefine(relatesToOnlyWithAll);
export type ExplorerUrlParams = z.infer<typeof ExplorerUrlParamsSchema>;

/** GET /api/entities/:id/neighborhood query. */
export const NeighborhoodQuerySchema = z
  .object({ ...explorerSettingsShape, expand: ExpandListSchema })
  .superRefine(relatesToOnlyWithAll);
export type NeighborhoodQuery = z.infer<typeof NeighborhoodQuerySchema>;

export const NodeReasonSchema = z.enum([
  'FOCUS',
  'BLOCKING_PATH',
  'NEIGHBORHOOD',
  'CONNECTOR',
  'EXPANSION',
]);
export type NodeReason = z.infer<typeof NodeReasonSchema>;

export const NeighborhoodNodeDtoSchema = TracedEntityDtoSchema.extend({
  /** 0 for the focus; base CTE distance for base candidates; null otherwise (research R9). */
  distance: z.number().int().min(0).nullable(),
  /** Every group that listed this node, in NodeReasonSchema option order. */
  reasons: z.array(NodeReasonSchema).min(1),
  /** Null only for the focus. */
  parentId: z.string().uuid().nullable(),
  /** Key of the edge parent—this node; null only for the focus. Always present in `edges`. */
  viaEdgeKey: z.string().uuid().nullable(),
  /** This node's id is in query.expand (applied). */
  expanded: z.boolean(),
});
export type NeighborhoodNodeDto = z.infer<typeof NeighborhoodNodeDtoSchema>;

export const GraphEdgeDtoSchema = z.object({
  /** Smallest relationship id of the (type, from, to) group: same rule as HopDto.key. */
  key: z.string().uuid(),
  relationshipType: RelationshipTypeSchema,
  /** As recorded. */
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  effectiveOrigin: RelationshipOriginSchema,
  effectiveConfidence: ConfidenceSchema,
  /** Same order as HopDto.assertions (origin rank, confidence, observedAt desc, id). */
  assertions: z.array(HopAssertionDtoSchema).min(1),
});
export type GraphEdgeDto = z.infer<typeof GraphEdgeDtoSchema>;

export const NeighborhoodResponseSchema = z.object({
  query: z.object({
    entityId: z.string().uuid(),
    direction: NeighborhoodDirectionSchema,
    depth: z.number().int(),
    /** Resolved: the defaults when the request gave none. Never empty. */
    relationshipTypes: z.array(RelationshipTypeSchema).min(1),
    entityTypes: z.array(EntityTypeSchema),
    /** As requested (deduplicated, request order). */
    expand: z.array(z.string().uuid()),
    blockers: z.boolean(),
  }),
  computedAt: z.string().datetime(),
  focusId: z.string().uuid(),
  /** Priority order (research R6). nodes[0] is the focus. Length 1..200. */
  nodes: z.array(NeighborhoodNodeDtoSchema).min(1).max(EXPLORER_LIMITS.maxVisibleNodes),
  /** Sorted by key (code-unit order). */
  edges: z.array(GraphEdgeDtoSchema),
  totals: z.object({
    visible: z.number().int().min(1),
    /** Candidates not shown because of the 200 cap. */
    omitted: z.number().int().min(0),
    /** True when the 10,000 exploration limit was hit: omitted is then a lower bound. */
    omittedIsLowerBound: z.boolean(),
  }),
  /** Expand ids that were not applied (unknown entity, or not visible when processed). Request order. */
  ignoredExpansions: z.array(z.string().uuid()),
  /** Feature 003 BlockersResponse, unchanged; null when query.blockers is false. */
  blockers: BlockersResponseSchema.nullable(),
});
export type NeighborhoodResponse = z.infer<typeof NeighborhoodResponseSchema>;
