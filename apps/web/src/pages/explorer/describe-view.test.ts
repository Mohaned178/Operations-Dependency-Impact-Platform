import type {
  ExplorerUrlParams,
  GraphEdgeDto,
  NeighborhoodNodeDto,
  NeighborhoodResponse,
} from '@opsgraph/shared';
import { describe, expect, it } from 'vitest';
import { describeView } from './describe-view';

const FOCUS_ID = '00000000-0000-4000-8000-000000000001';

function makeNode(index: number, displayName: string): NeighborhoodNodeDto {
  const isFocus = index === 0;
  return {
    id: isFocus ? FOCUS_ID : `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    type: 'Order',
    displayName,
    currentState: 'ACTIVE',
    state: { classification: 'SATISFIED', observation: null, latestBySource: [] },
    distance: isFocus ? 0 : 1,
    reasons: ['FOCUS'],
    parentId: isFocus ? null : FOCUS_ID,
    viaEdgeKey: isFocus ? null : '00000000-0000-4000-8000-0000000000aa',
    expanded: false,
  };
}

function makeEdge(index: number): GraphEdgeDto {
  return {
    key: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
    relationshipType: 'REQUIRES',
    fromEntityId: FOCUS_ID,
    toEntityId: FOCUS_ID,
    effectiveOrigin: 'SOURCE',
    effectiveConfidence: 'HIGH',
    assertions: [
      {
        relationshipId: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
        origin: 'SOURCE',
        confidence: 'HIGH',
        basis: null,
        sourceSystem: 'erp',
        sourceId: `REL-${index}`,
        observedAt: '2026-01-01T00:00:00.000Z',
        importId: '00000000-0000-4000-8000-0000000000ff',
      },
    ],
  };
}

interface ResponseOptions {
  nodeCount?: number;
  edgeCount?: number;
  depth?: number;
  direction?: NeighborhoodResponse['query']['direction'];
  omitted?: number;
  omittedIsLowerBound?: boolean;
  focusName?: string;
}

function makeResponse(options: ResponseOptions = {}): NeighborhoodResponse {
  const nodeCount = options.nodeCount ?? 1;
  const edgeCount = options.edgeCount ?? 0;
  const omitted = options.omitted ?? 0;
  const nodes = Array.from({ length: nodeCount }, (_, index) =>
    makeNode(index, index === 0 ? (options.focusName ?? 'Order #18492') : `Entity ${index}`),
  );
  const edges = Array.from({ length: edgeCount }, (_, index) => makeEdge(index));
  return {
    query: {
      entityId: FOCUS_ID,
      direction: options.direction ?? 'all',
      depth: options.depth ?? 2,
      relationshipTypes: ['HAS', 'REQUIRES'],
      entityTypes: [],
      expand: [],
      blockers: false,
    },
    computedAt: '2026-10-10T08:00:00.000Z',
    focusId: FOCUS_ID,
    nodes,
    edges,
    totals: {
      visible: nodeCount,
      omitted,
      omittedIsLowerBound: options.omittedIsLowerBound ?? false,
    },
    ignoredExpansions: [],
    blockers: null,
  };
}

const NO_FILTERS: ExplorerUrlParams = {
  direction: 'all',
  depth: 2,
  relationshipTypes: [],
  entityTypes: [],
  blockers: false,
};

describe('describeView', () => {
  describe('title', () => {
    it('uses singular step and entity for one step and one entity', () => {
      const view = describeView(makeResponse({ depth: 1, nodeCount: 1, edgeCount: 0 }), {
        ...NO_FILTERS,
        depth: 1,
      });
      expect(view.title).toBe('Order #18492 — all directions, 1 step: 1 entity, 0 relationships');
    });

    it('uses plural forms and direction labels', () => {
      const upstream = describeView(
        makeResponse({ nodeCount: 3, edgeCount: 2, depth: 2, direction: 'upstream' }),
        { ...NO_FILTERS, direction: 'upstream' },
      );
      expect(upstream.title).toBe(
        'Order #18492 — upstream only, 2 steps: 3 entities, 2 relationships',
      );

      const downstream = describeView(
        makeResponse({ nodeCount: 2, edgeCount: 1, depth: 3, direction: 'downstream' }),
        { ...NO_FILTERS, direction: 'downstream', depth: 3 },
      );
      expect(downstream.title).toBe(
        'Order #18492 — downstream only, 3 steps: 2 entities, 1 relationship',
      );
    });

    it('uses the focus display name from nodes[0]', () => {
      const view = describeView(makeResponse({ focusName: 'Acme Corp', nodeCount: 2 }), NO_FILTERS);
      expect(view.title.startsWith('Acme Corp — ')).toBe(true);
    });
  });

  describe('filters', () => {
    it('is null when no URL filter lists are set', () => {
      expect(describeView(makeResponse({ nodeCount: 3 }), NO_FILTERS).filters).toBeNull();
    });

    it('joins entity and relationship filters with a middle dot', () => {
      const view = describeView(makeResponse({ nodeCount: 3 }), {
        ...NO_FILTERS,
        entityTypes: ['Order', 'Payment'],
        relationshipTypes: ['REQUIRES'],
      });
      expect(view.filters).toBe('Entity types: Order, Payment · Relationship types: REQUIRES');
    });

    it('shows only the list that is set', () => {
      const view = describeView(makeResponse({ nodeCount: 3 }), {
        ...NO_FILTERS,
        relationshipTypes: ['BLOCKS', 'REQUIRES'],
      });
      expect(view.filters).toBe('Relationship types: BLOCKS, REQUIRES');
    });
  });

  describe('omitted', () => {
    it('is null when nothing was omitted', () => {
      expect(describeView(makeResponse({ nodeCount: 5 }), NO_FILTERS).omitted).toBeNull();
    });

    it('matches the acceptance example: 200 shown, 4112 omitted', () => {
      const view = describeView(makeResponse({ nodeCount: 200, omitted: 4112 }), NO_FILTERS);
      expect(view.omitted).toBe(
        'Showing 200 of 4312 entities — 4112 more. Refine filters, reduce the step limit, or choose a direction.',
      );
    });

    it('uses the lower-bound wording when the exploration limit was hit', () => {
      const view = describeView(
        makeResponse({ nodeCount: 200, omitted: 4112, omittedIsLowerBound: true }),
        NO_FILTERS,
      );
      expect(view.omitted).toBe(
        'Showing 200 of more than 4312 entities — refine filters, reduce the step limit, or choose a direction.',
      );
    });
  });

  describe('empty', () => {
    it('is null when the focus has any neighbours', () => {
      expect(
        describeView(makeResponse({ nodeCount: 2, edgeCount: 1 }), NO_FILTERS).empty,
      ).toBeNull();
    });

    it('explains the empty neighbourhood without the filter hint when no filters are set', () => {
      const view = describeView(makeResponse({ nodeCount: 1 }), NO_FILTERS);
      expect(view.empty).toBe('Order #18492 has no relationships matching the current settings.');
    });

    it('adds the filter hint when filters are set', () => {
      const view = describeView(makeResponse({ nodeCount: 1 }), {
        ...NO_FILTERS,
        entityTypes: ['Payment'],
      });
      expect(view.empty).toBe(
        'Order #18492 has no relationships matching the current settings. Try removing filters.',
      );
    });
  });
});
