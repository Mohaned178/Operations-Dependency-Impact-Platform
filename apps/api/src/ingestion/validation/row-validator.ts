import {
  EntityImportRowSchema,
  EntityTypeSchema,
  EventImportRowSchema,
  RelationshipImportRowSchema,
} from '@opsgraph/shared';
import type { ZodIssue } from 'zod';
import { identifierKey } from '../planning/import-plan';
import type { ParsedRow, RowError, ValidatedRow } from '../parsing/parsed-import';

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export interface ValidationResult {
  rows: ValidatedRow[];
  errors: RowError[];
}

function translateField(parsed: ParsedRow, path: string): string {
  if (parsed.columnMap === undefined) {
    return path;
  }
  const entries = Object.entries(parsed.columnMap);
  const exact = entries.find(([, fieldPath]) => fieldPath === path);
  if (exact !== undefined) {
    return exact[0];
  }
  const length = ([, fieldPath]: [string, string]): number => fieldPath.length;
  const nested = entries
    .filter(([, fieldPath]) => path.startsWith(`${fieldPath}.`))
    .sort((left, right) => length(right) - length(left))[0];
  if (nested !== undefined) {
    return nested[0];
  }
  const parent = entries
    .filter(([, fieldPath]) => fieldPath.startsWith(`${path}.`))
    .sort((left, right) => length(right) - length(left))[0];
  if (parent !== undefined) {
    return parent[0];
  }
  return path;
}

function issuesToRowErrors(parsed: ParsedRow, issues: readonly ZodIssue[]): RowError[] {
  return issues.map((issue) => {
    const path = issue.path.join('.');
    return {
      kind: parsed.kind,
      row: parsed.row,
      field: path === '' ? null : translateField(parsed, path),
      message: issue.message,
    };
  });
}

function checkTimestamp(
  parsed: ParsedRow,
  field: string,
  value: string,
  now: Date,
): RowError | null {
  if (new Date(value).getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return {
      kind: parsed.kind,
      row: parsed.row,
      field: translateField(parsed, field),
      message: `${field} cannot be more than 5 minutes in the future`,
    };
  }
  return null;
}

export function collectRejectedEntityKeys(
  rows: readonly ParsedRow[],
  errors: readonly RowError[],
): Map<string, number> {
  const rejectedRows = new Set(
    errors.filter((error) => error.kind === 'entities').map((error) => error.row),
  );
  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'entities' || !rejectedRows.has(row.row)) {
      continue;
    }
    const type = EntityTypeSchema.safeParse(row.candidate['type']);
    const sourceSystem = row.candidate['sourceSystem'];
    const sourceId = row.candidate['sourceId'];
    if (
      !type.success ||
      typeof sourceSystem !== 'string' ||
      typeof sourceId !== 'string'
    ) {
      continue;
    }
    const key = identifierKey(type.data, sourceSystem, sourceId);
    if (!result.has(key)) {
      result.set(key, row.row);
    }
  }
  return result;
}

export function validateRows(rows: readonly ParsedRow[], now: Date): ValidationResult {
  const valid: ValidatedRow[] = [];
  const errors: RowError[] = [];

  for (const parsed of rows) {
    switch (parsed.kind) {
      case 'entities': {
        const result = EntityImportRowSchema.safeParse(parsed.candidate);
        if (!result.success) {
          errors.push(...issuesToRowErrors(parsed, result.error.issues));
          break;
        }
        const timeError = checkTimestamp(parsed, 'observedAt', result.data.observedAt, now);
        if (timeError) {
          errors.push(timeError);
          break;
        }
        valid.push({ kind: 'entities', parsed, value: result.data });
        break;
      }
      case 'relationships': {
        const result = RelationshipImportRowSchema.safeParse(parsed.candidate);
        if (!result.success) {
          errors.push(...issuesToRowErrors(parsed, result.error.issues));
          break;
        }
        const timeError = checkTimestamp(parsed, 'observedAt', result.data.observedAt, now);
        if (timeError) {
          errors.push(timeError);
          break;
        }
        valid.push({ kind: 'relationships', parsed, value: result.data });
        break;
      }
      case 'events': {
        const result = EventImportRowSchema.safeParse(parsed.candidate);
        if (!result.success) {
          errors.push(...issuesToRowErrors(parsed, result.error.issues));
          break;
        }
        const timeError =
          checkTimestamp(parsed, 'observedAt', result.data.observedAt, now) ??
          checkTimestamp(parsed, 'occurredAt', result.data.occurredAt, now);
        if (timeError) {
          errors.push(timeError);
          break;
        }
        valid.push({ kind: 'events', parsed, value: result.data });
        break;
      }
    }
  }

  return { rows: valid, errors };
}
