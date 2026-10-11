import {
  CONFIDENCE_RANK,
  ROOT_CAUSE_LIMITS,
  STATE_CLASSIFICATION,
  type Confidence,
  type ConfidenceRule,
  type ConfidenceRuleOutcomeDto,
  type EntityEvidenceDto,
  type NoteEvidenceDto,
  type RelationshipEvidenceDto,
  type TracedEntityDto,
} from '@opsgraph/shared';
import { compareCodeUnits } from '../../graph/traversal/path-order';
import {
  corroborationReason,
  cycleReason,
  disagreementDetail,
  disagreementReason,
  disputedReason,
  searchLimitReason,
  staleReason,
  unknownStateReason,
  weakestLinkReason,
  type StaleStep,
} from './explanation';
import type { ConfidenceInput, ConfidenceResult } from './types';

/** Research R6. Every rule reads only the primary chain; rules run in CONFIDENCE_RULES order. */

type Refs = ConfidenceRuleOutcomeDto['refs'];

function lower(confidence: Confidence): Confidence {
  return confidence === 'HIGH' ? 'MEDIUM' : 'LOW';
}

function ids(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function indexes(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function refs(parts: Partial<Refs> = {}): Refs {
  return {
    stepIndexes: parts.stepIndexes ?? [],
    relationshipIds: parts.relationshipIds ?? [],
    noteIds: parts.noteIds ?? [],
  };
}

function outcome(
  rule: ConfidenceRule,
  applied: boolean,
  confidenceAfter: Confidence,
  reason: string,
  outcomeRefs: Refs,
): ConfidenceRuleOutcomeDto {
  return { rule, applied, confidenceAfter, reason, refs: outcomeRefs };
}

interface Dispute {
  note: NoteEvidenceDto;
  /** The step the note is about: the entity's step, or the step reached by the hop it targets. */
  stepIndex: number;
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { chain, start, deepest, truncation, depth, evaluatedAt } = input;
  const steps: TracedEntityDto[] = [start, ...chain.hops.map((hop) => hop.entity)];
  const root = steps.at(-1);
  if (chain.hops.length === 0 || root === undefined) {
    throw new Error('computeConfidence: chain without hops');
  }
  const rootIndex = steps.length - 1;

  const nameOfEntity = (entityId: string): string => {
    const found = steps.find((step) => step.id === entityId);
    if (found === undefined) {
      throw new Error(`computeConfidence: entity ${entityId} is not on the chain`);
    }
    return found.displayName;
  };
  const evidenceOfEntity = (entityId: string): EntityEvidenceDto => {
    const found = input.entityEvidence.get(entityId);
    if (found === undefined) {
      throw new Error(`computeConfidence: no evidence for entity ${entityId}`);
    }
    return found;
  };
  const evidenceOfRelationship = (relationshipId: string): RelationshipEvidenceDto => {
    const found = input.relationshipEvidence.get(relationshipId);
    if (found === undefined) {
      throw new Error(`computeConfidence: no evidence for relationship ${relationshipId}`);
    }
    return found;
  };

  const outcomes: ConfidenceRuleOutcomeDto[] = [];

  // 1. WEAKEST_LINK: the first hop with the lowest effective confidence.
  let weakestOffset = 0;
  chain.hops.forEach((hop, offset) => {
    const current = chain.hops[weakestOffset];
    if (
      current !== undefined &&
      CONFIDENCE_RANK[hop.effectiveConfidence] < CONFIDENCE_RANK[current.effectiveConfidence]
    ) {
      weakestOffset = offset;
    }
  });
  const weakest = chain.hops[weakestOffset];
  if (weakest === undefined) {
    throw new Error('computeConfidence: chain without hops');
  }
  let confidence: Confidence = weakest.effectiveConfidence;
  outcomes.push(
    outcome(
      'WEAKEST_LINK',
      true,
      confidence,
      weakestLinkReason({
        fromName: nameOfEntity(weakest.fromEntityId),
        relationshipType: weakest.relationshipType,
        toName: nameOfEntity(weakest.toEntityId),
        origin: weakest.effectiveOrigin,
        confidence: weakest.effectiveConfidence,
      }),
      refs({
        stepIndexes: [weakestOffset + 1],
        relationshipIds: ids(weakest.assertions.map((assertion) => assertion.relationshipId)),
      }),
    ),
  );

  // 2. UNKNOWN_STATE fires on any step, the start included.
  const unknownSteps = steps.flatMap((step, index) =>
    step.currentState === 'UNKNOWN' ? [{ index, name: step.displayName }] : [],
  );
  const unknownApplied = unknownSteps.length > 0;
  if (unknownApplied) {
    confidence = 'LOW';
  }
  outcomes.push(
    outcome(
      'UNKNOWN_STATE',
      unknownApplied,
      confidence,
      unknownStateReason(
        unknownApplied,
        unknownSteps.map((step) => step.name),
      ),
      refs({ stepIndexes: unknownSteps.map((step) => step.index) }),
    ),
  );

  // 3. CYCLE
  const cycleApplied = deepest.inCycle;
  if (cycleApplied) {
    confidence = 'LOW';
  }
  outcomes.push(
    outcome(
      'CYCLE',
      cycleApplied,
      confidence,
      cycleReason(cycleApplied, root.displayName),
      refs({ stepIndexes: cycleApplied ? [rootIndex] : [] }),
    ),
  );

  // 4. SEARCH_LIMIT: applied even when the confidence is already at or below MEDIUM.
  const searchApplied =
    deepest.continuesBeyondDepth || truncation.pathLimit || truncation.explorationLimit;
  if (searchApplied && CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK.MEDIUM) {
    confidence = 'MEDIUM';
  }
  outcomes.push(
    outcome(
      'SEARCH_LIMIT',
      searchApplied,
      confidence,
      searchLimitReason(searchApplied, deepest.continuesBeyondDepth, depth),
      refs({ stepIndexes: searchApplied && deepest.continuesBeyondDepth ? [rootIndex] : [] }),
    ),
  );

  // 5. STALE_EVIDENCE: strictly more than 72 hours; a future observation is not stale.
  const staleSteps: Array<StaleStep & { index: number }> = [];
  steps.forEach((step, index) => {
    const observation = step.state.observation;
    const stale =
      observation === null ||
      evaluatedAt.getTime() - Date.parse(observation.observedAt) >
        ROOT_CAUSE_LIMITS.staleAfterMs;
    if (stale) {
      staleSteps.push({
        index,
        name: step.displayName,
        observedAt: observation === null ? null : observation.observedAt,
      });
    }
  });
  const staleApplied = staleSteps.length > 0;
  if (staleApplied) {
    confidence = lower(confidence);
  }
  outcomes.push(
    outcome(
      'STALE_EVIDENCE',
      staleApplied,
      confidence,
      staleReason(staleApplied, confidence, staleSteps, evaluatedAt),
      refs({ stepIndexes: staleSteps.map((step) => step.index) }),
    ),
  );

  // 6. CLASSIFICATION_DISAGREEMENT: only a disagreement across classifications lowers it.
  const crossClass: Array<{ index: number; detail: string }> = [];
  const sameClass: string[] = [];
  steps.forEach((step, index) => {
    const observed = step.state.latestBySource;
    if (new Set(observed.map((entry) => entry.state)).size < 2) {
      return;
    }
    const detail = disagreementDetail(
      step.displayName,
      observed.map((entry) => ({ sourceSystem: entry.sourceSystem, state: entry.state })),
    );
    const classifications = new Set(observed.map((entry) => STATE_CLASSIFICATION[entry.state]));
    if (classifications.size > 1) {
      crossClass.push({ index, detail });
    } else {
      sameClass.push(detail);
    }
  });
  const disagreementApplied = crossClass.length > 0;
  if (disagreementApplied) {
    confidence = lower(confidence);
  }
  outcomes.push(
    outcome(
      'CLASSIFICATION_DISAGREEMENT',
      disagreementApplied,
      confidence,
      disagreementReason(
        disagreementApplied,
        confidence,
        crossClass.map((entry) => entry.detail),
        sameClass,
      ),
      refs({ stepIndexes: crossClass.map((entry) => entry.index) }),
    ),
  );

  // 7. UNCORROBORATED: the root cause's state comes from at most one source (none at all is the
  // weakest case, never a reason to skip the rule) and no event mentions it.
  const rootEvidence = evidenceOfEntity(root.id);
  const rootSources = ids(
    rootEvidence.stateRecords.map((record) => record.observation.sourceSystem),
  );
  const eventTotal = rootEvidence.events.total;
  const uncorroboratedApplied = rootSources.length <= 1 && eventTotal === 0;
  if (uncorroboratedApplied) {
    confidence = lower(confidence);
  }
  outcomes.push(
    outcome(
      'UNCORROBORATED',
      uncorroboratedApplied,
      confidence,
      corroborationReason(
        uncorroboratedApplied,
        confidence,
        root.displayName,
        rootSources,
        eventTotal,
      ),
      refs({ stepIndexes: uncorroboratedApplied ? [rootIndex] : [] }),
    ),
  );

  // 8. DISPUTED: active DISPUTES notes on a chain entity or on a hop's assertion.
  const disputes = new Map<string, Dispute>();
  const collect = (notes: readonly NoteEvidenceDto[], stepIndex: number): void => {
    for (const note of notes) {
      if (note.active && note.stance === 'DISPUTES' && !disputes.has(note.id)) {
        disputes.set(note.id, { note, stepIndex });
      }
    }
  };
  // `notes.items` is capped per target; `activeDisputes` is not, so both are read.
  const disputesOf = (targetId: string) => input.activeDisputes.get(targetId) ?? [];
  steps.forEach((step, index) => {
    collect(evidenceOfEntity(step.id).notes.items, index);
    collect(disputesOf(step.id), index);
  });
  chain.hops.forEach((hop, offset) => {
    for (const assertion of hop.assertions) {
      collect(evidenceOfRelationship(assertion.relationshipId).notes.items, offset + 1);
      collect(disputesOf(assertion.relationshipId), offset + 1);
    }
  });
  const disputing = [...disputes.values()].sort(
    (a, b) =>
      compareCodeUnits(a.note.createdAt, b.note.createdAt) ||
      compareCodeUnits(a.note.id, b.note.id),
  );
  const disputedApplied = disputing.length > 0;
  if (disputedApplied) {
    confidence = lower(confidence);
  }
  outcomes.push(
    outcome(
      'DISPUTED',
      disputedApplied,
      confidence,
      disputedReason(
        disputedApplied,
        confidence,
        disputing.map(({ note }) => ({
          authorName: note.author.displayName,
          createdAt: note.createdAt,
          text: note.text,
        })),
      ),
      refs({
        stepIndexes: indexes(disputing.map((dispute) => dispute.stepIndex)),
        relationshipIds: ids(
          disputing.flatMap(({ note }) =>
            note.target.kind === 'RELATIONSHIP' ? [note.target.relationshipId] : [],
          ),
        ),
        noteIds: ids(disputing.map(({ note }) => note.id)),
      }),
    ),
  );

  return { confidence, outcomes };
}
