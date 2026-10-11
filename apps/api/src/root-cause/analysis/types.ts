import type {
  BlockerDto,
  BlockingPathDto,
  Confidence,
  ConfidenceRuleOutcomeDto,
  EntityEvidenceDto,
  RelationshipEvidenceDto,
  TracedEntityDto,
  TruncationDto,
} from '@opsgraph/shared';

export interface ConfidenceInput {
  /** Primary chain (003 DTO). */
  chain: BlockingPathDto;
  start: TracedEntityDto;
  /** From BlockersResponse.deepestBlockers. */
  deepest: BlockerDto;
  truncation: TruncationDto;
  /** The query depth, for the SEARCH_LIMIT reasons ("within 6 steps"). */
  depth: number;
  evaluatedAt: Date;
  /** Evidence for every entity on the chain, start included. */
  entityEvidence: ReadonlyMap<string, EntityEvidenceDto>;
  /** Evidence for every assertion id on every hop of the chain. */
  relationshipEvidence: ReadonlyMap<string, RelationshipEvidenceDto>;
}

export interface ConfidenceResult {
  confidence: Confidence;
  /** Always 8, in CONFIDENCE_RULES order. */
  outcomes: ConfidenceRuleOutcomeDto[];
}

export interface CandidateGroup {
  deepestEntityId: string;
  primary: BlockingPathDto;
  /** Index of the primary chain in the blockers response `paths`. */
  primaryIndex: number;
  alternatives: BlockingPathDto[];
}
