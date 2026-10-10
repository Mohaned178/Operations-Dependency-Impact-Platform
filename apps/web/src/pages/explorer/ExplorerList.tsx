import type { GraphEdgeDto, NeighborhoodNodeDto, NeighborhoodResponse, NodeReason } from '@opsgraph/shared';
import { Link } from 'react-router';
import { OriginBadge } from '../entities/OriginBadge';
import { StateBadge } from '../entities/StateBadge';
import type { EmphasisResult } from './emphasis';
import type { Selection } from './flow-types';
import { NodeChips } from './NodeChips';
import { compareCodeUnits } from './text-order';

export interface ExplorerListProps {
  response: NeighborhoodResponse;
  selection: Selection;
  emphasis: EmphasisResult;
  onSelectNode: (id: string, from: 'list') => void;
  onSelectEdge: (key: string, from: 'list') => void;
  onToggleExpand: (id: string) => void;
  onToggleFocusMode: () => void;
  focusMode: boolean;
  onExploreFrom: (id: string) => void;
}

const REASON_TEXT: Record<NodeReason, string | null> = {
  FOCUS: null,
  BLOCKING_PATH: 'Blocking path',
  NEIGHBORHOOD: 'Neighborhood',
  CONNECTOR: 'Connector',
  EXPANSION: 'Expansion',
};

interface Group {
  title: string;
  nodes: NeighborhoodNodeDto[];
}

/** Contract ui.md §12: focus, then one group per distance, then the nodes added without one. */
function groupNodes(response: NeighborhoodResponse): Group[] {
  const focus: NeighborhoodNodeDto[] = [];
  const byDistance = new Map<number, NeighborhoodNodeDto[]>();
  const byBlocking: NeighborhoodNodeDto[] = [];
  const byExpansion: NeighborhoodNodeDto[] = [];

  for (const node of response.nodes) {
    if (node.id === response.focusId) {
      focus.push(node);
    } else if (node.distance !== null) {
      const list = byDistance.get(node.distance);
      if (list === undefined) {
        byDistance.set(node.distance, [node]);
      } else {
        list.push(node);
      }
    } else if (node.reasons.includes('BLOCKING_PATH')) {
      byBlocking.push(node);
    } else {
      byExpansion.push(node);
    }
  }

  const groups: Group[] = [{ title: 'Focus', nodes: focus }];
  for (const distance of [...byDistance.keys()].sort((a, b) => a - b)) {
    groups.push({
      title: `${distance} ${distance === 1 ? 'step' : 'steps'}`,
      nodes: byDistance.get(distance) ?? [],
    });
  }
  groups.push({ title: 'Added by blocking path', nodes: byBlocking });
  groups.push({ title: 'Added by expansion', nodes: byExpansion });
  return groups.filter((group) => group.nodes.length > 0);
}

export function ExplorerList({
  response,
  selection,
  emphasis,
  onSelectNode,
  onSelectEdge,
  onToggleExpand,
  onToggleFocusMode,
  focusMode,
  onExploreFrom,
}: ExplorerListProps) {
  const nodesById = new Map(response.nodes.map((n) => [n.id, n]));
  const indexOf = new Map(response.nodes.map((n, i) => [n.id, i]));
  const nameOf = (id: string) => nodesById.get(id)?.displayName ?? id;

  const edges: GraphEdgeDto[] = [...response.edges].sort(
    (a, b) =>
      (indexOf.get(a.fromEntityId) ?? 0) - (indexOf.get(b.fromEntityId) ?? 0) ||
      compareCodeUnits(a.relationshipType, b.relationshipType) ||
      (indexOf.get(a.toEntityId) ?? 0) - (indexOf.get(b.toEntityId) ?? 0),
  );

  return (
    <section aria-label="Entities and relationships" className="flex flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Entities</h2>
        {groupNodes(response).map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{`${group.title} (${group.nodes.length})`}</h3>
            <ul className="flex flex-col gap-1">
              {group.nodes.map((node) => {
                const selected = selection?.kind === 'node' && selection.id === node.id;
                const dimmed = emphasis.nodes.get(node.id) === 'dimmed';
                const reasons = node.reasons
                  .map((reason) => REASON_TEXT[reason])
                  .filter((text): text is string => text !== null);
                return (
                  <li key={node.id} className={dimmed ? 'opacity-50' : undefined}>
                    <button
                      type="button"
                      data-entity-id={node.id}
                      aria-pressed={selected}
                      onClick={() => {
                        onSelectNode(node.id, 'list');
                      }}
                      className={`flex w-full flex-col gap-1 rounded border px-3 py-2 text-left text-sm ${
                        selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {node.type}
                      </span>
                      <span className="font-medium text-slate-900">{node.displayName}</span>
                      <span className="flex flex-wrap items-center gap-1">
                        <StateBadge state={node.currentState} />
                        <NodeChips node={node} blockerRole={emphasis.blockerRole.get(node.id) ?? 'none'} />
                        {reasons.length > 0 ? (
                          <span className="text-xs text-slate-500">{reasons.join(', ')}</span>
                        ) : null}
                      </span>
                    </button>
                    {selected ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 pl-3 text-sm">
                        {node.id === response.focusId ? null : (
                          <button
                            type="button"
                            onClick={() => {
                              onToggleExpand(node.id);
                            }}
                            className="rounded border px-2 py-0.5"
                          >
                            {node.expanded ? 'Collapse' : 'Expand'}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-pressed={focusMode}
                          onClick={onToggleFocusMode}
                          className="rounded border px-2 py-0.5"
                        >
                          {focusMode ? 'Focus mode off' : 'Focus mode on'}
                        </button>
                        {node.id === response.focusId ? null : (
                          <button
                            type="button"
                            onClick={() => {
                              onExploreFrom(node.id);
                            }}
                            className="rounded border px-2 py-0.5"
                          >
                            Explore from here
                          </button>
                        )}
                        <Link to={`/entities/${node.id}`} className="underline">
                          Open Entity 360
                        </Link>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Relationships</h2>
        {edges.length === 0 ? <p className="text-sm text-slate-500">No relationships shown.</p> : null}
        <ul className="flex flex-col gap-1">
          {edges.map((edge) => {
            const selected = selection?.kind === 'edge' && selection.key === edge.key;
            const dimmed = emphasis.edges.get(edge.key) === 'dimmed';
            return (
              <li key={edge.key} className={dimmed ? 'opacity-50' : undefined}>
                <button
                  type="button"
                  data-edge-key={edge.key}
                  aria-pressed={selected}
                  onClick={() => {
                    onSelectEdge(edge.key, 'list');
                  }}
                  className={`flex w-full flex-wrap items-center gap-2 rounded border px-3 py-2 text-left text-sm ${
                    selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <span>{`${nameOf(edge.fromEntityId)} ${edge.relationshipType} ${nameOf(edge.toEntityId)}`}</span>
                  <OriginBadge origin={edge.effectiveOrigin} confidence={edge.effectiveConfidence} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
