import type { JsonValue } from '@opsgraph/shared';
import type { ParsedRow } from '../parsing/parsed-import';
import { validateRows } from './row-validator';

const NOW = new Date('2026-09-14T10:00:00.000Z');
const PAST = '2026-09-14T09:00:00+00:00';
const FUTURE = '2026-09-14T11:00:00+00:00';

function entityRow(candidate: Record<string, unknown>): ParsedRow {
  return { kind: 'entities', row: 1, raw: candidate as unknown as JsonValue, candidate };
}

function relationshipRow(candidate: Record<string, unknown>): ParsedRow {
  return { kind: 'relationships', row: 1, raw: candidate as unknown as JsonValue, candidate };
}

function eventRow(candidate: Record<string, unknown>): ParsedRow {
  return { kind: 'events', row: 1, raw: candidate as unknown as JsonValue, candidate };
}

const VALID_ENTITY = {
  type: 'Order',
  sourceSystem: 'OMS',
  sourceId: '18492',
  displayName: 'Order #18492',
  observedAt: PAST,
  attributes: { amount: '12480.00', currency: 'USD' },
};

describe('validateRows', () => {
  it('accepts a valid row', () => {
    const result = validateRows([entityRow(VALID_ENTITY)], NOW);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it('reports an unknown enum value with the allowed values', () => {
    const result = validateRows([entityRow({ ...VALID_ENTITY, type: 'Widget' })], NOW);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.field).toBe('type');
    expect(result.errors[0]?.message).toContain('Customer');
  });

  it('rejects a naive timestamp', () => {
    const result = validateRows(
      [entityRow({ ...VALID_ENTITY, observedAt: '2026-09-14T09:00:00' })],
      NOW,
    );
    expect(result.errors[0]?.field).toBe('observedAt');
  });

  it('rejects an observation more than 5 minutes in the future', () => {
    const result = validateRows([entityRow({ ...VALID_ENTITY, observedAt: FUTURE })], NOW);
    expect(result.errors[0]?.field).toBe('observedAt');
    expect(result.errors[0]?.message).toMatch(/5 minutes/);
  });

  it('accepts an observation within the 5 minute window', () => {
    const observedAt = new Date(NOW.getTime() + 4 * 60 * 1000).toISOString();
    const result = validateRows([entityRow({ ...VALID_ENTITY, observedAt })], NOW);
    expect(result.errors).toEqual([]);
  });

  it('rejects invalid money with the nested field path', () => {
    const result = validateRows(
      [entityRow({ ...VALID_ENTITY, attributes: { amount: '-1', currency: 'USD' } })],
      NOW,
    );
    expect(result.errors[0]?.field).toBe('attributes.amount');
  });

  it('rejects an inferred relationship without a basis', () => {
    const result = validateRows(
      [
        relationshipRow({
          type: 'BLOCKS',
          sourceSystem: 'OPSGRAPH',
          sourceId: 'rel-1',
          from: { entityType: 'Payment', sourceSystem: 'ERP', sourceId: 'p-1' },
          to: { entityType: 'Shipment', sourceSystem: 'WMS', sourceId: 's-1' },
          origin: 'INFERRED',
          confidence: 'MEDIUM',
          observedAt: PAST,
        }),
      ],
      NOW,
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ kind: 'relationships', field: 'basis' }),
    ]);
  });

  it('rejects a bad event type', () => {
    const result = validateRows(
      [
        eventRow({
          type: 'blocked',
          sourceSystem: 'OMS',
          sourceId: 'evt-1',
          occurredAt: PAST,
          observedAt: PAST,
          subject: { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
        }),
      ],
      NOW,
    );
    expect(result.errors[0]?.field).toBe('type');
  });

  it('rejects a future event occurrence', () => {
    const result = validateRows(
      [
        eventRow({
          type: 'order.blocked',
          sourceSystem: 'OMS',
          sourceId: 'evt-1',
          occurredAt: FUTURE,
          observedAt: PAST,
          subject: { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
        }),
      ],
      NOW,
    );
    expect(result.errors[0]?.field).toBe('occurredAt');
  });

  it('translates a CSV field path back to the column name', () => {
    const result = validateRows(
      [
        {
          kind: 'entities',
          row: 2,
          raw: { amount: '-1' },
          candidate: { ...VALID_ENTITY, attributes: { amount: '-1', currency: 'USD' } },
          columnMap: { 'Amount': 'attributes.amount', 'Currency': 'attributes.currency' },
        },
      ],
      NOW,
    );
    expect(result.errors[0]?.field).toBe('Amount');
  });

  it('does not include a row that failed validation in the valid rows', () => {
    const result = validateRows(
      [
        entityRow({ ...VALID_ENTITY, type: 'Widget' }),
        entityRow({ ...VALID_ENTITY, sourceId: '18493' }),
      ],
      NOW,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});
