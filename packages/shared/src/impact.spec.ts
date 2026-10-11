import { describe, expect, it } from 'vitest';
import { EntityTypeSchema, OperationalStateSchema } from './graph';
import {
  IMPACT_HEADLINE_TYPES,
  IMPACT_NOUNS,
  IMPACT_STATE_CLASS,
  IMPAIRED_STATES,
  ImpactListQuerySchema,
  ImpactResponseSchema,
  TERMINAL_STATES,
  impactCategoryLabel,
} from './impact';

describe('IMPACT_STATE_CLASS', () => {
  it('classifies every state exactly as research R3 says', () => {
    expect(IMPACT_STATE_CLASS).toEqual({
      PENDING: 'IMPAIRED',
      WAITING: 'IMPAIRED',
      BLOCKED: 'IMPAIRED',
      MISSING: 'IMPAIRED',
      DELAYED: 'IMPAIRED',
      FAILED: 'IMPAIRED',
      SUSPENDED: 'IMPAIRED',
      AT_RISK: 'IMPAIRED',
      ACTIVE: 'UNIMPAIRED',
      COMPLETED: 'TERMINAL',
      CANCELLED: 'TERMINAL',
      UNKNOWN: 'INDETERMINATE',
    });
    expect(Object.keys(IMPACT_STATE_CLASS).sort()).toEqual([...OperationalStateSchema.options].sort());
  });

  it('derives the impaired and terminal lists', () => {
    expect(IMPAIRED_STATES).toHaveLength(8);
    expect([...TERMINAL_STATES]).toEqual(['COMPLETED', 'CANCELLED']);
  });
});

describe('IMPACT_NOUNS and labels', () => {
  it('covers every entity type', () => {
    expect(Object.keys(IMPACT_NOUNS).sort()).toEqual([...EntityTypeSchema.options].sort());
  });

  it('upper-cases the first letter of the plural', () => {
    expect(impactCategoryLabel('Order')).toBe('Customer orders');
    expect(impactCategoryLabel('SLA')).toBe('SLA commitments');
    expect(impactCategoryLabel('PurchaseOrder')).toBe('Purchase orders');
  });

  it('lists the six headline types in order', () => {
    expect([...IMPACT_HEADLINE_TYPES]).toEqual([
      'Product',
      'PurchaseOrder',
      'Order',
      'Customer',
      'Shipment',
      'SLA',
    ]);
  });
});

describe('ImpactListQuerySchema', () => {
  function issuesOf(query: Record<string, string>): { path: string; message: string }[] {
    const result = ImpactListQuerySchema.safeParse(query);
    if (result.success) throw new Error('expected a validation failure');
    return result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }

  it('requires list', () => {
    expect(issuesOf({}).map((i) => i.path)).toContain('list');
  });

  it('requires type for list=category', () => {
    expect(issuesOf({ list: 'category', bucket: 'total' }).map((i) => i.path)).toEqual(['type']);
  });

  it('rejects an unknown category bucket and lists the allowed ones', () => {
    const issues = issuesOf({ list: 'category', type: 'Order', bucket: 'sum' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('bucket');
    expect(issues[0]?.message).toContain('total, direct, indirect, current, potential, inferredOnly, stateUnknown');
  });

  it('forbids currency for list=category', () => {
    expect(
      issuesOf({ list: 'category', type: 'Order', bucket: 'total', currency: 'USD' }),
    ).toEqual([{ path: 'currency', message: 'currency is not allowed for list=category' }]);
  });

  it('requires currency for list=exposure', () => {
    expect(issuesOf({ list: 'exposure', bucket: 'total' }).map((i) => i.path)).toEqual(['currency']);
  });

  it('rejects a lower-case currency', () => {
    expect(
      issuesOf({ list: 'exposure', currency: 'usd', bucket: 'total' }).map((i) => i.path),
    ).toEqual(['currency']);
  });

  it('forbids type for list=exposure and rejects category-only buckets', () => {
    expect(
      issuesOf({ list: 'exposure', currency: 'USD', bucket: 'direct', type: 'Order' }).map(
        (i) => i.path,
      ),
    ).toEqual(['type', 'bucket']);
  });

  it('forbids type, bucket and currency for list=valueUnknown', () => {
    expect(
      issuesOf({ list: 'valueUnknown', type: 'Order', bucket: 'total', currency: 'USD' }).map(
        (i) => i.path,
      ),
    ).toEqual(['type', 'bucket', 'currency']);
  });

  it('forbids bucket and currency for list=notCounted', () => {
    expect(
      issuesOf({ list: 'notCounted', bucket: 'total', currency: 'USD' }).map((i) => i.path),
    ).toEqual(['bucket', 'currency']);
  });

  it('rejects an unknown type', () => {
    expect(issuesOf({ list: 'notCounted', type: 'Widget' }).map((i) => i.path)).toEqual(['type']);
  });

  it('rejects limit 0 and 201 and a depth out of range', () => {
    expect(issuesOf({ list: 'valueUnknown', limit: '0' }).map((i) => i.path)).toEqual(['limit']);
    expect(issuesOf({ list: 'valueUnknown', limit: '201' }).map((i) => i.path)).toEqual(['limit']);
    expect(issuesOf({ list: 'valueUnknown', depth: '0' }).map((i) => i.path)).toEqual(['depth']);
  });

  it('transforms valid selectors', () => {
    expect(ImpactListQuerySchema.parse({ list: 'valueUnknown' }).selector).toEqual({
      list: 'valueUnknown',
    });
    expect(ImpactListQuerySchema.parse({ list: 'notCounted' }).selector).toEqual({
      list: 'notCounted',
      type: null,
    });
    expect(ImpactListQuerySchema.parse({ list: 'notCounted', type: 'Order' }).selector).toEqual({
      list: 'notCounted',
      type: 'Order',
    });
    expect(
      ImpactListQuerySchema.parse({ list: 'category', type: 'Order', bucket: 'current' }).selector,
    ).toEqual({ list: 'category', type: 'Order', bucket: 'current' });
    expect(
      ImpactListQuerySchema.parse({ list: 'exposure', currency: 'USD', bucket: 'inferredOnly' })
        .selector,
    ).toEqual({ list: 'exposure', currency: 'USD', bucket: 'inferredOnly' });
  });

  it('defaults depth to 6 and limit to 50', () => {
    const parsed = ImpactListQuerySchema.parse({ list: 'valueUnknown' });
    expect(parsed.depth).toBe(6);
    expect(parsed.limit).toBe(50);
    expect(parsed.cursor).toBeUndefined();
  });
});

describe('ImpactResponseSchema', () => {
  it('rejects a response with fewer than 6 categories', () => {
    const result = ImpactResponseSchema.safeParse({ categories: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'categories')).toBe(true);
    }
  });
});
