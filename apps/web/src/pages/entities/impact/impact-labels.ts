import {
  STATE_CLASSIFICATION,
  impactCategoryLabel,
  type EntityRefDto,
  type ImpactClassification,
  type ImpactListSelector,
  type ImpactResponse,
  type TracedEntityDto,
} from '@opsgraph/shared';

export function classificationLabel(classification: ImpactClassification): string {
  switch (classification) {
    case 'CURRENT':
      return 'Current';
    case 'POTENTIAL':
      return 'Potential';
    case 'NOT_COUNTED':
      return 'Not counted (completed or cancelled)';
  }
}

export function stepsText(count: number): string {
  return `${count} step${count === 1 ? '' : 's'}`;
}

/** PathView wants a traced start; a bare entity reference is enough for its names and ids. */
export function asTraced(entity: EntityRefDto): TracedEntityDto {
  return {
    ...entity,
    state: {
      classification: STATE_CLASSIFICATION[entity.currentState],
      observation: null,
      latestBySource: [],
    },
  };
}

const BUCKET_WORDS = {
  total: 'total',
  direct: 'direct',
  indirect: 'indirect',
  current: 'current',
  potential: 'potential',
  inferredOnly: 'only inferred',
  stateUnknown: 'state unknown',
} as const;

/** "Customer orders — current", the heading of an opened list (without the count). */
export function selectorTitle(selector: ImpactListSelector): string {
  switch (selector.list) {
    case 'category':
      return `${impactCategoryLabel(selector.type)} — ${BUCKET_WORDS[selector.bucket]}`;
    case 'exposure':
      return `Exposure in ${selector.currency} — ${BUCKET_WORDS[selector.bucket]}`;
    case 'valueUnknown':
      return 'Customer orders without a recorded value';
    case 'notCounted':
      return selector.type === null
        ? 'Not counted (completed or cancelled)'
        : `Not counted (completed or cancelled) — ${impactCategoryLabel(selector.type)}`;
  }
}

/** The number in the summary that opens the list for this selector (research R13). */
export function summaryCountFor(selector: ImpactListSelector, summary: ImpactResponse): number {
  switch (selector.list) {
    case 'category':
      return summary.categories.find((entry) => entry.type === selector.type)?.[selector.bucket] ?? 0;
    case 'exposure': {
      const figure = summary.exposure.byCurrency.find((entry) => entry.currency === selector.currency);
      if (figure === undefined) {
        return 0;
      }
      return selector.bucket === 'inferredOnly'
        ? figure.inferredOnly.total.orderCount
        : figure[selector.bucket].orderCount;
    }
    case 'valueUnknown':
      return summary.exposure.valueUnknownCount;
    case 'notCounted':
      return selector.type === null
        ? summary.notCounted.total
        : (summary.notCounted.byType.find((entry) => entry.type === selector.type)?.count ?? 0);
  }
}
