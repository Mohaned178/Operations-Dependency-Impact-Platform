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
import {
  CONFIDENCE_RANK,
  IMPACT_LIMITS,
  JsonValueSchema,
  RelationshipTypeSchema,
  SATISFIED_STATES,
  TERMINAL_STATES,
  TRACEABLE_RELATIONSHIP_TYPES,
  TRACING_LIMITS,
} from '@opsgraph/shared';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AttributionQuery,
  BlockerTrace,
  BlockerTraceQuery,
  CustomerAttribution,
  CycleClosingHop,
  DependencyTrace,
  DependencyTraceQuery,
  GraphEntityRef,
  GraphRepository,
  ImpactPathSet,
  ImpactReachedEntity,
  ImpactTrace,
  ImpactTraceQuery,
  IncomingRelationshipRow,
  NeighborPage,
  NeighborQuery,
  NeighborRow,
  NeighborhoodReached,
  NeighborhoodTrace,
  NeighborhoodTraceQuery,
  RelationshipGroup,
  TraversalPath,
} from './graph.repository';
import { enumerateBlockingPaths } from './traversal/blocking-paths';
import { selectCanonicalPaths } from './traversal/canonical-paths';
import { buildUndirectedTraversalEdges, groupEdgeRows } from './traversal/edge-groups';
import { computeImpactSelections, enumerateImpactPaths } from './traversal/impact-paths';
import { compareCodeUnits, comparePaths } from './traversal/path-order';
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
  type: RelationshipType;
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

interface RawAttributionEntityRow {
  id: string;
  type: EntityType;
  display_name: string;
  current_state: OperationalState;
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

function isTraceableType(type: RelationshipType): type is TraceableRelationshipType {
  return (TRACEABLE_RELATIONSHIP_TYPES as readonly RelationshipType[]).includes(type);
}

function isTraceableRow(row: EdgeRow<RelationshipType>): row is EdgeRow<TraceableRelationshipType> {
  return isTraceableType(row.type);
}

function toEdgeRow(row: RawEdgeRow): EdgeRow<RelationshipType> {
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

function weakestOf(edges: readonly TraversalEdge[]): Confidence {
  let weakest: Confidence = 'HIGH';
  for (const edge of edges) {
    if (CONFIDENCE_RANK[edge.effectiveConfidence] < CONFIDENCE_RANK[weakest]) {
      weakest = edge.effectiveConfidence;
    }
  }
  return weakest;
}

function linkPath(attributedId: string, edges: readonly TraversalEdge[]): InternalPath {
  return {
    entityIds: [attributedId, ...edges.map((edge) => edge.targetId)],
    edges: [...edges],
    weakestConfidence: weakestOf(edges),
    nonSourceHops: edges.filter((edge) => edge.nonSource).length,
    continuesBeyondDepth: false,
    endsInCycle: false,
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

  async findIncomingRelationships(
    entityIds: readonly string[],
    types: readonly RelationshipType[],
  ): Promise<IncomingRelationshipRow[]> {
    if (entityIds.length === 0 || types.length === 0) {
      return [];
    }

    const rows = await this.prisma.relationship.findMany({
      where: { toEntityId: { in: [...entityIds] }, type: { in: [...types] } },
      include: { from: true },
    });

    return rows
      .map(
        (row): IncomingRelationshipRow => ({
          relationship: {
            id: row.id,
            type: row.type,
            direction: 'IN',
            origin: row.origin,
            confidence: row.confidence,
            basis: row.basis,
            sourceSystem: row.sourceSystem,
            sourceId: row.sourceId,
            observedAt: row.observedAt,
            importId: row.importId,
          },
          targetEntityId: row.toEntityId,
          source: {
            id: row.from.id,
            type: row.from.type,
            displayName: row.from.displayName,
            currentState: row.from.currentState,
            attributes: z.record(JsonValueSchema).parse(row.from.attributes),
          },
        }),
      )
      .sort(
        (a, b) =>
          compareCodeUnits(a.targetEntityId, b.targetEntityId) ||
          compareCodeUnits(a.relationship.type, b.relationship.type) ||
          compareCodeUnits(a.source.displayName, b.source.displayName) ||
          compareCodeUnits(a.source.id, b.source.id) ||
          compareCodeUnits(a.relationship.id, b.relationship.id),
      );
  }

  async traceDependencies(query: DependencyTraceQuery): Promise<DependencyTrace | null> {
    const { followFromTypes, followToTypes } = walkTypes(query.direction, query.relationshipTypes);
    const reachable = await this.reachableEntities({
      startId: query.startId,
      maxDepth: query.maxDepth,
      followFromTypes,
      followToTypes,
      blockersOnly: false,
      probeBeyondDepth: true,
    });
    if (reachable === null) {
      return null;
    }

    const rows = await this.loadEdgeRows(reachable.entities.keys(), [
      ...followFromTypes,
      ...followToTypes,
    ]);
    const edges = buildTraversalEdges(rows.filter(isTraceableRow), query.direction);
    const selection = selectCanonicalPaths(reachable.start.id, edges, query.maxDepth);
    const cycleClosing = toCycleClosingHops(selection.cycleClosing);

    const reached = reachable.within.map((row) => {
      const internal = selection.paths.get(row.entity.id);
      if (internal === undefined) {
        throw new Error(
          `traversal invariant: no canonical path for reached entity ${row.entity.id}`,
        );
      }
      return {
        entity: row.entity,
        distance: row.depth,
        path: toTraversalPath(internal, reachable.entities),
      };
    });

    return {
      start: reachable.start,
      reached,
      depthLimitReached: reachable.beyondDepth,
      explorationLimitReached: reachable.explorationLimitReached,
      cycleClosingHops: cycleClosing.hops,
      cycleClosingHopCount: cycleClosing.total,
    };
  }

  async traceBlockers(query: BlockerTraceQuery): Promise<BlockerTrace | null> {
    const { followFromTypes, followToTypes } = walkTypes('UPSTREAM', query.relationshipTypes);
    const reachable = await this.reachableEntities({
      startId: query.startId,
      maxDepth: query.maxDepth,
      followFromTypes,
      followToTypes,
      blockersOnly: true,
      probeBeyondDepth: true,
    });
    if (reachable === null) {
      return null;
    }

    const rows = await this.loadEdgeRows(reachable.entities.keys(), [
      ...followFromTypes,
      ...followToTypes,
    ]);
    const edges = buildTraversalEdges(rows.filter(isTraceableRow), 'UPSTREAM');
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

  async traceNeighborhood(query: NeighborhoodTraceQuery): Promise<NeighborhoodTrace | null> {
    let followFromTypes: readonly RelationshipType[];
    let followToTypes: readonly RelationshipType[];
    if (query.walk === 'ALL') {
      followFromTypes = query.relationshipTypes;
      followToTypes = query.relationshipTypes;
    } else {
      const traceable = query.relationshipTypes.filter(isTraceableType);
      if (traceable.length !== query.relationshipTypes.length) {
        throw new Error(`traversal invariant: RELATES_TO cannot be walked ${query.walk}`);
      }
      ({ followFromTypes, followToTypes } = walkTypes(query.walk, traceable));
    }

    const reachable = await this.reachableEntities({
      startId: query.startId,
      maxDepth: query.maxDepth,
      followFromTypes,
      followToTypes,
      blockersOnly: false,
      probeBeyondDepth: false,
    });
    if (reachable === null) {
      return null;
    }

    const rows = await this.loadEdgeRows(reachable.entities.keys(), [
      ...new Set([...followFromTypes, ...followToTypes]),
    ]);
    const paths: ReadonlyMap<string, InternalPath<RelationshipType>> =
      query.walk === 'ALL'
        ? selectCanonicalPaths(
            reachable.start.id,
            buildUndirectedTraversalEdges(groupEdgeRows(rows)),
            query.maxDepth,
          ).paths
        : selectCanonicalPaths(
            reachable.start.id,
            buildTraversalEdges(rows.filter(isTraceableRow), query.walk),
            query.maxDepth,
          ).paths;

    const reached = reachable.within.map((row): NeighborhoodReached => {
      const path = paths.get(row.entity.id);
      if (path === undefined) {
        throw new Error(
          `traversal invariant: no canonical path for reached entity ${row.entity.id}`,
        );
      }
      return {
        entity: row.entity,
        distance: row.depth,
        pathEntityIds: path.entityIds,
        pathEdgeKeys: path.edges.map((edge) => edge.key),
        weakestConfidence: path.weakestConfidence,
        nonSourceHops: path.nonSourceHops,
      };
    });

    return {
      start: reachable.start,
      reached,
      explorationLimitReached: reachable.explorationLimitReached,
    };
  }

  async findRelationshipsAmong(
    entityIds: readonly string[],
    types: readonly RelationshipType[],
  ): Promise<RelationshipGroup[]> {
    if (entityIds.length === 0 || types.length === 0) {
      return [];
    }
    return groupEdgeRows(await this.loadEdgeRows(entityIds, types));
  }

  async traceImpact(query: ImpactTraceQuery): Promise<ImpactTrace | null> {
    const reachable = await this.impactReachable(query.startId, query.maxDepth);
    if (reachable === null) {
      return null;
    }

    const rows = await this.loadEdgeRows(reachable.entities.keys(), TRACEABLE_RELATIONSHIP_TYPES);
    const edges = buildTraversalEdges(rows.filter(isTraceableRow), 'DOWNSTREAM');

    const stateById = new Map<string, OperationalState>();
    for (const entity of reachable.entities.values()) {
      stateById.set(entity.id, entity.currentState);
    }
    // Entities that were only probed one step past maxDepth carry that distance (data-model 3c).
    const distanceById = new Map<string, number>();
    for (const id of reachable.entities.keys()) {
      distanceById.set(id, query.maxDepth + 1);
    }
    distanceById.set(reachable.start.id, 0);
    for (const row of reachable.within) {
      distanceById.set(row.entity.id, row.depth);
    }

    const selection = computeImpactSelections(
      reachable.start.id,
      edges,
      stateById,
      distanceById,
      query.maxDepth,
    );
    const cycleClosing = toCycleClosingHops(selection.cycleClosing);

    const reached = reachable.within.map((row): ImpactReachedEntity => {
      const canonical = selection.canonical.get(row.entity.id);
      const shortest = selection.shortest.get(row.entity.id);
      if (canonical === undefined || shortest === undefined) {
        throw new Error(
          `traversal invariant: no canonical or shortest path for reached entity ${row.entity.id}`,
        );
      }
      const live = selection.live.get(row.entity.id);
      return {
        entity: row.entity,
        distance: row.depth,
        canonicalPath: toTraversalPath(canonical, reachable.entities),
        livePath: live === undefined ? null : toTraversalPath(live, reachable.entities),
        shortestPath: toTraversalPath(shortest, reachable.entities),
        sourcedReach: selection.sourced.has(row.entity.id),
      };
    });

    return {
      start: reachable.start,
      reached,
      depthLimitReached: reachable.beyondDepth,
      explorationLimitReached: reachable.explorationLimitReached,
      cycleClosingHops: cycleClosing.hops,
      cycleClosingHopCount: cycleClosing.total,
      paths: (targetIds) => {
        const enumerated = enumerateImpactPaths(
          reachable.start.id,
          selection.filteredEdges,
          distanceById,
          targetIds,
          query.maxDepth,
          IMPACT_LIMITS.maxEnumeratedPaths,
          IMPACT_LIMITS.pathSearchBudget,
        );
        const result = new Map<string, ImpactPathSet>();
        for (const [id, set] of enumerated) {
          result.set(id, {
            found: set.found.map((path) => toTraversalPath(path, reachable.entities)),
            morePaths: set.morePaths,
          });
        }
        return result;
      },
    };
  }

  async findAttributedCustomers(query: AttributionQuery): Promise<CustomerAttribution[]> {
    if (query.orderIds.length === 0 && query.slaIds.length === 0) {
      return [];
    }
    const orderIds = [...query.orderIds];
    const slaIds = [...query.slaIds];

    const raw = await this.prisma.$queryRaw<RawEdgeRow[]>`
      SELECT r.id::text AS id, r.type::text AS type, r.from_entity_id::text AS from_entity_id,
             r.to_entity_id::text AS to_entity_id, r.origin::text AS origin,
             r.confidence::text AS confidence, r.basis AS basis, r.source_system AS source_system,
             r.source_id AS source_id, r.observed_at AS observed_at, r.import_id::text AS import_id
      FROM relationships r
      WHERE r.type = 'PLACED' AND r.to_entity_id = ANY(${orderIds}::uuid[])
      UNION ALL
      SELECT d.id::text, d.type::text, d.from_entity_id::text, d.to_entity_id::text,
             d.origin::text, d.confidence::text, d.basis, d.source_system, d.source_id,
             d.observed_at, d.import_id::text
      FROM relationships d
      WHERE d.type = 'DEFINES' AND d.to_entity_id = ANY(${slaIds}::uuid[])
      UNION ALL
      SELECT h.id::text, h.type::text, h.from_entity_id::text, h.to_entity_id::text,
             h.origin::text, h.confidence::text, h.basis, h.source_system, h.source_id,
             h.observed_at, h.import_id::text
      FROM relationships d
      JOIN relationships h ON h.type = 'HAS' AND h.to_entity_id = d.from_entity_id
      WHERE d.type = 'DEFINES' AND d.to_entity_id = ANY(${slaIds}::uuid[])`;

    // A contract that defines several of the requested SLAs returns its HAS rows once per SLA.
    const unique = new Map<string, RawEdgeRow>();
    for (const row of raw) {
      unique.set(row.id, row);
    }
    const edges = buildTraversalEdges(
      [...unique.values()].map(toEdgeRow).filter(isTraceableRow),
      'UPSTREAM',
    );
    const placedByOrder = new Map<string, TraversalEdge[]>();
    const definesBySla = new Map<string, TraversalEdge[]>();
    const hasByContract = new Map<string, TraversalEdge[]>();
    const push = (map: Map<string, TraversalEdge[]>, edge: TraversalEdge): void => {
      const list = map.get(edge.sourceId);
      if (list === undefined) {
        map.set(edge.sourceId, [edge]);
      } else {
        list.push(edge);
      }
    };
    for (const edge of edges) {
      if (edge.type === 'PLACED') {
        push(placedByOrder, edge);
      } else if (edge.type === 'DEFINES') {
        push(definesBySla, edge);
      } else if (edge.type === 'HAS') {
        push(hasByContract, edge);
      }
    }

    const best = new Map<string, InternalPath>();
    const keep = (link: InternalPath): void => {
      const attributedId = link.entityIds.at(0);
      const customerId = link.entityIds.at(-1);
      if (attributedId === undefined || customerId === undefined) {
        throw new Error('traversal invariant: empty attribution link');
      }
      const pairKey = JSON.stringify([attributedId, customerId]);
      const existing = best.get(pairKey);
      if (existing === undefined || comparePaths(link, existing) < 0) {
        best.set(pairKey, link);
      }
    };
    for (const orderId of orderIds) {
      for (const placed of placedByOrder.get(orderId) ?? []) {
        keep(linkPath(orderId, [placed]));
      }
    }
    for (const slaId of slaIds) {
      for (const defines of definesBySla.get(slaId) ?? []) {
        for (const has of hasByContract.get(defines.targetId) ?? []) {
          keep(linkPath(slaId, [defines, has]));
        }
      }
    }
    if (best.size === 0) {
      return [];
    }

    const linkedIds = new Set<string>();
    for (const link of best.values()) {
      for (const id of link.entityIds.slice(1)) {
        linkedIds.add(id);
      }
    }
    const entityRows = await this.prisma.$queryRaw<RawAttributionEntityRow[]>`
      SELECT id::text AS id, type::text AS type, display_name, current_state::text AS current_state
      FROM entities
      WHERE id = ANY(${[...linkedIds]}::uuid[])`;
    const entities = new Map<string, GraphEntityRef>(
      entityRows.map((row) => [
        row.id,
        {
          id: row.id,
          type: row.type,
          displayName: row.display_name,
          currentState: row.current_state,
        },
      ]),
    );

    return [...best.values()]
      .map((link): CustomerAttribution => {
        const attributedEntityId = link.entityIds.at(0);
        const customerId = link.entityIds.at(-1);
        const customer = customerId === undefined ? undefined : entities.get(customerId);
        if (attributedEntityId === undefined || customer === undefined) {
          throw new Error('traversal invariant: attributed customer was not loaded');
        }
        return { attributedEntityId, customer, link: toTraversalPath(link, entities) };
      })
      .sort(
        (a, b) =>
          compareCodeUnits(a.attributedEntityId, b.attributedEntityId) ||
          compareCodeUnits(a.customer.id, b.customer.id),
      );
  }

  /**
   * Research R2: like reachableEntities, but a terminal entity (COMPLETED or CANCELLED) is kept in
   * the result and never expanded. The start row is always expandable. The post-processing is a
   * copy of reachableEntities on purpose (the 003 query stays untouched).
   */
  private async impactReachable(startId: string, maxDepth: number): Promise<ReachableSet | null> {
    const { followFromTypes, followToTypes } = walkTypes(
      'DOWNSTREAM',
      TRACEABLE_RELATIONSHIP_TYPES,
    );
    const terminalStates = [...TERMINAL_STATES];
    const maxDepthPlusOne = maxDepth + 1;

    const rows = await this.prisma.$queryRaw<RawReachedRow[]>`
      WITH RECURSIVE walk(entity_id, depth, expandable) AS (
        SELECT ${startId}::uuid, 0, true
        UNION
        SELECT step.next_id, w.depth + 1,
               (n.current_state <> ALL(${terminalStates}::"OperationalState"[]))
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
        JOIN entities n ON n.id = step.next_id
        WHERE w.depth < ${maxDepthPlusOne}
          AND w.expandable
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
    const within = others.filter((row) => row.depth <= maxDepth).sort(compareReached);
    // A terminal entity past the depth is never counted, so it alone does not hit the depth limit.
    const beyondDepth = others.some(
      (row) =>
        row.depth === maxDepthPlusOne && !TERMINAL_STATES.includes(row.entity.currentState),
    );
    const explorationLimitReached = within.length > TRACING_LIMITS.maxReachedEntities;
    const kept = explorationLimitReached
      ? within.slice(0, TRACING_LIMITS.maxReachedEntities)
      : within;

    const connected = explorationLimitReached ? kept : others;
    const entities = new Map<string, GraphEntityRef>([[start.entity.id, start.entity]]);
    for (const row of connected) {
      entities.set(row.entity.id, row.entity);
    }

    return { start: start.entity, within: kept, beyondDepth, explorationLimitReached, entities };
  }

  /**
   * Research R3 step 1: the entities reachable within maxDepth hops (maxDepth + 1 when
   * probeBeyondDepth is set), each at its minimum depth. Returns null when the start entity does not exist. Blocker walks only pass through
   * entities whose state is not satisfied. This is the only traversal SQL in the code base.
   */
  private async reachableEntities(options: {
    startId: string;
    maxDepth: number;
    followFromTypes: readonly RelationshipType[];
    followToTypes: readonly RelationshipType[];
    blockersOnly: boolean;
    /** Also walk one hop past maxDepth, so callers can tell whether a chain continues. */
    probeBeyondDepth: boolean;
  }): Promise<ReachableSet | null> {
    const followFromTypes = [...options.followFromTypes];
    const followToTypes = [...options.followToTypes];
    const satisfiedStates = [...SATISFIED_STATES];
    const maxDepthPlusOne = options.maxDepth + 1;
    const sqlDepthBound = options.probeBeyondDepth ? maxDepthPlusOne : options.maxDepth;
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
        WHERE w.depth < ${sqlDepthBound}
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
    allowedTypes: readonly RelationshipType[],
  ): Promise<EdgeRow<RelationshipType>[]> {
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
