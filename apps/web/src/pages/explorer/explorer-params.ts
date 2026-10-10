import { ExplorerUrlParamsSchema, EXPLORER_LIMITS, type ExplorerUrlParams } from '@opsgraph/shared';

export type ParsedExplorerParams =
  | { ok: true; params: ExplorerUrlParams }
  | { ok: false; issues: string[] };

type SettingKey = 'direction' | 'depth' | 'relationshipTypes' | 'entityTypes' | 'blockers';

function raw(sp: URLSearchParams, key: SettingKey): string | undefined {
  return sp.get(key) ?? undefined;
}

/**
 * Research R10: validates the URL with the shared schema. Unlike feature 003's
 * parseTracingParams, invalid values are reported, never replaced by defaults.
 */
export function parseExplorerParams(sp: URLSearchParams): ParsedExplorerParams {
  const result = ExplorerUrlParamsSchema.safeParse({
    direction: raw(sp, 'direction'),
    depth: raw(sp, 'depth'),
    relationshipTypes: raw(sp, 'relationshipTypes'),
    entityTypes: raw(sp, 'entityTypes'),
    blockers: raw(sp, 'blockers'),
  });
  if (result.success) {
    return { ok: true, params: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  };
}

/**
 * Merges a partial update into the current params. Unrelated params are kept. Defaults are
 * omitted: direction=all, depth=2, empty lists, blockers=false.
 */
export function writeExplorerParams(
  current: URLSearchParams,
  next: Partial<ExplorerUrlParams>,
): URLSearchParams {
  const out = new URLSearchParams(current.toString());

  if (next.direction !== undefined) {
    if (next.direction === 'all') {
      out.delete('direction');
    } else {
      out.set('direction', next.direction);
    }
  }
  if (next.depth !== undefined) {
    if (next.depth === EXPLORER_LIMITS.defaultDepth) {
      out.delete('depth');
    } else {
      out.set('depth', String(next.depth));
    }
  }
  if (next.relationshipTypes !== undefined) {
    if (next.relationshipTypes.length === 0) {
      out.delete('relationshipTypes');
    } else {
      out.set('relationshipTypes', next.relationshipTypes.join(','));
    }
  }
  if (next.entityTypes !== undefined) {
    if (next.entityTypes.length === 0) {
      out.delete('entityTypes');
    } else {
      out.set('entityTypes', next.entityTypes.join(','));
    }
  }
  if (next.blockers !== undefined) {
    if (next.blockers) {
      out.set('blockers', 'true');
    } else {
      out.delete('blockers');
    }
  }

  return out;
}

/** Query string for GET /entities/:id/neighborhood. Lists only when non-empty; expand keeps its order. */
export function toNeighborhoodQueryString(params: ExplorerUrlParams, expand: readonly string[]): string {
  const query = new URLSearchParams();
  query.set('direction', params.direction);
  query.set('depth', String(params.depth));
  if (params.relationshipTypes.length > 0) {
    query.set('relationshipTypes', params.relationshipTypes.join(','));
  }
  if (params.entityTypes.length > 0) {
    query.set('entityTypes', params.entityTypes.join(','));
  }
  query.set('blockers', String(params.blockers));
  if (expand.length > 0) {
    query.set('expand', expand.join(','));
  }
  return query.toString();
}
