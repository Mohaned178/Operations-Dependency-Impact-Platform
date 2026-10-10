import type { BlockersResponse } from '@opsgraph/shared';
import { ExplanationSentence, linkTargets } from '../entities/ExplanationSentence';
import { PathLabels, TruncationNotes } from '../entities/PathLabels';

export interface BlockerHighlightPanelProps {
  blockers: BlockersResponse;
  /** null = every path is highlighted. */
  selectedPathIndex: number | null;
  onSelectPath: (index: number | null) => void;
}

/** Contract ui.md §13: feature 003's blocker summary and explanations, with path selection. */
export function BlockerHighlightPanel({
  blockers,
  selectedPathIndex,
  onSelectPath,
}: BlockerHighlightPanelProps) {
  return (
    <section aria-label="Blockers" className="flex flex-col gap-2 rounded border bg-white p-3">
      <h2 className="text-base font-semibold">Blockers</h2>
      <p className="text-sm">{blockers.summary}</p>

      {blockers.paths.length > 0 ? (
        <>
          <div>
            <button
              type="button"
              aria-pressed={selectedPathIndex === null}
              onClick={() => {
                onSelectPath(null);
              }}
              className="rounded border px-2 py-1 text-sm aria-pressed:border-red-600 aria-pressed:bg-red-50"
            >
              Show all paths
            </button>
          </div>
          <ol className="flex flex-col gap-3">
            {blockers.paths.map((path, index) => (
              <li key={path.hops.map((hop) => hop.key).join('/')} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={selectedPathIndex === index}
                    onClick={() => {
                      onSelectPath(index);
                    }}
                    className="rounded border px-2 py-1 text-sm font-medium aria-pressed:border-red-600 aria-pressed:bg-red-50"
                  >
                    {`Path ${index + 1}`}
                  </button>
                  <PathLabels path={path} depth={blockers.query.depth} />
                </div>
                <ul className="flex flex-col gap-1 pl-2 text-sm">
                  {path.explanation.map((sentence) => (
                    <li key={sentence}>
                      <ExplanationSentence
                        sentence={sentence}
                        targets={linkTargets(blockers.start, path)}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <TruncationNotes data={blockers} />
        </>
      ) : null}
    </section>
  );
}
