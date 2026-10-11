import type { BlockingPathDto, HopDto, RootCauseCandidateDto } from '@opsgraph/shared';
import { ExplanationSentence, linkTargets } from './ExplanationSentence';
import { useBlockers } from './useBlockers';
import { useRootCause } from './useRootCause';

export interface BlockerCalloutProps {
  entityId: string;
}

function hopKeys(hops: readonly HopDto[]): string[] {
  return hops.map((hop) => hop.key);
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function primaryChainHops(candidate: RootCauseCandidateDto): HopDto[] {
  return candidate.primaryChain.steps.flatMap((step): HopDto[] =>
    step.hop === null ? [] : [step.hop],
  );
}

/**
 * The most relevant answers above the fold: the first root cause and the first blocking path.
 * Renders nothing unless one of them has something to show.
 */
export function BlockerCallout({ entityId }: BlockerCalloutProps) {
  const rootCauseQuery = useRootCause(entityId);
  const blockersQuery = useBlockers(entityId);

  const rootCause = rootCauseQuery.data;
  const candidate = rootCause?.candidates[0];
  const blockers = blockersQuery.data;
  const firstPath: BlockingPathDto | undefined = blockers?.paths[0];

  if (candidate === undefined && (blockers === undefined || firstPath === undefined)) {
    return null;
  }

  // The path explanation repeats the chain above when both name the same hops, so it is shown
  // only when there is no root cause or when the two paths differ.
  const samePath =
    candidate !== undefined &&
    firstPath !== undefined &&
    sameKeys(hopKeys(primaryChainHops(candidate)), hopKeys(firstPath.hops));
  const showPathExplanation = firstPath !== undefined && !samePath;

  return (
    <div
      role="note"
      className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm"
    >
      {rootCause !== undefined && candidate !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{rootCause.summary}</p>
          <p>{candidate.explanation.headline}</p>
          <ul className="flex flex-col gap-1">
            {candidate.explanation.chain.map((sentence, index) => (
              <li key={index}>
                <ExplanationSentence
                  sentence={sentence}
                  targets={linkTargets(candidate.primaryChain.steps.map((step) => step.entity))}
                />
              </li>
            ))}
          </ul>
          <a href="#root-cause" className="self-start underline">
            See root cause
          </a>
        </div>
      )}
      {blockers !== undefined && firstPath !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{blockers.summary}</p>
          {showPathExplanation && (
            <ul className="flex flex-col gap-1">
              {firstPath.explanation.map((sentence, index) => (
                <li key={index}>
                  <ExplanationSentence
                    sentence={sentence}
                    targets={linkTargets(blockers.start, firstPath)}
                  />
                </li>
              ))}
            </ul>
          )}
          <a href="#blockers" className="self-start underline">
            See all blocking paths
          </a>
        </div>
      )}
    </div>
  );
}
