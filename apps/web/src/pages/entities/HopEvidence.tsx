import type { HopDto } from '@opsgraph/shared';
import { formatTimestamp } from '../../lib/format';
import { OriginBadge } from './OriginBadge';
import { stateLabel } from './StateBadge';

export interface HopEvidenceProps {
  hop: HopDto;
}

export function HopEvidence({ hop }: HopEvidenceProps) {
  const { observation, latestBySource } = hop.entity.state;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul className="flex flex-col gap-2">
        {hop.assertions.map((assertion) => (
          <li key={assertion.relationshipId} className="flex flex-col gap-0.5">
            <span>
              <OriginBadge origin={assertion.origin} confidence={assertion.confidence} />
            </span>
            {assertion.basis === null ? null : (
              <span className="text-slate-600">{assertion.basis}</span>
            )}
            <span className="text-slate-500">
              {`${assertion.sourceSystem} · ${assertion.sourceId} · ${formatTimestamp(assertion.observedAt)}`}
            </span>
          </li>
        ))}
      </ul>

      <p>
        {observation === null
          ? 'No state observation'
          : `State: ${stateLabel(observation.state)} — reported by ${observation.sourceSystem} at ${formatTimestamp(observation.observedAt)}`}
      </p>

      {latestBySource.length === 0 ? null : (
        <div>
          <p className="font-medium">Sources disagree:</p>
          <ul>
            {latestBySource.map((entry) => (
              <li key={entry.id}>{`${entry.sourceSystem}: ${stateLabel(entry.state)}`}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
