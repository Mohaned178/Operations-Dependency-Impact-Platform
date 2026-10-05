import { randomUUID } from 'node:crypto';
import {
  EntityImportRowSchema,
  EventImportRowSchema,
  RELATIONSHIP_RULES,
  RelationshipImportRowSchema,
  type EntityImportRowInput,
  type EntityKeyRef,
  type EntityRef,
  type ImportDocument,
  type JsonValue,
  type OperationalState,
} from '@opsgraph/shared';
import type { ImportSnapshot } from '../planning/import-plan';
import { planImport } from '../planning/import-planner';
import type { ParsedRow } from '../parsing/parsed-import';
import { validateRows } from '../validation/row-validator';
import { buildScenario39Document } from './scenario-39';

const NOW = new Date('2026-10-06T00:00:00Z');
const BUDGET_REQUIREMENT_KEY = 'BudgetRequirement|FinanceApprovals|BR-18492';

function nodeKey(ref: EntityKeyRef): string {
  return `${ref.entityType}|${ref.sourceSystem}|${ref.sourceId}`;
}

function keyRefOf(value: EntityRef): EntityKeyRef {
  if ('entityType' in value) {
    return value;
  }
  throw new Error('The §39 scenario must only use key references');
}

function toCents(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

interface DependencyWalk {
  reached: ReadonlySet<string>;
  orders: string[];
  customerKeys: string[];
  slaStates: OperationalState[];
  totalCents: bigint;
}

/** Test-only walk over the fixture document; it is not production traversal. */
function walkDependencies(document: ImportDocument): DependencyWalk {
  const relationships = document.relationships ?? [];
  const dependents = new Map<string, string[]>();
  const addDependent = (dependedOn: string, dependent: string): void => {
    const list = dependents.get(dependedOn);
    if (list === undefined) {
      dependents.set(dependedOn, [dependent]);
    } else {
      list.push(dependent);
    }
  };

  for (const row of relationships) {
    const from = nodeKey(keyRefOf(row.from));
    const to = nodeKey(keyRefOf(row.to));
    if (row.type === 'REQUIRES' || row.type === 'DEPENDS_ON') {
      addDependent(to, from);
    } else if (row.type === 'BLOCKS') {
      addDependent(from, to);
    }
  }

  const reached = new Set<string>([BUDGET_REQUIREMENT_KEY]);
  const queue: string[] = [BUDGET_REQUIREMENT_KEY];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    for (const dependent of dependents.get(current) ?? []) {
      if (!reached.has(dependent)) {
        reached.add(dependent);
        queue.push(dependent);
      }
    }
  }

  const entityRows = new Map<string, EntityImportRowInput>();
  for (const row of document.entities ?? []) {
    if (row.entityRef === undefined) {
      entityRows.set(`${row.type}|${row.sourceSystem}|${row.sourceId}`, row);
    }
  }

  const orders = [...reached].filter((key) => key.startsWith('Order|'));
  const customerKeys = new Set<string>();
  for (const row of relationships) {
    if (row.type === 'PLACED' && reached.has(nodeKey(keyRefOf(row.to)))) {
      customerKeys.add(nodeKey(keyRefOf(row.from)));
    }
  }

  const slaStates: OperationalState[] = [];
  for (const key of reached) {
    if (key.startsWith('SLA|')) {
      const state = entityRows.get(key)?.state;
      if (state !== undefined) {
        slaStates.push(state);
      }
    }
  }

  let totalCents = 0n;
  for (const key of orders) {
    const amount = entityRows.get(key)?.attributes?.['amount'];
    if (typeof amount !== 'string') {
      throw new Error(`Order ${key} has no decimal amount`);
    }
    totalCents += toCents(amount);
  }

  return { reached, orders, customerKeys: [...customerKeys], slaStates, totalCents };
}

function parsedRow(kind: ParsedRow['kind'], row: object, index: number): ParsedRow {
  const raw = JSON.parse(JSON.stringify(row)) as JsonValue;
  return {
    kind,
    row: index + 1,
    raw,
    candidate: raw as unknown as Record<string, unknown>,
  };
}

function toParsedRows(document: ImportDocument): ParsedRow[] {
  const rows: ParsedRow[] = [];
  (document.entities ?? []).forEach((row, index) => rows.push(parsedRow('entities', row, index)));
  (document.relationships ?? []).forEach((row, index) =>
    rows.push(parsedRow('relationships', row, index)),
  );
  (document.events ?? []).forEach((row, index) => rows.push(parsedRow('events', row, index)));
  return rows;
}

function emptySnapshot(): ImportSnapshot {
  return {
    maxSourceRecordSeq: 0,
    maxStateObservationSeq: 0,
    entitiesById: new Map(),
    identifiersByKey: new Map(),
    entityObservations: new Map(),
    stateObservations: new Map(),
    relationshipsById: new Map(),
    relationshipsByKey: new Map(),
    relationshipObservations: new Map(),
    eventsById: new Map(),
    eventsByKey: new Map(),
    eventObservations: new Map(),
    rejectedEntityRows: new Map(),
  };
}

describe('§39 scenario document', () => {
  const document = buildScenario39Document();

  it('passes every row schema', () => {
    const entityFailures = (document.entities ?? []).flatMap((row, index) => {
      const result = EntityImportRowSchema.safeParse(row);
      return result.success ? [] : [{ row: index + 1, issues: result.error.issues }];
    });
    expect(entityFailures).toEqual([]);

    const relationshipFailures = (document.relationships ?? []).flatMap((row, index) => {
      const result = RelationshipImportRowSchema.safeParse(row);
      return result.success ? [] : [{ row: index + 1, issues: result.error.issues }];
    });
    expect(relationshipFailures).toEqual([]);

    const eventFailures = (document.events ?? []).flatMap((row, index) => {
      const result = EventImportRowSchema.safeParse(row);
      return result.success ? [] : [{ row: index + 1, issues: result.error.issues }];
    });
    expect(eventFailures).toEqual([]);
  });

  it('has 48 entity rows resolving to 44 entities, 102 relationships and 10 events', () => {
    const entityRows = document.entities ?? [];
    expect(entityRows).toHaveLength(48);
    expect(document.relationships ?? []).toHaveLength(102);
    expect(document.events ?? []).toHaveLength(10);

    const entityKeys = new Set<string>();
    for (const row of entityRows) {
      if (row.entityRef === undefined) {
        entityKeys.add(`${row.type}|${row.sourceSystem}|${row.sourceId}`);
      }
    }
    expect(entityKeys.size).toBe(44);
  });

  it('satisfies every RELATIONSHIP_RULES entry', () => {
    const violations = (document.relationships ?? []).filter((row) => {
      const rule = RELATIONSHIP_RULES[row.type];
      const from = keyRefOf(row.from);
      const to = keyRefOf(row.to);
      const fromOk = rule.from === null || rule.from.includes(from.entityType);
      const toOk = rule.to === null || rule.to.includes(to.entityType);
      return !fromOk || !toOk;
    });
    expect(violations).toEqual([]);
  });

  it('walks backwards from BR-18492 to 17 orders, 4 customers and 31,400.00 USD', () => {
    const result = walkDependencies(document);

    expect(result.orders).toHaveLength(17);
    expect(result.customerKeys).toHaveLength(4);
    expect(result.totalCents).toBe(3_140_000n);
    expect(result.totalCents / 100n).toBe(31_400n);
    expect(result.slaStates).toHaveLength(4);
    expect(result.slaStates.filter((state) => state === 'AT_RISK')).toHaveLength(3);
    for (const controlOrder of ['18530', '18531', '18532']) {
      expect(result.reached.has(`Order|OMS|${controlOrder}`)).toBe(false);
    }
  });

  it('plans against an empty snapshot with zero rejected rows', () => {
    const parsedRows = toParsedRows(document);
    const validation = validateRows(parsedRows, NOW);
    expect(validation.errors).toEqual([]);
    expect(validation.rows).toHaveLength(160);

    const plan = planImport(validation.rows, emptySnapshot(), {
      now: NOW,
      receivedAt: NOW,
      newId: randomUUID,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.counts.entities).toEqual({ created: 44, updated: 4, unchanged: 0, rejected: 0 });
    expect(plan.counts.relationships).toEqual({
      created: 102,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });
    expect(plan.counts.events).toEqual({ created: 10, updated: 0, unchanged: 0, rejected: 0 });
  });
});
