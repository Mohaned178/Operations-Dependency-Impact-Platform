import type { CausalRole } from '@opsgraph/shared';
import { blockingPath, traced } from '../../../test/root-cause-builders';
import { toCausalChain } from './roles';

const symptom = traced('Shipment SHP-77120', 'DELAYED', { type: 'Shipment' });

function chainOfLength(hopCount: number) {
  const entities = Array.from({ length: hopCount }, (_unused, index) =>
    traced(`Blocker ${index + 1}`, index === hopCount - 1 ? 'MISSING' : 'BLOCKED'),
  );
  const path = blockingPath(
    symptom,
    entities.map((entity) => ({ entity })),
  );
  return { entities, path, chain: toCausalChain(symptom, path, ['s']) };
}

function rolesOf(hopCount: number): CausalRole[][] {
  return chainOfLength(hopCount).chain.steps.map((step) => step.roles);
}

describe('toCausalChain role assignment (research R3)', () => {
  it('gives a 1-hop chain SYMPTOM, then IMMEDIATE_BLOCKER and ROOT_CAUSE on the same step', () => {
    expect(rolesOf(1)).toEqual([['SYMPTOM'], ['IMMEDIATE_BLOCKER', 'ROOT_CAUSE']]);
  });

  it('gives a 2-hop chain no UPSTREAM_CAUSE step', () => {
    expect(rolesOf(2)).toEqual([['SYMPTOM'], ['IMMEDIATE_BLOCKER'], ['ROOT_CAUSE']]);
  });

  it('gives a 3-hop chain one UPSTREAM_CAUSE step', () => {
    expect(rolesOf(3)).toEqual([
      ['SYMPTOM'],
      ['IMMEDIATE_BLOCKER'],
      ['UPSTREAM_CAUSE'],
      ['ROOT_CAUSE'],
    ]);
  });

  it('gives a 6-hop chain four UPSTREAM_CAUSE steps', () => {
    expect(rolesOf(6)).toEqual([
      ['SYMPTOM'],
      ['IMMEDIATE_BLOCKER'],
      ['UPSTREAM_CAUSE'],
      ['UPSTREAM_CAUSE'],
      ['UPSTREAM_CAUSE'],
      ['UPSTREAM_CAUSE'],
      ['ROOT_CAUSE'],
    ]);
  });
});

describe('toCausalChain structure', () => {
  it('numbers the steps from 0, with the start first and no hop on step 0', () => {
    const { entities, path, chain } = chainOfLength(3);
    expect(chain.steps.map((step) => step.index)).toEqual([0, 1, 2, 3]);
    expect(chain.steps.map((step) => step.entity.id)).toEqual([
      symptom.id,
      ...entities.map((entity) => entity.id),
    ]);
    expect(chain.steps[0]?.hop).toBeNull();
    expect(chain.steps.slice(1).map((step) => step.hop)).toEqual(path.hops);
  });

  it('copies length, confidence, flags and the given sentences from the path', () => {
    const blocker = traced('Blocker', 'MISSING');
    const path = blockingPath(
      symptom,
      [{ entity: blocker, origin: 'INFERRED', confidence: 'MEDIUM' }],
      { continuesBeyondDepth: true, endsInCycle: true },
    );
    const chain = toCausalChain(symptom, path, ['first', 'second']);
    expect(chain).toMatchObject({
      length: 1,
      weakestConfidence: 'MEDIUM',
      nonSourceHops: 1,
      continuesBeyondDepth: true,
      endsInCycle: true,
      sentences: ['first', 'second'],
    });
  });

  it('marks a step possible only when its entity state is UNKNOWN', () => {
    const unknownMiddle = traced('Mystery Record', 'UNKNOWN');
    const root = traced('Budget code', 'MISSING');
    const chain = toCausalChain(
      symptom,
      blockingPath(symptom, [{ entity: unknownMiddle }, { entity: root }]),
      ['s'],
    );
    expect(chain.steps.map((step) => step.possible)).toEqual([false, true, false]);
  });

  it('marks an UNKNOWN start as possible', () => {
    const unknownStart = traced('Mystery Start', 'UNKNOWN');
    const chain = toCausalChain(
      unknownStart,
      blockingPath(unknownStart, [{ entity: traced('Root', 'MISSING') }]),
      ['s'],
    );
    expect(chain.steps[0]?.possible).toBe(true);
  });

  it('refuses a path without hops', () => {
    const empty = { ...blockingPath(symptom, [{ entity: traced('x', 'MISSING') }]), hops: [] };
    expect(() => toCausalChain(symptom, empty, ['s'])).toThrow('path without hops');
  });
});
