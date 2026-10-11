import {
  CONFIDENCE_RANK,
  STATE_CLASSIFICATION,
  type BlockingPathDto,
  type Confidence,
  type EntityEvidenceDto,
  type EntityRefDto,
  type EventEvidenceDto,
  type HopDto,
  type NoteEvidenceDto,
  type OperationalState,
  type RelationshipEvidenceDto,
  type RelationshipOrigin,
  type RequirementSourceDto,
  type SourceRecordDto,
  type StateObservationDto,
  type StateRecordEvidenceDto,
  type TraceableRelationshipType,
  type TracedEntityDto,
} from '@opsgraph/shared';

/** Hand-built DTOs for the pure root-cause modules. Deterministic: ids come from a counter. */

let counter = 0;

export function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export const OBSERVED_AT = '2026-09-29T10:05:00.000Z';

export function observation(
  state: OperationalState,
  options: { sourceSystem?: string; sourceId?: string; observedAt?: string } = {},
): StateObservationDto {
  const observedAt = options.observedAt ?? OBSERVED_AT;
  return {
    id: uuid(),
    state,
    sourceStatus: null,
    sourceSystem: options.sourceSystem ?? 'ERP',
    sourceId: options.sourceId ?? `obs-${counter}`,
    observedAt,
    receivedAt: observedAt,
    importId: uuid(),
  };
}

export interface TracedOptions {
  type?: TracedEntityDto['type'];
  /** The current-state observation time. `null` means the entity was never observed. */
  observedAt?: string | null;
  sourceSystem?: string;
  /** Per-source latest states, as 003 returns them when sources disagree. */
  latestBySource?: ReadonlyArray<{ sourceSystem: string; state: OperationalState }>;
}

export function traced(
  displayName: string,
  currentState: OperationalState,
  options: TracedOptions = {},
): TracedEntityDto {
  const current =
    options.observedAt === null
      ? null
      : observation(currentState, {
          sourceSystem: options.sourceSystem,
          observedAt: options.observedAt,
        });
  return {
    id: uuid(),
    type: options.type ?? 'Order',
    displayName,
    currentState,
    state: {
      classification: STATE_CLASSIFICATION[currentState],
      observation: current,
      latestBySource: (options.latestBySource ?? []).map((entry) =>
        observation(entry.state, { sourceSystem: entry.sourceSystem }),
      ),
    },
  };
}

export function entityRef(entity: TracedEntityDto): EntityRefDto {
  return {
    id: entity.id,
    type: entity.type,
    displayName: entity.displayName,
    currentState: entity.currentState,
  };
}

export interface HopSpec {
  relationshipType?: TraceableRelationshipType;
  traversal?: 'FORWARD' | 'REVERSE';
  entity: TracedEntityDto;
  origin?: RelationshipOrigin;
  confidence?: Confidence;
  assertionIds?: string[];
}

/** Builds a blocking path from `start` through the given hops (a hop reaches `spec.entity`). */
export function blockingPath(
  start: TracedEntityDto,
  specs: readonly HopSpec[],
  flags: { continuesBeyondDepth?: boolean; endsInCycle?: boolean } = {},
): BlockingPathDto {
  let before = start;
  const hops = specs.map((spec): HopDto => {
    const traversal = spec.traversal ?? 'FORWARD';
    const origin = spec.origin ?? 'SOURCE';
    const confidence = spec.confidence ?? 'HIGH';
    const assertionIds = spec.assertionIds ?? [uuid()];
    const [key] = assertionIds;
    const hop: HopDto = {
      key: key ?? uuid(),
      relationshipType: spec.relationshipType ?? 'REQUIRES',
      fromEntityId: traversal === 'FORWARD' ? before.id : spec.entity.id,
      toEntityId: traversal === 'FORWARD' ? spec.entity.id : before.id,
      traversal,
      effectiveOrigin: origin,
      effectiveConfidence: confidence,
      assertions: assertionIds.map((relationshipId) => ({
        relationshipId,
        origin,
        confidence,
        basis: null,
        sourceSystem: 'OPSGRAPH',
        sourceId: `rel-${relationshipId}`,
        observedAt: OBSERVED_AT,
        importId: uuid(),
      })),
      entity: spec.entity,
    };
    before = spec.entity;
    return hop;
  });

  const weakest = hops.reduce<Confidence>(
    (lowest, hop) =>
      CONFIDENCE_RANK[hop.effectiveConfidence] < CONFIDENCE_RANK[lowest]
        ? hop.effectiveConfidence
        : lowest,
    'HIGH',
  );

  return {
    hops,
    length: hops.length,
    weakestConfidence: weakest,
    nonSourceHops: hops.filter((hop) => hop.effectiveOrigin !== 'SOURCE').length,
    continuesBeyondDepth: flags.continuesBeyondDepth ?? false,
    endsInCycle: flags.endsInCycle ?? false,
    explanation: hops.map((_hop, index) => `sentence ${index}`),
  };
}

export function sourceRecord(
  options: { sourceSystem?: string; sourceId?: string; observedAt?: string } = {},
): SourceRecordDto {
  const observedAt = options.observedAt ?? OBSERVED_AT;
  return {
    id: uuid(),
    kind: 'ENTITY',
    sourceSystem: options.sourceSystem ?? 'ERP',
    sourceId: options.sourceId ?? `src-${counter}`,
    observedAt,
    receivedAt: observedAt,
    importId: uuid(),
    rawPayload: {},
  };
}

export function stateRecord(
  state: OperationalState,
  options: {
    sourceSystem?: string;
    sourceId?: string;
    observedAt?: string;
    current?: boolean;
    sourceRecordId?: string;
  } = {},
): StateRecordEvidenceDto {
  const record = sourceRecord(options);
  return {
    rule: 'STATE_RECORD',
    origin: 'SOURCE',
    current: options.current ?? true,
    observation: observation(state, options),
    sourceRecord: options.sourceRecordId === undefined ? record : { ...record, id: options.sourceRecordId },
  };
}

export function eventEvidence(
  entity: TracedEntityDto,
  options: { id?: string; occurredAt?: string } = {},
): EventEvidenceDto {
  const occurredAt = options.occurredAt ?? OBSERVED_AT;
  return {
    rule: 'EVENT',
    origin: 'SOURCE',
    id: options.id ?? uuid(),
    eventType: 'status.changed',
    occurredAt,
    observedAt: occurredAt,
    description: null,
    role: 'SUBJECT',
    entities: [{ entity: entityRef(entity), role: 'SUBJECT' }],
    sourceSystem: 'OMS',
    sourceId: `evt-${counter}`,
    importId: uuid(),
  };
}

export function requirementSource(
  definer: TracedEntityDto,
  options: {
    type?: 'DEFINES' | 'GOVERNS';
    origin?: RelationshipOrigin;
    stateRecord?: StateRecordEvidenceDto | null;
    targetEntityId?: string;
  } = {},
): RequirementSourceDto {
  return {
    rule: 'REQUIREMENT_SOURCE',
    origin: options.origin ?? 'SOURCE',
    confidence: 'HIGH',
    relationship: {
      id: uuid(),
      type: options.type ?? 'GOVERNS',
      fromEntityId: definer.id,
      toEntityId: options.targetEntityId ?? uuid(),
      basis: null,
      sourceSystem: 'ContractMgmt',
      sourceId: `req-${counter}`,
      observedAt: OBSERVED_AT,
    },
    entity: entityRef(definer),
    attributes: {},
    stateRecord:
      options.stateRecord === undefined
        ? stateRecord(definer.currentState, { sourceSystem: 'ContractMgmt' })
        : options.stateRecord,
  };
}

export function noteEvidence(options: {
  id?: string;
  target: { kind: 'ENTITY'; entityId: string } | { kind: 'RELATIONSHIP'; relationshipId: string };
  stance?: NoteEvidenceDto['stance'];
  text?: string;
  author?: string;
  createdAt?: string;
  active?: boolean;
}): NoteEvidenceDto {
  const active = options.active ?? true;
  const author = { id: uuid(), displayName: options.author ?? 'Analyst A' };
  return {
    rule: 'MANUAL_NOTE',
    origin: 'MANUAL',
    id: options.id ?? uuid(),
    target: options.target,
    stance: options.stance ?? 'DISPUTES',
    text: options.text ?? 'This looks wrong',
    reference: null,
    author,
    createdAt: options.createdAt ?? '2026-09-30T09:00:00.000Z',
    active,
    retraction: active
      ? null
      : { retractedBy: author, reason: 'Mistaken', retractedAt: '2026-09-30T10:00:00.000Z' },
  };
}

export function entityEvidence(
  entity: TracedEntityDto,
  options: {
    stateRecords?: StateRecordEvidenceDto[];
    requirementSources?: RequirementSourceDto[];
    events?: EventEvidenceDto[];
    /** Overrides `events.total` (the list can be shorter than the total). */
    eventTotal?: number;
    notes?: NoteEvidenceDto[];
  } = {},
): EntityEvidenceDto {
  const requirementSources = options.requirementSources ?? [];
  const events = options.events ?? [];
  const notes = options.notes ?? [];
  return {
    entityId: entity.id,
    stateRecords: options.stateRecords ?? [
      stateRecord(entity.currentState, {
        sourceSystem: entity.state.observation?.sourceSystem,
        observedAt: entity.state.observation?.observedAt,
      }),
    ],
    requirementSources: { items: requirementSources, total: requirementSources.length },
    events: { items: events, total: options.eventTotal ?? events.length },
    notes: { items: notes, total: notes.length },
  };
}

export function relationshipEvidence(
  relationshipId: string,
  options: { notes?: NoteEvidenceDto[] } = {},
): RelationshipEvidenceDto {
  const notes = options.notes ?? [];
  return {
    relationshipId,
    rule: 'RELATIONSHIP_RECORD',
    origin: 'SOURCE',
    confidence: 'HIGH',
    record: null,
    notes: { items: notes, total: notes.length },
  };
}
