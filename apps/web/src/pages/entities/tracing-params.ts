import {
  EntityTypeSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  TRACING_LIMITS,
  type EntityType,
  type TraceableRelationshipType,
} from '@opsgraph/shared';

export interface TracingParams {
  dep: 'upstream' | 'downstream';
  depth: number;
  rel: TraceableRelationshipType[];
  types: EntityType[];
}

const ENTITY_TYPE_ORDER = EntityTypeSchema.options;

function parseList(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

/** Plan KDN 8: invalid values fall back to the defaults. */
export function parseTracingParams(sp: URLSearchParams): TracingParams {
  const depRaw = sp.get('dep');
  const dep: TracingParams['dep'] = depRaw === 'downstream' ? 'downstream' : 'upstream';

  const depthRaw = sp.get('depth');
  const depthNumber = depthRaw === null ? Number.NaN : Number(depthRaw);
  const depth =
    Number.isInteger(depthNumber) &&
    depthNumber >= TRACING_LIMITS.minDepth &&
    depthNumber <= TRACING_LIMITS.maxDepth
      ? depthNumber
      : TRACING_LIMITS.defaultDepth;

  const relRaw = new Set(parseList(sp.get('rel')));
  const rel = TRACEABLE_RELATIONSHIP_TYPES.filter((type) => relRaw.has(type));

  const typesRaw = new Set(parseList(sp.get('types')));
  const types = ENTITY_TYPE_ORDER.filter((type) => typesRaw.has(type));

  return { dep, depth, rel, types };
}

/**
 * Merges a partial update into the current params. Unrelated params are kept.
 * Defaults are omitted: dep=upstream, depth=6, empty lists.
 */
export function writeTracingParams(
  current: URLSearchParams,
  next: Partial<TracingParams>,
): URLSearchParams {
  const out = new URLSearchParams(current.toString());

  if (next.dep !== undefined) {
    if (next.dep === 'upstream') {
      out.delete('dep');
    } else {
      out.set('dep', next.dep);
    }
  }
  if (next.depth !== undefined) {
    if (next.depth === TRACING_LIMITS.defaultDepth) {
      out.delete('depth');
    } else {
      out.set('depth', String(next.depth));
    }
  }
  if (next.rel !== undefined) {
    if (next.rel.length === 0) {
      out.delete('rel');
    } else {
      out.set('rel', next.rel.join(','));
    }
  }
  if (next.types !== undefined) {
    if (next.types.length === 0) {
      out.delete('types');
    } else {
      out.set('types', next.types.join(','));
    }
  }

  return out;
}

/** Research R12: relationshipTypes and entityTypes are comma lists, only when non-empty. */
export function toDependenciesQueryString(
  params: TracingParams,
  cursor?: string | null,
  limit = 50,
): string {
  const qs = new URLSearchParams();
  qs.set('direction', params.dep);
  qs.set('depth', String(params.depth));
  if (params.rel.length > 0) {
    qs.set('relationshipTypes', params.rel.join(','));
  }
  if (params.types.length > 0) {
    qs.set('entityTypes', params.types.join(','));
  }
  qs.set('limit', String(limit));
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    qs.set('cursor', cursor);
  }
  return `?${qs.toString()}`;
}
