import type { OperationalState } from '@opsgraph/shared';

const STATE_CLASSES: Record<OperationalState, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-sky-100 text-sky-800',
  WAITING: 'bg-sky-100 text-sky-800',
  BLOCKED: 'bg-red-100 text-red-800',
  MISSING: 'bg-red-100 text-red-800',
  DELAYED: 'bg-orange-100 text-orange-800',
  AT_RISK: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
  SUSPENDED: 'bg-slate-200 text-slate-700',
  UNKNOWN: 'bg-slate-100 text-slate-600',
};

export function stateLabel(state: OperationalState): string {
  return state
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

export interface StateBadgeProps {
  state: OperationalState;
}

export function StateBadge({ state }: StateBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STATE_CLASSES[state]}`}
    >
      {stateLabel(state)}
    </span>
  );
}
