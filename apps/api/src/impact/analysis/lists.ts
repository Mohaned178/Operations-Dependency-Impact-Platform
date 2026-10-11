import { z } from 'zod';
import type { ImpactCategoryBucket, ImpactExposureBucket, ImpactListSelector } from '@opsgraph/shared';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { compareCodeUnits } from '../../graph/traversal/path-order';
import type { Affected, ExposureResult } from './types';

/** One part of a sort key. Keys compare element by element; ascending key order is list order. */
export type KeyPart = string | number;

const CursorSchema = z.object({ k: z.array(z.union([z.string(), z.number()])) });

/** Bigint units are sorted descending as fixed-width complement strings (research R7). */
const KEY_WIDTH = 30;
const KEY_CEILING = 10n ** BigInt(KEY_WIDTH);

function descendingUnits(units: bigint): string {
  if (units < 0n || units >= KEY_CEILING) {
    throw new Error('impact invariant: amount outside the sortable range');
  }
  return (KEY_CEILING - 1n - units).toString().padStart(KEY_WIDTH, '0');
}

function categoryBucketMatches(item: Affected, bucket: ImpactCategoryBucket): boolean {
  switch (bucket) {
    case 'total':
      return true;
    case 'direct':
      return item.directness === 'DIRECT';
    case 'indirect':
      return item.directness === 'INDIRECT';
    case 'current':
      return item.classification === 'CURRENT';
    case 'potential':
      return item.classification === 'POTENTIAL';
    case 'inferredOnly':
      return item.flags.inferredOnly;
    case 'stateUnknown':
      return item.flags.stateUnknown;
  }
}

function exposureBucketMatches(item: Affected, bucket: ImpactExposureBucket): boolean {
  switch (bucket) {
    case 'total':
      return true;
    case 'current':
      return item.classification === 'CURRENT';
    case 'potential':
      return item.classification === 'POTENTIAL';
    case 'inferredOnly':
      return item.flags.inferredOnly;
  }
}

/**
 * Spec FR-017: the entities behind one number of the summary, in input order. Each selector
 * returns exactly the members its summary cell counts (contracts/api.md "List total").
 */
export function selectList(
  affected: readonly Affected[],
  exposure: ExposureResult,
  selector: ImpactListSelector,
): Affected[] {
  switch (selector.list) {
    case 'category':
      return affected.filter(
        (item) =>
          item.classification !== 'NOT_COUNTED' &&
          item.entity.type === selector.type &&
          categoryBucketMatches(item, selector.bucket),
      );
    case 'exposure':
      return affected.filter(
        (item) =>
          exposure.orders.get(item.entity.id)?.currency === selector.currency &&
          exposureBucketMatches(item, selector.bucket),
      );
    case 'valueUnknown':
      return affected.filter((item) => exposure.valueUnknownIds.has(item.entity.id));
    case 'notCounted':
      return affected.filter(
        (item) =>
          item.classification === 'NOT_COUNTED' &&
          (selector.type === null || item.entity.type === selector.type),
      );
  }
}

type ListKind = 'orders' | 'customers' | 'others';

function listKind(selector: ImpactListSelector): ListKind {
  switch (selector.list) {
    case 'exposure':
    case 'valueUnknown':
      return 'orders';
    case 'notCounted':
      return 'others';
    case 'category':
      if (selector.type === 'Order') return 'orders';
      return selector.type === 'Customer' ? 'customers' : 'others';
  }
}

const CLASS_RANK: Record<Affected['classification'], number> = {
  CURRENT: 0,
  POTENTIAL: 1,
  NOT_COUNTED: 2,
};

/** Distances are small; an attributed-only customer (null) sorts after every real distance. */
const NO_DISTANCE = 1_000_000;

/** Research R7: the sort key of one list item. Ascending key order is the list order. */
export function keyForList(
  selector: ImpactListSelector,
  exposure: ExposureResult,
): (item: Affected) => KeyPart[] {
  const kind = listKind(selector);
  return (item) => {
    const { id, displayName } = item.entity;
    if (kind === 'orders') {
      const order = exposure.orders.get(id);
      return order === undefined
        ? [1, '', '', displayName, id]
        : [0, descendingUnits(order.amount), order.currency, displayName, id];
    }
    if (kind === 'customers') {
      let highest = 0n;
      for (const sum of exposure.customerExposure.get(id)?.values() ?? []) {
        if (sum > highest) {
          highest = sum;
        }
      }
      return [descendingUnits(highest), displayName, id];
    }
    return [CLASS_RANK[item.classification], item.distance ?? NO_DISTANCE, displayName, id];
  };
}

export function compareKeys(a: readonly KeyPart[], b: readonly KeyPart[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined || right === undefined || left === right) {
      continue;
    }
    if (typeof left === 'number' && typeof right === 'number') {
      return left < right ? -1 : 1;
    }
    if (typeof left === 'string' && typeof right === 'string') {
      return compareCodeUnits(left, right);
    }
    return typeof left === 'number' ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}

/** Research R7: the list order for a selector (orders by value, customers by exposure, others by state). */
export function compareForList(
  selector: ImpactListSelector,
  exposure: ExposureResult,
): (a: Affected, b: Affected) => number {
  const keyOf = keyForList(selector, exposure);
  return (a, b) => compareKeys(keyOf(a), keyOf(b));
}

/**
 * Key-based paging over items that are already sorted by `keyOf`: the page starts at the first
 * item whose key is greater than the cursor's, so a cursor stays valid when the data changes.
 */
export function paginate<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
  keyOf: (item: T) => KeyPart[],
): { items: T[]; nextCursor: string | null } {
  let start = 0;
  if (cursor !== undefined) {
    const after = decodeCursor(CursorSchema, cursor).k;
    start = items.findIndex((item) => compareKeys(keyOf(item), after) > 0);
    if (start === -1) {
      return { items: [], nextCursor: null };
    }
  }
  const page = items.slice(start, start + limit);
  const last = page.at(-1);
  const hasMore = start + limit < items.length;
  return {
    items: page,
    nextCursor: hasMore && last !== undefined ? encodeCursor({ k: keyOf(last) }) : null,
  };
}
