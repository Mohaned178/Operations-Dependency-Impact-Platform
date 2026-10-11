import {
  ROOT_CAUSE_LIMITS,
  type Confidence,
  type KeyEvidenceItemDto,
  type RelationshipOrigin,
  type RootCauseCandidateDto,
  type RootCauseStatus,
  type TraceableRelationshipType,
  type TracedEntityDto,
} from '@opsgraph/shared';
import { steps } from '../../tracing/explanation';
import { compareCodeUnits } from '../../graph/traversal/path-order';

/** Fixed templates from contracts/api.md § Explanation text. No AI, no randomness, no clock. */

const STALE_HOURS = ROOT_CAUSE_LIMITS.staleAfterMs / 3_600_000;
const EXCERPT_LENGTH = 80;

const ORIGIN_KIND: Record<RelationshipOrigin, string> = {
  SOURCE: 'source-recorded',
  INFERRED: 'inferred',
  MANUAL: 'manually recorded',
};

function events(count: number): string {
  return `${count} operational event${count === 1 ? '' : 's'}`;
}

function iso(date: Date): string {
  return date.toISOString();
}

export interface HeadlineFields {
  label: string;
  confidence: Confidence;
  possible: boolean;
  inCycle: boolean;
  continuesBeyondDepth: boolean;
}

export function headline(
  candidate: HeadlineFields,
  candidateCount: number,
  depth: number,
): string {
  const display =
    candidate.label +
    (candidate.possible ? ' (state unknown)' : '') +
    (candidate.inCycle ? ' (circular dependency)' : '') +
    (candidate.continuesBeyondDepth ? ` (deepest cause found within ${steps(depth)})` : '');
  if (candidate.confidence === 'LOW') {
    return `Possible root cause — insufficient evidence: ${display}. Confidence: LOW.`;
  }
  if (candidateCount > 1) {
    return `Possible root cause: ${display}. Confidence: ${candidate.confidence}.`;
  }
  return `Root cause: ${display}. Confidence: ${candidate.confidence}.`;
}

export interface WeakestLink {
  /** Display name of the relationship's recorded `from` end. */
  fromName: string;
  relationshipType: TraceableRelationshipType;
  /** Display name of the relationship's recorded `to` end. */
  toName: string;
  origin: RelationshipOrigin;
  /** The hop's effective confidence, which is also where the overall confidence starts. */
  confidence: Confidence;
}

export function weakestLinkReason(link: WeakestLink): string {
  return (
    `Confidence starts at ${link.confidence}, the confidence of the weakest link: ` +
    `${link.fromName} ${link.relationshipType} ${link.toName} ` +
    `(${ORIGIN_KIND[link.origin]}, ${link.confidence.toLowerCase()} confidence).`
  );
}

export function unknownStateReason(applied: boolean, names: readonly string[]): string {
  return applied
    ? `Confidence set to LOW: the state of ${names.join(', ')} is unknown.`
    : 'No step has an unknown state.';
}

export function cycleReason(applied: boolean, rootName: string): string {
  return applied
    ? `Confidence set to LOW: ${rootName} is part of a dependency cycle.`
    : 'The chain is not part of a dependency cycle.';
}

export function searchLimitReason(
  applied: boolean,
  continuesBeyondDepth: boolean,
  depth: number,
): string {
  if (!applied) {
    return `The search was complete within ${steps(depth)}.`;
  }
  return continuesBeyondDepth
    ? `Confidence is at most MEDIUM: the chain continues beyond the depth limit of ${steps(depth)}, so the true cause may lie deeper.`
    : 'Confidence is at most MEDIUM: the blocker search was truncated, so other causes may exist.';
}

export interface StaleStep {
  name: string;
  /** ISO time of the current-state observation, or null when the step was never observed. */
  observedAt: string | null;
}

export function staleReason(
  applied: boolean,
  confidence: Confidence,
  staleSteps: readonly StaleStep[],
  evaluatedAt: Date,
): string {
  if (!applied) {
    return `Every step's state was observed within ${STALE_HOURS} hours before ${iso(evaluatedAt)}.`;
  }
  const items = staleSteps
    .map((step) => `${step.name} (${step.observedAt ?? 'never observed'})`)
    .join(', ');
  return `Confidence lowered to ${confidence}: the state of ${items} was last observed more than ${STALE_HOURS} hours before ${iso(evaluatedAt)}.`;
}

export interface SourceState {
  sourceSystem: string;
  state: string;
}

/** `Order #18492 (ERP PENDING, OMS BLOCKED)`: sources in sourceSystem order. */
export function disagreementDetail(name: string, states: readonly SourceState[]): string {
  const ordered = [...states].sort(
    (a, b) => compareCodeUnits(a.sourceSystem, b.sourceSystem) || compareCodeUnits(a.state, b.state),
  );
  return `${name} (${ordered.map((entry) => `${entry.sourceSystem} ${entry.state}`).join(', ')})`;
}

/**
 * `crossClassDetails` are the entities whose per-source states fall into different
 * classifications (the rule applies); `sameClassDetails` are those whose states differ within
 * one classification (the rule does not apply, but the disagreement is still named).
 */
export function disagreementReason(
  applied: boolean,
  confidence: Confidence,
  crossClassDetails: readonly string[],
  sameClassDetails: readonly string[],
): string {
  if (applied) {
    return `Confidence lowered to ${confidence}: sources disagree on whether a step can progress: ${crossClassDetails.join('; ')}.`;
  }
  if (sameClassDetails.length > 0) {
    return `Sources report different states for ${sameClassDetails.join('; ')}, but each step's states share one classification, so confidence is not lowered.`;
  }
  return "All sources agree on each step's state.";
}

export function corroborationReason(
  applied: boolean,
  confidence: Confidence,
  rootName: string,
  sourceSystems: readonly string[],
  eventTotal: number,
): string {
  if (applied) {
    return sourceSystems.length === 0
      ? `Confidence lowered to ${confidence}: the state of ${rootName} has no source record and no operational event mentions it.`
      : `Confidence lowered to ${confidence}: the state of ${rootName} comes from a single source (${sourceSystems.join(', ')}) and no operational event mentions it.`;
  }
  return eventTotal > 0
    ? `The state of ${rootName} is corroborated by ${events(eventTotal)}.`
    : `The state of ${rootName} is reported by ${sourceSystems.length} source systems.`;
}

export interface DisputingNote {
  authorName: string;
  createdAt: string;
  text: string;
}

function excerpt(text: string): string {
  const characters = [...text];
  return characters.length > EXCERPT_LENGTH
    ? `${characters.slice(0, EXCERPT_LENGTH).join('')}…`
    : text;
}

/** `notes` are already in createdAt-then-id order. */
export function disputedReason(
  applied: boolean,
  confidence: Confidence,
  notes: readonly DisputingNote[],
): string {
  if (!applied) {
    return 'No active note disputes this chain.';
  }
  const items = notes
    .map((note) => `${note.authorName} on ${note.createdAt}: "${excerpt(note.text)}"`)
    .join(', ');
  return `Confidence lowered to ${confidence}: ${notes.length} active disputing note${notes.length === 1 ? '' : 's'}: ${items}.`;
}

export function evidenceSentence(
  keyEvidence: ReadonlyArray<Pick<KeyEvidenceItemDto, 'entity' | 'sourceSystem' | 'sourceId'>>,
  eventCount: number,
): string {
  const records = keyEvidence
    .map((item) => `${item.entity.displayName} (${item.sourceSystem} ${item.sourceId})`)
    .join(', ');
  return `Evidence: ${records}; ${events(eventCount)}.`;
}

export function summarizeRootCause(
  start: TracedEntityDto,
  status: RootCauseStatus,
  candidates: ReadonlyArray<Pick<RootCauseCandidateDto, 'label' | 'confidence'>>,
  depth: number,
): string {
  const head = `${start.displayName} is ${start.currentState}.`;
  switch (status) {
    case 'NOT_BLOCKED':
      return `${head} It is not blocked: no unsatisfied dependency was found within ${steps(depth)}, so no root cause applies.`;
    case 'UNEXPLAINED':
      return `${start.displayName} is ${start.currentState}, but no recorded dependency within ${steps(depth)} explains this state. No root cause can be named.`;
    case 'ROOT_CAUSES_FOUND': {
      const [first] = candidates;
      if (first === undefined) {
        throw new Error('summarizeRootCause: ROOT_CAUSES_FOUND without candidates');
      }
      if (candidates.length > 1) {
        return `${head} ${candidates.length} possible root causes found; highest ranked: ${first.label} (${first.confidence}).`;
      }
      return first.confidence === 'LOW'
        ? `${head} 1 possible root cause found, with insufficient evidence: ${first.label} (LOW).`
        : `${head} 1 root cause found: ${first.label} (${first.confidence}).`;
    }
  }
}
