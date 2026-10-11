import { Inject, Injectable } from '@nestjs/common';
import {
  IMPACT_STATE_CLASS,
  type ImpactQuery,
  type ImpactResponse,
} from '@opsgraph/shared';
import { Errors } from '../common/errors/app-error';
import { GRAPH_REPOSITORY, type GraphRepository, type ImpactTrace } from '../graph/graph.repository';
import { StateEvidenceReader } from '../tracing/state-evidence.reader';
import { evidenceFor, toCycleClosingHopDto, toTracedEntityDto } from '../tracing/tracing.mapper';
import { buildCategories, notCountedSummary } from './analysis/categories';
import { classifyReached } from './analysis/classify';
import { mergeCustomers } from './analysis/customers';
import { computeExposure } from './analysis/exposure';
import { buildSummary } from './analysis/summary';
import type { Affected, ExposureResult, OrderValue } from './analysis/types';
import { toExposureDto, toStartOwnValueDto } from './impact.mapper';
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
