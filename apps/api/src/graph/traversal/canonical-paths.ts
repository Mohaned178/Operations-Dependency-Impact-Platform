import { CONFIDENCE_RANK, type Confidence } from '@opsgraph/shared';
import { compareIdSequences } from './path-order';
import type { InternalPath, TraversalEdge } from './types';

export interface CanonicalPathsResult {
  /** Keyed by reached entity id; never contains startId. */
  paths: Map<string, InternalPath>;
  /** All, unsorted; the repository sorts and caps. */
  cycleClosing: TraversalEdge[];
}

interface Label {
  nonSource: number;
  entityIds: string[];
  hopKeys: string[];
  edges: TraversalEdge[];
}

function compareLabels(a: Label, b: Label): number {
  if (a.nonSource !== b.nonSource) {
    return Math.sign(a.nonSource - b.nonSource);
  }
  const ids = compareIdSequences(a.entityIds, b.entityIds);
  if (ids !== 0) {
    return ids;
  }
  return compareIdSequences(a.hopKeys, b.hopKeys);
}

/** The minimum over d also compares the hop count. */
function compareAcrossDepths(a: Label, b: Label): number {
  if (a.nonSource !== b.nonSource) {
    return Math.sign(a.nonSource - b.nonSource);
  }
  if (a.edges.length !== b.edges.length) {
    return Math.sign(a.edges.length - b.edges.length);
  }
  const ids = compareIdSequences(a.entityIds, b.entityIds);
  if (ids !== 0) {
    return ids;
  }
  return compareIdSequences(a.hopKeys, b.hopKeys);
}

function weakestOf(edges: readonly TraversalEdge[]): Confidence {
  let weakest: Confidence = 'HIGH';
  for (const edge of edges) {
    if (CONFIDENCE_RANK[edge.effectiveConfidence] < CONFIDENCE_RANK[weakest]) {
      weakest = edge.effectiveConfidence;
    }
  }
  return weakest;
}

/**
 * Research R5: one canonical path per reached entity, ranked by spec FR-016
 * (weakest-hop confidence first, then non-SOURCE count, then length, then ids).
 * Never re-enters the start entity. Throws on a repeated entity.
 */
export function selectCanonicalPaths(
  startId: string,
  edges: readonly TraversalEdge[],
  maxDepth: number,
): CanonicalPathsResult {
  const bySource = new Map<string, TraversalEdge[]>();
  for (const edge of edges) {
    const outgoing = bySource.get(edge.sourceId);
    if (outgoing === undefined) {
      bySource.set(edge.sourceId, [edge]);
    } else {
      outgoing.push(edge);
    }
  }

  const thresholds: Confidence[] = ['HIGH', 'MEDIUM', 'LOW'];
  const assigned = new Map<string, InternalPath>();

  for (const threshold of thresholds) {
    const thresholdRank = CONFIDENCE_RANK[threshold];
    const usable = edges.filter(
      (edge) => CONFIDENCE_RANK[edge.effectiveConfidence] >= thresholdRank,
    );
    const usableBySource = new Map<string, TraversalEdge[]>();
    for (const edge of usable) {
      const outgoing = usableBySource.get(edge.sourceId);
      if (outgoing === undefined) {
        usableBySource.set(edge.sourceId, [edge]);
      } else {
        outgoing.push(edge);
      }
    }

    const best: Array<Map<string, Label>> = [];
    best[0] = new Map<string, Label>([
      [startId, { nonSource: 0, entityIds: [startId], hopKeys: [], edges: [] }],
    ]);
    for (let d = 1; d <= maxDepth; d += 1) {
      const current = new Map<string, Label>();
      const previous = best[d - 1];
      if (previous !== undefined) {
        for (const [u, labelU] of previous) {
          for (const edge of usableBySource.get(u) ?? []) {
            if (edge.targetId === startId) {
              continue;
            }
            const candidate: Label = {
              nonSource: labelU.nonSource + (edge.nonSource ? 1 : 0),
              entityIds: [...labelU.entityIds, edge.targetId],
              hopKeys: [...labelU.hopKeys, edge.key],
              edges: [...labelU.edges, edge],
            };
            const existing = current.get(edge.targetId);
            if (existing === undefined || compareLabels(candidate, existing) < 0) {
              current.set(edge.targetId, candidate);
            }
          }
        }
      }
      best[d] = current;
    }

    const candidates = new Map<string, Label>();
    for (let d = 1; d <= maxDepth; d += 1) {
      const layer = best[d];
      if (layer === undefined) {
        continue;
      }
      for (const [v, label] of layer) {
        if (v === startId || assigned.has(v)) {
          continue;
        }
        const existing = candidates.get(v);
        if (existing === undefined || compareAcrossDepths(label, existing) < 0) {
          candidates.set(v, label);
        }
      }
    }

    for (const [v, label] of candidates) {
      if (assigned.has(v)) {
        continue;
      }
      const weakest = weakestOf(label.edges);
      const path: InternalPath = {
        entityIds: label.entityIds,
        edges: label.edges,
        weakestConfidence: weakest,
        nonSourceHops: label.nonSource,
        continuesBeyondDepth: continuesBeyond(label, edges, maxDepth),
        endsInCycle: false,
      };
      if (new Set(path.entityIds).size !== path.entityIds.length) {
        throw new Error('traversal invariant: repeated entity');
      }
      assigned.set(v, path);
    }
  }

  const cycleClosing = collectCycleClosing(startId, edges, assigned, maxDepth);

  return { paths: assigned, cycleClosing };
}

function continuesBeyond(label: Label, allEdges: readonly TraversalEdge[], maxDepth: number): boolean {
  if (label.edges.length !== maxDepth) {
    return false;
  }
  const last = label.entityIds.at(-1);
  if (last === undefined) {
    return false;
  }
  const onPath = new Set(label.entityIds);
  for (const edge of allEdges) {
    if (edge.sourceId === last && !onPath.has(edge.targetId)) {
      return true;
    }
  }
  return false;
}

/**
 * Research R5 cycle-closing hops: u is the start or has a canonical path shorter
 * than maxDepth; v is the start or lies on u's canonical path.
 */
function collectCycleClosing(
  startId: string,
  edges: readonly TraversalEdge[],
  assigned: ReadonlyMap<string, InternalPath>,
  maxDepth: number,
): TraversalEdge[] {
  const seen = new Map<string, TraversalEdge>();
  for (const edge of edges) {
    const u = edge.sourceId;
    const v = edge.targetId;

    let uOk = false;
    let uPath: readonly string[] | null = null;
    if (u === startId) {
      uOk = true;
      uPath = [startId];
    } else {
      const path = assigned.get(u);
      if (path !== undefined && path.edges.length < maxDepth) {
        uOk = true;
        uPath = path.entityIds;
      }
    }
    if (!uOk || uPath === null) {
      continue;
    }

    const vOnPath = v === startId || uPath.includes(v);
    if (!vOnPath) {
      continue;
    }
    if (!seen.has(edge.key)) {
      seen.set(edge.key, edge);
    }
  }
  return [...seen.values()];
}
