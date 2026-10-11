import type { Confidence, EntityType } from '@opsgraph/shared';
import type {
  GraphEntityRef,
  NeighborhoodReached,
  NeighborhoodTrace,
} from '../graph/graph.repository';
import {
  composeNeighborhood,
  type ComposeBlockerPath,
  type ComposeExpansion,
  type ComposeInput,
} from './compose-neighborhood';

const FOCUS: GraphEntityRef = {
  id: 'focus',
  type: 'Order',
  displayName: 'Focus order',
  currentState: 'BLOCKED',
};

function ent(id: string, type: EntityType = 'Order', displayName = id): GraphEntityRef {
  return { id, type, displayName, currentState: 'PENDING' };
}

interface ReachedSpec {
  entity: GraphEntityRef;
  /** Parent id (focus by default). */
  parent?: string;
  confidence?: Confidence;
  nonSource?: number;
}

/** Builds a coherent tree trace: every path goes through its parent's path. */
function trace(
  specs: readonly ReachedSpec[],
  options: { start?: GraphEntityRef; limit?: boolean } = {},
): NeighborhoodTrace {
  const start = options.start ?? FOCUS;
  const paths = new Map<string, { ids: string[]; keys: string[] }>([
    [start.id, { ids: [start.id], keys: [] }],
  ]);
  const reached: NeighborhoodReached[] = [];
  for (const spec of specs) {
    const parent = paths.get(spec.parent ?? start.id);
    if (parent === undefined) {
      throw new Error(`test setup: unknown parent ${spec.parent}`);
    }
    const ids = [...parent.ids, spec.entity.id];
    const keys = [...parent.keys, `e-${spec.entity.id}`];
    paths.set(spec.entity.id, { ids, keys });
    reached.push({
      entity: spec.entity,
      distance: ids.length - 1,
      pathEntityIds: ids,
      pathEdgeKeys: keys,
      weakestConfidence: spec.confidence ?? 'HIGH',
      nonSourceHops: spec.nonSource ?? 0,
    });
  }
  return { start, reached, explorationLimitReached: options.limit ?? false };
}

function compose(overrides: Partial<ComposeInput> & { base: NeighborhoodTrace }) {
  return composeNeighborhood({
    focus: FOCUS,
    entityTypes: [],
    blockerPaths: [],
    blockerEntities: new Map(),
    expansions: [],
    maxVisible: 200,
    ...overrides,
  });
}

const ids = (output: ReturnType<typeof compose>) => output.visible.map((n) => n.entity.id);

describe('composeNeighborhood', () => {
  it('shows only the focus for an empty base', () => {
    const output = compose({ base: trace([]) });
    expect(output.visible).toHaveLength(1);
    expect(output.visible[0]).toMatchObject({
      reasons: ['FOCUS'],
      distance: 0,
      parentId: null,
      viaEdgeKey: null,
      expanded: false,
    });
    expect(output.omitted).toBe(0);
    expect(output.omittedIsLowerBound).toBe(false);
    expect(output.appliedExpansions).toEqual([]);
    expect(output.ignoredExpansions).toEqual([]);
    expect(output.blockerEdgeKeys.size).toBe(0);
  });

  describe('base order (basePriority)', () => {
    it('orders by distance, then confidence, then non-SOURCE hops, then type, name and id', () => {
      const base = trace([
        { entity: ent('a1', 'Order', 'A') },
        { entity: ent('d2', 'Order', 'B'), parent: 'a1' },
        { entity: ent('lowconf', 'Order', 'A'), confidence: 'LOW' },
        { entity: ent('midconf', 'Order', 'A'), confidence: 'MEDIUM' },
        { entity: ent('nonsrc', 'Order', 'A'), nonSource: 1 },
        { entity: ent('typeP', 'Payment', 'A') },
        { entity: ent('nameZ', 'Order', 'Z') },
        { entity: ent('a0', 'Order', 'A') },
      ]);
      const output = compose({ base });
      // distance 1: HIGH+0 non-source first (type Order, name A: a0 < a1 by id; Z later;
      // Payment after Order), then the non-SOURCE one, then MEDIUM, then LOW; distance 2 last.
      expect(ids(output)).toEqual([
        'focus',
        'a0',
        'a1',
        'nameZ',
        'typeP',
        'nonsrc',
        'midconf',
        'lowconf',
        'd2',
      ]);
    });

    it('records the base distance and tags nodes NEIGHBORHOOD with their parent edge', () => {
      const base = trace([{ entity: ent('a') }, { entity: ent('b'), parent: 'a' }]);
      const output = compose({ base });
      expect(output.visible[2]).toMatchObject({
        reasons: ['NEIGHBORHOOD'],
        distance: 2,
        parentId: 'a',
        viaEdgeKey: 'e-b',
      });
    });
  });

  describe('entity-type filter', () => {
    const base = trace([
      { entity: ent('pay', 'Payment', 'Pay') },
      { entity: ent('apr', 'Approval', 'Apr'), parent: 'pay' },
      { entity: ent('br', 'BudgetRequirement', 'Br'), parent: 'apr' },
      { entity: ent('other', 'Customer', 'Other') },
    ]);

    it('adds connectors before the matching entity, in path order', () => {
      const output = compose({ base, entityTypes: ['BudgetRequirement'] });
      expect(ids(output)).toEqual(['focus', 'pay', 'apr', 'br']);
      expect(output.visible.map((n) => n.reasons)).toEqual([
        ['FOCUS'],
        ['CONNECTOR'],
        ['CONNECTOR'],
        ['NEIGHBORHOOD'],
      ]);
      expect(output.visible.map((n) => n.parentId)).toEqual([null, 'focus', 'pay', 'apr']);
    });

    it('tags a matching intermediate NEIGHBORHOOD and does not count unlisted entities', () => {
      const output = compose({ base, entityTypes: ['Payment', 'BudgetRequirement'] });
      expect(ids(output)).toEqual(['focus', 'pay', 'apr', 'br']);
      expect(output.visible[1]?.reasons).toEqual(['NEIGHBORHOOD']);
      expect(output.visible[2]?.reasons).toEqual(['CONNECTOR']);
      expect(output.omitted).toBe(0);
    });
  });

  describe('blocking paths', () => {
    const base = trace([
      { entity: ent('x') },
      { entity: ent('pay', 'Payment'), parent: 'x' },
      { entity: ent('y') },
    ]);
    const blockerEntities = new Map<string, GraphEntityRef>([
      ['pay', ent('pay', 'Payment')],
      ['apr', ent('apr', 'Approval')],
      ['br', ent('br', 'BudgetRequirement')],
      ['alt', ent('alt')],
    ]);
    const blockerPaths: ComposeBlockerPath[] = [
      { entityIds: ['pay', 'apr', 'br'], edgeKeys: ['k1', 'k2', 'k3'] },
      { entityIds: ['alt', 'br'], edgeKeys: ['k4', 'k5'] },
    ];

    it('places blocker paths right after the focus, in rank order, with parents along the path', () => {
      const output = compose({ base, blockerPaths, blockerEntities });
      expect(ids(output).slice(0, 5)).toEqual(['focus', 'pay', 'apr', 'br', 'alt']);
      expect(output.visible.slice(1, 5).map((n) => [n.parentId, n.viaEdgeKey])).toEqual([
        ['focus', 'k1'],
        ['pay', 'k2'],
        ['apr', 'k3'],
        ['focus', 'k4'],
      ]);
      expect([...output.blockerEdgeKeys].sort()).toEqual(['k1', 'k2', 'k3', 'k4', 'k5']);
    });

    it('gives a blocker entity also in the base both reasons and keeps its base distance', () => {
      const output = compose({ base, blockerPaths, blockerEntities });
      const pay = output.visible.find((n) => n.entity.id === 'pay');
      expect(pay?.reasons).toEqual(['BLOCKING_PATH', 'NEIGHBORHOOD']);
      expect(pay?.distance).toBe(2);
      expect(pay?.parentId).toBe('focus');
    });

    it('gives a blocker-only entity a null distance', () => {
      const output = compose({ base, blockerPaths, blockerEntities });
      const apr = output.visible.find((n) => n.entity.id === 'apr');
      expect(apr).toMatchObject({ reasons: ['BLOCKING_PATH'], distance: null });
    });

    it('rejects a blocker hop without an entity', () => {
      expect(() =>
        compose({ base, blockerPaths, blockerEntities: new Map() }),
      ).toThrow('explorer invariant');
    });
  });

  describe('expansions', () => {
    const base = trace([{ entity: ent('a') }, { entity: ent('b') }]);
    const expansionOf = (expandedId: string, children: string[]): ComposeExpansion => ({
      expandedId,
      trace: trace(
        children.map((c) => ({ entity: ent(c) })),
        { start: ent(expandedId) },
      ),
    });

    it('applies expansions in request order with EXPANSION reason, parent and first edge key', () => {
      const output = compose({
        base,
        expansions: [expansionOf('b', ['b1', 'b2']), expansionOf('a', ['a1'])],
      });
      expect(ids(output)).toEqual(['focus', 'a', 'b', 'b1', 'b2', 'a1']);
      expect(output.visible.slice(3).map((n) => [n.reasons, n.parentId, n.viaEdgeKey])).toEqual([
        [['EXPANSION'], 'b', 'e-b1'],
        [['EXPANSION'], 'b', 'e-b2'],
        [['EXPANSION'], 'a', 'e-a1'],
      ]);
      expect(output.appliedExpansions).toEqual(['b', 'a']);
      expect(output.visible.filter((n) => n.expanded).map((n) => n.entity.id)).toEqual(['a', 'b']);
    });

    it('adds the EXPANSION reason to a node that is already visible without moving it', () => {
      const output = compose({ base, expansions: [expansionOf('a', ['b'])] });
      const b = output.visible.find((n) => n.entity.id === 'b');
      expect(b?.reasons).toEqual(['NEIGHBORHOOD', 'EXPANSION']);
      expect(b?.parentId).toBe('focus');
      expect(ids(output)).toEqual(['focus', 'a', 'b']);
    });

    it('ignores an expansion with a null trace or an id that is not visible', () => {
      const output = compose({
        base,
        expansions: [
          { expandedId: 'a', trace: null },
          expansionOf('ghost', ['g1']),
          expansionOf('b', ['b1']),
        ],
      });
      expect(output.ignoredExpansions).toEqual(['a', 'ghost']);
      expect(output.appliedExpansions).toEqual(['b']);
      expect(ids(output)).toEqual(['focus', 'a', 'b', 'b1']);
    });

    it('ignores an expansion of a node beyond the first maxVisible entries', () => {
      const output = compose({
        base,
        maxVisible: 2,
        expansions: [expansionOf('b', ['b1'])],
      });
      expect(ids(output)).toEqual(['focus', 'a']);
      expect(output.ignoredExpansions).toEqual(['b']);
      expect(output.omitted).toBe(1);
    });

    it('never gives the focus an EXPANSION reason', () => {
      const output = compose({
        base,
        expansions: [
          {
            expandedId: 'a',
            trace: trace([{ entity: FOCUS }], { start: ent('a') }),
          },
        ],
      });
      expect(output.visible[0]?.reasons).toEqual(['FOCUS']);
      expect(output.appliedExpansions).toEqual(['a']);
    });

    it('filters expansion results by entity type without adding connectors', () => {
      const output = compose({
        base,
        entityTypes: ['Order'],
        expansions: [
          {
            expandedId: 'a',
            trace: trace([{ entity: ent('p', 'Payment') }, { entity: ent('o2') }], {
              start: ent('a'),
            }),
          },
        ],
      });
      expect(ids(output)).toEqual(['focus', 'a', 'b', 'o2']);
    });
  });

  describe('cap and omitted count', () => {
    const nine = trace(
      Array.from({ length: 8 }, (_, i) => ({ entity: ent(`n${i}`, 'Order', `N${i}`) })),
    );

    it('cuts at maxVisible and counts the rest as omitted', () => {
      const output = compose({ base: nine, maxVisible: 5 });
      expect(output.visible).toHaveLength(5);
      expect(output.omitted).toBe(4);
      expect(output.omittedIsLowerBound).toBe(false);
    });

    it('marks omitted as a lower bound when the base hit the exploration limit', () => {
      const output = compose({
        base: trace(
          nine.reached.map((r) => ({ entity: r.entity })),
          { limit: true },
        ),
        maxVisible: 5,
      });
      expect(output.omittedIsLowerBound).toBe(true);
    });

    it('marks omitted as a lower bound when an applied expansion hit the limit', () => {
      const limited: ComposeExpansion = {
        expandedId: 'n0',
        trace: trace([{ entity: ent('x1') }], { start: ent('n0'), limit: true }),
      };
      expect(compose({ base: nine, expansions: [limited] }).omittedIsLowerBound).toBe(true);
      const ignored: ComposeExpansion = { ...limited, expandedId: 'ghost' };
      expect(compose({ base: nine, expansions: [ignored] }).omittedIsLowerBound).toBe(false);
    });
  });

  describe('property: parents come first', () => {
    function mulberry32(seed: number): () => number {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const TYPES: EntityType[] = ['Order', 'Payment', 'Approval', 'Shipment'];
    const CONFIDENCES: Confidence[] = ['HIGH', 'MEDIUM', 'LOW'];

    function randomInput(rand: () => number): ComposeInput {
      const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
      const count = Math.floor(rand() * 30);
      const entities: GraphEntityRef[] = [];
      const depthOf = new Map<string, number>();
      const specs: ReachedSpec[] = [];
      for (let i = 0; i < count; i += 1) {
        const entity = ent(`n${i}`, pick(TYPES), `name${Math.floor(rand() * 5)}`);
        // Parent: the focus, or an earlier entity that is at most 3 hops deep (depth <= 4).
        const candidates = entities.filter((e) => (depthOf.get(e.id) ?? 0) <= 3);
        const parent =
          candidates.length === 0 || rand() < 0.3 ? undefined : pick(candidates).id;
        depthOf.set(entity.id, (parent === undefined ? 0 : (depthOf.get(parent) ?? 0)) + 1);
        entities.push(entity);
        specs.push({
          entity,
          parent,
          confidence: pick(CONFIDENCES),
          nonSource: Math.floor(rand() * 3),
        });
      }
      const base = trace(specs);

      const blockerEntities = new Map<string, GraphEntityRef>();
      const blockerPaths: ComposeBlockerPath[] = [];
      for (let p = 0; p < Math.floor(rand() * 3); p += 1) {
        const length = 1 + Math.floor(rand() * 4);
        const entityIds: string[] = [];
        const edgeKeys: string[] = [];
        for (let h = 0; h < length; h += 1) {
          const useBase = entities.length > 0 && rand() < 0.4;
          const entity = useBase ? pick(entities) : ent(`b${p}-${h}`, pick(TYPES));
          if (entityIds.includes(entity.id)) {
            continue;
          }
          blockerEntities.set(entity.id, entity);
          entityIds.push(entity.id);
          edgeKeys.push(`bk${p}-${h}`);
        }
        blockerPaths.push({ entityIds, edgeKeys });
      }

      const expansions: ComposeExpansion[] = [];
      for (let x = 0; x < Math.floor(rand() * 4); x += 1) {
        const expandedId = rand() < 0.2 ? 'ghost' : `n${Math.floor(rand() * Math.max(count, 1))}`;
        const children = Array.from({ length: Math.floor(rand() * 5) }, (_, c) =>
          ent(`x${x}-${c}`, pick(TYPES)),
        );
        expansions.push({
          expandedId,
          trace: rand() < 0.1 ? null : trace(children.map((entity) => ({ entity })), { start: ent(expandedId) }),
        });
      }

      return {
        focus: FOCUS,
        base,
        entityTypes: rand() < 0.5 ? [] : [pick(TYPES), pick(TYPES)],
        blockerPaths,
        blockerEntities,
        expansions,
        maxVisible: 1 + Math.floor(rand() * 40),
      };
    }

    it('places every visible non-focus parent earlier and is stable over 200 random inputs', () => {
      const rand = mulberry32(0x0b5e55ed);
      for (let i = 0; i < 200; i += 1) {
        const input = randomInput(rand);
        const first = composeNeighborhood(input);
        const second = composeNeighborhood(input);
        expect(second).toEqual(first);

        expect(first.visible.length).toBeLessThanOrEqual(input.maxVisible);
        expect(first.visible[0]?.entity.id).toBe(FOCUS.id);
        const seen = new Set<string>();
        for (const node of first.visible) {
          if (node.entity.id !== FOCUS.id) {
            expect(node.parentId).not.toBeNull();
            expect(seen.has(node.parentId ?? '')).toBe(true);
          }
          seen.add(node.entity.id);
        }
        expect(seen.size).toBe(first.visible.length);
      }
    });
  });
});
