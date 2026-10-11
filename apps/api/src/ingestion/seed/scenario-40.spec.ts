import { randomUUID } from 'node:crypto';
import {
  DEPENDENCY_DIRECTION,
  EntityImportRowSchema,
  EventImportRowSchema,
  IMPAIRED_STATES,
  RELATIONSHIP_RULES,
  RelationshipImportRowSchema,
  TERMINAL_STATES,
  type EntityKeyRef,
  type EntityRef,
  type ImportDocument,
  type JsonValue,
  type OperationalState,
  type RelationshipImportRowInput,
  type TraceableRelationshipType,
} from '@opsgraph/shared';
import type { ImportSnapshot } from '../planning/import-plan';
import { planImport } from '../planning/import-planner';
import type { ParsedRow } from '../parsing/parsed-import';
import { validateRows } from '../validation/row-validator';
import { buildScenario39Document } from './scenario-39';
import { buildScenario40Document } from './scenario-40';

const NOW = new Date('2026-10-06T00:00:00Z');
const START = 'Supplier|PIM|SUP-400';
const MAX_DEPTH = 6;

function nodeKey(ref: EntityKeyRef): string {
  return `${ref.entityType}|${ref.sourceSystem}|${ref.sourceId}`;
}

function keyRefOf(value: EntityRef): EntityKeyRef {
  if ('entityType' in value) {
    return value;
  }
  throw new Error('The §40 scenario must only use key references');
}

/** Amounts in units of 10^-4, as in the production code, but written independently here. */
function units(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole + fraction.padEnd(4, '0'));
}

function name(key: string): string {
  return key.split('|')[2] ?? key;
}

interface Edge {
  dependent: string;
  dependedOn: string;
  source: boolean;
}

/**
 * Test-only walk over the fixture document (spec FR-031). It is not production traversal and it
 * imports nothing from the graph module.
 */
function analyze(document: ImportDocument) {
  const states = new Map<string, OperationalState>();
  const amounts = new Map<string, string>();
  for (const row of document.entities ?? []) {
    const key = `${row.type}|${row.sourceSystem}|${row.sourceId}`;
    states.set(key, row.state ?? 'UNKNOWN');
    const amount = row.attributes?.['amount'];
    if (typeof amount === 'string') {
      amounts.set(key, amount);
    }
  }

  const dependentsOf = new Map<string, Edge[]>();
  const relationships: RelationshipImportRowInput[] = document.relationships ?? [];
  for (const row of relationships) {
    if (row.type === 'RELATES_TO') continue;
    const direction = DEPENDENCY_DIRECTION[row.type as TraceableRelationshipType];
    const from = nodeKey(keyRefOf(row.from));
    const to = nodeKey(keyRefOf(row.to));
    const edge: Edge =
      direction === 'FROM_DEPENDS_ON_TO'
        ? { dependent: from, dependedOn: to, source: row.origin === 'SOURCE' }
        : { dependent: to, dependedOn: from, source: row.origin === 'SOURCE' };
    const list = dependentsOf.get(edge.dependedOn);
    if (list === undefined) {
      dependentsOf.set(edge.dependedOn, [edge]);
    } else {
      list.push(edge);
    }
  }

  const stateOf = (key: string): OperationalState => states.get(key) ?? 'UNKNOWN';
  const terminal = (key: string): boolean => TERMINAL_STATES.includes(stateOf(key));
  const impaired = (key: string): boolean => IMPAIRED_STATES.includes(stateOf(key));

  /** Breadth-first reach from the start, never expanding a terminal non-start entity. */
  function reach(allow: (edge: Edge) => boolean): Map<string, number> {
    const distance = new Map<string, number>([[START, 0]]);
    let frontier = [START];
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const key of frontier) {
        if (key !== START && terminal(key)) continue;
        for (const edge of dependentsOf.get(key) ?? []) {
          if (allow(edge) && !distance.has(edge.dependent)) {
            distance.set(edge.dependent, depth);
            next.push(edge.dependent);
          }
        }
      }
      frontier = next;
    }
    distance.delete(START);
    return distance;
  }

  const distance = reach(() => true);
  const sourced = new Set(reach((edge) => edge.source).keys());

  // Live: every entity on the chain is impaired, starting from an impaired start.
  const live = new Set<string>();
  if (impaired(START)) {
    let frontier = [START];
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const key of frontier) {
        for (const edge of dependentsOf.get(key) ?? []) {
          if (impaired(edge.dependent) && !live.has(edge.dependent)) {
            live.add(edge.dependent);
            next.push(edge.dependent);
          }
        }
      }
      frontier = next;
    }
  }

  /** Distinct simple paths from the start to the target within MAX_DEPTH. */
  function pathCount(target: string): number {
    let count = 0;
    const walk = (key: string, seen: Set<string>, hops: number): void => {
      if (key === target) {
        count += 1;
        return;
      }
      if (hops === MAX_DEPTH || (key !== START && terminal(key))) return;
      for (const edge of dependentsOf.get(key) ?? []) {
        if (!seen.has(edge.dependent)) {
          seen.add(edge.dependent);
          walk(edge.dependent, seen, hops + 1);
          seen.delete(edge.dependent);
        }
      }
    };
    walk(START, new Set([START]), 0);
    return count;
  }

  // Attribution: Customer PLACED Order, and Customer HAS Contract DEFINES SLA.
  const customersOf = new Map<string, Set<string>>();
  const contractOwners = new Map<string, string[]>();
  const add = (map: Map<string, Set<string>>, key: string, value: string): void => {
    const set = map.get(key);
    if (set === undefined) map.set(key, new Set([value]));
    else set.add(value);
  };
  for (const row of relationships) {
    const from = nodeKey(keyRefOf(row.from));
    const to = nodeKey(keyRefOf(row.to));
    if (row.type === 'PLACED') add(customersOf, to, from);
    if (row.type === 'HAS') contractOwners.set(to, [...(contractOwners.get(to) ?? []), from]);
  }
  for (const row of relationships) {
    if (row.type === 'DEFINES') {
      for (const owner of contractOwners.get(nodeKey(keyRefOf(row.from))) ?? []) {
        add(customersOf, nodeKey(keyRefOf(row.to)), owner);
      }
    }
  }

  const counted = [...distance.keys()].filter((key) => !terminal(key));
  const notCounted = [...distance.keys()].filter((key) => terminal(key));
  const ofType = (type: string, keys: readonly string[]): string[] =>
    keys.filter((key) => key.startsWith(`${type}|`)).map(name).sort();

  const attribution = new Map<string, string[]>();
  for (const key of counted) {
    if (!key.startsWith('Order|') && !key.startsWith('SLA|')) continue;
    for (const customer of customersOf.get(key) ?? []) {
      attribution.set(customer, [...(attribution.get(customer) ?? []), name(key)].sort());
    }
  }

  const sum = (keys: readonly string[]): bigint =>
    keys.reduce((total, key) => total + units(amounts.get(key) ?? '0'), 0n);
  const orders = counted.filter((key) => key.startsWith('Order|'));

  return {
    distance,
    sourced,
    live,
    counted,
    notCounted,
    ofType,
    attribution,
    pathCount,
    sum,
    orders,
    stateOf,
    amounts,
  };
}

function parsedRow(kind: ParsedRow['kind'], row: object, index: number): ParsedRow {
  const raw = JSON.parse(JSON.stringify(row)) as JsonValue;
  return { kind, row: index + 1, raw, candidate: raw as unknown as Record<string, unknown> };
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

describe('§40 scenario document', () => {
  const document = buildScenario40Document();

  it('passes every row schema', () => {
    const failures = [
      ...(document.entities ?? []).flatMap((row, index) => {
        const result = EntityImportRowSchema.safeParse(row);
        return result.success ? [] : [{ kind: 'entity', row: index + 1, issues: result.error.issues }];
      }),
      ...(document.relationships ?? []).flatMap((row, index) => {
        const result = RelationshipImportRowSchema.safeParse(row);
        return result.success
          ? []
          : [{ kind: 'relationship', row: index + 1, issues: result.error.issues }];
      }),
      ...(document.events ?? []).flatMap((row, index) => {
        const result = EventImportRowSchema.safeParse(row);
        return result.success ? [] : [{ kind: 'event', row: index + 1, issues: result.error.issues }];
      }),
    ];
    expect(failures).toEqual([]);
  });

  it('has 47 entity rows (47 distinct keys), 97 relationships and 9 events', () => {
    const rows = document.entities ?? [];
    expect(rows).toHaveLength(47);
    expect(new Set(rows.map((row) => `${row.type}|${row.sourceSystem}|${row.sourceId}`)).size).toBe(47);
    expect(document.relationships ?? []).toHaveLength(97);
    expect(document.events ?? []).toHaveLength(9);
  });

  it('satisfies every RELATIONSHIP_RULES entry', () => {
    const violations = (document.relationships ?? []).filter((row) => {
      const rule = RELATIONSHIP_RULES[row.type];
      const from = keyRefOf(row.from);
      const to = keyRefOf(row.to);
      return (
        !(rule.from === null || rule.from.includes(from.entityType)) ||
        !(rule.to === null || rule.to.includes(to.entityType))
      );
    });
    expect(violations).toEqual([]);
  });

  it('shares no entity key with the §39 scenario', () => {
    const keys39 = new Set(
      (buildScenario39Document().entities ?? []).map(
        (row) => `${row.type}|${row.sourceSystem}|${row.sourceId}`,
      ),
    );
    const shared = (document.entities ?? []).filter((row) =>
      keys39.has(`${row.type}|${row.sourceSystem}|${row.sourceId}`),
    );
    expect(shared).toEqual([]);
  });

  it('marks exactly the two inferred relationships', () => {
    const inferred = (document.relationships ?? []).filter((row) => row.origin !== 'SOURCE');
    expect(inferred.map((row) => [row.sourceId, row.origin, row.confidence, row.sourceSystem])).toEqual([
      ['SUPPLIED_BY:PRD-6104:SUP-400', 'INFERRED', 'LOW', 'InferenceRules'],
      ['DEPENDS_ON:SLA-5002-DEL:SHP-8002', 'INFERRED', 'MEDIUM', 'InferenceRules'],
    ]);
  });

  it('plans against an empty snapshot with zero rejected rows', () => {
    const validation = validateRows(toParsedRows(document), NOW);
    expect(validation.errors).toEqual([]);
    expect(validation.rows).toHaveLength(47 + 97 + 9);

    const plan = planImport(validation.rows, emptySnapshot(), {
      now: NOW,
      receivedAt: NOW,
      newId: randomUUID,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.counts.entities).toEqual({ created: 47, updated: 0, unchanged: 0, rejected: 0 });
    expect(plan.counts.relationships).toEqual({ created: 97, updated: 0, unchanged: 0, rejected: 0 });
    expect(plan.counts.events).toEqual({ created: 9, updated: 0, unchanged: 0, rejected: 0 });
  });
});

describe('§40 expected impact of Fabrikam Components (test-only walk)', () => {
  const result = analyze(buildScenario40Document());
  const entityKey = (type: string, system: string, id: string): string => `${type}|${system}|${id}`;
  const keysOf = (type: string, system: string, ids: readonly string[]): string[] =>
    ids.map((id) => entityKey(type, system, id));

  it('reaches the expected counted entities per category', () => {
    expect(result.ofType('Product', result.counted)).toEqual(['PRD-6101', 'PRD-6102', 'PRD-6103', 'PRD-6104']);
    expect(result.ofType('PurchaseOrder', result.counted)).toEqual(['PO-7001', 'PO-7002', 'PO-7003', 'PO-7004', 'PO-7005']);
    expect(result.ofType('Order', result.counted)).toHaveLength(12);
    expect(result.ofType('Shipment', result.counted)).toEqual(['SHP-8001', 'SHP-8002', 'SHP-8003']);
    expect(result.ofType('SLA', result.counted)).toEqual(['SLA-5001-DEL', 'SLA-5002-DEL', 'SLA-5004-DEL']);
    expect(result.counted).toHaveLength(27);
    expect([...result.attribution.keys()].map(name).sort()).toEqual(['CUST-2001', 'CUST-2002', 'CUST-2003', 'CUST-2004']);
  });

  it('measures distances 1, 2, 3 and 4 along the chain', () => {
    const at = (key: string): number | undefined => result.distance.get(key);
    expect(at(entityKey('Product', 'PIM', 'PRD-6101'))).toBe(1);
    expect(at(entityKey('PurchaseOrder', 'ERP', 'PO-7001'))).toBe(1);
    expect(at(entityKey('Order', 'OMS', 'SO-20401'))).toBe(2);
    expect(at(entityKey('Shipment', 'TMS', 'SHP-8001'))).toBe(3);
    expect(at(entityKey('SLA', 'ContractMgmt', 'SLA-5001-DEL'))).toBe(4);
  });

  it('splits current from potential through the live chain', () => {
    const liveCounted = result.counted.filter((key) => result.live.has(key));
    expect(result.ofType('PurchaseOrder', liveCounted)).toEqual(['PO-7001', 'PO-7002', 'PO-7003']);
    expect(result.ofType('Order', liveCounted)).toEqual(['SO-20401', 'SO-20402', 'SO-20403', 'SO-20404', 'SO-20405', 'SO-20406']);
    expect(result.ofType('Shipment', liveCounted)).toEqual(['SHP-8001', 'SHP-8002']);
    expect(result.ofType('SLA', liveCounted)).toEqual(['SLA-5001-DEL', 'SLA-5002-DEL']);
    expect(result.ofType('Product', liveCounted)).toEqual([]);

    const potential = result.counted.filter((key) => !result.live.has(key));
    expect(result.ofType('Order', potential)).toEqual(['SO-20407', 'SO-20408', 'SO-20409', 'SO-20410', 'SO-20411', 'SO-20412']);
    expect(result.ofType('SLA', potential)).toEqual(['SLA-5004-DEL']);
  });

  it('flags SO-20408 as impaired for another reason', () => {
    const key = entityKey('Order', 'OMS', 'SO-20408');
    expect(result.stateOf(key)).toBe('PENDING');
    expect(result.live.has(key)).toBe(false);
  });

  it('finds the inferred-only entities by all-SOURCE reachability', () => {
    const inferred = result.counted.filter((key) => !result.sourced.has(key));
    expect(inferred.map(name).sort()).toEqual(['PRD-6104', 'SLA-5002-DEL', 'SO-20411']);
  });

  it('leaves out the two completed entities', () => {
    expect(result.notCounted.map(name).sort()).toEqual(['PO-7006', 'SO-20413']);
  });

  it('never reaches the control entities, customers or contracts', () => {
    const controls = [
      entityKey('Supplier', 'PIM', 'SUP-410'),
      ...keysOf('Product', 'PIM', ['PRD-6105']),
      ...keysOf('PurchaseOrder', 'ERP', ['PO-7010']),
      ...keysOf('Order', 'OMS', ['SO-20414', 'SO-20415']),
      ...keysOf('Shipment', 'TMS', ['SHP-8009']),
      ...keysOf('SLA', 'ContractMgmt', ['SLA-5005-DEL']),
      ...keysOf('Customer', 'CRM', ['CUST-2001', 'CUST-2002', 'CUST-2003', 'CUST-2004', 'CUST-2005']),
      ...keysOf('Contract', 'ContractMgmt', ['CON-5001', 'CON-5002', 'CON-5003', 'CON-5004', 'CON-5005']),
    ];
    expect(controls.filter((key) => result.distance.has(key))).toEqual([]);
  });

  it('attributes customers through PLACED and HAS/DEFINES', () => {
    const byCustomer = Object.fromEntries(
      [...result.attribution].map(([customer, entities]) => [name(customer), entities]),
    );
    expect(byCustomer).toEqual({
      'CUST-2001': ['SLA-5001-DEL', 'SO-20401', 'SO-20402', 'SO-20407'],
      'CUST-2002': ['SLA-5002-DEL', 'SO-20403', 'SO-20404', 'SO-20408'],
      'CUST-2003': ['SO-20405', 'SO-20406', 'SO-20412'],
      'CUST-2004': ['SLA-5004-DEL', 'SO-20409', 'SO-20410', 'SO-20411'],
    });
  });

  it('adds the exposure up exactly', () => {
    const live = result.orders.filter((key) => result.live.has(key));
    const potential = result.orders.filter((key) => !result.live.has(key));
    const inferred = result.orders.filter((key) => !result.sourced.has(key));
    expect(result.sum(live)).toBe(units('51250.00'));
    expect(result.sum(potential)).toBe(units('32750.00'));
    expect(result.sum(result.orders)).toBe(units('84000.00'));
    expect(result.sum(inferred)).toBe(units('2400.00'));
    expect(result.orders).toHaveLength(12);
    expect(result.sum(result.notCounted)).toBe(units('3100.00'));
  });

  it('adds up the attributed exposure per customer', () => {
    const orderSet = new Set(result.orders);
    const perCustomer = Object.fromEntries(
      [...result.attribution].map(([customer, entities]) => [
        name(customer),
        result.sum(entities.map((id) => entityKey('Order', 'OMS', id)).filter((key) => orderSet.has(key))),
      ]),
    );
    expect(perCustomer).toEqual({
      'CUST-2001': units('28350.00'),
      'CUST-2002': units('22650.00'),
      'CUST-2003': units('17100.00'),
      'CUST-2004': units('15900.00'),
    });
  });

  it('counts the distinct paths of the multi-path orders', () => {
    const count = (id: string): number => result.pathCount(entityKey('Order', 'OMS', id));
    expect(count('SO-20401')).toBe(3);
    expect(count('SO-20402')).toBe(5);
    expect(count('SO-20404')).toBe(6);
    expect(count('SO-20408')).toBe(3);
    expect(count('SO-20411')).toBe(1);
  });
});
