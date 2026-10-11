import type {
  CausalRole,
  CausalStepDto,
  RootCauseResponse,
  CausalChainDto,
} from '@opsgraph/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { OriginBadge } from './OriginBadge';
import { StateBadge } from './StateBadge';
import { StepEvidence } from './StepEvidence';

export interface CausalChainViewProps {
  chain: CausalChainDto;
  evidence: RootCauseResponse['evidence'];
}

const ROLE_LABELS: Record<CausalRole, string> = {
  SYMPTOM: 'Symptom',
  IMMEDIATE_BLOCKER: 'Immediate Blocker',
  UPSTREAM_CAUSE: 'Upstream Cause',
  ROOT_CAUSE: 'Root Cause',
};

const ROLE_CLASSES: Record<CausalRole, string> = {
  SYMPTOM: 'border-slate-300 bg-slate-100 text-slate-700',
  IMMEDIATE_BLOCKER: 'border-orange-300 bg-orange-50 text-orange-800',
  UPSTREAM_CAUSE: 'border-sky-300 bg-sky-50 text-sky-800',
  ROOT_CAUSE: 'border-red-300 bg-red-50 text-red-800',
};

function RoleBadge({ role }: { role: CausalRole }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${ROLE_CLASSES[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

/** The causal chain as an ordered list, symptom first. Each step can show its evidence. */
export function CausalChainView({ chain, evidence }: CausalChainViewProps) {
  return (
    <ol className="flex flex-col gap-2">
      {chain.steps.map((step, position) => (
        <CausalStepItem
          key={`${step.index}:${step.entity.id}`}
          step={step}
          previous={position > 0 ? chain.steps.at(position - 1) : undefined}
          evidence={evidence}
        />
      ))}
    </ol>
  );
}

interface CausalStepItemProps {
  step: CausalStepDto;
  previous: CausalStepDto | undefined;
  evidence: RootCauseResponse['evidence'];
}

function CausalStepItem({ step, previous, evidence }: CausalStepItemProps) {
  const [expanded, setExpanded] = useState(false);
  const name = step.entity.displayName;
  const { hop } = step;

  const entityEvidence = evidence.entities.find((entry) => entry.entityId === step.entity.id);
  const relationships =
    hop === null
      ? []
      : evidence.relationships.filter((relationship) =>
          hop.assertions.some(
            (assertion) => assertion.relationshipId === relationship.relationshipId,
          ),
        );

  // The relationship as recorded: FORWARD hops point from the previous step, REVERSE hops point back to it.
  let recorded: string | null = null;
  if (hop !== null && previous !== undefined) {
    recorded =
      hop.traversal === 'FORWARD'
        ? `${previous.entity.displayName} ${hop.relationshipType} ${name}`
        : `${name} ${hop.relationshipType} ${previous.entity.displayName}`;
  }

  return (
    <li className="rounded border bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {step.roles.map((role) => (
          <RoleBadge key={role} role={role} />
        ))}
        <Link to={`/entities/${step.entity.id}`} className="font-medium underline">
          {name}
        </Link>
        <StateBadge state={step.entity.currentState} />
        {step.possible ? <span className="text-slate-600">possible</span> : null}
      </div>

      {hop === null || recorded === null ? null : (
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span>{recorded}</span>
          <OriginBadge origin={hop.effectiveOrigin} confidence={hop.effectiveConfidence} />
        </p>
      )}

      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="mt-2 text-slate-600 underline"
      >
        {`Show evidence for ${name}`}
      </button>

      {expanded ? (
        <div className="mt-2">
          {entityEvidence === undefined ? (
            <p className="text-slate-500">Evidence unavailable</p>
          ) : (
            <StepEvidence
              evidence={entityEvidence}
              relationships={relationships}
              entityName={name}
              relationshipLabel={recorded ?? undefined}
            />
          )}
        </div>
      ) : null}
    </li>
  );
}
