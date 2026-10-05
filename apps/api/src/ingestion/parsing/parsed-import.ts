import type {
  EntityImportRow,
  EventImportRow,
  ImportKind,
  JsonValue,
  RelationshipImportRow,
} from '@opsgraph/shared';

export interface ParsedRow {
  kind: ImportKind;
  /** JSON: 1-based index in its section. CSV: spreadsheet row number (header = 1). */
  row: number;
  /** The row exactly as received (JSON object, or CSV `{ header: cell }`). */
  raw: JsonValue;
  /** The normalized object the row validator parses. */
  candidate: Record<string, unknown>;
  /** CSV only: CSV column name -> field path, for error mapping. */
  columnMap?: Readonly<Record<string, string>>;
}

export type ValidatedRow =
  | { kind: 'entities'; parsed: ParsedRow; value: EntityImportRow }
  | { kind: 'relationships'; parsed: ParsedRow; value: RelationshipImportRow }
  | { kind: 'events'; parsed: ParsedRow; value: EventImportRow };

export interface RowError {
  kind: ImportKind;
  row: number;
  field: string | null;
  message: string;
  dependsOn?: { kind: ImportKind; row: number };
}

export interface ParsedImport {
  rows: ParsedRow[];
  rowErrors: RowError[];
  fileErrors: string[];
}
