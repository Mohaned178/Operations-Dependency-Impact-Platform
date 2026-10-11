import type {
  BlockingPathDto,
  CausalChainDto,
  CausalRole,
  CausalStepDto,
  TracedEntityDto,
} from '@opsgraph/shared';

/** Research R3. For a chain of `hopCount` hops, step 0 is the start and step i is hops[i - 1]. */
function rolesFor(index: number, hopCount: number): CausalRole[] {
  if (index === 0) {
    return ['SYMPTOM'];
  }
  if (index === 1) {
    return hopCount === 1 ? ['IMMEDIATE_BLOCKER', 'ROOT_CAUSE'] : ['IMMEDIATE_BLOCKER'];
  }
  return index === hopCount ? ['ROOT_CAUSE'] : ['UPSTREAM_CAUSE'];
}

export function toCausalChain(
  start: TracedEntityDto,
  path: BlockingPathDto,
  sentences: string[],
): CausalChainDto {
  const hopCount = path.hops.length;
  if (hopCount === 0) {
    throw new Error('toCausalChain: path without hops');
  }

  const steps: CausalStepDto[] = [
    {
      index: 0,
      roles: rolesFor(0, hopCount),
      possible: start.currentState === 'UNKNOWN',
      entity: start,
      hop: null,
    },
    ...path.hops.map(
      (hop, offset): CausalStepDto => ({
        index: offset + 1,
        roles: rolesFor(offset + 1, hopCount),
        possible: hop.entity.currentState === 'UNKNOWN',
        entity: hop.entity,
        hop,
      }),
    ),
  ];

  return {
    steps,
    length: path.length,
    weakestConfidence: path.weakestConfidence,
    nonSourceHops: path.nonSourceHops,
    continuesBeyondDepth: path.continuesBeyondDepth,
    endsInCycle: path.endsInCycle,
    sentences,
  };
}
