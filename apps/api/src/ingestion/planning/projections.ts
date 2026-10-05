import type { Confidence, JsonValue, OperationalState, RelationshipOrigin } from '@opsgraph/shared';
import type {
  NormalizedEntity,
  NormalizedEvent,
  NormalizedRelationship,
} from './import-plan';

export interface EntityObservation {
  observedAt: Date;
  seqOrder: number;
  normalized: NormalizedEntity;
}

export interface EntityStateObservation {
  observedAt: Date;
  seqOrder: number;
  state: OperationalState;
}

export interface RelationshipObservation {
  observedAt: Date;
  seqOrder: number;
  importId: string;
  normalized: NormalizedRelationship;
}

export interface EventObservation {
  observedAt: Date;
  seqOrder: number;
  importId: string;
  normalized: NormalizedEvent;
}

export interface EntityProjection {
  displayName: string;
  attributes: Record<string, JsonValue>;
  currentState: OperationalState;
  lastObservedAt: Date;
}

export interface RelationshipProjection {
  origin: RelationshipOrigin;
  confidence: Confidence;
  basis: string | null;
  observedAt: Date;
  importId: string;
}

export interface EventProjection {
  occurredAt: Date;
  description: string | null;
  relatedEntityIds: string[];
  observedAt: Date;
  importId: string;
}

function compareObservation(
  left: { observedAt: Date; seqOrder: number },
  right: { observedAt: Date; seqOrder: number },
): number {
  const time = left.observedAt.getTime() - right.observedAt.getTime();
  if (time !== 0) {
    return time;
  }
  return left.seqOrder - right.seqOrder;
}

export function latestObservation<T extends { observedAt: Date; seqOrder: number }>(
  observations: readonly T[],
): T | undefined {
  let latest: T | undefined;
  for (const observation of observations) {
    if (latest === undefined || compareObservation(observation, latest) > 0) {
      latest = observation;
    }
  }
  return latest;
}

export function nonEmpty<T>(items: readonly T[]): [T, ...T[]] {
  const first = items[0];
  if (first === undefined) {
    throw new Error('Expected at least one observation');
  }
  return [first, ...items.slice(1)];
}

export function projectEntity(
  observations: readonly [EntityObservation, ...EntityObservation[]],
  stateObservations: readonly EntityStateObservation[],
): EntityProjection {
  const latest = latestObservation(observations) ?? observations[0];
  const attributes: Record<string, JsonValue> = {};
  for (const observation of [...observations].sort(compareObservation)) {
    Object.assign(attributes, observation.normalized.attributes);
  }
  const latestState = latestObservation(stateObservations);
  return {
    displayName: latest.normalized.displayName,
    attributes,
    currentState: latestState?.state ?? 'UNKNOWN',
    lastObservedAt: latest.observedAt,
  };
}

export function projectRelationship(
  observations: readonly [RelationshipObservation, ...RelationshipObservation[]],
): RelationshipProjection {
  const latest = latestObservation(observations) ?? observations[0];
  return {
    origin: latest.normalized.origin,
    confidence: latest.normalized.confidence,
    basis: latest.normalized.basis,
    observedAt: latest.observedAt,
    importId: latest.importId,
  };
}

export function projectEvent(
  observations: readonly [EventObservation, ...EventObservation[]],
): EventProjection {
  const latest = latestObservation(observations) ?? observations[0];
  return {
    occurredAt: new Date(latest.normalized.occurredAt),
    description: latest.normalized.description,
    relatedEntityIds: [...latest.normalized.relatedEntityIds],
    observedAt: latest.observedAt,
    importId: latest.importId,
  };
}

export function latestStateBySource<T extends { observedAt: Date; seqOrder: number; sourceSystem: string }>(
  observations: readonly T[],
): T[] {
  const bySource = new Map<string, T>();
  for (const observation of observations) {
    const current = bySource.get(observation.sourceSystem);
    if (current === undefined || compareObservation(observation, current) > 0) {
      bySource.set(observation.sourceSystem, observation);
    }
  }
  return [...bySource.values()].sort((left, right) =>
    left.sourceSystem < right.sourceSystem ? -1 : left.sourceSystem > right.sourceSystem ? 1 : 0,
  );
}
