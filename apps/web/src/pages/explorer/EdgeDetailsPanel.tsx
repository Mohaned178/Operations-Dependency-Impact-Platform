import type { GraphEdgeDto, NeighborhoodNodeDto } from '@opsgraph/shared';
import { formatTimestamp } from '../../lib/format';
import { OriginBadge } from '../entities/OriginBadge';
import { EntityLinks, PANEL_CLASS } from './NodeDetailsPanel';

export interface EdgeDetailsPanelProps {
  edge: GraphEdgeDto;
  nodesById: ReadonlyMap<string, NeighborhoodNodeDto>;
  /** Canonical explorer settings, for the Explore links. */
  search: string;
  onClose: () => void;
}

/** Contract ui.md §14: the relationship as recorded and every assertion behind it (FR-024). */
export function EdgeDetailsPanel({ edge, nodesById, search, onClose }: EdgeDetailsPanelProps) {
  const from = nodesById.get(edge.fromEntityId);
  const to = nodesById.get(edge.toEntityId);
  return (
    <aside className={PANEL_CLASS} aria-label="Relationship details">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold">Relationship</h2>
        <button type="button" onClick={onClose} className="rounded border px-2 py-1 text-sm">
          Close
        </button>
      </div>

      <p className="mt-3 text-sm" data-testid="recorded-sentence">
        <EntityLinks id={edge.fromEntityId} name={from?.displayName ?? edge.fromEntityId} search={search} />{' '}
        <span className="font-medium">{edge.relationshipType}</span>{' '}
        <EntityLinks id={edge.toEntityId} name={to?.displayName ?? edge.toEntityId} search={search} />
      </p>

      <div className="mt-2">
        <OriginBadge origin={edge.effectiveOrigin} confidence={edge.effectiveConfidence} />
      </div>

      <h3 className="mt-4 text-sm font-semibold">{`Assertions (${edge.assertions.length})`}</h3>
      <ul className="mt-1 flex flex-col gap-2">
        {edge.assertions.map((assertion) => (
          <li key={assertion.relationshipId} className="rounded border bg-white p-2 text-sm">
            <OriginBadge origin={assertion.origin} confidence={assertion.confidence} />
            {assertion.basis === null ? null : <p className="mt-1">{`Basis: ${assertion.basis}`}</p>}
            <p className="mt-1 text-slate-600">
              {`${assertion.sourceSystem} · ${assertion.sourceId} · observed ${formatTimestamp(assertion.observedAt)}`}
            </p>
            <p className="break-all text-xs text-slate-500">{`Import ${assertion.importId}`}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
