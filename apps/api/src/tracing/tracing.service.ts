import { Inject, Injectable } from '@nestjs/common';
import {
  BLOCKER_RELATIONSHIP_TYPES,
  EntityTypeSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  TRACING_LIMITS,
  type BlockerDto,
  type BlockersQuery,
  type BlockersResponse,
  type DependenciesQuery,
  type DependenciesResponse,
} from '@opsgraph/shared';
import { z } from 'zod';
import { Errors } from '../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import {
  GRAPH_REPOSITORY,
  type GraphRepository,
  type ReachedEntity,
  type TraversalPath,
} from '../graph/graph.repository';
import { compareCodeUnits } from '../graph/traversal/path-order';
import { explainBlockingPath, summarizeBlockers } from './explanation';
import { StateEvidenceReader } from './state-evidence.reader';
import {
  collectEntityIds,
  evidenceFor,
  toCycleClosingHopDto,
  toPathDto,
  toTracedEntityDto,
  type EvidenceMap,
} from './tracing.mapper';

/**
 * Direct blockers are the distinct first-hop entities and deepest blockers the distinct last
 * entities of the given paths, each placed by the first (highest-ranked) path it appears in
 * (research R6).
 */
function blockerLists(
  paths: readonly TraversalPath[],
  evidenceMap: EvidenceMap,
): { direct: BlockerDto[]; deepest: BlockerDto[] } {
  const direct = new Map<string, BlockerDto>();
  const deepest = new Map<string, BlockerDto>();

  for (const path of paths) {
    const first = path.hops.at(0);
    const last = path.hops.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error('tracing invariant: blocking path without hops');
    }

    if (!direct.has(first.target.id)) {
      direct.set(first.target.id, {
        entity: toTracedEntityDto(first.target, evidenceFor(evidenceMap, first.target.id)),
        pathLength: 1,
        possible: first.target.currentState === 'UNKNOWN',
        continuesBeyondDepth: false,
        inCycle: false,
      });
    }
    if (!deepest.has(last.target.id)) {
      deepest.set(last.target.id, {
        entity: toTracedEntityDto(last.target, evidenceFor(evidenceMap, last.target.id)),
        pathLength: path.hops.length,
        possible: last.target.currentState === 'UNKNOWN',
        continuesBeyondDepth: path.continuesBeyondDepth,
        inCycle: path.endsInCycle,
      });
    }
  }

  return { direct: [...direct.values()], deepest: [...deepest.values()] };
}

const DependencyCursorSchema = z.object({
  distance: z.number().int(),
  type: EntityTypeSchema,
  displayName: z.string(),
  id: z.string().uuid(),
});
type DependencyCursor = z.infer<typeof DependencyCursorSchema>;

/** Research R7 order for reached entities: (distance, type, displayName, id). */
function compareReachedToCursor(a: ReachedEntity, b: DependencyCursor): number {
  return (
    Math.sign(a.distance - b.distance) ||
    compareCodeUnits(a.entity.type, b.type) ||
    compareCodeUnits(a.entity.displayName, b.displayName) ||
    compareCodeUnits(a.entity.id, b.id)
  );
}

@Injectable()
export class TracingService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graph: GraphRepository,
    private readonly evidence: StateEvidenceReader,
  ) {}

  async blockers(id: string, query: BlockersQuery): Promise<BlockersResponse> {
    const computedAt = new Date().toISOString();
    const relationshipTypes =
      query.relationshipTypes.length > 0 ? query.relationshipTypes : [...BLOCKER_RELATIONSHIP_TYPES];

    const trace = await this.graph.traceBlockers({
      startId: id,
      maxDepth: query.depth,
      relationshipTypes,
    });
    if (trace === null) {
      throw Errors.notFound('Entity');
    }

    const kept =
      query.entityTypes.length === 0
        ? trace.paths
        : trace.paths.filter((path) =>
            path.hops.some((hop) => query.entityTypes.includes(hop.target.type)),
          );
    const top = kept.slice(0, TRACING_LIMITS.maxBlockingPaths);

    const evidenceMap = await this.evidence.load(collectEntityIds(top, trace.start.id));
    const start = toTracedEntityDto(trace.start, evidenceFor(evidenceMap, trace.start.id));

    const paths = top.map((path) => {
      const dto = toPathDto(path, evidenceMap);
      return { ...dto, endsInCycle: path.endsInCycle, explanation: explainBlockingPath(start, dto) };
    });
    const lists = blockerLists(top, evidenceMap);

    return {
      query: {
        entityId: id,
        kind: 'blockers',
        depth: query.depth,
        relationshipTypes,
        entityTypes: query.entityTypes,
      },
      computedAt,
      start,
      truncation: {
        depthLimit: kept.some((path) => path.continuesBeyondDepth),
        explorationLimit: trace.explorationLimitReached,
        pathLimit: trace.enumerationCapped || kept.length > TRACING_LIMITS.maxBlockingPaths,
      },
      summary: summarizeBlockers(start, lists.deepest, query.depth),
      totalPaths: kept.length,
      paths,
      directBlockers: lists.direct,
      deepestBlockers: lists.deepest,
      cycleClosingHops: trace.cycleClosingHops.map(toCycleClosingHopDto),
      cycleClosingHopCount: trace.cycleClosingHopCount,
    };
  }

  async dependencies(id: string, query: DependenciesQuery): Promise<DependenciesResponse> {
    const computedAt = new Date().toISOString();
    const relationshipTypes =
      query.relationshipTypes.length > 0
        ? query.relationshipTypes
        : [...TRACEABLE_RELATIONSHIP_TYPES];

    const trace = await this.graph.traceDependencies({
      startId: id,
      direction: query.direction === 'upstream' ? 'UPSTREAM' : 'DOWNSTREAM',
      maxDepth: query.depth,
      relationshipTypes,
    });
    if (trace === null) {
      throw Errors.notFound('Entity');
    }

    const filtered =
      query.entityTypes.length === 0
        ? trace.reached
        : trace.reached.filter((row) => query.entityTypes.includes(row.entity.type));

    let startIndex = 0;
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(DependencyCursorSchema, query.cursor);
      startIndex = filtered.findIndex((row) => compareReachedToCursor(row, cursor) > 0);
      if (startIndex === -1) {
        startIndex = filtered.length;
      }
    }
    const page = filtered.slice(startIndex, startIndex + query.limit);
    const hasMore = startIndex + query.limit < filtered.length;
    const last = page.at(-1);
    const nextCursor =
      hasMore && last !== undefined
        ? encodeCursor({
            distance: last.distance,
            type: last.entity.type,
            displayName: last.entity.displayName,
            id: last.entity.id,
          } satisfies DependencyCursor)
        : null;

    const evidenceMap = await this.evidence.load(
      collectEntityIds(
        page.map((row) => row.path),
        trace.start.id,
      ),
    );
    const start = toTracedEntityDto(trace.start, evidenceFor(evidenceMap, trace.start.id));

    return {
      query: {
        entityId: id,
        kind: query.direction,
        depth: query.depth,
        relationshipTypes,
        entityTypes: query.entityTypes,
      },
      computedAt,
      start,
      truncation: {
        depthLimit: trace.depthLimitReached,
        explorationLimit: trace.explorationLimitReached,
        pathLimit: false,
      },
      totalReached: filtered.length,
      items: page.map((row) => ({
        entity: toTracedEntityDto(row.entity, evidenceFor(evidenceMap, row.entity.id)),
        distance: row.distance,
        path: toPathDto(row.path, evidenceMap),
      })),
      nextCursor,
      cycleClosingHops: trace.cycleClosingHops.map(toCycleClosingHopDto),
      cycleClosingHopCount: trace.cycleClosingHopCount,
    };
  }
}
