import { Injectable } from '@nestjs/common';
import { AMOUNT_PATTERN, CURRENCY_PATTERN } from '@opsgraph/shared';
import { compareCodeUnits } from '../graph/traversal/path-order';
import { PrismaService } from '../prisma/prisma.service';
import type { OrderValue, SourceValue } from './analysis/types';

interface RawCurrentRow {
  id: string;
  amount: string | null;
  currency: string | null;
}

interface RawSourceRow {
  entity_id: string;
  source_system: string;
  source_id: string;
  observed_at: Date;
  amount: string | null;
  currency: string | null;
}

function usable(
  amount: string | null,
  currency: string | null,
): { amount: string; currency: string } | null {
  return amount !== null &&
    currency !== null &&
    AMOUNT_PATTERN.test(amount) &&
    CURRENCY_PATTERN.test(currency)
    ? { amount, currency }
    : null;
}

/**
 * Data-model 4a, research R6: reads the current and per-source order values. Plain reading of
 * entity attributes and source records, not graph traversal. A value that fails the shared
 * amount or currency pattern counts as "no value".
 */
@Injectable()
export class OrderValueReader {
  constructor(private readonly prisma: PrismaService) {}

  async load(orderIds: readonly string[]): Promise<Map<string, OrderValue>> {
    const values = new Map<string, OrderValue>();
    if (orderIds.length === 0) {
      return values;
    }
    const ids = [...orderIds];

    const [current, perSource] = await Promise.all([
      this.prisma.$queryRaw<RawCurrentRow[]>`
        SELECT id::text AS id, attributes->>'amount' AS amount, attributes->>'currency' AS currency
        FROM entities WHERE id = ANY(${ids}::uuid[])`,
      this.prisma.$queryRaw<RawSourceRow[]>`
        SELECT DISTINCT ON (entity_id, source_system)
               entity_id::text AS entity_id, source_system, source_id, observed_at,
               normalized->'attributes'->>'amount' AS amount,
               normalized->'attributes'->>'currency' AS currency
        FROM source_records
        WHERE kind = 'ENTITY' AND entity_id = ANY(${ids}::uuid[])
          AND (normalized->'attributes') ? 'amount'
        ORDER BY entity_id, source_system, observed_at DESC, seq DESC`,
    ]);

    for (const row of current) {
      values.set(row.id, { current: usable(row.amount, row.currency), bySource: [] });
    }

    for (const row of perSource) {
      const value = values.get(row.entity_id);
      const stated = usable(row.amount, row.currency);
      if (value === undefined || stated === null) {
        continue;
      }
      const source: SourceValue = {
        sourceSystem: row.source_system,
        sourceId: row.source_id,
        observedAt: row.observed_at.toISOString(),
        ...stated,
      };
      value.bySource.push(source);
    }
    for (const value of values.values()) {
      value.bySource.sort((a, b) => compareCodeUnits(a.sourceSystem, b.sourceSystem));
    }

    return values;
  }
}
