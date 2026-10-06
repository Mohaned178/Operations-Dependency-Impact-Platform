import type { PathDto, TracedEntityDto } from '@opsgraph/shared';
import { Link } from 'react-router';
import { HopEvidence } from './HopEvidence';
import { OriginBadge } from './OriginBadge';
import { StateBadge } from './StateBadge';

export interface PathViewProps {
  start: TracedEntityDto;
  path: PathDto;
  direction: 'upstream' | 'downstream';
}

export function PathView({ start, path, direction }: PathViewProps) {
  const arrow = direction === 'upstream' ? '↑' : '↓';
  const names = new Map<string, string>([[start.id, start.displayName]]);
  for (const hop of path.hops) {
    names.set(hop.entity.id, hop.entity.displayName);
  }
  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <ol className="flex flex-col gap-2">
      {path.hops.map((hop) => (
        <li key={hop.key} className="rounded border bg-white p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="text-slate-500">
              {arrow}
            </span>
            <span>{`${nameOf(hop.fromEntityId)} ${hop.relationshipType} ${nameOf(hop.toEntityId)}`}</span>
            <OriginBadge origin={hop.effectiveOrigin} confidence={hop.effectiveConfidence} />
          </p>
          <p className="mt-1 flex items-center gap-2">
            <Link to={`/entities/${hop.entity.id}`} className="font-medium underline">
              {hop.entity.displayName}
            </Link>
            <StateBadge state={hop.entity.currentState} />
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-slate-600">Evidence</summary>
            <HopEvidence hop={hop} />
          </details>
        </li>
      ))}
    </ol>
  );
}
