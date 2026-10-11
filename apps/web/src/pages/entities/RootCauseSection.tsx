import type { RootCauseResponse } from '@opsgraph/shared';
import { RootCauseCandidate } from './RootCauseCandidate';
import { StepEvidence } from './StepEvidence';
import { useRootCause } from './useRootCause';

export interface RootCauseSectionProps {
  entityId: string;
}

/** Spec FR-028: its own loading and error states, so a failure never blanks the page. */
export function RootCauseSection({ entityId }: RootCauseSectionProps) {
  const rootCauseQuery = useRootCause(entityId);

  return (
    <section id="root-cause" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Root cause</h2>

      {rootCauseQuery.isPending ? <p>Loading…</p> : null}
      {rootCauseQuery.isError ? <p role="alert">Unable to load the root cause.</p> : null}
      {rootCauseQuery.isSuccess ? <RootCauseContent data={rootCauseQuery.data} /> : null}
    </section>
  );
}

function RootCauseContent({ data }: { data: RootCauseResponse }) {
  if (data.status === 'NOT_BLOCKED') {
    return <p>{data.summary}</p>;
  }

  if (data.status === 'UNEXPLAINED') {
    const startEvidence = data.evidence.entities.find((entry) => entry.entityId === data.start.id);
    return (
      <div className="flex flex-col gap-3">
        <p>{data.summary}</p>
        {startEvidence === undefined ? null : (
          <StepEvidence evidence={startEvidence} entityName={data.start.displayName} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-medium">{data.summary}</p>
      {data.candidates.map((candidate) => (
        <RootCauseCandidate
          key={candidate.rootCause.id}
          candidate={candidate}
          evidence={data.evidence}
        />
      ))}
    </div>
  );
}
