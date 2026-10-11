import type {
  BlockerDto,
  BlockingPathDto,
  Confidence,
  ConfidenceRuleOutcomeDto,
  EntityEvidenceDto,
  NoteEvidenceDto,
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
  /**
   * Every active DISPUTES note per target id (entity or relationship), uncapped. Rule 8 reads it
   * alongside the capped `notes.items`, so an older dispute behind 50 newer notes still counts.
   */
  activeDisputes: ReadonlyMap<string, readonly NoteEvidenceDto[]>;
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
