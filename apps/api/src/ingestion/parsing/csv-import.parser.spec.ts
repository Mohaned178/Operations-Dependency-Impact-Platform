import { parseCsvImport } from './csv-import.parser';

function buffer(text: string): Uint8Array {
  return Buffer.from(text, 'utf8');
}

function lines(...rows: string[]): string {
  return rows.join('\r\n');
}

const ENTITY_HEADER =
  'type,source_system,source_id,display_name,observed_at,state,source_status,attr.amount,attr.currency,extra';

describe('parseCsvImport', () => {
  it('maps entity columns, keeps every header in the raw payload and ignores unknown columns', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          ENTITY_HEADER,
          'Order,DemoOMS,ORD-1,Order #1,2026-09-29T08:05:00Z,PENDING,OPEN,12480.00,USD,ignored',
          'Customer,DemoCRM,CUST-1,Acme,2026-09-29T08:00:00Z,,,,,',
        ),
      ),
      'entities',
    );

    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rowErrors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);

    const first = parsed.rows[0];
    expect(first?.row).toBe(2);
    expect(first?.candidate).toEqual({
      type: 'Order',
      sourceSystem: 'DemoOMS',
      sourceId: 'ORD-1',
      displayName: 'Order #1',
      observedAt: '2026-09-29T08:05:00Z',
      state: 'PENDING',
      sourceStatus: 'OPEN',
      attributes: { amount: '12480.00', currency: 'USD' },
    });
    expect(first?.raw).toEqual({
      type: 'Order',
      source_system: 'DemoOMS',
      source_id: 'ORD-1',
      display_name: 'Order #1',
      observed_at: '2026-09-29T08:05:00Z',
      state: 'PENDING',
      source_status: 'OPEN',
      'attr.amount': '12480.00',
      'attr.currency': 'USD',
      extra: 'ignored',
    });
    expect(first?.columnMap).toMatchObject({
      source_system: 'sourceSystem',
      'attr.amount': 'attributes.amount',
    });
    expect(first?.columnMap).not.toHaveProperty('extra');

    const second = parsed.rows[1];
    expect(second?.row).toBe(3);
    expect(second?.candidate).toEqual({
      type: 'Customer',
      sourceSystem: 'DemoCRM',
      sourceId: 'CUST-1',
      displayName: 'Acme',
      observedAt: '2026-09-29T08:00:00Z',
    });
    expect(second?.raw).toMatchObject({
      state: '',
      'attr.amount': '',
      extra: '',
    });
  });

  it('strips a BOM and trims header names', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          ' type , source_system , source_id , display_name , observed_at ',
          'Customer,DemoCRM,CUST-1,Acme,2026-09-29T08:00:00Z',
        ),
      ),
      'entities',
    );

    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows[0]?.candidate).toMatchObject({ type: 'Customer', sourceSystem: 'DemoCRM' });
  });

  it('keeps attribute names that contain dots', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,display_name,observed_at,attr.custom.sub',
          'Customer,C,S,N,T,T',
        ),
      ),
      'entities',
    );
    expect(parsed.rows[0]?.candidate).toMatchObject({
      attributes: { 'custom.sub': 'T' },
    });
  });

  it('maps an entityRef given by key', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,display_name,observed_at,ref_type,ref_source_system,ref_source_id',
          'Order,ERP,SO-1,Order #1,2026-09-29T08:05:00Z,Order,OMS,18492',
        ),
      ),
      'entities',
    );

    expect(parsed.rowErrors).toEqual([]);
    expect(parsed.rows[0]?.candidate).toMatchObject({
      entityRef: { entityType: 'Order', sourceSystem: 'OMS', sourceId: '18492' },
    });
  });

  it('maps an entityRef given by OpsGraph id', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,display_name,observed_at,ref_id',
          'Order,ERP,SO-1,Order #1,2026-09-29T08:05:00Z,00000000-0000-4000-8000-000000000009',
        ),
      ),
      'entities',
    );

    expect(parsed.rows[0]?.candidate).toMatchObject({
      entityRef: { id: '00000000-0000-4000-8000-000000000009' },
    });
  });

  it('rejects an entityRef that fills in both forms', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,display_name,observed_at,ref_id,ref_type,ref_source_system,ref_source_id',
          'Order,ERP,SO-1,Order #1,2026-09-29T08:05:00Z,abc,Order,OMS,18492',
        ),
      ),
      'entities',
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.rowErrors).toEqual([
      {
        kind: 'entities',
        row: 2,
        field: 'ref_id',
        message: 'Use either ref_id or the ref_type/ref_source_system/ref_source_id columns, not both',
      },
    ]);
  });

  it('maps relationship columns and both reference forms', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,from_type,from_source_system,from_source_id,to_id,origin,confidence,basis,observed_at',
          'PLACED,DemoCRM,REL-1,Customer,DemoCRM,CUST-1,00000000-0000-4000-8000-00000000000b,INFERRED,MEDIUM,The customer placed the order,2026-09-29T08:15:00Z',
        ),
      ),
      'relationships',
    );

    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rowErrors).toEqual([]);
    expect(parsed.rows[0]?.candidate).toEqual({
      type: 'PLACED',
      sourceSystem: 'DemoCRM',
      sourceId: 'REL-1',
      from: { entityType: 'Customer', sourceSystem: 'DemoCRM', sourceId: 'CUST-1' },
      to: { id: '00000000-0000-4000-8000-00000000000b' },
      origin: 'INFERRED',
      confidence: 'MEDIUM',
      basis: 'The customer placed the order',
      observedAt: '2026-09-29T08:15:00Z',
    });
  });

  it('leaves an omitted reference out of the candidate', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,from_id,to_id,origin,confidence,basis,observed_at',
          'REQUIRES,Demo,REL-1,,00000000-0000-4000-8000-00000000000b,SOURCE,HIGH,,2026-09-29T08:15:00Z',
        ),
      ),
      'relationships',
    );

    expect(parsed.rowErrors).toEqual([]);
    const candidate = parsed.rows[0]?.candidate;
    expect(candidate).not.toHaveProperty('from');
    expect(candidate).not.toHaveProperty('basis');
  });

  it('rejects mixed from and to reference forms', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,from_id,from_source_system,to_id,to_type,origin,confidence,observed_at',
          'REQUIRES,Demo,REL-1,00000000-0000-4000-8000-000000000001,OMS,00000000-0000-4000-8000-000000000002,Payment,SOURCE,HIGH,2026-09-29T08:15:00Z',
        ),
      ),
      'relationships',
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.rowErrors.map((error) => error.field)).toEqual(['from_id', 'to_id']);
    expect(parsed.rowErrors[0]?.message).toBe(
      'Use either from_id or the from_type/from_source_system/from_source_id columns, not both',
    );
    expect(parsed.rowErrors[1]?.message).toBe(
      'Use either to_id or the to_type/to_source_system/to_source_id columns, not both',
    );
  });

  it('parses the related list as ids and Type|System|Id items', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,occurred_at,observed_at,subject_type,subject_source_system,subject_source_id,related,description',
          `order.created,DemoOMS,EVT-1,2026-09-29T08:05:00Z,2026-09-29T08:06:00Z,Order,DemoOMS,ORD-1,00000000-0000-4000-8000-00000000000a;Customer|DemoCRM|CUST-1; ;,Order #1 created`,
        ),
      ),
      'events',
    );

    expect(parsed.rowErrors).toEqual([]);
    expect(parsed.rows[0]?.candidate).toMatchObject({
      subject: { entityType: 'Order', sourceSystem: 'DemoOMS', sourceId: 'ORD-1' },
      related: [
        { id: '00000000-0000-4000-8000-00000000000a' },
        { entityType: 'Customer', sourceSystem: 'DemoCRM', sourceId: 'CUST-1' },
      ],
      description: 'Order #1 created',
    });
  });

  it('omits empty related cells', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,occurred_at,observed_at,subject_id,related',
          'order.created,DemoOMS,EVT-1,2026-09-29T08:05:00Z,2026-09-29T08:06:00Z,00000000-0000-4000-8000-00000000000a,',
        ),
      ),
      'events',
    );

    expect(parsed.rows[0]?.candidate).not.toHaveProperty('related');
  });

  it('skips empty lines and does not report them', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,display_name,observed_at',
          '',
          'Customer,DemoCRM,CUST-1,Acme,2026-09-29T08:00:00Z',
          '',
        ),
      ),
      'entities',
    );

    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rowErrors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
  });

  it('reports a column-count mismatch as a row error but keeps the other rows', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id,display_name,observed_at',
          'Order,DemoOMS',
          'Customer,DemoCRM,CUST-1,Acme,2026-09-29T08:00:00Z',
        ),
      ),
      'entities',
    );

    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rowErrors).toEqual([
      { kind: 'entities', row: 2, field: null, message: 'Expected 5 columns, found 2' },
    ]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.row).toBe(3);
  });

  it('reports a data row with more columns than the header', () => {
    const parsed = parseCsvImport(
      buffer(
        lines(
          'type,source_system,source_id',
          'Order,DemoOMS,ORD-1,extra',
        ),
      ),
      'entities',
    );

    expect(parsed.rowErrors[0]?.message).toBe('Expected 3 columns, found 4');
  });

  it('rejects an empty header column', () => {
    const parsed = parseCsvImport(buffer(lines('type,,source_id', 'Order,DemoOMS,ORD-1')), 'entities');

    expect(parsed.rows).toEqual([]);
    expect(parsed.fileErrors).toEqual(['The header contains an empty column name']);
  });

  it('rejects duplicate header columns', () => {
    const parsed = parseCsvImport(
      buffer(lines('type,source_id,type', 'Order,ORD-1,Order')),
      'entities',
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.fileErrors).toEqual(['The header contains duplicate column name "type"']);
  });

  it('rejects a file without a header row', () => {
    const parsed = parseCsvImport(buffer(''), 'entities');
    expect(parsed.fileErrors).toEqual(['The file must contain a header row']);
  });

  it('rejects a file that is not valid UTF-8', () => {
    const parsed = parseCsvImport(new Uint8Array([0xc3, 0x28]), 'entities');
    expect(parsed.fileErrors).toEqual(['File is not valid UTF-8']);
  });

  it('reports an unclosed quote as a file error with the parser line number', () => {
    const parsed = parseCsvImport(
      buffer(lines('type,source_id', 'Order,"unclosed')),
      'entities',
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.rowErrors).toEqual([]);
    expect(parsed.fileErrors).toHaveLength(1);
    expect(parsed.fileErrors[0]).toContain('line 2');
  });
});
