import {
  CONFIDENCE_RANK,
  TRACEABLE_RELATIONSHIP_TYPES,
  type Confidence,
  type RelationshipOrigin,
} from '@opsgraph/shared';
import { enumerateBlockingPaths } from './blocking-paths';
import { selectCanonicalPaths } from './canonical-paths';
import { comparePaths } from './path-order';
import type { InternalPath, TraversalEdge } from './types';

/** Inline PRNG (research R10): no dependency. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ORIGINS: RelationshipOrigin[] = ['SOURCE', 'MANUAL', 'INFERRED'];
const CONFIDENCES: Confidence[] = ['HIGH', 'MEDIUM', 'LOW'];

function weakestOf(edges: readonly TraversalEdge[]): Confidence {
  let weakest: Confidence = 'HIGH';
  for (const edge of edges) {
    if (CONFIDENCE_RANK[edge.effectiveConfidence] < CONFIDENCE_RANK[weakest]) {
      weakest = edge.effectiveConfidence;
    }
  }
  return weakest;
}

function makeEdge(
  key: string,
  sourceId: string,
  targetId: string,
  typeIndex: number,
  origin: RelationshipOrigin,
  confidence: Confidence,
): TraversalEdge {
  const type = TRACEABLE_RELATIONSHIP_TYPES[typeIndex % TRACEABLE_RELATIONSHIP_TYPES.length];
  if (type === undefined) {
    throw new Error('traversal invariant: empty traceable types');
  }
  return {
    key,
    type,
    fromEntityId: sourceId,
    toEntityId: targetId,
    sourceId,
    targetId,
    traversal: 'FORWARD',
    effectiveOrigin: origin,
    effectiveConfidence: confidence,
    nonSource: origin !== 'SOURCE',
    assertions: [],
  };
}

interface RandomGraph {
  startId: string;
  edges: TraversalEdge[];
}

function randomGraph(rand: () => number, graphIndex: number): RandomGraph {
  const entityCount = 2 + Math.floor(rand() * 8);
  const edgeCount = Math.floor(rand() * 21);
  const edges: TraversalEdge[] = [];
  for (let i = 0; i < edgeCount; i += 1) {
    const source = `e${Math.floor(rand() * entityCount)}`;
    const target = `e${Math.floor(rand() * entityCount)}`;
    const typeIndex = Math.floor(rand() * TRACEABLE_RELATIONSHIP_TYPES.length);
    const origin = ORIGINS[Math.floor(rand() * ORIGINS.length)] ?? 'SOURCE';
    const confidence = CONFIDENCES[Math.floor(rand() * CONFIDENCES.length)] ?? 'HIGH';
    edges.push(makeEdge(`k${graphIndex}-${i}`, source, target, typeIndex, origin, confidence));
  }
  return { startId: 'e0', edges };
}

function toInternalPath(entityIds: string[], edges: TraversalEdge[]): InternalPath {
  return {
    entityIds: [...entityIds],
    edges: [...edges],
    weakestConfidence: weakestOf(edges),
    nonSourceHops: edges.filter((edge) => edge.nonSource).length,
    continuesBeyondDepth: false,
    endsInCycle: false,
  };
}

/** Every simple path from the start, up to maxDepth hops, with no repeated entity. */
function bruteAllSimplePaths(
  startId: string,
  edges: readonly TraversalEdge[],
  maxDepth: number,
): InternalPath[] {
  const bySource = new Map<string, TraversalEdge[]>();
  for (const edge of edges) {
    const outgoing = bySource.get(edge.sourceId);
    if (outgoing === undefined) {
      bySource.set(edge.sourceId, [edge]);
    } else {
      outgoing.push(edge);
    }
  }
  const found: InternalPath[] = [];
  const entityIds: string[] = [startId];
  const hops: TraversalEdge[] = [];
  const onPath = new Set<string>([startId]);

  function dfs(): void {
    if (hops.length > 0) {
      found.push(toInternalPath(entityIds, hops));
    }
    if (hops.length === maxDepth) {
      return;
    }
    const current = entityIds.at(-1);
    if (current === undefined) {
      return;
    }
    for (const edge of bySource.get(current) ?? []) {
      if (onPath.has(edge.targetId)) {
        continue;
      }
      entityIds.push(edge.targetId);
      hops.push(edge);
      onPath.add(edge.targetId);
      dfs();
      onPath.delete(edge.targetId);
      hops.pop();
      entityIds.pop();
    }
  }

  dfs();
  return found;
}

/** Every maximal simple path, with the R6 end flags. */
function bruteMaximalPaths(
  startId: string,
  edges: readonly TraversalEdge[],
  maxDepth: number,
): InternalPath[] {
  const bySource = new Map<string, TraversalEdge[]>();
  for (const edge of edges) {
    const outgoing = bySource.get(edge.sourceId);
    if (outgoing === undefined) {
      bySource.set(edge.sourceId, [edge]);
    } else {
      outgoing.push(edge);
    }
  }
  const found: InternalPath[] = [];
  const entityIds: string[] = [startId];
  const hops: TraversalEdge[] = [];

  function dfs(): void {
    const current = entityIds.at(-1);
    if (current === undefined) {
      return;
    }
    const onPath = new Set(entityIds);
    const candidates: TraversalEdge[] = [];
    let skipped = 0;
    for (const edge of bySource.get(current) ?? []) {
      if (onPath.has(edge.targetId)) {
        skipped += 1;
      } else {
        candidates.push(edge);
      }
    }
    if (candidates.length === 0 || hops.length === maxDepth) {
      if (hops.length >= 1) {
        found.push({
          entityIds: [...entityIds],
          edges: [...hops],
          weakestConfidence: weakestOf(hops),
          nonSourceHops: hops.filter((hop) => hop.nonSource).length,
          continuesBeyondDepth: hops.length === maxDepth && candidates.length > 0,
          endsInCycle: candidates.length === 0 && skipped > 0,
        });
      }
      return;
    }
    for (const edge of candidates) {
      entityIds.push(edge.targetId);
      hops.push(edge);
      dfs();
      hops.pop();
      entityIds.pop();
    }
  }

  dfs();
  return found.sort(comparePaths);
}

function pathKey(path: InternalPath): string {
  return path.entityIds.join('>') + '|' + path.edges.map((edge) => edge.key).join(',');
}

describe('traversal property (SC-007)', () => {
  it('matches brute force on 1,000 deterministic random graphs', () => {
    const rand = mulberry32(0x1a2b3c4d);
    for (let g = 0; g < 1000; g += 1) {
      const { startId, edges } = randomGraph(rand, g);
      for (let depth = 1; depth <= 4; depth += 1) {
        // Canonical paths: first per target after sorting every simple path.
        const all = bruteAllSimplePaths(startId, edges, depth).sort(comparePaths);
        const expected = new Map<string, InternalPath>();
        for (const path of all) {
          const last = path.entityIds.at(-1);
          if (last === undefined || expected.has(last)) {
            continue;
          }
          expected.set(last, path);
        }
        const actual = selectCanonicalPaths(startId, edges, depth);
        expect([...actual.paths.keys()].sort()).toEqual([...expected.keys()].sort());
        for (const [target, want] of expected) {
          const got = actual.paths.get(target);
          expect(got).toBeDefined();
          expect(got?.entityIds).toEqual(want.entityIds);
          expect(got?.edges.map((edge) => edge.key)).toEqual(
            want.edges.map((edge) => edge.key),
          );
        }
        for (const path of actual.paths.values()) {
          expect(path.edges.length).toBeLessThanOrEqual(depth);
          expect(new Set(path.entityIds).size).toBe(path.entityIds.length);
        }

        // Blocking paths: every maximal simple path, in comparator order.
        const bruteBlocking = bruteMaximalPaths(startId, edges, depth);
        const actualBlocking = enumerateBlockingPaths(startId, edges, depth, 10_000);
        expect(actualBlocking.enumerationCapped).toBe(false);
        expect(actualBlocking.paths.map(pathKey)).toEqual(bruteBlocking.map(pathKey));
        for (const path of actualBlocking.paths) {
          expect(path.edges.length).toBeLessThanOrEqual(depth);
          expect(new Set(path.entityIds).size).toBe(path.entityIds.length);
        }
      }
    }
  }, 60_000);
});
