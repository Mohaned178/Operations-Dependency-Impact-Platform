import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type {
  Confidence,
  EntityType,
  OperationalState,
  RelationshipOrigin,
  RelationshipType,
  TraceableRelationshipType,
} from '@opsgraph/shared';
import { RelationshipTypeSchema, SATISFIED_STATES, TRACING_LIMITS } from '@opsgraph/shared';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BlockerTrace,
  BlockerTraceQuery,
  CycleClosingHop,
  DependencyTrace,
  GraphEntityRef,
  GraphRepository,
  NeighborPage,
  NeighborQuery,
  NeighborRow,
  TraversalPath,
} from './graph.repository';
import { enumerateBlockingPaths } from './traversal/blocking-paths';
import { compareCodeUnits } from './traversal/path-order';
import { buildTraversalEdges } from './traversal/traversal-edges';
import type { EdgeRow, InternalPath, TraversalEdge } from './traversal/types';
import { walkTypes } from './traversal/walk-types';

const NeighborCursorSchema = z.object({
  relType: RelationshipTypeSchema,
  direction: z.enum(['OUT', 'IN']),
  neighborDisplayName: z.string(),
  relationshipId: z.string().uuid(),
});
type NeighborCursor = z.infer<typeof NeighborCursorSchema>;

interface RawNeighborRow {
  relationship_id: string;
  rel_type_text: RelationshipType;
  direction: 'OUT' | 'IN';
  origin: NeighborRow['relationship']['origin'];
  confidence: Confidence;
  basis: string | null;
  source_system: string;
  source_id: string;
  observed_at: Date;
  import_id: string;
  neighbor_id: string;
  neighbor_type: EntityType;
  neighbor_display_name: string;
  neighbor_current_state: OperationalState;
}

interface RawReachedRow {
  id: string;
  type: EntityType;
  display_name: string;
  current_state: OperationalState;
  depth: number;
}

interface RawEdgeRow {
  id: string;
  type: TraceableRelationshipType;
  from_entity_id: string;
  to_entity_id: string;
  origin: RelationshipOrigin;
  confidence: Confidence;
  basis: string | null;
  source_system: string;
  source_id: string;
  observed_at: Date;
  import_id: string;
}

interface ReachedEntityRow {
  entity: GraphEntityRef;
  depth: number;
}

interface ReachableSet {
  start: GraphEntityRef;
  /** Non-start entities with depth <= maxDepth, sorted by (depth, type, displayName, id). */
  within: ReachedEntityRow[];
  /** Whether any entity sits exactly at maxDepth + 1 (it exists only to detect a depth cut). */
  beyondDepth: boolean;
  explorationLimitReached: boolean;
  /** The start entity plus every entity the edge query may connect (research R8). */
  entities: Map<string, GraphEntityRef>;
}

function compareReached(a: ReachedEntityRow, b: ReachedEntityRow): number {
  return (
    a.depth - b.depth ||
    compareCodeUnits(a.entity.type, b.entity.type) ||
    compareCodeUnits(a.entity.displayName, b.entity.displayName) ||
    compareCodeUnits(a.entity.id, b.entity.id)
  );
}

function toEdgeRow(row: RawEdgeRow): EdgeRow {
  return {
    id: row.id,
    type: row.type,
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    origin: row.origin,
    confidence: row.confidence,
    basis: row.basis,
    sourceSystem: row.source_system,
    sourceId: row.source_id,
    observedAt: row.observed_at,
    importId: row.import_id,
  };
}

function toTraversalPath(
  path: InternalPath,
  entities: ReadonlyMap<string, GraphEntityRef>,
): TraversalPath {
  return {
    hops: path.edges.map((edge) => {
      const target = entities.get(edge.targetId);
      if (target === undefined) {
        throw new Error(`traversal invariant: hop target ${edge.targetId} was not loaded`);
      }
      return {
        key: edge.key,
        relationshipType: edge.type,
        fromEntityId: edge.fromEntityId,
        toEntityId: edge.toEntityId,
        traversal: edge.traversal,
        effectiveOrigin: edge.effectiveOrigin,
        effectiveConfidence: edge.effectiveConfidence,
        assertions: edge.assertions,
        target,
      };
    }),
    weakestConfidence: path.weakestConfidence,
    nonSourceHops: path.nonSourceHops,
    continuesBeyondDepth: path.continuesBeyondDepth,
    endsInCycle: path.endsInCycle,
  };
}

/** Sorted by the recorded (from, type, to) and capped; also returns the uncapped total. */
function toCycleClosingHops(edges: readonly TraversalEdge[]): {
  hops: CycleClosingHop[];
  total: number;
} {
  const sorted = [...edges].sort(
    (a, b) =>
      compareCodeUnits(a.fromEntityId, b.fromEntityId) ||
      compareCodeUnits(a.type, b.type) ||
      compareCodeUnits(a.toEntityId, b.toEntityId),
  );
  return {
    hops: sorted.slice(0, TRACING_LIMITS.maxCycleClosingHops).map((edge) => ({
      key: edge.key,
      relationshipType: edge.type,
      fromEntityId: edge.fromEntityId,
      toEntityId: edge.toEntityId,
      relationshipIds: edge.assertions
        .map((assertion) => assertion.relationshipId)
        .sort(compareCodeUnits),
    })),
    total: sorted.length,
  };
}

const NEIGHBOR_COLUMNS = Prisma.sql`
  r.id::text AS relationship_id,
  r.type::text AS rel_type_text,
  r.origin::text AS origin,
  r.confidence::text AS confidence,
  r.basis AS basis,
  r.source_system AS source_system,
  r.source_id AS source_id,
  r.observed_at AS observed_at,
  r.import_id::text AS import_id,
  e.id::text AS neighbor_id,
  e.type::text AS neighbor_type,
  e.display_name AS neighbor_display_name,
  e.current_state::text AS neighbor_current_state`;

@Injectable()
export class PrismaGraphRepository implements GraphRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findNeighbors(query: NeighborQuery): Promise<NeighborPage> {
    const cursor =
      query.cursor === undefined ? null : decodeCursor(NeighborCursorSchema, query.cursor);

    const relationshipTypes = [...(query.relationshipTypes ?? [])];
    const neighborTypes = [...(query.neighborTypes ?? [])];
    const relTypeFilter =
      relationshipTypes.length > 0
        ? Prisma.sql`AND r.type::text = ANY(${relationshipTypes}::text[])`
        : Prisma.empty;
    const neighborTypeFilter =
      neighborTypes.length > 0
        ? Prisma.sql`AND e.type::text = ANY(${neighborTypes}::text[])`
        : Prisma.empty;

    const outPart = Prisma.sql`
      SELECT ${NEIGHBOR_COLUMNS}, 'OUT'::text AS direction
      FROM relationships r
      JOIN entities e ON e.id = r.to_entity_id
      WHERE r.from_entity_id = ${query.entityId}::uuid
        ${relTypeFilter}
        ${neighborTypeFilter}`;
    const inPart = Prisma.sql`
      SELECT ${NEIGHBOR_COLUMNS}, 'IN'::text AS direction
      FROM relationships r
      JOIN entities e ON e.id = r.from_entity_id
      WHERE r.to_entity_id = ${query.entityId}::uuid
        ${relTypeFilter}
        ${neighborTypeFilter}`;

    const parts =
      query.direction === 'OUT'
        ? [outPart]
        : query.direction === 'IN'
          ? [inPart]
          : [outPart, inPart];

    const cursorFilter =
      cursor === null
        ? Prisma.empty
        : Prisma.sql`WHERE (rel_type_text, direction, neighbor_display_name, relationship_id)
            > (${cursor.relType}::text, ${cursor.direction}::text, ${cursor.neighborDisplayName}::text, ${cursor.relationshipId}::text)`;

    const rows = await this.prisma.$queryRaw<RawNeighborRow[]>`
      SELECT * FROM (${Prisma.join(parts, ' UNION ALL ')}) AS neighbors
      ${cursorFilter}
      ORDER BY rel_type_text, direction, neighbor_display_name, relationship_id
      LIMIT ${query.limit + 1}`;

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);

    return {
      items: pageRows.map((row) => ({
        relationship: {
          id: row.relationship_id,
          type: row.rel_type_text,
          direction: row.direction,
          origin: row.origin,
          confidence: row.confidence,
          basis: row.basis,
          sourceSystem: row.source_system,
          sourceId: row.source_id,
          observedAt: row.observed_at,
          importId: row.import_id,
        },
        neighbor: {
          id: row.neighbor_id,
          type: row.neighbor_type,
          displayName: row.neighbor_display_name,
          currentState: row.neighbor_current_state,
        },
      })),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({
              relType: last.rel_type_text,
              direction: last.direction,
              neighborDisplayName: last.neighbor_display_name,
              relationshipId: last.relationship_id,
            } satisfies NeighborCursor)
          : null,
    };
  }

  async countNeighbors(entityId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM relationships
      WHERE from_entity_id = ${entityId}::uuid OR to_entity_id = ${entityId}::uuid`;
    return Number(rows[0]?.count ?? 0n);
  }

  traceDependencies(): Promise<DependencyTrace | null> {
    return Promise.reject(new Error('not implemented'));
  }

  async traceBlockers(query: BlockerTraceQuery): Promise<BlockerTrace | null> {
    const { followFromTypes, followToTypes } = walkTypes('UPSTREAM', query.relationshipTypes);
    const reachable = await this.reachableEntities({
      startId: query.startId,
      maxDepth: query.maxDepth,
      followFromTypes,
      followToTypes,
      blockersOnly: true,
    });
    if (reachable === null) {
      return null;
    }

    const rows = await this.loadEdgeRows(reachable.entities.keys(), [
      ...followFromTypes,
      ...followToTypes,
    ]);
    const edges = buildTraversalEdges(rows, 'UPSTREAM');
    const enumeration = enumerateBlockingPaths(
      reachable.start.id,
      edges,
      query.maxDepth,
      TRACING_LIMITS.maxEnumeratedPaths,
    );
    const cycleClosing = toCycleClosingHops(enumeration.cycleClosing);

    return {
      start: reachable.start,
      paths: enumeration.paths.map((path) => toTraversalPath(path, reachable.entities)),
      enumerationCapped: enumeration.enumerationCapped,
      explorationLimitReached: reachable.explorationLimitReached,
      cycleClosingHops: cycleClosing.hops,
      cycleClosingHopCount: cycleClosing.total,
    };
  }

  /**
   * Research R3 step 1: the entities reachable within maxDepth + 1 hops, each at its minimum
   * depth. Returns null when the start entity does not exist. Blocker walks only pass through
   * entities whose state is not satisfied. This is the only traversal SQL in the code base.
   */
  private async reachableEntities(options: {
    startId: string;
    maxDepth: number;
    followFromTypes: readonly TraceableRelationshipType[];
    followToTypes: readonly TraceableRelationshipType[];
    blockersOnly: boolean;
  }): Promise<ReachableSet | null> {
    const followFromTypes = [...options.followFromTypes];
    const followToTypes = [...options.followToTypes];
    const satisfiedStates = [...SATISFIED_STATES];
    const maxDepthPlusOne = options.maxDepth + 1;
    const blockerJoin = options.blockersOnly
      ? Prisma.sql`JOIN entities n ON n.id = step.next_id`
      : Prisma.empty;
    const blockerFilter = options.blockersOnly
      ? Prisma.sql`AND n.current_state <> ALL(${satisfiedStates}::"OperationalState"[])`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RawReachedRow[]>`
      WITH RECURSIVE walk(entity_id, depth) AS (
        SELECT ${options.startId}::uuid, 0
        UNION
        SELECT step.next_id, w.depth + 1
        FROM walk w
        CROSS JOIN LATERAL (
          SELECT r.to_entity_id AS next_id
          FROM relationships r
          WHERE r.from_entity_id = w.entity_id
            AND r.type = ANY(${followFromTypes}::"RelationshipType"[])
          UNION ALL
          SELECT r.from_entity_id AS next_id
          FROM relationships r
          WHERE r.to_entity_id = w.entity_id
            AND r.type = ANY(${followToTypes}::"RelationshipType"[])
        ) step
        ${blockerJoin}
        WHERE w.depth < ${maxDepthPlusOne}
          ${blockerFilter}
      )
      SELECT e.id::text AS id, e.type::text AS type, e.display_name AS display_name,
             e.current_state::text AS current_state, m.depth AS depth
      FROM (SELECT entity_id, min(depth)::int AS depth FROM walk GROUP BY entity_id) m
      JOIN entities e ON e.id = m.entity_id`;

    const reached: ReachedEntityRow[] = rows.map((row) => ({
      entity: {
        id: row.id,
        type: row.type,
        displayName: row.display_name,
        currentState: row.current_state,
      },
      depth: row.depth,
    }));

    const start = reached.find((row) => row.depth === 0);
    if (start === undefined) {
      return null;
    }

    const others = reached.filter((row) => row.depth > 0);
    const within = others.filter((row) => row.depth <= options.maxDepth).sort(compareReached);
    const beyondDepth = others.some((row) => row.depth === maxDepthPlusOne);
    const explorationLimitReached = within.length > TRACING_LIMITS.maxReachedEntities;
    const kept = explorationLimitReached
      ? within.slice(0, TRACING_LIMITS.maxReachedEntities)
      : within;

    // Entities at maxDepth + 1 only take part when nothing was cut: they let the path search
    // see that a chain continues. They are never returned as results.
    const connected = explorationLimitReached ? kept : others;
    const entities = new Map<string, GraphEntityRef>([[start.entity.id, start.entity]]);
    for (const row of connected) {
      entities.set(row.entity.id, row.entity);
    }

    return { start: start.entity, within: kept, beyondDepth, explorationLimitReached, entities };
  }

  /** Research R3 step 2: every relationship assertion among the given entities. */
  private async loadEdgeRows(
    entityIds: Iterable<string>,
    allowedTypes: readonly TraceableRelationshipType[],
  ): Promise<EdgeRow[]> {
    const ids = [...entityIds];
    const types = [...allowedTypes];
    const rows = await this.prisma.$queryRaw<RawEdgeRow[]>`
      SELECT r.id::text AS id, r.type::text AS type,
             r.from_entity_id::text AS from_entity_id, r.to_entity_id::text AS to_entity_id,
             r.origin::text AS origin, r.confidence::text AS confidence, r.basis AS basis,
             r.source_system AS source_system, r.source_id AS source_id,
             r.observed_at AS observed_at, r.import_id::text AS import_id
      FROM relationships r
      WHERE r.from_entity_id = ANY(${ids}::uuid[])
        AND r.to_entity_id = ANY(${ids}::uuid[])
        AND r.type = ANY(${types}::"RelationshipType"[])`;
    return rows.map(toEdgeRow);
  }
}
