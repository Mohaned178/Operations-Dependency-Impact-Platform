import type {
  AuditAction,
  Confidence,
  EntityType,
  JsonValue,
  OperationalState,
  RelationshipOrigin,
  RelationshipType,
} from '@opsgraph/shared';

export type SourceRecordKind = 'ENTITY' | 'RELATIONSHIP' | 'EVENT';
import type { RowError } from '../parsing/parsed-import';

export type RowClassification = 'created' | 'updated' | 'unchanged' | 'rejected';

export function recordKey(sourceSystem: string, sourceId: string): string {
  return `${sourceSystem}\u0000${sourceId}`;
}

export function identifierKey(
  entityType: EntityType,
  sourceSystem: string,
  sourceId: string,
): string {
  return `${entityType}\u0000${sourceSystem}\u0000${sourceId}`;
}

export interface NormalizedEntity {
  entityType: EntityType;
  displayName: string;
  attributes: Record<string, JsonValue>;
  state: OperationalState | null;
  sourceStatus: string | null;
}

export interface NormalizedRelationship {
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
  origin: RelationshipOrigin;
  confidence: Confidence;
  basis: string | null;
}

export interface NormalizedEvent {
  type: string;
  occurredAt: string;
  description: string | null;
  subjectEntityId: string;
  relatedEntityIds: string[];
}

export type NormalizedPayload = NormalizedEntity | NormalizedRelationship | NormalizedEvent;

export interface ObservationRecord<TNormalized extends NormalizedPayload = NormalizedPayload> {
  observedAt: Date;
  seqOrder: number;
  payloadHash: string;
  sourceSystem: string;
  sourceId: string;
  importId: string;
  normalized: TNormalized;
}

export interface StateObservationRecord {
  observedAt: Date;
  seqOrder: number;
  state: OperationalState;
  sourceStatus: string | null;
  sourceSystem: string;
}

export interface SnapshotEntity {
  id: string;
  type: EntityType;
}

export interface SnapshotIdentifier {
  entityId: string;
  entityType: EntityType;
  sourceSystem: string;
  sourceId: string;
}

export interface SnapshotRelationship {
  id: string;
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
  origin: RelationshipOrigin;
  confidence: Confidence;
  basis: string | null;
  sourceSystem: string;
  sourceId: string;
  observedAt: Date;
  importId: string;
}

export interface SnapshotEvent {
  id: string;
  type: string;
  occurredAt: Date;
  observedAt: Date;
  description: string | null;
  subjectEntityId: string;
  relatedEntityIds: string[];
  sourceSystem: string;
  sourceId: string;
  importId: string;
}

/**
 * Everything the planner may read about the data already stored. Keyed maps use
 * `identifierKey` / `recordKey` above.
 */
export interface ImportSnapshot {
  maxSourceRecordSeq: number;
  maxStateObservationSeq: number;
  entitiesById: ReadonlyMap<string, SnapshotEntity>;
  identifiersByKey: ReadonlyMap<string, SnapshotIdentifier>;
  entityObservations: ReadonlyMap<string, readonly ObservationRecord<NormalizedEntity>[]>;
  stateObservations: ReadonlyMap<string, readonly StateObservationRecord[]>;
  relationshipsById: ReadonlyMap<string, SnapshotRelationship>;
  relationshipsByKey: ReadonlyMap<string, SnapshotRelationship>;
  relationshipObservations: ReadonlyMap<
    string,
    readonly ObservationRecord<NormalizedRelationship>[]
  >;
  eventsById: ReadonlyMap<string, SnapshotEvent>;
  eventsByKey: ReadonlyMap<string, SnapshotEvent>;
  eventObservations: ReadonlyMap<string, readonly ObservationRecord<NormalizedEvent>[]>;
  /** In-file entity keys rejected before planning; maps the key to the first rejected row. */
  rejectedEntityRows: ReadonlyMap<string, number>;
}

export interface PlanContext {
  now: Date;
  receivedAt: Date;
  newId: () => string;
}

export interface EntityProjectionWrite {
  id: string;
  type: EntityType;
  displayName: string;
  attributes: Record<string, JsonValue>;
  currentState: OperationalState;
  lastObservedAt: Date;
}

export interface EntityIdentifierInsert {
  id: string;
  entityId: string;
  entityType: EntityType;
  sourceSystem: string;
  sourceId: string;
}

export interface RelationshipProjectionWrite {
  id: string;
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
  origin: RelationshipOrigin;
  confidence: Confidence;
  basis: string | null;
  sourceSystem: string;
  sourceId: string;
  observedAt: Date;
}

export interface EventProjectionWrite {
  id: string;
  type: string;
  occurredAt: Date;
  observedAt: Date;
  description: string | null;
  subjectEntityId: string;
  relatedEntityIds: string[];
  sourceSystem: string;
  sourceId: string;
}

export interface EventEntityWrite {
  eventId: string;
  entityId: string;
  role: 'SUBJECT' | 'RELATED';
}

export interface SourceRecordInsert {
  id: string;
  kind: SourceRecordKind;
  sourceSystem: string;
  sourceId: string;
  observedAt: Date;
  /** Planner ordering; the writer inserts in ascending order so DB seq matches. */
  seqOrder: number;
  rawPayload: JsonValue;
  payloadHash: string;
  normalized: NormalizedPayload;
  entityId: string | null;
  relationshipId: string | null;
  eventId: string | null;
}

export interface StateObservationInsert {
  id: string;
  entityId: string;
  sourceRecordId: string;
  state: OperationalState;
  sourceStatus: string | null;
  sourceSystem: string;
  sourceId: string;
  observedAt: Date;
  seqOrder: number;
}

export interface PlannedAudit {
  action: AuditAction;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  sourceRecordId: string;
}

export interface ImportWriteSet {
  entityInserts: EntityProjectionWrite[];
  entityUpdates: EntityProjectionWrite[];
  identifierInserts: EntityIdentifierInsert[];
  relationshipInserts: RelationshipProjectionWrite[];
  relationshipUpdates: RelationshipProjectionWrite[];
  eventInserts: EventProjectionWrite[];
  eventUpdates: EventProjectionWrite[];
  eventEntityInserts: EventEntityWrite[];
  eventRelatedReplacements: string[];
  sourceRecords: SourceRecordInsert[];
  stateObservations: StateObservationInsert[];
  audits: PlannedAudit[];
}

export interface PlannedEntityRow {
  row: number;
  classification: RowClassification;
  entityId: string | null;
}

export interface PlannedRelationshipRow {
  row: number;
  classification: RowClassification;
  relationshipId: string | null;
}

export interface PlannedEventRow {
  row: number;
  classification: RowClassification;
  eventId: string | null;
}

export interface PlanCounts {
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
}

export interface ImportPlan {
  entityRows: PlannedEntityRow[];
  relationshipRows: PlannedRelationshipRow[];
  eventRows: PlannedEventRow[];
  write: ImportWriteSet;
  counts: { entities: PlanCounts; relationships: PlanCounts; events: PlanCounts };
  errors: RowError[];
  changeCount: number;
}
