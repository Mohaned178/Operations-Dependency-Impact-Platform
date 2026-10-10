import { EXPLORER_LIMITS, type ExplorerUrlParams } from '@opsgraph/shared';
import { useSearchParams } from 'react-router';
import { writeExplorerParams } from './explorer-params';

export interface ExplorerToolbarProps {
  params: ExplorerUrlParams;
}

const STEP_OPTIONS = Array.from(
  { length: EXPLORER_LIMITS.maxDepth - EXPLORER_LIMITS.minDepth + 1 },
  (_, i) => EXPLORER_LIMITS.minDepth + i,
);

/** Contract ui.md §11: every control writes the URL (replace, defaults omitted). */
export function ExplorerToolbar({ params }: ExplorerToolbarProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  const update = (partial: Partial<ExplorerUrlParams>): void => {
    setSearchParams(writeExplorerParams(searchParams, partial), { replace: true });
  };

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm" role="toolbar" aria-label="Explorer settings">
      <label className="flex items-center gap-2">
        Steps
        <select
          value={params.depth}
          onChange={(event) => {
            update({ depth: Number(event.target.value) });
          }}
          className="rounded border border-gray-300 px-2 py-1"
        >
          {STEP_OPTIONS.map((depth) => (
            <option key={depth} value={depth}>
              {depth}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={params.blockers}
          onChange={(event) => {
            update({ blockers: event.target.checked });
          }}
        />
        Highlight blockers
      </label>
    </div>
  );
}
