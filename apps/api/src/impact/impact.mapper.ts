import {
  CONFIDENCE_RANK,
  ORIGIN_RANK,
  type AffectedEntityDto,
  type AttributionPreviewDto,
  type Confidence,
  type ExposureFigureDto,
  type ExposureShareDto,
  type ImpactResponse,
  type MoneyDto,
  type OrderValueDto,
  type RelationshipOrigin,
} from '@opsgraph/shared';
import type { ImpactPathSet, TraversalPath } from '../graph/graph.repository';
import { toPathDto, toTracedEntityDto, evidenceFor, type EvidenceMap } from '../tracing/tracing.mapper';
import { orderValueFlags } from './analysis/exposure';
import { formatAmount } from './analysis/money';
import type {
  Affected,
  ExposureFigure,
  ExposureResult,
  ExposureShare,
  OrderValue,
} from './analysis/types';

function toShareDto(share: ExposureShare): ExposureShareDto {
  return { amount: formatAmount(share.amount), orderCount: share.orderCount };
}

function toFigureDto(figure: ExposureFigure): ExposureFigureDto {
  return {
    currency: figure.currency,
    total: toShareDto(figure.total),
    current: toShareDto(figure.current),
    potential: toShareDto(figure.potential),
    inferredOnly: {
      total: toShareDto(figure.inferredOnly.total),
      current: toShareDto(figure.inferredOnly.current),
      potential: toShareDto(figure.inferredOnly.potential),
    },
    disagreementOrderCount: figure.disagreementOrderCount,
    range:
      figure.range === null
        ? null
        : { low: formatAmount(figure.range.low), high: formatAmount(figure.range.high) },
  };
}

export function toExposureDto(exposure: ExposureResult): ImpactResponse['exposure'] {
  return {
    byCurrency: exposure.byCurrency.map(toFigureDto),
    valueUnknownCount: exposure.valueUnknownCount,
  };
}

export function toStartOwnValueDto(exposure: ExposureResult): MoneyDto | null {
  return exposure.startOwnValue === null
    ? null
    : {
        amount: formatAmount(exposure.startOwnValue.amount),
        currency: exposure.startOwnValue.currency,
      };
}

/** Contracts/api.md § Field rules: the lowest origin and the lowest confidence of the hops. */
function weakestOf(
  path: TraversalPath | null,
): { origin: RelationshipOrigin; confidence: Confidence } | null {
  if (path === null || path.hops.length === 0) {
    return null;
  }
  let origin: RelationshipOrigin = 'SOURCE';
  let confidence: Confidence = 'HIGH';
  for (const hop of path.hops) {
    if (ORIGIN_RANK[hop.effectiveOrigin] < ORIGIN_RANK[origin]) {
      origin = hop.effectiveOrigin;
    }
    if (CONFIDENCE_RANK[hop.effectiveConfidence] < CONFIDENCE_RANK[confidence]) {
      confidence = hop.effectiveConfidence;
    }
  }
  return { origin, confidence };
}

export function toOrderValueDto(value: OrderValue): OrderValueDto {
  return {
    current: value.current,
    bySource: value.bySource.map((source) => ({ ...source })),
    ...orderValueFlags(value),
  };
}

/** Every path `toAffectedEntityDto` will serialize, so the caller can load evidence once. */
export function serializedPaths(item: Affected, attributionLimit: number): TraversalPath[] {
  return [
    ...(item.primaryPath === null ? [] : [item.primaryPath]),
    ...(item.shortestPath === null ? [] : [item.shortestPath]),
    ...item.attributions.slice(0, attributionLimit).map((attribution) => attribution.link),
  ];
}

export interface AffectedMapping {
  evidence: EvidenceMap;
  values: ReadonlyMap<string, OrderValue>;
  /** The analysis, by entity id: attribution previews name the attributed entity and its class. */
  affectedById: ReadonlyMap<string, Affected>;
  /** Enumerated paths for this item; absent means no enumeration was done (count 0). */
  pathSet?: ImpactPathSet | undefined;
  attributionLimit: number;
}

export function toAttributionPreviews(
  item: Affected,
  mapping: AffectedMapping,
  limit: number,
): AttributionPreviewDto[] {
  return item.attributions.slice(0, limit).map((attribution) => {
    const attributed = mapping.affectedById.get(attribution.attributedEntityId);
    if (attributed === undefined || attributed.classification === 'NOT_COUNTED') {
      throw new Error(
        `impact invariant: attributed entity ${attribution.attributedEntityId} is not a counted entity`,
      );
    }
    return {
      entity: {
        id: attributed.entity.id,
        type: attributed.entity.type,
        displayName: attributed.entity.displayName,
        currentState: attributed.entity.currentState,
      },
      classification: attributed.classification,
      link: toPathDto(attribution.link, mapping.evidence),
    };
  });
}

export function toAffectedEntityDto(item: Affected, mapping: AffectedMapping): AffectedEntityDto {
  const value = mapping.values.get(item.entity.id);
  return {
    entity: toTracedEntityDto(item.entity, evidenceFor(mapping.evidence, item.entity.id)),
    classification: item.classification,
    notCountedReason: item.notCountedReason,
    directness: item.directness,
    distance: item.distance,
    primaryPath: item.primaryPath === null ? null : toPathDto(item.primaryPath, mapping.evidence),
    shortestPath:
      item.shortestPath === null ? null : toPathDto(item.shortestPath, mapping.evidence),
    pathCount: mapping.pathSet?.found.length ?? 0,
    morePaths: mapping.pathSet?.morePaths ?? false,
    flags: { ...item.flags },
    weakest: weakestOf(item.primaryPath),
    value: item.entity.type === 'Order' && value !== undefined ? toOrderValueDto(value) : null,
    attributionCount: item.attributions.length,
    attributions: toAttributionPreviews(item, mapping, mapping.attributionLimit),
  };
}
