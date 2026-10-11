import type { CustomerAttribution, GraphEntityRef, TraversalPath } from '../../graph/graph.repository';

export type Classification = 'CURRENT' | 'POTENTIAL' | 'NOT_COUNTED';

/** One entity of the impact analysis, as the pure modules pass it around (data-model 4b). */
export interface Affected {
  entity: GraphEntityRef;
  classification: Classification;
  notCountedReason: 'TERMINAL' | null;
  /** Null only for attributed-only customers. */
  distance: number | null;
  directness: 'DIRECT' | 'INDIRECT';
  /** Null only for attributed-only customers. Live path if CURRENT, else canonical. */
  primaryPath: TraversalPath | null;
  /** Set only when it differs from primaryPath by hop-key sequence. */
  shortestPath: TraversalPath | null;
  flags: { stateUnknown: boolean; otherCause: boolean; inferredOnly: boolean };
  /** Customers only: attributions in (classification CURRENT first, then entity type, displayName, id) order. */
  attributions: CustomerAttribution[];
}

/** The latest value one source system states for an order (data-model 4a). */
export interface SourceValue {
  sourceSystem: string;
  sourceId: string;
  observedAt: string;
  amount: string;
  currency: string;
}

export interface OrderValue {
  /** Null when the current attributes lack a usable amount/currency (research R6). */
  current: { amount: string; currency: string } | null;
  /** Latest stated value per source system; sorted by sourceSystem. */
  bySource: SourceValue[];
}

/** Mirrors ExposureShareDtoSchema with a bigint amount (units of 10^-4). */
export interface ExposureShare {
  amount: bigint;
  orderCount: number;
}

/** Mirrors ExposureFigureDtoSchema with bigint amounts. */
export interface ExposureFigure {
  currency: string;
  total: ExposureShare;
  current: ExposureShare;
  potential: ExposureShare;
  inferredOnly: { total: ExposureShare; current: ExposureShare; potential: ExposureShare };
  disagreementOrderCount: number;
  range: { low: bigint; high: bigint } | null;
}

/** One counted order that has a usable current value. */
export interface ExposureOrder {
  amount: bigint;
  currency: string;
  disagreement: boolean;
  currencyMismatch: boolean;
}

export interface ExposureResult {
  /** Sorted by currency code. */
  byCurrency: ExposureFigure[];
  valueUnknownCount: number;
  /** Counted orders without a usable current value. */
  valueUnknownIds: Set<string>;
  /** The start's own current value, when it has one. Never part of the figures. */
  startOwnValue: { amount: bigint; currency: string } | null;
  /** Orders included in the figures, by entity id. */
  orders: Map<string, ExposureOrder>;
  /** Customer id → currency → sum of its attributed included orders (research R7). */
  customerExposure: Map<string, Map<string, bigint>>;
}
