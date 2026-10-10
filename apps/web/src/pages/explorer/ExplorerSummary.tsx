import type { ExplorerUrlParams, NeighborhoodResponse } from '@opsgraph/shared';
import { formatTimestamp } from '../../lib/format';
import { describeView } from './describe-view';

export interface ExplorerSummaryProps {
  response: NeighborhoodResponse;
  settings: ExplorerUrlParams;
  onRefresh: () => void;
  isUpdating: boolean;
}

/** ui.md §10: header, filters, load time, omitted-count notice and empty-state message. */
export function ExplorerSummary({ response, settings, onRefresh, isUpdating }: ExplorerSummaryProps) {
  const view = describeView(response, settings);

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-lg font-semibold">{view.title}</h1>
      {view.filters !== null ? <p className="text-sm text-slate-600">{view.filters}</p> : null}
      <p className="text-sm text-slate-500">
        Loaded {formatTimestamp(response.computedAt)}{' '}
        <button
          type="button"
          onClick={() => {
            onRefresh();
          }}
        >
          Refresh
        </button>
        {isUpdating ? <span> Updating…</span> : null}
      </p>
      {view.omitted !== null ? (
        <div
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {view.omitted}
        </div>
      ) : null}
      {view.empty !== null ? <p className="text-sm text-slate-600">{view.empty}</p> : null}
    </div>
  );
}
