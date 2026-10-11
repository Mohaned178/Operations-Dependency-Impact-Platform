import {
  IMPACT_NOUNS,
  type EntityType,
  type ImpactCategoryDto,
  type ImpactStateClass,
  type OperationalState,
} from '@opsgraph/shared';
import { formatMoneyText } from './money';
import type { ExposureFigure, ExposureResult, ExposureShare } from './types';

export interface SummaryInput {
  startName: string;
  startState: OperationalState;
  startClass: ImpactStateClass;
  depth: number;
  /** Counted entities over all categories, customers included. */
  countedTotal: number;
  categories: readonly ImpactCategoryDto[];
  exposure: ExposureResult;
  notCountedTotal: number;
  limits: { depthLimit: boolean; explorationLimit: boolean };
}

type CountColumn = 'current' | 'potential';
type ShareOf = (figure: ExposureFigure) => ExposureShare;

function steps(count: number): string {
  return count === 1 ? '1 step' : `${count} steps`;
}

function noun(type: EntityType, count: number): string {
  const [singular, plural] = IMPACT_NOUNS[type];
  return count === 1 ? singular : plural;
}

const isAre = (count: number): string => (count === 1 ? 'is' : 'are');
const hasHave = (count: number): string => (count === 1 ? 'has' : 'have');
const entityWord = (count: number): string => (count === 1 ? 'entity' : 'entities');

/** "3 purchase orders, 6 customer orders": the categories in table order, zeros left out. */
function countList(categories: readonly ImpactCategoryDto[], column: CountColumn): string {
  return categories
    .filter((category) => category[column] > 0)
    .map((category) => `${category[column]} ${noun(category.type, category[column])}`)
    .join(', ');
}

/** Each currency with a non-zero amount, in currency order, joined with " and ". */
function moneyText(figures: readonly ExposureFigure[], shareOf: ShareOf): string {
  return figures
    .map((figure) => ({ currency: figure.currency, amount: shareOf(figure).amount }))
    .filter((entry) => entry.amount > 0n)
    .map((entry) => formatMoneyText(entry.amount, entry.currency))
    .join(' and ');
}

function rangeText(figures: readonly ExposureFigure[]): string {
  return figures
    .flatMap((figure) =>
      figure.range === null
        ? []
        : [
            `${formatMoneyText(figure.range.low, figure.currency)} to ${formatMoneyText(figure.range.high, figure.currency)}`,
          ],
    )
    .join(' and ');
}

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
};

/** Contracts/api.md § Summary text, lines 1 to 12, in that order. */
export function buildSummary(input: SummaryInput): string[] {
  const { categories, exposure, countedTotal, startName, depth } = input;
  const figures = exposure.byCurrency;
  const orderNoun = (count: number): string => noun('Order', count);
  const lines: string[] = [];

  const inferredCount = sum(categories.map((category) => category.inferredOnly));
  const allInferred = countedTotal > 0 && inferredCount === countedTotal;

  // 1
  const statement =
    input.startClass === 'INDETERMINATE'
      ? `${startName} has an unknown state`
      : `${startName} is ${input.startState}`;
  lines.push(
    allInferred
      ? `${statement}, and everything it affects is reached only through inferred or manual links.`
      : `${statement}.`,
  );

  if (countedTotal === 0) {
    // 2
    lines.push(`Nothing is affected within ${steps(depth)}.`);
  } else if (input.startClass === 'IMPAIRED') {
    const currentCount = sum(categories.map((category) => category.current));
    const potentialCount = sum(categories.map((category) => category.potential));
    const currentMoney = moneyText(figures, (figure) => figure.current);
    const potentialMoney = moneyText(figures, (figure) => figure.potential);
    const totalMoney = moneyText(figures, (figure) => figure.total);

    // 3a / 3b
    if (currentCount > 0) {
      lines.push(
        `Currently affected: ${countList(categories, 'current')}.` +
          (currentMoney === '' ? '' : ` ${currentMoney} exposed.`),
      );
    } else {
      lines.push('Nothing is currently affected.');
    }
    // 3c
    if (potentialCount > 0) {
      lines.push(
        `Potentially affected if it continues: ${countList(categories, 'potential')}.` +
          (potentialMoney === '' ? '' : ` ${potentialMoney} more exposed.`),
      );
    }
    // 3d
    if (totalMoney !== '') {
      const orders = sum(figures.map((figure) => figure.total.orderCount));
      lines.push(`Total exposure: ${totalMoney} across ${orders} ${orderNoun(orders)}.`);
    }
  } else {
    // 4
    const totalMoney = moneyText(figures, (figure) => figure.total);
    lines.push(
      `If ${startName} became unavailable: ${countList(categories, 'potential')}.` +
        (totalMoney === '' ? '' : ` ${totalMoney} exposed.`),
    );
  }

  // 5
  if (inferredCount > 0 && !allInferred) {
    const inferredMoney = moneyText(figures, (figure) => figure.inferredOnly.total);
    lines.push(
      `${inferredCount} of the affected entities ${isAre(inferredCount)} reached only through inferred or manual links` +
        (inferredMoney === '' ? '' : `, including ${inferredMoney} of exposure`) +
        '.',
    );
  }

  // 6
  const unknownCount = sum(categories.map((category) => category.stateUnknown));
  if (unknownCount > 0) {
    lines.push(
      `${unknownCount} affected ${entityWord(unknownCount)} ${hasHave(unknownCount)} an unknown state and ${isAre(unknownCount)} counted as potential.`,
    );
  }

  // 7
  if (input.notCountedTotal > 0) {
    lines.push(
      `Not counted: ${input.notCountedTotal} completed or cancelled ${entityWord(input.notCountedTotal)}.`,
    );
  }

  // 8
  if (exposure.valueUnknownCount > 0) {
    const count = exposure.valueUnknownCount;
    lines.push(
      `${count} ${orderNoun(count)} without a recorded value ${isAre(count)} left out of exposure.`,
    );
  }

  // 9
  const disagreeing = sum(figures.map((figure) => figure.disagreementOrderCount));
  if (disagreeing > 0) {
    lines.push(
      `${disagreeing} ${orderNoun(disagreeing)} ${hasHave(disagreeing)} values that disagree between sources; exposure could range from ${rangeText(figures)}.`,
    );
  }

  // 10
  if (exposure.startOwnValue !== null && countedTotal > 0) {
    lines.push(
      `${startName}'s own value, ${formatMoneyText(exposure.startOwnValue.amount, exposure.startOwnValue.currency)}, is not included.`,
    );
  }

  // 11
  if (input.limits.depthLimit) {
    lines.push(`Impact continues beyond ${steps(depth)}; these figures are lower bounds.`);
  }

  // 12
  if (input.limits.explorationLimit) {
    lines.push('The search stopped after 10,000 entities; these figures are lower bounds.');
  }

  return lines;
}
