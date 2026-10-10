import { Inject, Injectable } from '@nestjs/common';
import {
  BLOCKER_RELATIONSHIP_TYPES,
  EXPLORER_LIMITS,
  RelationshipTypeSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  TRACING_LIMITS,
  type NeighborhoodDirection,
  type NeighborhoodNodeDto,
  type NeighborhoodQuery,
  type NeighborhoodResponse,
  type RelationshipType,
} from '@opsgraph/shared';
import { Errors } from '../common/errors/app-error';
import {
  GRAPH_REPOSITORY,
  type GraphEntityRef,
  type GraphRepository,
  type NeighborhoodTrace,
  type NeighborhoodWalk,
} from '../graph/graph.repository';
import { compareCodeUnits } from '../graph/traversal/path-order';
import {
  composeNeighborhood,
  type ComposeBlockerPath,
  type ComposeExpansion,
} from './compose-neighborhood';
import { StateEvidenceReader } from './state-evidence.reader';
import { evidenceFor, toGraphEdgeDto, toTracedEntityDto } from './tracing.mapper';
import { TracingService } from './tracing.service';

const BLOCKER_TYPES: readonly RelationshipType[] = BLOCKER_RELATIONSHIP_TYPES;

const WALK: Record<NeighborhoodDirection, NeighborhoodWalk> = {
  all: 'ALL',
  upstream: 'UPSTREAM',
  downstream: 'DOWNSTREAM',
};

@Injectable()
export class NeighborhoodService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graph: GraphRepository,
    private readonly tracing: TracingService,
    private readonly evidence: StateEvidenceReader,
  ) {}

  async neighborhood(rawId: string, rawQuery: NeighborhoodQuery): Promise<NeighborhoodResponse> {
    const computedAt = new Date().toISOString();

    // UUIDs are accepted in any case but the database returns them lower-case, so every
    // comparison below (focus vs expand, node ids, parent edges) must use the lower-case form.
    const id = rawId.toLowerCase();
    const query: NeighborhoodQuery = {
      ...rawQuery,
      expand: [...new Set(rawQuery.expand.map((expandId) => expandId.toLowerCase()))],
    };

    if (query.expand.includes(id)) {
      throw Errors.validation([
        { path: 'expand', message: 'expand must not include the focus entity' },
      ]);
    }

    const walk = WALK[query.direction];
    const types =
      query.relationshipTypes.length > 0
        ? query.relationshipTypes
        : walk === 'ALL'
          ? [...RelationshipTypeSchema.options]
          : [...TRACEABLE_RELATIONSHIP_TYPES];

    const base = await this.graph.traceNeighborhood({
      startId: id,
      walk,
      maxDepth: query.depth,
      relationshipTypes: types,
    });
    if (base === null) {
      throw Errors.notFound('Entity');
    }

    const blockers = query.blockers
      ? await this.tracing.blockers(id, {
          depth: TRACING_LIMITS.defaultDepth,
          relationshipTypes: [],
          entityTypes: [],
        })
      : null;

    // Sequential and in request order: the order decides which expansion wins a contested slot.
    const expansions: ComposeExpansion[] = [];
    for (const expandedId of query.expand) {
      const trace: NeighborhoodTrace | null = await this.graph.traceNeighborhood({
        startId: expandedId,
        walk,
        maxDepth: 1,
        relationshipTypes: types,
      });
      expansions.push({ expandedId, trace });
    }

    const blockerPaths: ComposeBlockerPath[] =
      blockers?.paths.map((path) => ({
        entityIds: path.hops.map((hop) => hop.entity.id),
        edgeKeys: path.hops.map((hop) => hop.key),
      })) ?? [];
    const blockerEntities = new Map<string, GraphEntityRef>();
    for (const path of blockers?.paths ?? []) {
      for (const hop of path.hops) {
        blockerEntities.set(hop.entity.id, {
          id: hop.entity.id,
          type: hop.entity.type,
          displayName: hop.entity.displayName,
          currentState: hop.entity.currentState,
        });
      }
    }

    const composed = composeNeighborhood({
      focus: base.start,
      base,
      entityTypes: query.entityTypes,
      blockerPaths,
      blockerEntities,
      expansions,
      maxVisible: EXPLORER_LIMITS.maxVisibleNodes,
    });

    const visibleIds = composed.visible.map((node) => node.entity.id);
    const edgeTypes = RelationshipTypeSchema.options.filter(
      (type) =>
        types.includes(type) || (blockers !== null && BLOCKER_TYPES.includes(type)),
    );
    const groups = await this.graph.findRelationshipsAmong(visibleIds, edgeTypes);
    const edges = groups
      .filter((group) => types.includes(group.type) || composed.blockerEdgeKeys.has(group.key))
      .sort((a, b) => compareCodeUnits(a.key, b.key));

    const evidenceMap = await this.evidence.load(visibleIds);
    const nodes: NeighborhoodNodeDto[] = composed.visible.map((node) => ({
      ...toTracedEntityDto(node.entity, evidenceFor(evidenceMap, node.entity.id)),
      distance: node.distance,
      reasons: node.reasons,
      parentId: node.parentId,
      viaEdgeKey: node.viaEdgeKey,
      expanded: node.expanded,
    }));

    this.assertParentEdges(nodes, edges, id);

    return {
      query: {
        entityId: id,
        direction: query.direction,
        depth: query.depth,
        relationshipTypes: types,
        entityTypes: query.entityTypes,
        expand: query.expand,
        blockers: query.blockers,
      },
      computedAt,
      focusId: id,
      nodes,
      edges: edges.map(toGraphEdgeDto),
      totals: {
        visible: nodes.length,
        omitted: composed.omitted,
        omittedIsLowerBound: composed.omittedIsLowerBound,
      },
      ignoredExpansions: composed.ignoredExpansions,
      blockers,
    };
  }

  /** Every non-focus node must be connected to its parent by a kept edge. */
  private assertParentEdges(
    nodes: readonly NeighborhoodNodeDto[],
    edges: ReadonlyArray<{ key: string; fromEntityId: string; toEntityId: string }>,
    focusId: string,
  ): void {
    const byKey = new Map(edges.map((edge) => [edge.key, edge]));
    for (const node of nodes) {
      if (node.id === focusId) {
        continue;
      }
      const edge = node.viaEdgeKey === null ? undefined : byKey.get(node.viaEdgeKey);
      const connects =
        edge !== undefined &&
        node.parentId !== null &&
        ((edge.fromEntityId === node.parentId && edge.toEntityId === node.id) ||
          (edge.fromEntityId === node.id && edge.toEntityId === node.parentId));
      if (!connects) {
        throw new Error(
          `explorer invariant: node ${node.id} is not joined to ${node.parentId} by edge ${String(node.viaEdgeKey)}`,
        );
      }
    }
  }
}
