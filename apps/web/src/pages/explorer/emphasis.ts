import type { NeighborhoodResponse } from '@opsgraph/shared';
import type { BlockerRole, Emphasis, Selection } from './flow-types';

export interface EmphasisResult {
  nodes: Map<string, Emphasis>;
  edges: Map<string, Emphasis>;
  blockerRole: Map<string, BlockerRole>;
}

export interface EmphasisInput {
  response: NeighborhoodResponse;
  selection: Selection;
  focusMode: boolean;
  /** null = every blocking path. */
  selectedPathIndex: number | null;
}

/** Contract ui.md §7: blocker highlighting first, then focus mode on top of it. */
export function computeEmphasis(input: EmphasisInput): EmphasisResult {
  const { response, selection, focusMode, selectedPathIndex } = input;

  // 1. Everything normal.
  const nodes = new Map<string, Emphasis>(response.nodes.map((n) => [n.id, 'normal']));
  const edges = new Map<string, Emphasis>(response.edges.map((e) => [e.key, 'normal']));
  const blockerRole = new Map<string, BlockerRole>(response.nodes.map((n) => [n.id, 'none']));

  // 2. Blocker paths.
  const blockers = response.blockers;
  if (blockers !== null && blockers.paths.length > 0) {
    const selected =
      selectedPathIndex === null ? undefined : blockers.paths[selectedPathIndex];
    const paths = selected === undefined ? blockers.paths : [selected];

    const pathNodeIds = new Set<string>();
    const pathEdgeKeys = new Set<string>();
    for (const path of paths) {
      for (const hop of path.hops) {
        pathNodeIds.add(hop.entity.id);
        pathEdgeKeys.add(hop.key);
      }
    }
    for (const node of response.nodes) {
      if (node.id === response.focusId) {
        continue;
      }
      nodes.set(node.id, pathNodeIds.has(node.id) ? 'highlighted' : 'dimmed');
    }
    for (const edge of response.edges) {
      edges.set(edge.key, pathEdgeKeys.has(edge.key) ? 'highlighted' : 'dimmed');
    }

    const direct = new Set(blockers.directBlockers.map((b) => b.entity.id));
    const deepest = new Set(blockers.deepestBlockers.map((b) => b.entity.id));
    for (const node of response.nodes) {
      const isDirect = direct.has(node.id);
      const isDeepest = deepest.has(node.id);
      if (isDirect && isDeepest) {
        blockerRole.set(node.id, 'direct-and-deepest');
      } else if (isDirect) {
        blockerRole.set(node.id, 'direct');
      } else if (isDeepest) {
        blockerRole.set(node.id, 'deepest');
      }
    }
  }

  // 3. Focus mode on a selected node.
  if (focusMode && selection?.kind === 'node') {
    const selectedId = selection.id;
    const keepEdges = new Set<string>();
    const keepNodes = new Set<string>([selectedId]);
    for (const edge of response.edges) {
      if (edge.fromEntityId === selectedId || edge.toEntityId === selectedId) {
        keepEdges.add(edge.key);
        keepNodes.add(edge.fromEntityId);
        keepNodes.add(edge.toEntityId);
      }
    }
    for (const [id, current] of nodes) {
      if (!keepNodes.has(id)) {
        nodes.set(id, 'dimmed');
      } else if (current === 'dimmed') {
        nodes.set(id, 'normal');
      }
    }
    for (const [key, current] of edges) {
      if (!keepEdges.has(key)) {
        edges.set(key, 'dimmed');
      } else if (current === 'dimmed') {
        edges.set(key, 'normal');
      }
    }
  }

  return { nodes, edges, blockerRole };
}
