import type { ImportKind, JsonValue } from '@opsgraph/shared';
import { decodeUtf8 } from './decode';
import type { ParsedImport, ParsedRow, RowError } from './parsed-import';

const SECTIONS = ['entities', 'relationships', 'events'] as const;

function isSection(key: string): key is (typeof SECTIONS)[number] {
  return (SECTIONS as readonly string[]).includes(key);
}

export function parseJsonImport(buffer: Uint8Array): ParsedImport {
  let text: string;
  try {
    text = decodeUtf8(buffer);
  } catch {
    return { rows: [], rowErrors: [], fileErrors: ['File is not valid UTF-8'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    return { rows: [], rowErrors: [], fileErrors: [message] };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      rows: [],
      rowErrors: [],
      fileErrors: ['The import file must contain a JSON object'],
    };
  }

  const document = parsed as Record<string, unknown>;
  const fileErrors: string[] = [];

  for (const key of Object.keys(document)) {
    if (!isSection(key)) {
      fileErrors.push(`Unknown top-level section "${key}"`);
    }
  }
  if (!SECTIONS.some((section) => section in document)) {
    fileErrors.push(
      'The file must contain at least one of "entities", "relationships" or "events"',
    );
  }

  const rows: ParsedRow[] = [];
  const rowErrors: RowError[] = [];

  for (const section of SECTIONS) {
    const value = document[section];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      fileErrors.push(`"${section}" must be an array`);
      continue;
    }
    value.forEach((element, index) => {
      const row = index + 1;
      const kind: ImportKind = section;
      if (element === null || typeof element !== 'object' || Array.isArray(element)) {
        rowErrors.push({ kind, row, field: null, message: 'Row must be an object' });
        return;
      }
      const candidate = element as Record<string, unknown>;
      rows.push({ kind, row, raw: element as JsonValue, candidate });
    });
  }

  return { rows, rowErrors, fileErrors };
}
