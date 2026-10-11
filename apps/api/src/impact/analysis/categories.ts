import {
  EntityTypeSchema,
  IMPACT_HEADLINE_TYPES,
  impactCategoryLabel,
  type EntityType,
  type ImpactCategoryDto,
} from '@opsgraph/shared';
import { compareCodeUnits } from '../../graph/traversal/path-order';
import type { Affected } from './types';

function emptyCategory(type: EntityType, headline: boolean): ImpactCategoryDto {
  return {
    type,
    label: impactCategoryLabel(type),
    headline,
    total: 0,
    direct: 0,
    indirect: 0,
    current: 0,
    potential: 0,
    inferredOnly: 0,
    stateUnknown: 0,
  };
}

/**
 * Spec FR-012, research R7: the 6 headline categories always, in order, then every other type
 * with a non-zero total, by type name. Only counted entities take part.
 */
export function buildCategories(affected: readonly Affected[]): ImpactCategoryDto[] {
  const headline = new Set<EntityType>(IMPACT_HEADLINE_TYPES);
  const byType = new Map<EntityType, ImpactCategoryDto>(
    EntityTypeSchema.options.map((type) => [type, emptyCategory(type, headline.has(type))]),
  );

  for (const item of affected) {
    if (item.classification === 'NOT_COUNTED') {
      continue;
    }
    const category = byType.get(item.entity.type);
    if (category === undefined) {
      throw new Error(`impact invariant: unknown entity type ${item.entity.type}`);
    }
    category.total += 1;
    category[item.directness === 'DIRECT' ? 'direct' : 'indirect'] += 1;
    category[item.classification === 'CURRENT' ? 'current' : 'potential'] += 1;
    if (item.flags.inferredOnly) {
      category.inferredOnly += 1;
    }
    if (item.flags.stateUnknown) {
      category.stateUnknown += 1;
    }
  }

  const headlineCategories = IMPACT_HEADLINE_TYPES.map((type) => {
    const category = byType.get(type);
    if (category === undefined) {
      throw new Error(`impact invariant: missing headline type ${type}`);
    }
    return category;
  });
  const others = [...byType.values()]
    .filter((category) => !category.headline && category.total > 0)
    .sort((a, b) => compareCodeUnits(a.type, b.type));
  return [...headlineCategories, ...others];
}

/** Spec FR-005: what is left out, in total and by type (sorted by type name). */
export function notCountedSummary(affected: readonly Affected[]): {
  total: number;
  byType: Array<{ type: EntityType; count: number }>;
} {
  const counts = new Map<EntityType, number>();
  for (const item of affected) {
    if (item.classification === 'NOT_COUNTED') {
      counts.set(item.entity.type, (counts.get(item.entity.type) ?? 0) + 1);
    }
  }
  const byType = [...counts.entries()]
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([type, count]) => ({ type, count }));
  return { total: byType.reduce((sum, entry) => sum + entry.count, 0), byType };
}
