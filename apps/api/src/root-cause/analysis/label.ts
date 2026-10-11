import type { JsonValue, LabelRule, OperationalState, TracedEntityDto } from '@opsgraph/shared';

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** AT_RISK becomes "At Risk", MISSING becomes "Missing" (research R5). */
export function stateWords(state: OperationalState): string {
  return state.toLowerCase().split('_').map(capitalize).join(' ');
}

/** Splits before each uppercase letter and on "_" and "-": "budgetCode" becomes "Budget Code". */
export function humanize(field: string): string {
  return field
    .split(/(?=[A-Z])|[_-]/)
    .filter((part) => part !== '')
    .map(capitalize)
    .join(' ');
}

/** Research R5: the required field when the entity names one, otherwise its display name. */
export function rootCauseLabel(
  entity: TracedEntityDto,
  attributes: Record<string, JsonValue> | undefined,
): { label: string; labelRule: LabelRule } {
  const words = stateWords(entity.currentState);
  const field = attributes?.['requiredField'];
  if (typeof field === 'string' && field !== '') {
    return { label: `${humanize(field)} ${words}`, labelRule: 'REQUIRED_FIELD' };
  }
  return { label: `${entity.displayName} ${words}`, labelRule: 'DISPLAY_NAME_STATE' };
}
