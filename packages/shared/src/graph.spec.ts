import { describe, expect, it } from 'vitest';
import {
  EntityDetailDtoSchema,
  EntityListItemDtoSchema,
  EntityRefDtoSchema,
  EntityTypeSchema,
  MONETARY_ENTITY_TYPES,
  NeighborDtoSchema,
  RELATIONSHIP_RULES,
  RelationshipTypeSchema,
  SourceRecordDtoSchema,
  TimelineItemDtoSchema,
} from './graph';

const UUID = '6f1b3c2a-4d5e-4f60-8a9b-1c2d3e4f5a6b';
const IMPORT_ID = '7a2c4d3b-5e6f-4071-9b0c-2d3e4f5a6b7c';
const AT = '2026-09-14T08:30:00.000Z';

describe('RELATIONSHIP_RULES', () => {
  it('has an entry for every relationship type and no others', () => {
    expect(Object.keys(RELATIONSHIP_RULES).sort()).toEqual(
      [...RelationshipTypeSchema.options].sort(),
    );
  });

  it('only names entity types that exist', () => {
    for (const rule of Object.values(RELATIONSHIP_RULES)) {
      for (const type of [...(rule.from ?? []), ...(rule.to ?? [])]) {
        expect(EntityTypeSchema.safeParse(type).success).toBe(true);
      }
    }
  });

  it('marks only known entity types as monetary', () => {
    for (const type of MONETARY_ENTITY_TYPES) {
      expect(EntityTypeSchema.safeParse(type).success).toBe(true);
    }
  });
});

describe('graph DTOs', () => {
  const entityRef = {
    id: UUID,
    type: 'Order',
    displayName: 'Order #18492',
    currentState: 'BLOCKED',
  } as const;

  it('parses an entity list item', () => {
    const parsed = EntityListItemDtoSchema.parse({
      id: UUID,
      type: 'Order',
      displayName: 'Order #18492',
      currentState: 'BLOCKED',
      primaryIdentifier: {
        sourceSystem: 'OMS',
        sourceId: '18492',
        firstSeenAt: AT,
      },
      sourceSystems: ['ERP', 'OMS'],
      lastObservedAt: AT,
    });

    expect(parsed.primaryIdentifier.sourceId).toBe('18492');
  });

  it('parses an entity detail with no current state observation', () => {
    const parsed = EntityDetailDtoSchema.parse({
      id: UUID,
      type: 'Order',
      displayName: 'Order #18492',
      attributes: { amount: '12480.00', currency: 'USD' },
      currentState: 'UNKNOWN',
      currentStateObservation: null,
      latestStateBySource: [],
      identifiers: [],
      sourceSystems: [],
      lastObservedAt: AT,
      createdAt: AT,
      counts: { sourceRecords: 0, stateObservations: 0, relationships: 0, events: 0 },
    });

    expect(parsed.currentStateObservation).toBeNull();
  });

  it('parses an entity ref', () => {
    expect(EntityRefDtoSchema.parse(entityRef).currentState).toBe('BLOCKED');
  });

  it('parses a neighbor with an inferred basis', () => {
    const parsed = NeighborDtoSchema.parse({
      relationship: {
        id: UUID,
        type: 'BLOCKS',
        direction: 'IN',
        origin: 'INFERRED',
        confidence: 'MEDIUM',
        basis: 'Payment overdue',
        sourceSystem: 'OPSGRAPH',
        sourceId: 'rel-1',
        observedAt: AT,
        importId: IMPORT_ID,
      },
      neighbor: entityRef,
    });

    expect(parsed.relationship.direction).toBe('IN');
  });

  it('parses both timeline item variants', () => {
    const event = TimelineItemDtoSchema.parse({
      kind: 'EVENT',
      id: UUID,
      at: AT,
      eventType: 'order.blocked',
      description: null,
      role: 'RELATED',
      entities: [{ entity: entityRef, role: 'SUBJECT' }],
      sourceSystem: 'OMS',
      sourceId: 'evt-1',
      observedAt: AT,
      importId: IMPORT_ID,
    });
    const state = TimelineItemDtoSchema.parse({
      kind: 'STATE',
      id: UUID,
      at: AT,
      state: 'BLOCKED',
      sourceStatus: 'BLOCKED',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: AT,
      importId: IMPORT_ID,
    });

    expect(event.kind).toBe('EVENT');
    expect(state.kind).toBe('STATE');
  });

  it('parses a source record with an arbitrary JSON payload', () => {
    const parsed = SourceRecordDtoSchema.parse({
      id: UUID,
      kind: 'ENTITY',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: AT,
      receivedAt: AT,
      importId: IMPORT_ID,
      rawPayload: { status: 'BLOCKED', lines: [{ sku: 'A-1', qty: 2 }] },
    });

    expect(parsed.rawPayload).toEqual({ status: 'BLOCKED', lines: [{ sku: 'A-1', qty: 2 }] });
  });
});
