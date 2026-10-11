import {
  CurrencyCodeSchema,
  EntityTypeSchema,
  ImpactCategoryBucketSchema,
  ImpactExposureBucketSchema,
  TRACING_LIMITS,
  type ImpactListSelector,
} from '@opsgraph/shared';

export interface ImpactParams {
  depth: number;
  list: ImpactListSelector | null;
}

const DEPTH_KEY = 'idepth';
const LIST_KEY = 'ilist';

function parseDepth(raw: string | null): number {
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) && value >= TRACING_LIMITS.minDepth && value <= TRACING_LIMITS.maxDepth
    ? value
    : TRACING_LIMITS.defaultDepth;
}

/** Research R13: category.<Type>.<bucket>, exposure.<CUR>.<bucket>, valueUnknown, notCounted[.<Type>]. */
function parseList(raw: string | null): ImpactListSelector | null {
  if (raw === null) {
    return null;
  }
  const [kind, first, second, ...rest] = raw.split('.');
  if (rest.length > 0) {
    return null;
  }

  if (kind === 'valueUnknown' && first === undefined) {
    return { list: 'valueUnknown' };
  }
  if (kind === 'notCounted') {
    if (first === undefined) {
      return { list: 'notCounted', type: null };
    }
    const type = EntityTypeSchema.safeParse(first);
    return type.success && second === undefined ? { list: 'notCounted', type: type.data } : null;
  }
  if (kind === 'category') {
    const type = EntityTypeSchema.safeParse(first);
    const bucket = ImpactCategoryBucketSchema.safeParse(second);
    return type.success && bucket.success
      ? { list: 'category', type: type.data, bucket: bucket.data }
      : null;
  }
  if (kind === 'exposure') {
    const currency = CurrencyCodeSchema.safeParse(first);
    const bucket = ImpactExposureBucketSchema.safeParse(second);
    return currency.success && bucket.success
      ? { list: 'exposure', currency: currency.data, bucket: bucket.data }
      : null;
  }
  return null;
}

function serializeList(selector: ImpactListSelector): string {
  switch (selector.list) {
    case 'category':
      return `category.${selector.type}.${selector.bucket}`;
    case 'exposure':
      return `exposure.${selector.currency}.${selector.bucket}`;
    case 'valueUnknown':
      return 'valueUnknown';
    case 'notCounted':
      return selector.type === null ? 'notCounted' : `notCounted.${selector.type}`;
  }
}

/** Invalid values fall back to the default depth (6) or to no opened list. */
export function parseImpactParams(sp: URLSearchParams): ImpactParams {
  return { depth: parseDepth(sp.get(DEPTH_KEY)), list: parseList(sp.get(LIST_KEY)) };
}

/**
 * Merges a partial update into the current params. Unrelated params (dep, depth, rel, types) are
 * kept. Defaults are omitted: idepth=6, no opened list (`list: null` closes it).
 */
export function writeImpactParams(
  current: URLSearchParams,
  next: Partial<ImpactParams>,
): URLSearchParams {
  const out = new URLSearchParams(current.toString());

  if (next.depth !== undefined) {
    if (next.depth === TRACING_LIMITS.defaultDepth) {
      out.delete(DEPTH_KEY);
    } else {
      out.set(DEPTH_KEY, String(next.depth));
    }
  }
  if (next.list !== undefined) {
    if (next.list === null) {
      out.delete(LIST_KEY);
    } else {
      out.set(LIST_KEY, serializeList(next.list));
    }
  }
  return out;
}

/** The query string of GET /entities/:id/impact/items for one selector and page. */
export function toImpactListQueryString(
  depth: number,
  selector: ImpactListSelector,
  cursor?: string | null,
  limit = 50,
): string {
  const qs = new URLSearchParams();
  qs.set('list', selector.list);
  switch (selector.list) {
    case 'category':
      qs.set('type', selector.type);
      qs.set('bucket', selector.bucket);
      break;
    case 'exposure':
      qs.set('currency', selector.currency);
      qs.set('bucket', selector.bucket);
      break;
    case 'notCounted':
      if (selector.type !== null) {
        qs.set('type', selector.type);
      }
      break;
    case 'valueUnknown':
      break;
  }
  qs.set('depth', String(depth));
  qs.set('limit', String(limit));
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    qs.set('cursor', cursor);
  }
  return `?${qs.toString()}`;
}
