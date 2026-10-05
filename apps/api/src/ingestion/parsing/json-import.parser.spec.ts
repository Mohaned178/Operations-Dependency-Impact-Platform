import { parseJsonImport } from './json-import.parser';

function json(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

describe('parseJsonImport', () => {
  it('parses the three sections with 1-based row numbers and exact raw payloads', () => {
    const entity = { type: 'Order', sourceId: '18492', unknownField: 'kept' };
    const relationship = { type: 'PLACED', sourceId: 'placed-1' };
    const event = { type: 'order.blocked', sourceId: 'evt-1' };

    const result = parseJsonImport(
      json({ entities: [entity], relationships: [relationship], events: [event] }),
    );

    expect(result.fileErrors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => [row.kind, row.row])).toEqual([
      ['entities', 1],
      ['relationships', 1],
      ['events', 1],
    ]);
    expect(result.rows[0]?.raw).toEqual(entity);
    expect(result.rows[0]?.candidate).toEqual(entity);
  });

  it('keeps the per-section row index', () => {
    const result = parseJsonImport(json({ entities: [{ a: 1 }, { a: 2 }] }));
    expect(result.rows.map((row) => row.row)).toEqual([1, 2]);
  });

  it('reports a non-object element as a row error', () => {
    const result = parseJsonImport(json({ entities: ['not-an-object', { a: 1 }] }));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.row).toBe(2);
    expect(result.rowErrors).toEqual([
      { kind: 'entities', row: 1, field: null, message: 'Row must be an object' },
    ]);
  });

  it('rejects invalid UTF-8 as a file error', () => {
    const result = parseJsonImport(Buffer.from([0xff, 0xfe, 0x00]));
    expect(result.rows).toEqual([]);
    expect(result.fileErrors).toEqual(['File is not valid UTF-8']);
  });

  it('rejects invalid JSON as a file error', () => {
    const result = parseJsonImport(Buffer.from('{oops', 'utf8'));
    expect(result.fileErrors).toHaveLength(1);
    expect(result.fileErrors[0]).toMatch(/JSON/i);
  });

  it('rejects a non-object top level', () => {
    expect(parseJsonImport(json([1, 2, 3])).fileErrors).toEqual([
      'The import file must contain a JSON object',
    ]);
  });

  it('rejects an unknown top-level section and still reads the known ones', () => {
    const result = parseJsonImport(json({ entities: [{ a: 1 }], unknown: [] }));
    expect(result.fileErrors).toEqual(['Unknown top-level section "unknown"']);
    expect(result.rows).toHaveLength(1);
  });

  it('rejects a non-array section', () => {
    const result = parseJsonImport(json({ entities: { not: 'an array' } }));
    expect(result.fileErrors).toEqual(['"entities" must be an array']);
    expect(result.rows).toEqual([]);
  });

  it('rejects a document without any known section', () => {
    const result = parseJsonImport(json({}));
    expect(result.fileErrors).toEqual([
      'The file must contain at least one of "entities", "relationships" or "events"',
    ]);
  });
});
