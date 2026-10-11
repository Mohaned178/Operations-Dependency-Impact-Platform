import type { Confidence, ConfidenceRule, ConfidenceRuleOutcomeDto } from '@opsgraph/shared';
import { useState } from 'react';

export interface ConfidenceRulesProps {
  confidence: Confidence;
  rules: ConfidenceRuleOutcomeDto[];
}

const RULE_NAMES: Record<ConfidenceRule, string> = {
  WEAKEST_LINK: 'Weakest link',
  UNKNOWN_STATE: 'Unknown state',
  CYCLE: 'Dependency cycle',
  SEARCH_LIMIT: 'Search limit',
  STALE_EVIDENCE: 'Stale evidence',
  CLASSIFICATION_DISAGREEMENT: 'Classification disagreement',
  UNCORROBORATED: 'Uncorroborated root cause',
  DISPUTED: 'Disputed by a note',
};

/** Every confidence rule with its outcome, so the level is never an opaque score (invariant 5). */
export function ConfidenceRules({ confidence, rules }: ConfidenceRulesProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="w-fit text-sm text-slate-700 underline"
      >
        {`Confidence: ${confidence} — show the ${rules.length} rules`}
      </button>
      {open ? (
        <ol className="flex flex-col gap-2">
          {rules.map((outcome) => (
            <li key={outcome.rule} className="rounded border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{RULE_NAMES[outcome.rule]}</span>
                <span
                  className={
                    outcome.applied
                      ? 'rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800'
                      : 'rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700'
                  }
                >
                  {outcome.applied ? 'Applied' : 'Not applied'}
                </span>
                <span className="text-slate-600">{`Confidence after: ${outcome.confidenceAfter}`}</span>
              </div>
              <p className="mt-1 text-slate-700">{outcome.reason}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
