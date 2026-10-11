import type {
  GraphEdgeDto,
  NeighborhoodNodeDto,
  NeighborhoodResponse,
  NodeReason,
  OperationalState,
  RelationshipType,
} from '@opsgraph/shared';

/** Hand-built NeighborhoodResponse fixtures for the explorer's unit tests. */

const AT = '2026-09-29T11:40:00.000Z';

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

export interface NodeSpec {
  n: number;
  name?: string;
  type?: NeighborhoodNodeDto['type'];
  state?: OperationalState;
  /** Parent node number; omitted for the focus. */
  parent?: number;
  /** Edge number (key) connecting the parent. */
  via?: number;
  distance?: number | null;
  reasons?: NodeReason[];
  expanded?: boolean;
  latestBySource?: Array<{ sourceSystem: string; state: OperationalState }>;
}

export function node(spec: NodeSpec): NeighborhoodNodeDto {
  const isFocus = spec.parent === undefined;
  const state = spec.state ?? 'PENDING';
  return {
    id: uuid(spec.n),
    type: spec.type ?? 'Order',
    displayName: spec.name ?? `Entity ${spec.n}`,
    currentState: state,
    state: {
      classification: state === 'ACTIVE' || state === 'COMPLETED' ? 'SATISFIED' : 'UNSATISFIED',
      observation: {
        id: uuid(5000 + spec.n),
        state,
        sourceStatus: null,
        sourceSystem: 'OMS',
        sourceId: String(spec.n),
        observedAt: AT,
        receivedAt: AT,
        importId: uuid(9000),
      },
      latestBySource: (spec.latestBySource ?? []).map((o, i) => ({
        id: uuid(6000 + spec.n * 10 + i),
        state: o.state,
        sourceStatus: null,
        sourceSystem: o.sourceSystem,
        sourceId: String(spec.n),
        observedAt: AT,
        receivedAt: AT,
        importId: uuid(9000),
      })),
    },
    distance: spec.distance === undefined ? (isFocus ? 0 : 1) : spec.distance,
    reasons: spec.reasons ?? (isFocus ? ['FOCUS'] : ['NEIGHBORHOOD']),
    parentId: isFocus ? null : uuid(spec.parent ?? 0),
    viaEdgeKey: isFocus ? null : uuid(1000 + (spec.via ?? spec.n)),
    expanded: spec.expanded ?? false,
  };
}

export interface EdgeSpec {
  /** Edge number: the key is uuid(1000 + k). */
  k: number;
  type: RelationshipType;
  from: number;
  to: number;
  origin?: GraphEdgeDto['effectiveOrigin'];
  confidence?: GraphEdgeDto['effectiveConfidence'];
}

export function edge(spec: EdgeSpec): GraphEdgeDto {
  const origin = spec.origin ?? 'SOURCE';
  const confidence = spec.confidence ?? 'HIGH';
  return {
    key: uuid(1000 + spec.k),
    relationshipType: spec.type,
    fromEntityId: uuid(spec.from),
    toEntityId: uuid(spec.to),
    effectiveOrigin: origin,
    effectiveConfidence: confidence,
    assertions: [
      {
        relationshipId: uuid(1000 + spec.k),
        origin,
        confidence,
        basis: origin === 'SOURCE' ? null : 'test basis',
        sourceSystem: 'OMS',
        sourceId: `rel-${spec.k}`,
        observedAt: AT,
        importId: uuid(9000),
      },
    ],
  };
}

export function response(
  nodes: NeighborhoodNodeDto[],
  edges: GraphEdgeDto[],
  overrides: Partial<NeighborhoodResponse> = {},
): NeighborhoodResponse {
  return {
    query: {
      entityId: nodes[0]?.id ?? uuid(1),
      direction: 'all',
      depth: 2,
      relationshipTypes: ['REQUIRES'],
      entityTypes: [],
      expand: [],
      blockers: false,
    },
    computedAt: AT,
    focusId: nodes[0]?.id ?? uuid(1),
    nodes,
    edges,
    totals: { visible: nodes.length, omitted: 0, omittedIsLowerBound: false },
    ignoredExpansions: [],
    blockers: null,
    ...overrides,
  };
}

/**
 * Focus 1 with: upstream 2 (focus REQUIRES 2), downstream 3 (3 REQUIRES focus), sibling 4 (1
 * RELATES_TO 4), and a second-step upstream 5 (2 REQUIRES 5) and downstream 6 (6 REQUIRES 3).
 */
export function smallResponse(): NeighborhoodResponse {
  return response(
    [
      node({ n: 1, name: 'Focus' }),
      node({ n: 2, parent: 1, via: 1, name: 'Upstream' }),
      node({ n: 3, parent: 1, via: 2, name: 'Downstream' }),
      node({ n: 4, parent: 1, via: 3, name: 'Sibling' }),
      node({ n: 5, parent: 2, via: 4, name: 'Upstream 2', distance: 2 }),
      node({ n: 6, parent: 3, via: 5, name: 'Downstream 2', distance: 2 }),
    ],
    [
      edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 }),
      edge({ k: 2, type: 'REQUIRES', from: 3, to: 1 }),
      edge({ k: 3, type: 'RELATES_TO', from: 1, to: 4 }),
      edge({ k: 4, type: 'REQUIRES', from: 2, to: 5 }),
      edge({ k: 5, type: 'REQUIRES', from: 6, to: 3 }),
    ],
  );
}

/**
 * A BlockersResponse stub carrying only the fields the explorer's pure modules read: each path's
 * hop (entity id + edge key) and the direct and deepest blocker lists. Panel tests that need the
 * full shape build their own.
 */
export function blockersStub(input: {
  /** Each path as hops of [entity number, edge number]. */
  paths: Array<Array<[number, number]>>;
  direct: number[];
  deepest: number[];
}): NonNullable<NeighborhoodResponse['blockers']> {
  const entity = (n: number) => ({ id: uuid(n) });
  return {
    paths: input.paths.map((hops) => ({
      hops: hops.map(([n, k]) => ({ key: uuid(1000 + k), entity: entity(n) })),
    })),
    directBlockers: input.direct.map((n) => ({ entity: entity(n) })),
    deepestBlockers: input.deepest.map((n) => ({ entity: entity(n) })),
  } as unknown as NonNullable<NeighborhoodResponse['blockers']>;
}
