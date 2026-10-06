import type { GraphEntityRef, TraversalHop, TraversalPath } from '../graph/graph.repository';
import type { EntityStateEvidence } from './state-evidence.reader';
import {
  collectEntityIds,
  toCycleClosingHopDto,
  toHopDto,
  toPathDto,
  toTracedEntityDto,
  type EvidenceMap,
} from './tracing.mapper';

const OBSERVED = new Date('2026-09-29T11:40:00.000Z');

function ref(id: string, overrides: Partial<GraphEntityRef> = {}): GraphEntityRef {
  return { id, type: 'Order', displayName: `Entity ${id}`, currentState: 'BLOCKED', ...overrides };
}

function hop(target: GraphEntityRef, overrides: Partial<TraversalHop> = {}): TraversalHop {
  return {
    key: `key-${target.id}`,
    relationshipType: 'REQUIRES',
    fromEntityId: 'start',
    toEntityId: target.id,
    traversal: 'FORWARD',
    effectiveOrigin: 'SOURCE',
    effectiveConfidence: 'HIGH',
    assertions: [
      {
        relationshipId: `key-${target.id}`,
        origin: 'SOURCE',
        confidence: 'HIGH',
        basis: null,
        sourceSystem: 'Payments',
        sourceId: 'REQUIRES:1',
        observedAt: OBSERVED,
        importId: 'import-1',
      },
    ],
    target,
    ...overrides,
  };
}

function path(hops: TraversalHop[]): TraversalPath {
  return {
    hops,
    weakestConfidence: 'HIGH',
    nonSourceHops: 0,
    continuesBeyondDepth: false,
    endsInCycle: false,
  };
}

const NO_EVIDENCE: EntityStateEvidence = { observation: null, latestBySource: [] };

function evidenceMap(...ids: string[]): EvidenceMap {
  return new Map(ids.map((id) => [id, NO_EVIDENCE]));
}

describe('toTracedEntityDto', () => {
  it.each([
    ['ACTIVE', 'SATISFIED'],
    ['AT_RISK', 'SATISFIED'],
    ['BLOCKED', 'UNSATISFIED'],
    ['MISSING', 'UNSATISFIED'],
    ['UNKNOWN', 'INDETERMINATE'],
  ] as const)('classifies %s as %s', (currentState, classification) => {
    const dto = toTracedEntityDto(ref('a', { currentState }), NO_EVIDENCE);
    expect(dto.state.classification).toBe(classification);
    expect(dto.currentState).toBe(currentState);
  });

  it('passes the observation and per-source states through', () => {
    const observation = {
      id: 'o1',
      state: 'BLOCKED' as const,
      sourceStatus: 'ON_HOLD',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: OBSERVED.toISOString(),
      receivedAt: OBSERVED.toISOString(),
      importId: 'import-1',
    };
    const dto = toTracedEntityDto(ref('a'), { observation, latestBySource: [observation] });
    expect(dto.state.observation).toBe(observation);
    expect(dto.state.latestBySource).toEqual([observation]);
  });
});

describe('toHopDto', () => {
  it('maps dates to ISO strings and the hop target to the entity', () => {
    const dto = toHopDto(hop(ref('b')), evidenceMap('b'));
    expect(dto.assertions[0]?.observedAt).toBe('2026-09-29T11:40:00.000Z');
    expect(dto.entity.id).toBe('b');
    expect(dto.fromEntityId).toBe('start');
    expect(dto.toEntityId).toBe('b');
  });

  it('throws when the evidence for the target was not loaded', () => {
    expect(() => toHopDto(hop(ref('b')), evidenceMap('other'))).toThrow(/no state evidence/);
  });
});

describe('toPathDto', () => {
  it('sets length from the number of hops', () => {
    const dto = toPathDto(path([hop(ref('b')), hop(ref('c'))]), evidenceMap('b', 'c'));
    expect(dto.length).toBe(2);
    expect(dto.hops.map((h) => h.entity.id)).toEqual(['b', 'c']);
    expect(dto.weakestConfidence).toBe('HIGH');
    expect(dto.nonSourceHops).toBe(0);
    expect(dto.continuesBeyondDepth).toBe(false);
  });
});

describe('toCycleClosingHopDto', () => {
  it('copies the hop', () => {
    expect(
      toCycleClosingHopDto({
        key: 'k',
        relationshipType: 'REQUIRES',
        fromEntityId: 'a',
        toEntityId: 'b',
        relationshipIds: ['k', 'm'],
      }),
    ).toEqual({
      key: 'k',
      relationshipType: 'REQUIRES',
      fromEntityId: 'a',
      toEntityId: 'b',
      relationshipIds: ['k', 'm'],
    });
  });
});

describe('collectEntityIds', () => {
  it('returns the start first, then each hop target once, in first-seen order', () => {
    const b = ref('b');
    const c = ref('c');
    const d = ref('d');
    const ids = collectEntityIds([path([hop(b), hop(c)]), path([hop(b), hop(d)])], 'start');
    expect(ids).toEqual(['start', 'b', 'c', 'd']);
  });

  it('returns only the start for no paths', () => {
    expect(collectEntityIds([], 'start')).toEqual(['start']);
  });
});
