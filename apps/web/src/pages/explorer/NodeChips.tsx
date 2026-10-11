import type { NeighborhoodNodeDto } from '@opsgraph/shared';
import type { BlockerRole } from './flow-types';

/** Sources disagree on the entity's state (spec FR-009). */
export function hasConflict(node: NeighborhoodNodeDto): boolean {
  return new Set(node.state.latestBySource.map((o) => o.state)).size > 1;
}

/** Shown only because it lies between a matching entity and the focus (spec FR-007). */
export function isConnectorOnly(node: NeighborhoodNodeDto): boolean {
  return node.reasons.length === 1 && node.reasons[0] === 'CONNECTOR';
}

export interface NodeChipsProps {
  node: NeighborhoodNodeDto;
  blockerRole: BlockerRole;
}

/** The marker chips of ui.md §8, in order. Used by the graph node and the list row. */
export function NodeChips({ node, blockerRole }: NodeChipsProps) {
  const direct = blockerRole === 'direct' || blockerRole === 'direct-and-deepest';
  const deepest = blockerRole === 'deepest' || blockerRole === 'direct-and-deepest';
  return (
    <>
      {hasConflict(node) ? (
        <span
          className="rounded bg-amber-100 px-1 text-[10px] text-amber-800"
          title="Sources disagree on this entity's state"
        >
          Conflict
        </span>
      ) : null}
      {node.currentState === 'UNKNOWN' ? (
        <span className="rounded border border-slate-400 px-1 text-[10px] text-slate-600">
          State unknown
        </span>
      ) : null}
      {direct ? (
        <span className="rounded border border-red-600 px-1 text-[10px] text-red-700">
          Direct blocker
        </span>
      ) : null}
      {deepest ? (
        <span className="rounded bg-red-600 px-1 text-[10px] text-white">Deepest blocker</span>
      ) : null}
      {isConnectorOnly(node) ? (
        <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-700">Connector</span>
      ) : null}
    </>
  );
}
