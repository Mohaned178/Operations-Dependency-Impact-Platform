import {
  CONFIDENCE_RANK,
  type Confidence,
  type EntityType,
  type OperationalState,
  type RelationshipOrigin,
} from '@opsgraph/shared';
import type {
  CustomerAttribution,
  GraphEntityRef,
  ImpactReachedEntity,
  TraversalHop,
  TraversalPath,
} from '../src/graph/graph.repository';
import type { Affected } from '../src/impact/analysis/types';

/** Hand-built values for the pure impact modules. Deterministic: ids come from a counter. */

let counter = 0;

export function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export function ref(
  type: EntityType,
  displayName: string,
  currentState: OperationalState = 'ACTIVE',
  id: string = uuid(),
): GraphEntityRef {
  return { id, type, displayName, currentState };
}

export interface HopOptions {
  key?: string;
  origin?: RelationshipOrigin;
  confidence?: Confidence;
}

export function hop(target: GraphEntityRef, options: HopOptions = {}): TraversalHop {
  const key = options.key ?? `key-${uuid()}`;
  return {
    key,
    relationshipType: 'DEPENDS_ON',
    fromEntityId: target.id,
    toEntityId: target.id,
    traversal: 'REVERSE',
    effectiveOrigin: options.origin ?? 'SOURCE',
    effectiveConfidence: options.confidence ?? 'HIGH',
    assertions: [],
    target,
  };
}

export function path(hops: TraversalHop[]): TraversalPath {
  let weakest: Confidence = 'HIGH';
  for (const item of hops) {
    if (CONFIDENCE_RANK[item.effectiveConfidence] < CONFIDENCE_RANK[weakest]) {
      weakest = item.effectiveConfidence;
    }
  }
  return {
    hops,
    weakestConfidence: weakest,
    nonSourceHops: hops.filter((item) => item.effectiveOrigin !== 'SOURCE').length,
    continuesBeyondDepth: false,
    endsInCycle: false,
  };
}

/** A path with one hop to `target`. */
export function directPath(target: GraphEntityRef, options: HopOptions = {}): TraversalPath {
  return path([hop(target, options)]);
}

export interface ReachedOptions {
  distance?: number;
  canonical?: TraversalPath;
  live?: TraversalPath | null;
  shortest?: TraversalPath;
  sourced?: boolean;
}

export function reached(entity: GraphEntityRef, options: ReachedOptions = {}): ImpactReachedEntity {
  const canonical = options.canonical ?? directPath(entity);
  return {
    entity,
    distance: options.distance ?? 1,
    canonicalPath: canonical,
    livePath: options.live === undefined ? null : options.live,
    shortestPath: options.shortest ?? canonical,
    sourcedReach: options.sourced ?? true,
  };
}

export function affected(entity: GraphEntityRef, overrides: Partial<Affected> = {}): Affected {
  const distance = overrides.distance === undefined ? 1 : overrides.distance;
  return {
    entity,
    classification: 'POTENTIAL',
    notCountedReason: null,
    distance,
    directness: distance === 1 ? 'DIRECT' : 'INDIRECT',
    primaryPath: directPath(entity),
    shortestPath: null,
    flags: { stateUnknown: false, otherCause: false, inferredOnly: false },
    attributions: [],
    ...overrides,
  };
}

export function attribution(
  attributedEntityId: string,
  customer: GraphEntityRef,
  link: TraversalPath = directPath(customer),
): CustomerAttribution {
  return { attributedEntityId, customer, link };
}
