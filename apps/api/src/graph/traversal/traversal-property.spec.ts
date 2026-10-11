import {
  CONFIDENCE_RANK,
  RelationshipTypeSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  type Confidence,
  type RelationshipOrigin,
  type RelationshipType,
} from '@opsgraph/shared';
import { enumerateBlockingPaths } from './blocking-paths';
import { selectCanonicalPaths } from './canonical-paths';
import { buildUndirectedTraversalEdges, groupEdgeRows } from './edge-groups';
import { comparePaths } from './path-order';
import type { EdgeRow, InternalPath, TraversalEdge } from './types';

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

function randomRows(
  rand: () => number,
  graphIndex: number,
  entityCount: number,
): EdgeRow<RelationshipType>[] {
  const rowCount = Math.floor(rand() * 25);
  const rows: EdgeRow<RelationshipType>[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    rows.push({
      id: `r${graphIndex}-${i}`,
      type:
        RelationshipTypeSchema.options[
          Math.floor(rand() * RelationshipTypeSchema.options.length)
        ] ?? 'RELATES_TO',
      fromEntityId: `e${Math.floor(rand() * entityCount)}`,
      toEntityId: `e${Math.floor(rand() * entityCount)}`,
      origin: ORIGINS[Math.floor(rand() * ORIGINS.length)] ?? 'SOURCE',
      confidence: CONFIDENCES[Math.floor(rand() * CONFIDENCES.length)] ?? 'HIGH',
      basis: null,
      sourceSystem: 'SYS',
      sourceId: `SRC-${graphIndex}-${i}`,
      observedAt: new Date('2026-09-01T00:00:00.000Z'),
      importId: 'import-1',
    });
  }
  return rows;
}

/** Independent oracle: undirected BFS distances from the start, up to maxDepth. */
function bfsDistances(
  startId: string,
  rows: readonly EdgeRow<RelationshipType>[],
  maxDepth: number,
): Map<string, number> {
  const neighbors = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    const set = neighbors.get(a);
    if (set === undefined) {
      neighbors.set(a, new Set([b]));
    } else {
      set.add(b);
    }
  };
  for (const row of rows) {
    link(row.fromEntityId, row.toEntityId);
    link(row.toEntityId, row.fromEntityId);
  }
  const distance = new Map<string, number>([[startId, 0]]);
  let frontier = [startId];
  for (let d = 1; d <= maxDepth; d += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbor of neighbors.get(current) ?? []) {
        if (!distance.has(neighbor)) {
          distance.set(neighbor, d);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return distance;
}

describe('traversal property: ALL walk (feature 004)', () => {
  it('terminates, never repeats an entity and agrees with an undirected BFS on 1,000 graphs', () => {
    const rand = mulberry32(0x5eed0004);
    for (let g = 0; g < 1000; g += 1) {
      const entityCount = 2 + Math.floor(rand() * 8);
      const rows = randomRows(rand, g, entityCount);
      const maxDepth = 1 + Math.floor(rand() * 4);
      const startId = `e${Math.floor(rand() * entityCount)}`;

      const edges = buildUndirectedTraversalEdges(groupEdgeRows(rows));
      const { paths } = selectCanonicalPaths(startId, edges, maxDepth);

      const oracle = bfsDistances(startId, rows, maxDepth);
      const expectedReached = [...oracle.keys()].filter((id) => id !== startId).sort();
      expect([...paths.keys()].sort()).toEqual(expectedReached);

      for (const [entityId, path] of paths) {
        expect(path.entityIds[0]).toBe(startId);
        expect(path.entityIds.at(-1)).toBe(entityId);
        expect(new Set(path.entityIds).size).toBe(path.entityIds.length);
        expect(path.edges.length).toBe(path.entityIds.length - 1);
        expect(path.edges.length).toBeLessThanOrEqual(maxDepth);
        expect(path.edges.length).toBeGreaterThanOrEqual(oracle.get(entityId) ?? Infinity);
        path.edges.forEach((edge, index) => {
          expect(edge.sourceId).toBe(path.entityIds[index]);
          expect(edge.targetId).toBe(path.entityIds[index + 1]);
        });
      }
    }
  }, 60_000);
});
