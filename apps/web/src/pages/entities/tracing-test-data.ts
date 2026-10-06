import {
  STATE_CLASSIFICATION,
  type BlockersResponse,
  type Confidence,
  type EntityType,
  type HopDto,
  type OperationalState,
  type RelationshipOrigin,
  type TraceableRelationshipType,
  type TracedEntityDto,
} from '@opsgraph/shared';

/** Hand-built fixtures shaped like contracts/api.md F1 and F4, shared by the tracing UI tests. */

/** Matches the list item holding a whole explanation sentence, whose names are split into links. */
export function sentence(text: string) {
  return (_content: string, element: Element | null): boolean =>
    element?.tagName === 'LI' && element.textContent === text;
}

export const SHP_ID = '11111111-1111-4111-8111-111111111111';
export const ORDER_ID = '22222222-2222-4222-8222-222222222222';
export const PAY_ID = '33333333-3333-4333-8333-333333333333';
export const APR_ID = '44444444-4444-4444-8444-444444444444';
export const BR_ID = '55555555-5555-4555-8555-555555555555';

const IMPORT_ID = '99999999-9999-4999-8999-999999999999';
export const MANUAL_BASIS =
  'Recorded by ops analyst: carrier will not book the consolidated load until payment clears';

export function tracedEntity(
  id: string,
  type: EntityType,
  displayName: string,
  currentState: OperationalState,
  state: Partial<TracedEntityDto['state']> = {},
): TracedEntityDto {
  return {
    id,
    type,
    displayName,
    currentState,
    state: {
      classification: STATE_CLASSIFICATION[currentState],
      observation: null,
      latestBySource: [],
      ...state,
    },
  };
}

export const SHIPMENT = tracedEntity(
  SHP_ID,
  'Shipment',
  'Shipment SHP-77120 (consolidated)',
  'DELAYED',
);
export const ORDER = tracedEntity(ORDER_ID, 'Order', 'Order #18492', 'BLOCKED', {
  observation: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'BLOCKED',
    sourceStatus: 'ON_HOLD',
    sourceSystem: 'OMS',
    sourceId: '18492',
    observedAt: '2026-09-29T11:40:00.000Z',
    receivedAt: '2026-09-29T11:41:00.000Z',
    importId: IMPORT_ID,
  },
});
export const PAYMENT = tracedEntity(PAY_ID, 'Payment', 'Payment PAY-88213', 'PENDING');
export const APPROVAL = tracedEntity(APR_ID, 'Approval', 'Finance approval APR-2291', 'BLOCKED');
export const BUDGET = tracedEntity(
  BR_ID,
  'BudgetRequirement',
  'Budget code for Order #18492',
  'MISSING',
);

let hopCounter = 0;

export function hop(
  relationshipType: TraceableRelationshipType,
  traversal: 'FORWARD' | 'REVERSE',
  fromEntityId: string,
  toEntityId: string,
  target: TracedEntityDto,
  options: { origin?: RelationshipOrigin; confidence?: Confidence; basis?: string | null } = {},
): HopDto {
  hopCounter += 1;
  const origin = options.origin ?? 'SOURCE';
  const confidence = options.confidence ?? 'HIGH';
  const suffix = String(hopCounter).padStart(12, '0');
  return {
    key: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`,
    relationshipType,
    fromEntityId,
    toEntityId,
    traversal,
    effectiveOrigin: origin,
    effectiveConfidence: confidence,
    assertions: [
      {
        relationshipId: `cccccccc-cccc-4ccc-8ccc-${suffix}`,
        origin,
        confidence,
        basis: options.basis ?? null,
        sourceSystem: 'OPSGRAPH',
        sourceId: `rel-${hopCounter}`,
        observedAt: '2026-09-29T09:14:00.000Z',
        importId: IMPORT_ID,
      },
    ],
    entity: target,
  };
}

export const F1_BLOCKERS: BlockersResponse = {
  query: {
    entityId: SHP_ID,
    kind: 'blockers',
    depth: 6,
    relationshipTypes: ['REQUIRES', 'DEPENDS_ON', 'BLOCKS'],
    entityTypes: [],
  },
  computedAt: '2026-10-06T09:00:00.000Z',
  start: SHIPMENT,
  truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
  summary:
    'Shipment SHP-77120 (consolidated) is DELAYED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 4 steps away.',
  totalPaths: 2,
  paths: [
    {
      hops: [
        hop('DEPENDS_ON', 'FORWARD', SHP_ID, ORDER_ID, ORDER),
        hop('REQUIRES', 'FORWARD', ORDER_ID, PAY_ID, PAYMENT),
        hop('REQUIRES', 'FORWARD', PAY_ID, APR_ID, APPROVAL),
        hop('REQUIRES', 'FORWARD', APR_ID, BR_ID, BUDGET),
      ],
      length: 4,
      weakestConfidence: 'HIGH',
      nonSourceHops: 0,
      continuesBeyondDepth: false,
      endsInCycle: false,
      explanation: [
        'Shipment SHP-77120 (consolidated) is delayed because it depends on Order #18492, which is BLOCKED.',
        'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
        'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
        'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
      ],
    },
    {
      hops: [
        hop('BLOCKS', 'REVERSE', PAY_ID, SHP_ID, PAYMENT, {
          origin: 'MANUAL',
          confidence: 'MEDIUM',
          basis: MANUAL_BASIS,
        }),
        hop('REQUIRES', 'FORWARD', PAY_ID, APR_ID, APPROVAL),
        hop('REQUIRES', 'FORWARD', APR_ID, BR_ID, BUDGET),
      ],
      length: 3,
      weakestConfidence: 'MEDIUM',
      nonSourceHops: 1,
      continuesBeyondDepth: false,
      endsInCycle: false,
      explanation: [
        `Shipment SHP-77120 (consolidated) is delayed because Payment PAY-88213, which is PENDING, blocks it (manually recorded, medium confidence: "${MANUAL_BASIS}").`,
        'Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED.',
        'Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.',
      ],
    },
  ],
  directBlockers: [
    { entity: ORDER, pathLength: 1, possible: false, continuesBeyondDepth: false, inCycle: false },
    {
      entity: PAYMENT,
      pathLength: 1,
      possible: false,
      continuesBeyondDepth: false,
      inCycle: false,
    },
  ],
  deepestBlockers: [
    { entity: BUDGET, pathLength: 4, possible: false, continuesBeyondDepth: false, inCycle: false },
  ],
  cycleClosingHops: [],
  cycleClosingHopCount: 0,
};

const WAREHOUSE = tracedEntity(
  '66666666-6666-4666-8666-666666666666',
  'Warehouse',
  'East Distribution Center 02',
  'ACTIVE',
);

export const F4_BLOCKERS: BlockersResponse = {
  query: {
    entityId: WAREHOUSE.id,
    kind: 'blockers',
    depth: 6,
    relationshipTypes: ['REQUIRES', 'DEPENDS_ON', 'BLOCKS'],
    entityTypes: [],
  },
  computedAt: '2026-10-06T09:00:00.000Z',
  start: WAREHOUSE,
  truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
  summary: 'East Distribution Center 02 is ACTIVE. No blockers found within 6 steps.',
  totalPaths: 0,
  paths: [],
  directBlockers: [],
  deepestBlockers: [],
  cycleClosingHops: [],
  cycleClosingHopCount: 0,
};
