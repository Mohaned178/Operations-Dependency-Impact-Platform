import { z } from 'zod';
import { JsonValueSchema } from './common';
import { EvidenceNoteDtoSchema } from './evidence-notes';
import {
  ConfidenceSchema,
  EntityRefDtoSchema,
  RelationshipOriginSchema,
  SourceRecordDtoSchema,
  StateObservationDtoSchema,
} from './graph';
import {
  HopDtoSchema,
  TraceDepthSchema,
  TracedEntityDtoSchema,
  TruncationDtoSchema,
} from './tracing';

export const CAUSAL_ROLES = [
  'SYMPTOM',
  'IMMEDIATE_BLOCKER',
  'UPSTREAM_CAUSE',
  'ROOT_CAUSE',
] as const;
export const CausalRoleSchema = z.enum(CAUSAL_ROLES);
export type CausalRole = z.infer<typeof CausalRoleSchema>;

/** Evaluation order (research R6). */
export const CONFIDENCE_RULES = [
  'WEAKEST_LINK',
  'UNKNOWN_STATE',
  'CYCLE',
  'SEARCH_LIMIT',
  'STALE_EVIDENCE',
  'CLASSIFICATION_DISAGREEMENT',
  'UNCORROBORATED',
  'DISPUTED',
] as const;
export const ConfidenceRuleSchema = z.enum(CONFIDENCE_RULES);
export type ConfidenceRule = z.infer<typeof ConfidenceRuleSchema>;

export const LabelRuleSchema = z.enum(['REQUIRED_FIELD', 'DISPLAY_NAME_STATE']);
export type LabelRule = z.infer<typeof LabelRuleSchema>;

export const EvidenceRuleSchema = z.enum([
  'STATE_RECORD',
  'RELATIONSHIP_RECORD',
  'REQUIREMENT_SOURCE',
  'EVENT',
  'MANUAL_NOTE',
]);
export type EvidenceRule = z.infer<typeof EvidenceRuleSchema>;

export const RootCauseStatusSchema = z.enum(['ROOT_CAUSES_FOUND', 'NOT_BLOCKED', 'UNEXPLAINED']);
export type RootCauseStatus = z.infer<typeof RootCauseStatusSchema>;

export const ROOT_CAUSE_LIMITS = {
  /** FR-017 rule 5 (clarification Q2). */
  staleAfterMs: 72 * 60 * 60 * 1000,
  eventsPerEntity: 20,
  requirementSourcesPerEntity: 20,
  notesPerTarget: 50,
} as const;

export const REQUIREMENT_SOURCE_RELATIONSHIP_TYPES = ['DEFINES', 'GOVERNS'] as const;

export const RootCauseQuerySchema = z.object({
  depth: TraceDepthSchema,
  evaluatedAt: z.string().datetime().optional(),
});
export type RootCauseQuery = z.infer<typeof RootCauseQuerySchema>;

const Counted = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().min(0) });

export const StateRecordEvidenceDtoSchema = z.object({
  rule: z.literal('STATE_RECORD'),
  origin: z.literal('SOURCE'),
  /** True for the observation that set currentState. */
  current: z.boolean(),
  observation: StateObservationDtoSchema,
  sourceRecord: SourceRecordDtoSchema,
});
export type StateRecordEvidenceDto = z.infer<typeof StateRecordEvidenceDtoSchema>;

export const RequirementSourceDtoSchema = z.object({
  rule: z.literal('REQUIREMENT_SOURCE'),
  /** Origin of the DEFINES/GOVERNS relationship. */
  origin: RelationshipOriginSchema,
  confidence: ConfidenceSchema,
  relationship: z.object({
    id: z.string().uuid(),
    type: z.enum(['DEFINES', 'GOVERNS']),
    fromEntityId: z.string().uuid(),
    toEntityId: z.string().uuid(),
    basis: z.string().nullable(),
    sourceSystem: z.string(),
    sourceId: z.string(),
    observedAt: z.string().datetime(),
  }),
  /** The defining entity (for example the contract). */
  entity: EntityRefDtoSchema,
  attributes: z.record(JsonValueSchema),
  /** Its current state record. */
  stateRecord: StateRecordEvidenceDtoSchema.nullable(),
});
export type RequirementSourceDto = z.infer<typeof RequirementSourceDtoSchema>;

export const EventEvidenceDtoSchema = z.object({
  rule: z.literal('EVENT'),
  origin: z.literal('SOURCE'),
  id: z.string().uuid(),
  eventType: z.string(),
  occurredAt: z.string().datetime(),
  observedAt: z.string().datetime(),
  description: z.string().nullable(),
  /** Of the evidenced entity in this event. */
  role: z.enum(['SUBJECT', 'RELATED']),
  entities: z.array(z.object({ entity: EntityRefDtoSchema, role: z.enum(['SUBJECT', 'RELATED']) })),
  sourceSystem: z.string(),
  sourceId: z.string(),
  importId: z.string().uuid(),
});
export type EventEvidenceDto = z.infer<typeof EventEvidenceDtoSchema>;

export const NoteEvidenceDtoSchema = EvidenceNoteDtoSchema.extend({
  rule: z.literal('MANUAL_NOTE'),
  origin: z.literal('MANUAL'),
});
export type NoteEvidenceDto = z.infer<typeof NoteEvidenceDtoSchema>;

export const EntityEvidenceDtoSchema = z.object({
  entityId: z.string().uuid(),
  /** Current first, then other sources by sourceSystem. */
  stateRecords: z.array(StateRecordEvidenceDtoSchema),
  /** At most 20 items. */
  requirementSources: Counted(RequirementSourceDtoSchema),
  /** At most 20 items, newest first. */
  events: Counted(EventEvidenceDtoSchema),
  /** At most 50 items, newest first. */
  notes: Counted(NoteEvidenceDtoSchema),
});
export type EntityEvidenceDto = z.infer<typeof EntityEvidenceDtoSchema>;

export const RelationshipEvidenceDtoSchema = z.object({
  relationshipId: z.string().uuid(),
  rule: z.literal('RELATIONSHIP_RECORD'),
  origin: RelationshipOriginSchema,
  confidence: ConfidenceSchema,
  /** Latest source record of this assertion. */
  record: SourceRecordDtoSchema.nullable(),
  notes: Counted(NoteEvidenceDtoSchema),
});
export type RelationshipEvidenceDto = z.infer<typeof RelationshipEvidenceDtoSchema>;

export const CausalStepDtoSchema = z.object({
  /** 0 = symptom. */
  index: z.number().int().min(0),
  /** In CAUSAL_ROLES order. */
  roles: z.array(CausalRoleSchema).min(1),
  /** The entity state is UNKNOWN. */
  possible: z.boolean(),
  entity: TracedEntityDtoSchema,
  /** Null only at index 0. */
  hop: HopDtoSchema.nullable(),
});
export type CausalStepDto = z.infer<typeof CausalStepDtoSchema>;

export const CausalChainDtoSchema = z.object({
  steps: z.array(CausalStepDtoSchema).min(2),
  /** Hops = steps.length - 1. */
  length: z.number().int().min(1),
  weakestConfidence: ConfidenceSchema,
  nonSourceHops: z.number().int().min(0),
  continuesBeyondDepth: z.boolean(),
  endsInCycle: z.boolean(),
  /** 003 templates; HEDGED when the candidate is LOW. */
  sentences: z.array(z.string()).min(1),
});
export type CausalChainDto = z.infer<typeof CausalChainDtoSchema>;

export const KeyEvidenceItemDtoSchema = z.object({
  rule: z.enum(['STATE_RECORD', 'REQUIREMENT_SOURCE']),
  origin: RelationshipOriginSchema,
  entity: EntityRefDtoSchema,
  sourceRecordId: z.string().uuid(),
  sourceSystem: z.string(),
  sourceId: z.string(),
  observedAt: z.string().datetime(),
});
export type KeyEvidenceItemDto = z.infer<typeof KeyEvidenceItemDtoSchema>;

export const ConfidenceRuleOutcomeDtoSchema = z.object({
  rule: ConfidenceRuleSchema,
  applied: z.boolean(),
  confidenceAfter: ConfidenceSchema,
  reason: z.string(),
  refs: z.object({
    stepIndexes: z.array(z.number().int().min(0)),
    relationshipIds: z.array(z.string().uuid()),
    noteIds: z.array(z.string().uuid()),
  }),
});
export type ConfidenceRuleOutcomeDto = z.infer<typeof ConfidenceRuleOutcomeDtoSchema>;

export const RootCauseCandidateDtoSchema = z.object({
  rootCause: TracedEntityDtoSchema,
  label: z.string(),
  labelRule: LabelRuleSchema,
  possible: z.boolean(),
  inCycle: z.boolean(),
  continuesBeyondDepth: z.boolean(),
  /** Confidence is LOW. */
  insufficientEvidence: z.boolean(),
  confidence: ConfidenceSchema,
  confidenceRules: z.array(ConfidenceRuleOutcomeDtoSchema).length(CONFIDENCE_RULES.length),
  primaryChain: CausalChainDtoSchema,
  alternativeChains: z.array(CausalChainDtoSchema),
  keyEvidence: z.array(KeyEvidenceItemDtoSchema),
  eventCount: z.number().int().min(0),
  explanation: z.object({
    headline: z.string(),
    /** Equals primaryChain.sentences. */
    chain: z.array(z.string()).min(1),
    /** Reasons of applied rules, in rule order. */
    confidence: z.array(z.string()).min(1),
    evidence: z.string(),
  }),
});
export type RootCauseCandidateDto = z.infer<typeof RootCauseCandidateDtoSchema>;

export const RootCauseResponseSchema = z.object({
  query: z.object({
    entityId: z.string().uuid(),
    depth: z.number().int(),
    evaluatedAt: z.string().datetime(),
  }),
  computedAt: z.string().datetime(),
  status: RootCauseStatusSchema,
  start: TracedEntityDtoSchema,
  summary: z.string(),
  /** From the 003 blockers response. */
  truncation: TruncationDtoSchema,
  /** Empty unless ROOT_CAUSES_FOUND. */
  candidates: z.array(RootCauseCandidateDtoSchema),
  evidence: z.object({
    /** First-appearance order (data-model §4). */
    entities: z.array(EntityEvidenceDtoSchema),
    relationships: z.array(RelationshipEvidenceDtoSchema),
  }),
});
export type RootCauseResponse = z.infer<typeof RootCauseResponseSchema>;
