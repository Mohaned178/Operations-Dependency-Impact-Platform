import type { Entity, EntityIdentifier, SourceRecord, StateObservation } from '@prisma/client';
import type {
  EntityListItemDto,
  IdentifierDto,
  JsonValue,
  SourceRecordDto,
  StateObservationDto,
} from '@opsgraph/shared';

export type EntityWithIdentifiers = Entity & { identifiers: EntityIdentifier[] };

function distinctSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function toIdentifierDto(identifier: EntityIdentifier): IdentifierDto {
  return {
    sourceSystem: identifier.sourceSystem,
    sourceId: identifier.sourceId,
    firstSeenAt: identifier.createdAt.toISOString(),
  };
}

export function toStateObservationDto(observation: StateObservation): StateObservationDto {
  return {
    id: observation.id,
    state: observation.state,
    sourceStatus: observation.sourceStatus,
    sourceSystem: observation.sourceSystem,
    sourceId: observation.sourceId,
    observedAt: observation.observedAt.toISOString(),
    receivedAt: observation.receivedAt.toISOString(),
    importId: observation.importId,
  };
}

export function toSourceRecordDto(record: SourceRecord): SourceRecordDto {
  return {
    id: record.id,
    kind: record.kind,
    sourceSystem: record.sourceSystem,
    sourceId: record.sourceId,
    observedAt: record.observedAt.toISOString(),
    receivedAt: record.receivedAt.toISOString(),
    importId: record.importId,
    rawPayload: record.rawPayload as JsonValue,
  };
}

export function toEntityListItemDto(entity: EntityWithIdentifiers): EntityListItemDto {
  const [primary, ...rest] = entity.identifiers;
  if (primary === undefined) {
    throw new Error(`Entity ${entity.id} has no identifier`);
  }
  return {
    id: entity.id,
    type: entity.type,
    displayName: entity.displayName,
    currentState: entity.currentState,
    primaryIdentifier: toIdentifierDto(primary),
    sourceSystems: distinctSorted([primary, ...rest].map((identifier) => identifier.sourceSystem)),
    lastObservedAt: entity.lastObservedAt.toISOString(),
  };
}
