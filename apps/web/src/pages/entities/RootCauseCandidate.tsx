import type { CausalChainDto, RootCauseCandidateDto, RootCauseResponse } from '@opsgraph/shared';
import { useState } from 'react';
import { CausalChainView } from './CausalChainView';
import { ExplanationSentence, linkTargets } from './ExplanationSentence';

export interface RootCauseCandidateProps {
  candidate: RootCauseCandidateDto;
  evidence: RootCauseResponse['evidence'];
}

/** One root cause: its headline, the explanation, the primary chain and the collapsed alternatives. */
export function RootCauseCandidate({ candidate, evidence }: RootCauseCandidateProps) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const { explanation, primaryChain, alternativeChains } = candidate;
  const primaryTargets = linkTargets(primaryChain.steps.map((step) => step.entity));

  return (
    <article className="flex flex-col gap-4">
      <h3 className="text-base font-semibold">{explanation.headline}</h3>

      <ul className="flex flex-col gap-1 text-sm">
        {explanation.chain.map((sentence, index) => (
          <li key={index}>
            <ExplanationSentence sentence={sentence} targets={primaryTargets} />
          </li>
        ))}
      </ul>

      <ul className="flex flex-col gap-1 text-sm text-slate-700">
        {explanation.confidence.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>

      <p className="text-sm text-slate-700">{explanation.evidence}</p>

      <section className="flex flex-col gap-2">
        <h4 className="font-medium">Causal chain</h4>
        <CausalChainView chain={primaryChain} evidence={evidence} />
      </section>

      {alternativeChains.length === 0 ? null : (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showAlternatives}
            onClick={() => setShowAlternatives((open) => !open)}
            className="w-fit text-sm text-slate-700 underline"
          >
            {`Alternative chains (${alternativeChains.length})`}
          </button>
          {showAlternatives
            ? alternativeChains.map((chain, index) => (
                <AlternativeChain
                  key={index}
                  chain={chain}
                  title={`Alternative chain ${index + 1}`}
                  evidence={evidence}
                />
              ))
            : null}
        </section>
      )}
    </article>
  );
}

interface AlternativeChainProps {
  chain: CausalChainDto;
  title: string;
  evidence: RootCauseResponse['evidence'];
}

/** An alternative is explained in text as well as in the chain view (invariant 6). */
function AlternativeChain({ chain, title, evidence }: AlternativeChainProps) {
  const targets = linkTargets(chain.steps.map((step) => step.entity));
  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-medium">{title}</h4>
      <ul className="flex flex-col gap-1 text-sm">
        {chain.sentences.map((sentence, index) => (
          <li key={index}>
            <ExplanationSentence sentence={sentence} targets={targets} />
          </li>
        ))}
      </ul>
      <CausalChainView chain={chain} evidence={evidence} />
    </div>
  );
}
