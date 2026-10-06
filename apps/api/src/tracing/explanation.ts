import type { BlockerDto, HopDto, PathDto, TracedEntityDto } from '@opsgraph/shared';

/** Fixed templates from contracts/api.md § Explanation text. No AI, no randomness. */

function label(entity: TracedEntityDto): string {
  return entity.currentState.toLowerCase().replaceAll('_', ' ');
}

function steps(count: number): string {
  return `${count} step${count === 1 ? '' : 's'}`;
}

function subjectClause(entity: TracedEntityDto): string {
  const { displayName } = entity;
  switch (entity.state.classification) {
    case 'UNSATISFIED':
      return `${displayName} is ${label(entity)} because`;
    case 'INDETERMINATE':
      return `${displayName} has an unknown state, and`;
    case 'SATISFIED':
      return entity.currentState === 'AT_RISK'
        ? `${displayName} is at risk because`
        : `${displayName} is ${label(entity)}, but`;
  }
}

function objectClause(entity: TracedEntityDto): string {
  return entity.state.classification === 'INDETERMINATE'
    ? 'whose state is unknown'
    : `which is ${entity.currentState}`;
}

function qualifier(hop: HopDto): string {
  if (hop.effectiveOrigin === 'SOURCE') {
    return '';
  }
  const kind = hop.effectiveOrigin === 'INFERRED' ? 'inferred' : 'manually recorded';
  const basis = hop.assertions.find((assertion) => assertion.origin === hop.effectiveOrigin)?.basis;
  const basisText = basis === null || basis === undefined ? '' : `: "${basis}"`;
  return ` (${kind}, ${hop.effectiveConfidence.toLowerCase()} confidence${basisText})`;
}

/** One sentence per hop of a blocking path. */
export function explainBlockingPath(start: TracedEntityDto, path: Pick<PathDto, 'hops'>): string[] {
  return path.hops.map((hop, index) => {
    const before = index === 0 ? start : path.hops[index - 1]?.entity;
    if (before === undefined) {
      throw new Error('explainBlockingPath: hop without a preceding entity');
    }
    const subject = subjectClause(before);
    const reached = hop.entity;
    const object = objectClause(reached);
    const qualified = qualifier(hop);

    if (hop.traversal === 'FORWARD' && hop.relationshipType === 'REQUIRES') {
      return `${subject} it requires ${reached.displayName}${qualified}, ${object}.`;
    }
    if (hop.traversal === 'FORWARD' && hop.relationshipType === 'DEPENDS_ON') {
      return `${subject} it depends on ${reached.displayName}${qualified}, ${object}.`;
    }
    if (hop.traversal === 'REVERSE' && hop.relationshipType === 'BLOCKS') {
      return `${subject} ${reached.displayName}, ${object}, blocks it${qualified}.`;
    }
    throw new Error('explainBlockingPath: unsupported hop');
  });
}

/** One sentence naming the highest-ranked deepest blocker. */
export function summarizeBlockers(
  start: TracedEntityDto,
  deepestBlockers: readonly BlockerDto[],
  depth: number,
): string {
  const head = `${start.displayName} is ${start.currentState}.`;
  const [first] = deepestBlockers;
  if (first === undefined) {
    return `${head} No blockers found within ${steps(depth)}.`;
  }

  const count = deepestBlockers.length;
  const single = count === 1;
  const state = first.possible ? 'state unknown, possible blocker' : first.entity.currentState;
  const subject = `${first.entity.displayName} (${state}), ${steps(first.pathLength)} away`;
  const counted = single ? '1 deepest blocker' : `${count} deepest blockers`;

  let body: string;
  if (first.continuesBeyondDepth) {
    const found = `${counted} found within ${steps(depth)}`;
    body = single
      ? `${found}: ${subject}; the chain continues beyond the depth limit.`
      : `${found}; highest ranked: ${subject}; the chain continues beyond the depth limit.`;
  } else {
    body = single ? `${counted}: ${subject}.` : `${counted}; highest ranked: ${subject}.`;
  }
  const tail = first.inCycle ? ' It is part of a dependency cycle.' : '';
  return `${head} ${body}${tail}`;
}
