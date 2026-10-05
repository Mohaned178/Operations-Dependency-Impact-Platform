import { describe, expect, it } from 'vitest';
import {
  EntityImportRowSchema,
  EventImportRowSchema,
  ImportDocumentSchema,
  ImportRequestFieldsSchema,
  RelationshipImportRowSchema,
  SourceIdSchema,
  SourceSystemSchema,
  TimestampSchema,
} from './imports';

const BASE_ENTITY = {
  type: 'Order',
  sourceSystem: 'OMS',
  sourceId: '18492',
  displayName: 'Order #18492',
  observedAt: '2026-09-14T08:30:00+00:00',
  attributes: { amount: '12480.00', currency: 'USD' },
} as const;

describe('TimestampSchema', () => {
  it('rejects a naive timestamp', () => {
    expect(TimestampSchema.safeParse('2026-09-14T08:30:00').success).toBe(false);
  });

  it('accepts an offset timestamp and returns it unchanged', () => {
    const value = '2026-09-14T08:30:00+02:00';
    expect(TimestampSchema.parse(value)).toBe(value);
  });
});

describe('SourceIdSchema and SourceSystemSchema', () => {
  it('rejects the reserved CSV characters in a source id', () => {
    for (const sourceId of ['a|b', 'a;b', 'a\rb', 'a\nb']) {
      expect(SourceIdSchema.safeParse(sourceId).success).toBe(false);
    }
  });

  it('rejects an empty or oversized source system', () => {
    expect(SourceSystemSchema.safeParse('').success).toBe(false);
    expect(SourceSystemSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('accepts a normal source system', () => {
    expect(SourceSystemSchema.parse('Acme ERP')).toBe('Acme ERP');
  });
});

describe('EntityImportRowSchema', () => {
  it('rejects an amount given as a number', () => {
    const result = EntityImportRowSchema.safeParse({
      ...BASE_ENTITY,
      attributes: { amount: 12480, currency: 'USD' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a monetary entity without a currency', () => {
    const result = EntityImportRowSchema.safeParse({
      ...BASE_ENTITY,
      attributes: { amount: '12480.00' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a bad currency code', () => {
    const result = EntityImportRowSchema.safeParse({
      ...BASE_ENTITY,
      attributes: { amount: '12480.00', currency: 'usd' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a non-monetary entity without money attributes', () => {
    const parsed = EntityImportRowSchema.parse({
      type: 'Customer',
      sourceSystem: BASE_ENTITY.sourceSystem,
      sourceId: BASE_ENTITY.sourceId,
      displayName: BASE_ENTITY.displayName,
      observedAt: BASE_ENTITY.observedAt,
    });
    expect(parsed.attributes).toEqual({});
  });

  it('trims the display name', () => {
    const parsed = EntityImportRowSchema.parse({
      ...BASE_ENTITY,
      displayName: '  Order #18492  ',
    });
    expect(parsed.displayName).toBe('Order #18492');
  });

  it('allows unknown row fields', () => {
    const result = EntityImportRowSchema.safeParse({
      ...BASE_ENTITY,
      customField: 'kept for the raw payload',
    });
    expect(result.success).toBe(true);
  });
});

describe('RelationshipImportRowSchema', () => {
  const BASE_RELATIONSHIP = {
    type: 'PLACED',
    sourceSystem: 'OMS',
    sourceId: 'placed-1',
    from: { entityType: 'Customer', sourceSystem: 'CRM', sourceId: 'acme' },
    to: { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
    confidence: 'HIGH',
    observedAt: '2026-09-14T08:30:00+00:00',
  } as const;

  it('rejects an inferred relationship without a basis', () => {
    const result = RelationshipImportRowSchema.safeParse({
      ...BASE_RELATIONSHIP,
      origin: 'INFERRED',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a manual relationship without a basis', () => {
    const result = RelationshipImportRowSchema.safeParse({
      ...BASE_RELATIONSHIP,
      origin: 'MANUAL',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a source relationship without a basis', () => {
    const parsed = RelationshipImportRowSchema.parse({
      ...BASE_RELATIONSHIP,
      origin: 'SOURCE',
    });
    expect(parsed.basis).toBeUndefined();
  });

  it('trims the basis', () => {
    const parsed = RelationshipImportRowSchema.parse({
      ...BASE_RELATIONSHIP,
      origin: 'INFERRED',
      basis: '  Overdue payment  ',
    });
    expect(parsed.basis).toBe('Overdue payment');
  });
});

describe('EventImportRowSchema', () => {
  const BASE_EVENT = {
    sourceSystem: 'OMS',
    sourceId: 'evt-1',
    occurredAt: '2026-09-14T08:30:00+00:00',
    observedAt: '2026-09-14T08:31:00+00:00',
    subject: { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
  } as const;

  it('rejects an event type without a namespace', () => {
    expect(EventImportRowSchema.safeParse({ ...BASE_EVENT, type: 'blocked' }).success).toBe(false);
  });

  it('accepts a namespaced event type and defaults related to []', () => {
    const parsed = EventImportRowSchema.parse({ ...BASE_EVENT, type: 'order.blocked' });
    expect(parsed.related).toEqual([]);
  });
});

describe('ImportRequestFieldsSchema', () => {
  it('requires kind for a csv upload', () => {
    expect(ImportRequestFieldsSchema.safeParse({ format: 'csv' }).success).toBe(false);
  });

  it('forbids kind for a json upload', () => {
    expect(
      ImportRequestFieldsSchema.safeParse({ format: 'json', kind: 'entities' }).success,
    ).toBe(false);
  });

  it("transforms dryRun 'true' to true", () => {
    const parsed = ImportRequestFieldsSchema.parse({ format: 'json', dryRun: 'true' });
    expect(parsed.dryRun).toBe(true);
  });

  it('defaults dryRun to false', () => {
    expect(ImportRequestFieldsSchema.parse({ format: 'json' }).dryRun).toBe(false);
  });
});

describe('ImportDocumentSchema', () => {
  it('rejects an unknown top-level section', () => {
    expect(ImportDocumentSchema.safeParse({ entities: [], unknown: [] }).success).toBe(false);
  });
});
