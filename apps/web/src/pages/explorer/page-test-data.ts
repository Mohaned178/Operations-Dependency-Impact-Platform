import type {
  BlockersResponse,
  GraphEdgeDto,
  HopDto,
  NeighborhoodNodeDto,
  NeighborhoodResponse,
  SourceRecordListResponse,
  TracedEntityDto,
} from '@opsgraph/shared';
import {
  APPROVAL,
  BUDGET,
  F1_BLOCKERS,
  ORDER,
  PAYMENT,
  SHIPMENT,
  SHP_ID,
} from '../entities/tracing-test-data';
import { edge, node, response, uuid } from './test-fixtures';

export { F1_BLOCKERS } from '../entities/tracing-test-data';

/** One source record, enough for the node panel's evidence section in page tests. */
export const RECORDS_STUB: SourceRecordListResponse = {
  items: [
    {
      id: '12121212-1212-4212-8212-121212121212',
      kind: 'ENTITY',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: '2026-09-29T11:40:00.000Z',
      receivedAt: '2026-09-29T11:41:00.000Z',
      importId: '99999999-9999-4999-8999-999999999999',
      rawPayload: {},
    },
  ],
  nextCursor: null,
};

function toEdge(hop: HopDto): GraphEdgeDto {
  return {
    key: hop.key,
    relationshipType: hop.relationshipType,
    fromEntityId: hop.fromEntityId,
    toEntityId: hop.toEntityId,
    effectiveOrigin: hop.effectiveOrigin,
    effectiveConfidence: hop.effectiveConfidence,
    assertions: hop.assertions,
  };
}

function nodeFor(
  entity: TracedEntityDto,
  parent: { id: string; viaEdgeKey: string } | null,
  extra: Partial<NeighborhoodNodeDto>,
): NeighborhoodNodeDto {
  const base = node({ n: 1, name: entity.displayName, type: entity.type, state: entity.currentState });
  return {
    ...base,
    ...entity,
    distance: parent === null ? 0 : 1,
    reasons: parent === null ? ['FOCUS'] : ['NEIGHBORHOOD'],
    parentId: parent?.id ?? null,
    viaEdgeKey: parent?.viaEdgeKey ?? null,
    expanded: false,
    ...extra,
  };
}

export const OFF_PATH_ID = uuid(50);
export const OFF_PATH_EDGE_KEY = uuid(1050);

/**
 * Fixture N4: Shipment SHP-77120 with blocker highlighting. Two paths share the Payment → Approval
 * and Approval → Budget hops (as the real API does); the Budget code is outside the 2-step
 * neighborhood and was added by the blocking path. One entity is on no blocking path.
 */
export function n4Response(): NeighborhoodResponse {
  const [path1, path2] = F1_BLOCKERS.paths;
  if (path1 === undefined || path2 === undefined) {
    throw new Error('missing fixture paths');
  }
  const [toOrder, toPayment, toApproval, toBudget] = path1.hops;
  const manual = path2.hops[0];
  if (
    toOrder === undefined ||
    toPayment === undefined ||
    toApproval === undefined ||
    toBudget === undefined ||
    manual === undefined
  ) {
    throw new Error('missing fixture hops');
  }
  const blockers: BlockersResponse = {
    ...F1_BLOCKERS,
    paths: [path1, { ...path2, hops: [manual, toApproval, toBudget] }],
  };

  const offPath = node({ n: 50, parent: 1, via: 50, name: 'Order #18493', state: 'WAITING' });
  const nodes: NeighborhoodNodeDto[] = [
    nodeFor(SHIPMENT, null, {}),
    nodeFor(ORDER, { id: SHP_ID, viaEdgeKey: toOrder.key }, { reasons: ['BLOCKING_PATH', 'NEIGHBORHOOD'] }),
    nodeFor(PAYMENT, { id: ORDER.id, viaEdgeKey: toPayment.key }, { reasons: ['BLOCKING_PATH', 'NEIGHBORHOOD'] }),
    nodeFor(
      APPROVAL,
      { id: PAYMENT.id, viaEdgeKey: toApproval.key },
      { distance: 2, reasons: ['BLOCKING_PATH', 'NEIGHBORHOOD'] },
    ),
    nodeFor(
      BUDGET,
      { id: APPROVAL.id, viaEdgeKey: toBudget.key },
      { distance: null, reasons: ['BLOCKING_PATH'] },
    ),
    { ...offPath, id: OFF_PATH_ID, parentId: SHP_ID, viaEdgeKey: OFF_PATH_EDGE_KEY },
  ];
  const edges: GraphEdgeDto[] = [
    toEdge(toOrder),
    toEdge(toPayment),
    toEdge(toApproval),
    toEdge(toBudget),
    toEdge(manual),
    {
      ...edge({ k: 50, type: 'GOVERNS', from: 1, to: 50 }),
      key: OFF_PATH_EDGE_KEY,
      fromEntityId: SHP_ID,
      toEntityId: OFF_PATH_ID,
    },
  ];
  return response(nodes, edges, {
    focusId: SHP_ID,
    query: {
      entityId: SHP_ID,
      direction: 'all',
      depth: 2,
      relationshipTypes: ['REQUIRES', 'DEPENDS_ON', 'BLOCKS', 'GOVERNS'],
      entityTypes: [],
      expand: [],
      blockers: true,
    },
    blockers,
  });
}

export const N4_EDGE_KEYS = {
  toOrder: (): string => requireKey(0),
  toPayment: (): string => requireKey(1),
  toApproval: (): string => requireKey(2),
  toBudget: (): string => requireKey(3),
  manual: (): string => {
    const hop = F1_BLOCKERS.paths[1]?.hops[0];
    if (hop === undefined) {
      throw new Error('missing manual hop');
    }
    return hop.key;
  },
};

function requireKey(index: number): string {
  const hop = F1_BLOCKERS.paths[0]?.hops[index];
  if (hop === undefined) {
    throw new Error(`missing hop ${index}`);
  }
  return hop.key;
}
