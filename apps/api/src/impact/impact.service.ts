import { Inject, Injectable } from '@nestjs/common';
import {
  IMPACT_LIMITS,
  IMPACT_STATE_CLASS,
  type ImpactItemDetailResponse,
  type ImpactListQuery,
  type ImpactListResponse,
  type ImpactQuery,
  type ImpactResponse,
  type MoneyDto,
} from '@opsgraph/shared';
import { Errors } from '../common/errors/app-error';
import {
  GRAPH_REPOSITORY,
  type GraphRepository,
  type ImpactTrace,
  type TraversalPath,
} from '../graph/graph.repository';
import { StateEvidenceReader } from '../tracing/state-evidence.reader';
import {
  evidenceFor,
  toCycleClosingHopDto,
  toPathDto,
  toTracedEntityDto,
  type EvidenceMap,
} from '../tracing/tracing.mapper';
import { buildCategories, notCountedSummary } from './analysis/categories';
import { classifyReached } from './analysis/classify';
import { mergeCustomers } from './analysis/customers';
import { computeExposure } from './analysis/exposure';
import { compareForList, keyForList, paginate, selectList } from './analysis/lists';
import { formatAmount } from './analysis/money';
import { alternativePaths } from './analysis/paths';
import { buildSummary } from './analysis/summary';
import type { Affected, ExposureResult, OrderValue } from './analysis/types';
import {
  serializedPaths,
  toAffectedEntityDto,
  toAttributionPreviews,
  toExposureDto,
  toStartOwnValueDto,
  type AffectedMapping,
} from './impact.mapper';
import { OrderValueReader } from './order-value.reader';

interface Analysis {
  computedAt: string;
  trace: ImpactTrace;
  affected: Affected[];
  values: Map<string, OrderValue>;
  exposure: ExposureResult;
}

@Injectable()
export class ImpactService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graph: GraphRepository,
    private readonly orderValues: OrderValueReader,
    private readonly evidenceReader: StateEvidenceReader,
  ) {}

  async summary(id: string, query: ImpactQuery): Promise<ImpactResponse> {
    const { computedAt, trace, affected, exposure } = await this.analyze(id, query.depth);
    const evidence = await this.evidenceReader.load([id]);

    const categories = buildCategories(affected);
    const notCounted = notCountedSummary(affected);
    const countedTotal = affected.filter((item) => item.classification !== 'NOT_COUNTED').length;
    const startClass = IMPACT_STATE_CLASS[trace.start.currentState];
    const limits = {
      depthLimit: trace.depthLimitReached,
      explorationLimit: trace.explorationLimitReached,
      lowerBound: trace.depthLimitReached || trace.explorationLimitReached,
    };

    return {
      query: { entityId: id, depth: query.depth },
      computedAt,
      start: toTracedEntityDto(trace.start, evidenceFor(evidence, id)),
      startClass,
      startOwnValue: toStartOwnValueDto(exposure),
      limits,
      summary: buildSummary({
        startName: trace.start.displayName,
        startState: trace.start.currentState,
        startClass,
        depth: query.depth,
        countedTotal,
        categories,
        exposure,
        notCountedTotal: notCounted.total,
        limits,
      }),
      countedTotal,
      categories,
      exposure: toExposureDto(exposure),
      notCounted,
      cycleClosingHops: trace.cycleClosingHops.map(toCycleClosingHopDto),
      cycleClosingHopCount: trace.cycleClosingHopCount,
    };
  }

  async list(id: string, query: ImpactListQuery): Promise<ImpactListResponse> {
    const { computedAt, trace, affected, values, exposure } = await this.analyze(id, query.depth);
    const { selector } = query;

    const members = selectList(affected, exposure, selector).sort(compareForList(selector, exposure));
    const page = paginate(members, query.cursor, query.limit, keyForList(selector, exposure));

    const pathSets = trace.paths(
      page.items.filter((item) => item.distance !== null).map((item) => item.entity.id),
    );
    const evidence = await this.loadEvidence(
      id,
      page.items.map((item) => item.entity.id),
      page.items.flatMap((item) => serializedPaths(item, IMPACT_LIMITS.maxAttributionPreviews)),
    );
    const affectedById = new Map(affected.map((entry) => [entry.entity.id, entry]));

    let sum: MoneyDto | null = null;
    if (selector.list === 'exposure') {
      let units = 0n;
      for (const member of members) {
        units += exposure.orders.get(member.entity.id)?.amount ?? 0n;
      }
      sum = { amount: formatAmount(units), currency: selector.currency };
    }

    return {
      query: { entityId: id, depth: query.depth, selector },
      computedAt,
      start: toTracedEntityDto(trace.start, evidenceFor(evidence, id)),
      total: members.length,
      sum,
      items: page.items.map((item) =>
        toAffectedEntityDto(item, {
          evidence,
          values,
          affectedById,
          pathSet: pathSets.get(item.entity.id),
          attributionLimit: IMPACT_LIMITS.maxAttributionPreviews,
        }),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async item(id: string, targetId: string, query: ImpactQuery): Promise<ImpactItemDetailResponse> {
    const { computedAt, trace, affected, values } = await this.analyze(id, query.depth);
    const target = affected.find((entry) => entry.entity.id === targetId);
    if (target === undefined) {
      throw Errors.notFound('Affected entity');
    }

    const affectedById = new Map(affected.map((entry) => [entry.entity.id, entry]));
    const pathSet = target.distance === null ? undefined : trace.paths([targetId]).get(targetId);
    const alternatives = alternativePaths(
      pathSet?.found ?? [],
      target.shortestPath,
      target.primaryPath,
      IMPACT_LIMITS.maxAlternativePaths,
    );

    const detailed = target.attributions
      .slice(0, IMPACT_LIMITS.maxAttributions)
      .map((attribution) => {
        const attributed = affectedById.get(attribution.attributedEntityId);
        if (attributed === undefined || attributed.primaryPath === null) {
          throw new Error(
            `impact invariant: attributed entity ${attribution.attributedEntityId} has no impact path`,
          );
        }
        return { attribution, primaryPath: attributed.primaryPath };
      });

    const evidence = await this.loadEvidence(
      id,
      [targetId],
      [
        ...serializedPaths(target, IMPACT_LIMITS.maxAttributionPreviews),
        ...alternatives,
        ...detailed.flatMap((entry) => [entry.attribution.link, entry.primaryPath]),
      ],
    );
    const mapping: AffectedMapping = {
      evidence,
      values,
      affectedById,
      pathSet,
      attributionLimit: IMPACT_LIMITS.maxAttributionPreviews,
    };

    const previews = toAttributionPreviews(
      { ...target, attributions: detailed.map((entry) => entry.attribution) },
      mapping,
      IMPACT_LIMITS.maxAttributions,
    );

    return {
      query: { entityId: id, depth: query.depth },
      computedAt,
      start: toTracedEntityDto(trace.start, evidenceFor(evidence, id)),
      item: toAffectedEntityDto(target, mapping),
      alternativePaths: alternatives.map((path) => toPathDto(path, evidence)),
      attributions: previews.map((preview, index) => {
        const entry = detailed[index];
        if (entry === undefined) {
          throw new Error('impact invariant: attribution preview without a source');
        }
        return { ...preview, primaryPath: toPathDto(entry.primaryPath, evidence) };
      }),
      attributionCount: target.attributions.length,
    };
  }

  /**
   * Key design note 8: one evidence load per request, over the start, the listed entities and
   * every hop target of every path that will be serialized.
   */
  private loadEvidence(
    startId: string,
    entityIds: readonly string[],
    paths: readonly TraversalPath[],
  ): Promise<EvidenceMap> {
    const ids = new Set<string>([startId, ...entityIds]);
    for (const path of paths) {
      for (const hop of path.hops) {
        ids.add(hop.target.id);
      }
    }
    return this.evidenceReader.load([...ids]);
  }

  /** Data-model 4c. The clock is read here once and nowhere else. */
  private async analyze(id: string, depth: number): Promise<Analysis> {
    const computedAt = new Date().toISOString();

    const trace = await this.graph.traceImpact({ startId: id, maxDepth: depth });
    if (trace === null) {
      throw Errors.notFound('Entity');
    }

    const classified = classifyReached(trace);
    const countedIds = (type: 'Order' | 'SLA'): string[] =>
      classified
        .filter((item) => item.entity.type === type && item.classification !== 'NOT_COUNTED')
        .map((item) => item.entity.id);
    const countedOrders = countedIds('Order');

    const attributions = await this.graph.findAttributedCustomers({
      orderIds: countedOrders,
      slaIds: countedIds('SLA'),
    });
    const affected = mergeCustomers(classified, attributions, id);

    // The start's own value is read too (Order, Payment and Invoice starts have one).
    const values = await this.orderValues.load([...countedOrders, id]);
    const exposure = computeExposure(affected, values, id);

    return { computedAt, trace, affected, values, exposure };
  }
}
