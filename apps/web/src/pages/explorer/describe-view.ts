import type { ExplorerUrlParams, NeighborhoodResponse } from '@opsgraph/shared';

export interface ViewDescription {
  title: string;
  filters: string | null;
  omitted: string | null;
  empty: string | null;
}

const DIRECTION_LABEL: Record<NeighborhoodResponse['query']['direction'], string> = {
  all: 'all directions',
  upstream: 'upstream only',
  downstream: 'downstream only',
};

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** ui.md §10: the header text for the explorer summary. */
export function describeView(
  r: NeighborhoodResponse,
  settings: ExplorerUrlParams,
): ViewDescription {
  const focusName = r.nodes[0]?.displayName ?? '';
  const n = r.nodes.length;
  const m = r.edges.length;
  const { depth, direction } = r.query;

  const title =
    `${focusName} — ${DIRECTION_LABEL[direction]}, ` +
    `${depth} ${plural(depth, 'step', 'steps')}: ` +
    `${n} ${plural(n, 'entity', 'entities')}, ` +
    `${m} ${plural(m, 'relationship', 'relationships')}`;

  const filterParts: string[] = [];
  if (settings.entityTypes.length > 0) {
    filterParts.push(`Entity types: ${settings.entityTypes.join(', ')}`);
  }
  if (settings.relationshipTypes.length > 0) {
    filterParts.push(`Relationship types: ${settings.relationshipTypes.join(', ')}`);
  }
  const filters = filterParts.length > 0 ? filterParts.join(' · ') : null;

  const omittedCount = r.totals.omitted;
  let omitted: string | null = null;
  if (omittedCount > 0) {
    omitted = r.totals.omittedIsLowerBound
      ? `Showing ${n} of more than ${n + omittedCount} entities — refine filters, reduce the step limit, or choose a direction.`
      : `Showing ${n} of ${n + omittedCount} entities — ${omittedCount} more. Refine filters, reduce the step limit, or choose a direction.`;
  }

  let empty: string | null = null;
  if (n === 1) {
    empty = `${focusName} has no relationships matching the current settings.`;
    if (filters !== null) {
      empty += ' Try removing filters.';
    }
  }

  return { title, filters, omitted, empty };
}
