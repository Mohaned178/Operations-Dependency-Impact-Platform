import { CsvError, parse } from 'csv-parse/sync';
import type { ImportKind } from '@opsgraph/shared';
import { decodeUtf8 } from './decode';
import type { ParsedImport, ParsedRow, RowError } from './parsed-import';

interface ReferenceGroup {
  idColumn: string;
  keyColumns: readonly [string, string, string];
}

const FIELD_BY_COLUMN: Record<ImportKind, Readonly<Record<string, string>>> = {
  entities: {
    type: 'type',
    source_system: 'sourceSystem',
    source_id: 'sourceId',
    display_name: 'displayName',
    observed_at: 'observedAt',
    state: 'state',
    source_status: 'sourceStatus',
    ref_id: 'entityRef.id',
    ref_type: 'entityRef.entityType',
    ref_source_system: 'entityRef.sourceSystem',
    ref_source_id: 'entityRef.sourceId',
  },
  relationships: {
    type: 'type',
    source_system: 'sourceSystem',
    source_id: 'sourceId',
    origin: 'origin',
    confidence: 'confidence',
    basis: 'basis',
    observed_at: 'observedAt',
    from_id: 'from.id',
    from_type: 'from.entityType',
    from_source_system: 'from.sourceSystem',
    from_source_id: 'from.sourceId',
    to_id: 'to.id',
    to_type: 'to.entityType',
    to_source_system: 'to.sourceSystem',
    to_source_id: 'to.sourceId',
  },
  events: {
    type: 'type',
    source_system: 'sourceSystem',
    source_id: 'sourceId',
    occurred_at: 'occurredAt',
    observed_at: 'observedAt',
    description: 'description',
    subject_id: 'subject.id',
    subject_type: 'subject.entityType',
    subject_source_system: 'subject.sourceSystem',
    subject_source_id: 'subject.sourceId',
    related: 'related',
  },
};

const REFERENCE_GROUPS: Record<ImportKind, readonly ReferenceGroup[]> = {
  entities: [
    {
      idColumn: 'ref_id',
      keyColumns: ['ref_type', 'ref_source_system', 'ref_source_id'],
    },
  ],
  relationships: [
    {
      idColumn: 'from_id',
      keyColumns: ['from_type', 'from_source_system', 'from_source_id'],
    },
    {
      idColumn: 'to_id',
      keyColumns: ['to_type', 'to_source_system', 'to_source_id'],
    },
  ],
  events: [
    {
      idColumn: 'subject_id',
      keyColumns: ['subject_type', 'subject_source_system', 'subject_source_id'],
    },
  ],
};

const ATTRIBUTE_COLUMN = /^attr\.(.+)$/;

function isFilled(cells: ReadonlyMap<string, string>, column: string): boolean {
  const value = cells.get(column);
  return value !== undefined && value !== '';
}

function findMixedReferences(
  kind: ImportKind,
  cells: ReadonlyMap<string, string>,
): { idColumn: string; message: string }[] {
  const mixed: { idColumn: string; message: string }[] = [];
  for (const group of REFERENCE_GROUPS[kind]) {
    if (!isFilled(cells, group.idColumn)) {
      continue;
    }
    if (group.keyColumns.some((column) => isFilled(cells, column))) {
      const prefix = group.idColumn.slice(0, -'_id'.length);
      mixed.push({
        idColumn: group.idColumn,
        message: `Use either ${group.idColumn} or the ${prefix}_type/${prefix}_source_system/${prefix}_source_id columns, not both`,
      });
    }
  }
  return mixed;
}

function setField(target: Record<string, unknown>, field: string, value: string): void {
  const separator = field.indexOf('.');
  if (separator === -1) {
    target[field] = value;
    return;
  }
  const head = field.slice(0, separator);
  const nested = (target[head] ?? {}) as Record<string, unknown>;
  target[head] = nested;
  setField(nested, field.slice(separator + 1), value);
}

function parseRelated(cell: string): unknown[] {
  return cell
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => {
      const parts = item.split('|');
      if (parts.length === 3) {
        return { entityType: parts[0], sourceSystem: parts[1], sourceId: parts[2] };
      }
      return { id: item };
    });
}

function buildCandidate(
  kind: ImportKind,
  headers: readonly string[],
  record: readonly string[],
): Record<string, unknown> {
  const candidate: Record<string, unknown> = {};
  const attributes: Record<string, string> = {};
  let hasAttributes = false;

  headers.forEach((column, position) => {
    const cell = record[position] ?? '';
    if (cell === '') {
      return;
    }
    const attribute = ATTRIBUTE_COLUMN.exec(column);
    if (attribute !== null) {
      attributes[attribute[1] ?? ''] = cell;
      hasAttributes = true;
      return;
    }
    const field = FIELD_BY_COLUMN[kind][column];
    if (field === undefined) {
      return;
    }
    if (field === 'related') {
      candidate.related = parseRelated(cell);
      return;
    }
    setField(candidate, field, cell);
  });

  if (hasAttributes) {
    candidate.attributes = attributes;
  }
  return candidate;
}

function buildColumnMap(
  kind: ImportKind,
  headers: readonly string[],
): Record<string, string> {
  const columnMap: Record<string, string> = {};
  for (const column of headers) {
    const attribute = ATTRIBUTE_COLUMN.exec(column);
    if (attribute !== null) {
      columnMap[column] = `attributes.${attribute[1] ?? ''}`;
      continue;
    }
    const field = FIELD_BY_COLUMN[kind][column];
    if (field !== undefined) {
      columnMap[column] = field;
    }
  }
  return columnMap;
}

export function parseCsvImport(buffer: Uint8Array, kind: ImportKind): ParsedImport {
  let text: string;
  try {
    text = decodeUtf8(buffer);
  } catch {
    return { rows: [], rowErrors: [], fileErrors: ['File is not valid UTF-8'] };
  }

  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      relax_column_count: true,
    }) as string[][];
  } catch (error) {
    const message =
      error instanceof CsvError || error instanceof Error ? error.message : 'Invalid CSV';
    return { rows: [], rowErrors: [], fileErrors: [message] };
  }

  const headerRecord = records[0];
  if (headerRecord === undefined) {
    return { rows: [], rowErrors: [], fileErrors: ['The file must contain a header row'] };
  }

  const headers = headerRecord.map((name) => name.trim());
  const fileErrors: string[] = [];
  if (headers.some((name) => name === '')) {
    fileErrors.push('The header contains an empty column name');
  }
  const seen = new Set<string>();
  for (const name of headers) {
    if (seen.has(name)) {
      fileErrors.push(`The header contains duplicate column name "${name}"`);
    }
    seen.add(name);
  }
  if (fileErrors.length > 0) {
    return { rows: [], rowErrors: [], fileErrors };
  }

  const columnMap = buildColumnMap(kind, headers);
  const rows: ParsedRow[] = [];
  const rowErrors: RowError[] = [];

  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    // Blank lines are skipped here, not by the parser, so they still count as spreadsheet rows.
    if (record === undefined || (record.length === 1 && record[0] === '')) {
      continue;
    }
    const row = index + 1;
    if (record.length !== headers.length) {
      rowErrors.push({
        kind,
        row,
        field: null,
        message: `Expected ${headers.length} columns, found ${record.length}`,
      });
      continue;
    }

    const raw: Record<string, string> = {};
    const cells = new Map<string, string>();
    headers.forEach((column, position) => {
      const cell = record[position] ?? '';
      raw[column] = cell;
      cells.set(column, cell);
    });

    const mixed = findMixedReferences(kind, cells);
    if (mixed.length > 0) {
      for (const reference of mixed) {
        rowErrors.push({ kind, row, field: reference.idColumn, message: reference.message });
      }
      continue;
    }

    rows.push({
      kind,
      row,
      raw,
      candidate: buildCandidate(kind, headers, record),
      columnMap,
    });
  }

  return { rows, rowErrors, fileErrors: [] };
}
