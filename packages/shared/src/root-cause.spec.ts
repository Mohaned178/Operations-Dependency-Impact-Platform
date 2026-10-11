import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_RULES,
  ROOT_CAUSE_LIMITS,
  RootCauseQuerySchema,
  RootCauseResponseSchema,
} from './root-cause';

const UUID_A = '6f1b3c2a-4d5e-4f60-8a9b-1c2d3e4f5a6b';
const UUID_B = '7a2c4d3b-5e6f-4071-9b0c-2d3e4f5a6b7c';
const UUID_C = '8b3d5e4c-6f70-4182-8c1d-3e4f5a6b7c8d';
const UUID_D = '9c4e6f5d-7081-4293-9d2e-4f5a6b7c8d9e';
const AT = '2026-09-29T11:40:00.000Z';

const observation = {
  id: UUID_D,
  state: 'BLOCKED',
  sourceStatus: null,
  sourceSystem: 'OMS',
  sourceId: '18492',
  observedAt: AT,
  receivedAt: AT,
  importId: UUID_C,
} as const;

function traced(id: string, displayName: string, currentState: 'BLOCKED' | 'MISSING') {
  return {
    id,
    type: 'Order',
    displayName,
    currentState,
    state: { classification: 'UNSATISFIED', observation, latestBySource: [] },
  } as const;
}

const start = traced(UUID_A, 'Order #18492', 'BLOCKED');
const root = traced(UUID_B, 'Budget code for Order #18492', 'MISSING');

const hop = {
  key: UUID_C,
  relationshipType: 'REQUIRES',
  fromEntityId: UUID_A,
  toEntityId: UUID_B,
  traversal: 'FORWARD',
  effectiveOrigin: 'SOURCE',
  effectiveConfidence: 'HIGH',
  assertions: [
    {
      relationshipId: UUID_C,
      origin: 'SOURCE',
      confidence: 'HIGH',
      basis: null,
      sourceSystem: 'FinanceApprovals',
      sourceId: 'REQUIRES:18492:BR-18492',
      observedAt: AT,
      importId: UUID_D,
    },
  ],
  entity: root,
} as const;

function outcome(rule: (typeof CONFIDENCE_RULES)[number]) {
  return {
    rule,
    applied: rule === 'WEAKEST_LINK',
    confidenceAfter: 'HIGH',
    reason: 'reason',
    refs: { stepIndexes: [], relationshipIds: [], noteIds: [] },
  } as const;
}

function sampleResponse(rules: readonly (typeof CONFIDENCE_RULES)[number][] = CONFIDENCE_RULES) {
  return {
    query: { entityId: UUID_A, depth: 6, evaluatedAt: '2026-09-29T16:00:00.000Z' },
    computedAt: '2026-10-11T08:00:00.000Z',
    status: 'ROOT_CAUSES_FOUND',
    start,
    summary: 'Order #18492 is BLOCKED. 1 root cause found: Budget Code Missing (HIGH).',
    truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
    candidates: [
      {
        rootCause: root,
        label: 'Budget Code Missing',
        labelRule: 'REQUIRED_FIELD',
        possible: false,
        inCycle: false,
        continuesBeyondDepth: false,
        insufficientEvidence: false,
        confidence: 'HIGH',
        confidenceRules: rules.map(outcome),
        primaryChain: {
          steps: [
            { index: 0, roles: ['SYMPTOM'], possible: false, entity: start, hop: null },
            {
              index: 1,
              roles: ['IMMEDIATE_BLOCKER', 'ROOT_CAUSE'],
              possible: false,
              entity: root,
              hop,
            },
          ],
          length: 1,
          weakestConfidence: 'HIGH',
          nonSourceHops: 0,
          continuesBeyondDepth: false,
          endsInCycle: false,
          sentences: ['Order #18492 is blocked because it requires Budget code, which is MISSING.'],
        },
        alternativeChains: [],
        keyEvidence: [],
        eventCount: 0,
        explanation: {
          headline: 'Root cause: Budget Code Missing. Confidence: HIGH.',
          chain: ['Order #18492 is blocked because it requires Budget code, which is MISSING.'],
          confidence: ['Confidence starts at HIGH.'],
          evidence: 'Evidence: ; 0 operational events.',
        },
      },
    ],
    evidence: { entities: [], relationships: [] },
  };
}

describe('RootCauseQuerySchema', () => {
  it('defaults depth to 6', () => {
    expect(RootCauseQuerySchema.parse({})).toEqual({ depth: 6 });
  });

  it.each(['0', '11', 'abc'])('rejects depth %s at path depth', (depth) => {
    const result = RootCauseQuerySchema.safeParse({ depth });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['depth']);
    }
  });

  it('rejects an evaluatedAt that is not an ISO datetime', () => {
    const result = RootCauseQuerySchema.safeParse({ evaluatedAt: 'yesterday' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['evaluatedAt']);
    }
  });

  it('accepts a UTC evaluatedAt', () => {
    expect(RootCauseQuerySchema.parse({ evaluatedAt: '2026-09-29T16:00:00Z' }).evaluatedAt).toBe(
      '2026-09-29T16:00:00Z',
    );
  });
});

describe('constants', () => {
  it('lists exactly the 8 confidence rules in research R6 order', () => {
    expect(CONFIDENCE_RULES).toEqual([
      'WEAKEST_LINK',
      'UNKNOWN_STATE',
      'CYCLE',
      'SEARCH_LIMIT',
      'STALE_EVIDENCE',
      'CLASSIFICATION_DISAGREEMENT',
      'UNCORROBORATED',
      'DISPUTED',
    ]);
  });

  it('sets the staleness threshold to 72 hours', () => {
    expect(ROOT_CAUSE_LIMITS.staleAfterMs).toBe(259_200_000);
  });
});

describe('RootCauseResponseSchema', () => {
  it('parses a hand-built response', () => {
    const result = RootCauseResponseSchema.safeParse(sampleResponse());
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('fails when confidenceRules has 7 items', () => {
    const result = RootCauseResponseSchema.safeParse(sampleResponse(CONFIDENCE_RULES.slice(0, 7)));
    expect(result.success).toBe(false);
  });

  it('fails when a chain has fewer than 2 steps', () => {
    const response = sampleResponse();
    const candidate = response.candidates[0];
    if (candidate === undefined) {
      throw new Error('sample has a candidate');
    }
    const broken = {
      ...response,
      candidates: [
        {
          ...candidate,
          primaryChain: {
            ...candidate.primaryChain,
            steps: candidate.primaryChain.steps.slice(0, 1),
          },
        },
      ],
    };
    expect(RootCauseResponseSchema.safeParse(broken).success).toBe(false);
  });
});
