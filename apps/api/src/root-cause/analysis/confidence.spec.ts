import {
  CONFIDENCE_RULES,
  type ConfidenceRule,
  type EntityEvidenceDto,
  type NoteEvidenceDto,
  type RelationshipEvidenceDto,
  type TracedEntityDto,
} from '@opsgraph/shared';
import {
  blockingPath,
  entityEvidence,
  noteEvidence,
  relationshipEvidence,
  stateRecord,
  traced,
  uuid,
  type HopSpec,
  type TracedOptions,
} from '../../../test/root-cause-builders';
import { computeConfidence } from './confidence';
import type { ConfidenceInput, ConfidenceResult } from './types';

const EVALUATED_AT = new Date('2026-09-29T16:00:00.000Z');
const T_START = '2026-09-29T11:40:00.000Z';
const T_OTHER = '2026-09-29T10:05:00.000Z';

interface Trio {
  start: TracedEntityDto;
  middle: TracedEntityDto;
  root: TracedEntityDto;
}

/** Order BLOCKED -> Payment PENDING -> Budget code MISSING, all fresh and all HIGH/SOURCE. */
function trio(
  options: { start?: TracedOptions; middle?: TracedOptions; root?: TracedOptions } = {},
): Trio {
  return {
    start: traced('Order #18492', 'BLOCKED', { observedAt: T_START, sourceSystem: 'OMS', ...options.start }),
    middle: traced('Payment PAY-88213', 'PENDING', {
      type: 'Payment',
      observedAt: T_OTHER,
      sourceSystem: 'Payments',
      ...options.middle,
    }),
    root: traced('Budget code for Order #18492', 'MISSING', {
      type: 'BudgetRequirement',
      observedAt: T_OTHER,
      sourceSystem: 'FinanceApprovals',
      ...options.root,
    }),
  };
}

interface InputOptions {
  middleHop?: Partial<HopSpec>;
  rootHop?: Partial<HopSpec>;
  continuesBeyondDepth?: boolean;
  inCycle?: boolean;
  truncation?: Partial<ConfidenceInput['truncation']>;
  depth?: number;
  evaluatedAt?: Date;
  evidence?: Partial<Record<keyof Trio, Parameters<typeof entityEvidence>[1]>>;
  relationshipNotes?: Record<string, NoteEvidenceDto[]>;
  activeDisputes?: Map<string, NoteEvidenceDto[]>;
}

function inputFor(entities: Trio, options: InputOptions = {}): ConfidenceInput {
  const chain = blockingPath(
    entities.start,
    [
      { entity: entities.middle, ...options.middleHop },
      { entity: entities.root, ...options.rootHop },
    ],
    { continuesBeyondDepth: options.continuesBeyondDepth },
  );

  const entityEvidenceById = new Map<string, EntityEvidenceDto>();
  for (const key of ['start', 'middle', 'root'] as const) {
    entityEvidenceById.set(
      entities[key].id,
      entityEvidence(entities[key], { eventTotal: 1, ...options.evidence?.[key] }),
    );
  }
  const relationshipEvidenceById = new Map<string, RelationshipEvidenceDto>();
  for (const hop of chain.hops) {
    for (const assertion of hop.assertions) {
      relationshipEvidenceById.set(
        assertion.relationshipId,
        relationshipEvidence(assertion.relationshipId, {
          notes: options.relationshipNotes?.[assertion.relationshipId],
        }),
      );
    }
  }

  return {
    chain,
    start: entities.start,
    deepest: {
      entity: entities.root,
      pathLength: chain.length,
      possible: false,
      continuesBeyondDepth: options.continuesBeyondDepth ?? false,
      inCycle: options.inCycle ?? false,
    },
    truncation: { depthLimit: false, explorationLimit: false, pathLimit: false, ...options.truncation },
    depth: options.depth ?? 6,
    evaluatedAt: options.evaluatedAt ?? EVALUATED_AT,
    entityEvidence: entityEvidenceById,
    relationshipEvidence: relationshipEvidenceById,
    activeDisputes: options.activeDisputes ?? new Map(),
  };
}

function appliedRules(result: ConfidenceResult): ConfidenceRule[] {
  return result.outcomes.filter((entry) => entry.applied).map((entry) => entry.rule);
}

function outcomeOf(result: ConfidenceResult, rule: ConfidenceRule) {
  const found = result.outcomes.find((entry) => entry.rule === rule);
  if (found === undefined) {
    throw new Error(`no outcome for ${rule}`);
  }
  return found;
}

const NO_REFS = { stepIndexes: [], relationshipIds: [], noteIds: [] };

describe('computeConfidence: shape', () => {
  it('returns HIGH with 8 outcomes in rule order when nothing weakens the chain', () => {
    const result = computeConfidence(inputFor(trio()));
    expect(result.confidence).toBe('HIGH');
    expect(result.outcomes.map((entry) => entry.rule)).toEqual([...CONFIDENCE_RULES]);
    expect(appliedRules(result)).toEqual(['WEAKEST_LINK']);
    expect(result.outcomes.every((entry) => entry.confidenceAfter === 'HIGH')).toBe(true);
    for (const entry of result.outcomes.slice(1)) {
      expect(entry.refs).toEqual(NO_REFS);
    }
  });

  it('refuses a chain without hops', () => {
    const input = inputFor(trio());
    expect(() => computeConfidence({ ...input, chain: { ...input.chain, hops: [] } })).toThrow(
      'chain without hops',
    );
  });

  it('refuses a chain entity that has no evidence', () => {
    const input = inputFor(trio());
    expect(() => computeConfidence({ ...input, entityEvidence: new Map() })).toThrow(
      'no evidence for entity',
    );
  });
});

describe('rule 1: WEAKEST_LINK', () => {
  it('starts at the weakest hop, naming the first hop when several are equally weak', () => {
    const entities = trio();
    const result = computeConfidence(
      inputFor(entities, {
        middleHop: { confidence: 'MEDIUM' },
        rootHop: { confidence: 'MEDIUM' },
      }),
    );
    expect(result.confidence).toBe('MEDIUM');
    const weakest = outcomeOf(result, 'WEAKEST_LINK');
    expect(weakest.refs.stepIndexes).toEqual([1]);
    expect(weakest.reason).toBe(
      'Confidence starts at MEDIUM, the confidence of the weakest link: Order #18492 REQUIRES Payment PAY-88213 (source-recorded, medium confidence).',
    );
  });

  it('points at the step reached by the weakest hop and sorts its assertion ids', () => {
    const b2 = '00000000-0000-4000-8000-0000000000b2';
    const b1 = '00000000-0000-4000-8000-0000000000b1';
    const result = computeConfidence(
      inputFor(trio(), { rootHop: { confidence: 'LOW', assertionIds: [b2, b1] } }),
    );
    expect(result.confidence).toBe('LOW');
    expect(outcomeOf(result, 'WEAKEST_LINK').refs).toEqual({
      stepIndexes: [2],
      relationshipIds: [b1, b2],
      noteIds: [],
    });
  });

  it('names the recorded ends of a reversed hop and its effective origin', () => {
    const result = computeConfidence(
      inputFor(trio(), {
        middleHop: {
          relationshipType: 'BLOCKS',
          traversal: 'REVERSE',
          origin: 'MANUAL',
          confidence: 'MEDIUM',
        },
      }),
    );
    expect(outcomeOf(result, 'WEAKEST_LINK').reason).toBe(
      'Confidence starts at MEDIUM, the confidence of the weakest link: Payment PAY-88213 BLOCKS Order #18492 (manually recorded, medium confidence).',
    );
  });
});

describe('rule 2: UNKNOWN_STATE', () => {
  it('sets LOW over HIGH when a middle step is UNKNOWN', () => {
    const unknownMiddle = {
      ...trio(),
      middle: traced('Mystery Record', 'UNKNOWN', { observedAt: T_OTHER }),
    };
    const result = computeConfidence(inputFor(unknownMiddle));
    expect(result.confidence).toBe('LOW');
    expect(appliedRules(result)).toEqual(['WEAKEST_LINK', 'UNKNOWN_STATE']);
    const unknown = outcomeOf(result, 'UNKNOWN_STATE');
    expect(unknown.reason).toBe('Confidence set to LOW: the state of Mystery Record is unknown.');
    expect(unknown.refs.stepIndexes).toEqual([1]);
    expect(result.outcomes.slice(1).every((entry) => entry.confidenceAfter === 'LOW')).toBe(true);
  });

  it('counts an UNKNOWN start and lists every unknown step in chain order', () => {
    const entities = trio();
    const result = computeConfidence(
      inputFor({
        start: traced('Mystery Start', 'UNKNOWN', { observedAt: T_START }),
        middle: entities.middle,
        root: traced('Mystery Root', 'UNKNOWN', { observedAt: T_OTHER, sourceSystem: 'FinanceApprovals' }),
      }),
    );
    const unknown = outcomeOf(result, 'UNKNOWN_STATE');
    expect(unknown.reason).toBe(
      'Confidence set to LOW: the state of Mystery Start, Mystery Root is unknown.',
    );
    expect(unknown.refs.stepIndexes).toEqual([0, 2]);
  });
});

describe('rule 3: CYCLE', () => {
  it('sets LOW over HIGH when the deepest blocker is in a cycle', () => {
    const result = computeConfidence(inputFor(trio(), { inCycle: true }));
    expect(result.confidence).toBe('LOW');
    expect(appliedRules(result)).toEqual(['WEAKEST_LINK', 'CYCLE']);
    const cycle = outcomeOf(result, 'CYCLE');
    expect(cycle.reason).toBe(
      'Confidence set to LOW: Budget code for Order #18492 is part of a dependency cycle.',
    );
    expect(cycle.refs.stepIndexes).toEqual([2]);
  });
});

describe('rule 4: SEARCH_LIMIT', () => {
  it('caps HIGH to MEDIUM when the chain continues beyond the depth', () => {
    const result = computeConfidence(inputFor(trio(), { continuesBeyondDepth: true, depth: 3 }));
    expect(result.confidence).toBe('MEDIUM');
    const search = outcomeOf(result, 'SEARCH_LIMIT');
    expect(search.applied).toBe(true);
    expect(search.reason).toBe(
      'Confidence is at most MEDIUM: the chain continues beyond the depth limit of 3 steps, so the true cause may lie deeper.',
    );
    expect(search.refs.stepIndexes).toEqual([2]);
  });

  it('stays applied on LOW, where it changes nothing', () => {
    const result = computeConfidence(
      inputFor(trio(), { rootHop: { confidence: 'LOW' }, continuesBeyondDepth: true }),
    );
    expect(result.confidence).toBe('LOW');
    const search = outcomeOf(result, 'SEARCH_LIMIT');
    expect(search.applied).toBe(true);
    expect(search.confidenceAfter).toBe('LOW');
  });

  it('is triggered by truncation.pathLimit alone', () => {
    const result = computeConfidence(inputFor(trio(), { truncation: { pathLimit: true } }));
    expect(result.confidence).toBe('MEDIUM');
    const search = outcomeOf(result, 'SEARCH_LIMIT');
    expect(search.applied).toBe(true);
    expect(search.reason).toBe(
      'Confidence is at most MEDIUM: the blocker search was truncated, so other causes may exist.',
    );
    expect(search.refs).toEqual(NO_REFS);
  });

  it('is triggered by truncation.explorationLimit alone', () => {
    const result = computeConfidence(inputFor(trio(), { truncation: { explorationLimit: true } }));
    expect(result.confidence).toBe('MEDIUM');
    expect(outcomeOf(result, 'SEARCH_LIMIT').applied).toBe(true);
  });

  it('is not triggered by truncation.depthLimit alone', () => {
    const result = computeConfidence(inputFor(trio(), { truncation: { depthLimit: true } }));
    expect(result.confidence).toBe('HIGH');
    expect(outcomeOf(result, 'SEARCH_LIMIT')).toMatchObject({
      applied: false,
      reason: 'The search was complete within 6 steps.',
    });
  });
});

describe('rule 5: STALE_EVIDENCE', () => {
  const OBSERVED = '2026-09-29T10:05:00.000Z';
  const exactly72h = new Date('2026-10-02T10:05:00.000Z');

  function allObservedAt(observedAt: string | null): Trio {
    return trio({ start: { observedAt }, middle: { observedAt }, root: { observedAt } });
  }

  it('is not stale at exactly 72 hours', () => {
    const result = computeConfidence(inputFor(allObservedAt(OBSERVED), { evaluatedAt: exactly72h }));
    expect(outcomeOf(result, 'STALE_EVIDENCE').applied).toBe(false);
    expect(result.confidence).toBe('HIGH');
  });

  it('is stale at 72 hours plus 1 ms, and lowers once however many steps are stale', () => {
    const result = computeConfidence(
      inputFor(allObservedAt(OBSERVED), { evaluatedAt: new Date(exactly72h.getTime() + 1) }),
    );
    const stale = outcomeOf(result, 'STALE_EVIDENCE');
    expect(stale.applied).toBe(true);
    expect(stale.refs.stepIndexes).toEqual([0, 1, 2]);
    expect(stale.confidenceAfter).toBe('MEDIUM');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('lists only the stale steps', () => {
    const entities = trio({
      start: { observedAt: '2026-10-02T09:00:00.000Z' },
      middle: { observedAt: '2026-10-02T09:00:00.000Z' },
      root: { observedAt: OBSERVED },
    });
    const result = computeConfidence(inputFor(entities, { evaluatedAt: new Date('2026-10-02T12:00:00.000Z') }));
    const stale = outcomeOf(result, 'STALE_EVIDENCE');
    expect(stale.refs.stepIndexes).toEqual([2]);
    expect(stale.reason).toBe(
      'Confidence lowered to MEDIUM: the state of Budget code for Order #18492 (2026-09-29T10:05:00.000Z) was last observed more than 72 hours before 2026-10-02T12:00:00.000Z.',
    );
  });

  it('does not treat an observation after the evaluation time as stale', () => {
    const result = computeConfidence(
      inputFor(allObservedAt('2026-10-05T00:00:00.000Z'), { evaluatedAt: EVALUATED_AT }),
    );
    expect(outcomeOf(result, 'STALE_EVIDENCE').applied).toBe(false);
  });

  it('treats a missing observation as stale: never observed', () => {
    const entities = trio({ middle: { observedAt: null } });
    const result = computeConfidence(inputFor(entities));
    const stale = outcomeOf(result, 'STALE_EVIDENCE');
    expect(stale.applied).toBe(true);
    expect(stale.refs.stepIndexes).toEqual([1]);
    expect(stale.reason).toBe(
      'Confidence lowered to MEDIUM: the state of Payment PAY-88213 (never observed) was last observed more than 72 hours before 2026-09-29T16:00:00.000Z.',
    );
  });
});

describe('rule 6: CLASSIFICATION_DISAGREEMENT', () => {
  it('does not apply within one classification, but still names the disagreement', () => {
    const entities = trio({
      start: {
        latestBySource: [
          { sourceSystem: 'OMS', state: 'BLOCKED' },
          { sourceSystem: 'ERP', state: 'PENDING' },
        ],
      },
    });
    const result = computeConfidence(inputFor(entities));
    expect(result.confidence).toBe('HIGH');
    const disagreement = outcomeOf(result, 'CLASSIFICATION_DISAGREEMENT');
    expect(disagreement.applied).toBe(false);
    expect(disagreement.refs).toEqual(NO_REFS);
    expect(disagreement.reason).toBe(
      "Sources report different states for Order #18492 (ERP PENDING, OMS BLOCKED), but each step's states share one classification, so confidence is not lowered.",
    );
  });

  it('applies across classifications and lowers once', () => {
    const entities = trio({
      middle: {
        latestBySource: [
          { sourceSystem: 'Payments', state: 'COMPLETED' },
          { sourceSystem: 'ERP', state: 'PENDING' },
        ],
      },
      root: {
        latestBySource: [
          { sourceSystem: 'FinanceApprovals', state: 'ACTIVE' },
          { sourceSystem: 'ERP', state: 'MISSING' },
        ],
      },
    });
    const result = computeConfidence(inputFor(entities));
    expect(result.confidence).toBe('MEDIUM');
    const disagreement = outcomeOf(result, 'CLASSIFICATION_DISAGREEMENT');
    expect(disagreement.applied).toBe(true);
    expect(disagreement.confidenceAfter).toBe('MEDIUM');
    expect(disagreement.refs.stepIndexes).toEqual([1, 2]);
    expect(disagreement.reason).toBe(
      'Confidence lowered to MEDIUM: sources disagree on whether a step can progress: Payment PAY-88213 (ERP PENDING, Payments COMPLETED); Budget code for Order #18492 (ERP MISSING, FinanceApprovals ACTIVE).',
    );
  });

  it('treats an empty latestBySource as no disagreement', () => {
    const result = computeConfidence(inputFor(trio()));
    expect(outcomeOf(result, 'CLASSIFICATION_DISAGREEMENT').reason).toBe(
      "All sources agree on each step's state.",
    );
  });

  it('treats several sources that report the same state as agreement', () => {
    const entities = trio({
      start: {
        latestBySource: [
          { sourceSystem: 'OMS', state: 'BLOCKED' },
          { sourceSystem: 'ERP', state: 'BLOCKED' },
        ],
      },
    });
    const result = computeConfidence(inputFor(entities));
    expect(outcomeOf(result, 'CLASSIFICATION_DISAGREEMENT').reason).toBe(
      "All sources agree on each step's state.",
    );
  });
});

describe('rule 7: UNCORROBORATED', () => {
  it('applies for one source system and 0 events', () => {
    const result = computeConfidence(inputFor(trio(), { evidence: { root: { eventTotal: 0 } } }));
    expect(result.confidence).toBe('MEDIUM');
    const uncorroborated = outcomeOf(result, 'UNCORROBORATED');
    expect(uncorroborated.applied).toBe(true);
    expect(uncorroborated.refs.stepIndexes).toEqual([2]);
    expect(uncorroborated.reason).toBe(
      'Confidence lowered to MEDIUM: the state of Budget code for Order #18492 comes from a single source (FinanceApprovals) and no operational event mentions it.',
    );
  });

  it('does not apply for one source system and 1 event', () => {
    const result = computeConfidence(inputFor(trio(), { evidence: { root: { eventTotal: 1 } } }));
    const uncorroborated = outcomeOf(result, 'UNCORROBORATED');
    expect(uncorroborated.applied).toBe(false);
    expect(uncorroborated.reason).toBe(
      'The state of Budget code for Order #18492 is corroborated by 1 operational event.',
    );
  });

  it('does not apply for two source systems and 0 events', () => {
    const entities = trio();
    const result = computeConfidence(
      inputFor(entities, {
        evidence: {
          root: {
            eventTotal: 0,
            stateRecords: [
              stateRecord('MISSING', { sourceSystem: 'FinanceApprovals', current: true }),
              stateRecord('MISSING', { sourceSystem: 'ERP', current: false }),
            ],
          },
        },
      }),
    );
    const uncorroborated = outcomeOf(result, 'UNCORROBORATED');
    expect(uncorroborated.applied).toBe(false);
    expect(uncorroborated.reason).toBe(
      'The state of Budget code for Order #18492 is reported by 2 source systems.',
    );
  });

  it('applies when the root has no source record and no event, the weakest case', () => {
    const result = computeConfidence(
      inputFor(trio(), { evidence: { root: { eventTotal: 0, stateRecords: [] } } }),
    );
    const uncorroborated = outcomeOf(result, 'UNCORROBORATED');
    expect(uncorroborated.applied).toBe(true);
    expect(uncorroborated.refs.stepIndexes).toEqual([2]);
    expect(uncorroborated.reason).toBe(
      'Confidence lowered to MEDIUM: the state of Budget code for Order #18492 has no source record and no operational event mentions it.',
    );
    expect(result.confidence).toBe('MEDIUM');
  });
});

describe('rule 8: DISPUTED', () => {
  it('applies for an active DISPUTES note on a chain entity', () => {
    const entities = trio();
    const note = noteEvidence({
      target: { kind: 'ENTITY', entityId: entities.middle.id },
      author: 'Analyst B',
      createdAt: '2026-09-30T09:00:00.000Z',
      text: 'The payment was actually cleared',
    });
    const result = computeConfidence(inputFor(entities, { evidence: { middle: { notes: [note] } } }));
    expect(result.confidence).toBe('MEDIUM');
    const disputed = outcomeOf(result, 'DISPUTED');
    expect(disputed.applied).toBe(true);
    expect(disputed.refs).toEqual({ stepIndexes: [1], relationshipIds: [], noteIds: [note.id] });
    expect(disputed.reason).toBe(
      'Confidence lowered to MEDIUM: 1 active disputing note: Analyst B on 2026-09-30T09:00:00.000Z: "The payment was actually cleared".',
    );
  });

  it("applies for a DISPUTES note on a hop's assertion and reports its relationship id", () => {
    const entities = trio();
    const relationshipId = uuid();
    const note = noteEvidence({
      target: { kind: 'RELATIONSHIP', relationshipId },
      createdAt: '2026-09-30T09:00:00.000Z',
    });
    const result = computeConfidence(
      inputFor(entities, {
        rootHop: { assertionIds: [relationshipId] },
        relationshipNotes: { [relationshipId]: [note] },
      }),
    );
    expect(outcomeOf(result, 'DISPUTED').refs).toEqual({
      stepIndexes: [2],
      relationshipIds: [relationshipId],
      noteIds: [note.id],
    });
    expect(result.confidence).toBe('MEDIUM');
  });

  it('applies for an active dispute outside the capped notes list (older than 50 newer notes)', () => {
    const entities = trio();
    const old = noteEvidence({
      target: { kind: 'ENTITY', entityId: entities.middle.id },
      author: 'Analyst B',
      createdAt: '2026-09-01T09:00:00.000Z',
      text: 'Old dispute',
    });
    const newer = Array.from({ length: 50 }, () =>
      noteEvidence({ target: { kind: 'ENTITY', entityId: entities.middle.id }, stance: 'CONTEXT' }),
    );
    const result = computeConfidence(
      inputFor(entities, {
        evidence: { middle: { notes: newer } },
        activeDisputes: new Map([[entities.middle.id, [old]]]),
      }),
    );
    const disputed = outcomeOf(result, 'DISPUTED');
    expect(disputed.applied).toBe(true);
    expect(disputed.refs).toEqual({ stepIndexes: [1], relationshipIds: [], noteIds: [old.id] });
    expect(result.confidence).toBe('MEDIUM');
  });

  it('counts a dispute once when it is both in the notes list and in activeDisputes', () => {
    const entities = trio();
    const note = noteEvidence({ target: { kind: 'ENTITY', entityId: entities.root.id } });
    const result = computeConfidence(
      inputFor(entities, {
        evidence: { root: { notes: [note] } },
        activeDisputes: new Map([[entities.root.id, [note]]]),
      }),
    );
    expect(outcomeOf(result, 'DISPUTED').refs.noteIds).toEqual([note.id]);
    expect(result.confidence).toBe('MEDIUM');
  });

  it('ignores a retracted DISPUTES note', () => {
    const entities = trio();
    const note = noteEvidence({
      target: { kind: 'ENTITY', entityId: entities.root.id },
      active: false,
    });
    const result = computeConfidence(inputFor(entities, { evidence: { root: { notes: [note] } } }));
    expect(outcomeOf(result, 'DISPUTED')).toMatchObject({ applied: false, refs: NO_REFS });
    expect(result.confidence).toBe('HIGH');
  });

  it('ignores SUPPORTS and CONTEXT notes', () => {
    const entities = trio();
    const notes = [
      noteEvidence({ target: { kind: 'ENTITY', entityId: entities.root.id }, stance: 'SUPPORTS' }),
      noteEvidence({ target: { kind: 'ENTITY', entityId: entities.root.id }, stance: 'CONTEXT' }),
    ];
    const result = computeConfidence(inputFor(entities, { evidence: { root: { notes } } }));
    expect(outcomeOf(result, 'DISPUTED').applied).toBe(false);
    expect(result.confidence).toBe('HIGH');
  });

  it('counts a note once and lists several in createdAt then id order', () => {
    const entities = trio();
    const later = noteEvidence({
      id: '00000000-0000-4000-8000-0000000000c1',
      target: { kind: 'ENTITY', entityId: entities.root.id },
      author: 'Late',
      createdAt: '2026-09-30T12:00:00.000Z',
      text: 'second',
    });
    const earlierB = noteEvidence({
      id: '00000000-0000-4000-8000-0000000000b2',
      target: { kind: 'ENTITY', entityId: entities.root.id },
      author: 'Early B',
      createdAt: '2026-09-30T09:00:00.000Z',
      text: 'first b',
    });
    const earlierA = noteEvidence({
      id: '00000000-0000-4000-8000-0000000000a1',
      target: { kind: 'ENTITY', entityId: entities.root.id },
      author: 'Early A',
      createdAt: '2026-09-30T09:00:00.000Z',
      text: 'first a',
    });
    const result = computeConfidence(
      inputFor(entities, {
        evidence: {
          root: { notes: [later, earlierB, earlierA] },
          middle: { notes: [earlierA] },
        },
      }),
    );
    const disputed = outcomeOf(result, 'DISPUTED');
    expect(disputed.refs.noteIds).toEqual([earlierA.id, earlierB.id, later.id]);
    expect(disputed.reason).toBe(
      'Confidence lowered to MEDIUM: 3 active disputing notes: Early A on 2026-09-30T09:00:00.000Z: "first a", Early B on 2026-09-30T09:00:00.000Z: "first b", Late on 2026-09-30T12:00:00.000Z: "second".',
    );
    expect(result.confidence).toBe('MEDIUM');
  });
});

describe('rules 5 to 8 together', () => {
  it('lowers HIGH to LOW when rules 5, 6, 7 and 8 all fire, each exactly once', () => {
    const entities = trio({
      start: { observedAt: '2026-09-20T00:00:00.000Z' },
      middle: {
        observedAt: '2026-09-20T00:00:00.000Z',
        latestBySource: [
          { sourceSystem: 'Payments', state: 'COMPLETED' },
          { sourceSystem: 'ERP', state: 'PENDING' },
        ],
      },
      root: { observedAt: '2026-09-20T00:00:00.000Z' },
    });
    const note = noteEvidence({ target: { kind: 'ENTITY', entityId: entities.middle.id } });
    const result = computeConfidence(
      inputFor(entities, {
        evidence: { root: { eventTotal: 0 }, middle: { notes: [note] } },
      }),
    );

    expect(result.confidence).toBe('LOW');
    expect(appliedRules(result)).toEqual([
      'WEAKEST_LINK',
      'STALE_EVIDENCE',
      'CLASSIFICATION_DISAGREEMENT',
      'UNCORROBORATED',
      'DISPUTED',
    ]);
    expect(result.outcomes.map((entry) => entry.confidenceAfter)).toEqual([
      'HIGH',
      'HIGH',
      'HIGH',
      'HIGH',
      'MEDIUM',
      'LOW',
      'LOW',
      'LOW',
    ]);
  });

  it('floors at LOW', () => {
    const result = computeConfidence(
      inputFor(trio(), { inCycle: true, evidence: { root: { eventTotal: 0 } } }),
    );
    expect(result.confidence).toBe('LOW');
    expect(outcomeOf(result, 'UNCORROBORATED')).toMatchObject({ applied: true, confidenceAfter: 'LOW' });
  });
});

describe('fixtures R1 and R6: Order #18492', () => {
  function r1Input(evaluatedAt: Date): ConfidenceInput {
    const order = traced('Order #18492', 'BLOCKED', {
      observedAt: T_START,
      sourceSystem: 'OMS',
      latestBySource: [
        { sourceSystem: 'OMS', state: 'BLOCKED' },
        { sourceSystem: 'ERP', state: 'PENDING' },
      ],
    });
    const payment = traced('Payment PAY-88213', 'PENDING', {
      type: 'Payment',
      observedAt: T_OTHER,
      sourceSystem: 'Payments',
    });
    const approval = traced('Finance approval APR-2291', 'BLOCKED', {
      type: 'Approval',
      observedAt: T_OTHER,
      sourceSystem: 'FinanceApprovals',
    });
    const budget = traced('Budget code for Order #18492', 'MISSING', {
      type: 'BudgetRequirement',
      observedAt: T_OTHER,
      sourceSystem: 'FinanceApprovals',
    });
    const chain = blockingPath(order, [{ entity: payment }, { entity: approval }, { entity: budget }]);

    const entityEvidenceById = new Map<string, EntityEvidenceDto>(
      [order, payment, approval, budget].map((entity) => [
        entity.id,
        entityEvidence(entity, { eventTotal: 1 }),
      ]),
    );
    const relationshipEvidenceById = new Map<string, RelationshipEvidenceDto>(
      chain.hops.flatMap((hop) =>
        hop.assertions.map(
          (assertion): [string, RelationshipEvidenceDto] => [
            assertion.relationshipId,
            relationshipEvidence(assertion.relationshipId),
          ],
        ),
      ),
    );

    return {
      chain,
      start: order,
      deepest: {
        entity: budget,
        pathLength: 3,
        possible: false,
        continuesBeyondDepth: false,
        inCycle: false,
      },
      truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
      depth: 6,
      evaluatedAt,
      entityEvidence: entityEvidenceById,
      relationshipEvidence: relationshipEvidenceById,
      activeDisputes: new Map(),
    };
  }

  const R1_REASONS = [
    'Confidence starts at HIGH, the confidence of the weakest link: Order #18492 REQUIRES Payment PAY-88213 (source-recorded, high confidence).',
    'No step has an unknown state.',
    'The chain is not part of a dependency cycle.',
    'The search was complete within 6 steps.',
    "Every step's state was observed within 72 hours before 2026-09-29T16:00:00.000Z.",
    "Sources report different states for Order #18492 (ERP PENDING, OMS BLOCKED), but each step's states share one classification, so confidence is not lowered.",
    'The state of Budget code for Order #18492 is corroborated by 1 operational event.',
    'No active note disputes this chain.',
  ];

  it('R1: HIGH with exactly the 8 R1 reasons', () => {
    const result = computeConfidence(r1Input(EVALUATED_AT));
    expect(result.confidence).toBe('HIGH');
    expect(result.outcomes.map((entry) => entry.reason)).toEqual(R1_REASONS);
    expect(appliedRules(result)).toEqual(['WEAKEST_LINK']);
    expect(result.outcomes.every((entry) => entry.confidenceAfter === 'HIGH')).toBe(true);
    expect(outcomeOf(result, 'WEAKEST_LINK').refs.stepIndexes).toEqual([1]);
  });

  it('R6: evaluated a week later, only STALE_EVIDENCE changes and the result is MEDIUM', () => {
    const result = computeConfidence(r1Input(new Date('2026-10-06T12:00:00.000Z')));
    expect(result.confidence).toBe('MEDIUM');
    expect(appliedRules(result)).toEqual(['WEAKEST_LINK', 'STALE_EVIDENCE']);

    const stale = outcomeOf(result, 'STALE_EVIDENCE');
    expect(stale.confidenceAfter).toBe('MEDIUM');
    expect(stale.refs.stepIndexes).toEqual([0, 1, 2, 3]);
    expect(stale.reason).toBe(
      'Confidence lowered to MEDIUM: the state of Order #18492 (2026-09-29T11:40:00.000Z), Payment PAY-88213 (2026-09-29T10:05:00.000Z), Finance approval APR-2291 (2026-09-29T10:05:00.000Z), Budget code for Order #18492 (2026-09-29T10:05:00.000Z) was last observed more than 72 hours before 2026-10-06T12:00:00.000Z.',
    );
    expect(result.outcomes.slice(5).map((entry) => entry.confidenceAfter)).toEqual([
      'MEDIUM',
      'MEDIUM',
      'MEDIUM',
    ]);
    expect(result.outcomes.map((entry) => entry.reason).filter((_r, i) => i !== 4)).toEqual([
      R1_REASONS[0],
      R1_REASONS[1],
      R1_REASONS[2],
      R1_REASONS[3],
      R1_REASONS[5],
      R1_REASONS[6],
      R1_REASONS[7],
    ]);
  });
});
