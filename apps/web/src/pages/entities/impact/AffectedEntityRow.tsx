import { useState } from 'react';
import type { AffectedEntityDto, TracedEntityDto } from '@opsgraph/shared';
import { Link } from 'react-router';
import { formatMoney } from '../../../lib/format';
import { PathView } from '../PathView';
import { StateBadge } from '../StateBadge';
import { AffectedEntityDetail } from './AffectedEntityDetail';
import { asTraced, classificationLabel, stepsText } from './impact-labels';

const BADGE = 'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium';

export interface AffectedEntityRowProps {
  item: AffectedEntityDto;
  /** The analyzed entity, where every primary path starts. */
  start: TracedEntityDto;
  depth: number;
}

export function AffectedEntityRow({ item, start, depth }: AffectedEntityRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { entity, flags, weakest, value } = item;
  const hiddenAttributions = item.attributionCount - item.attributions.length;

  return (
    <li className="flex flex-col gap-2 rounded border bg-white p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Link to={`/entities/${entity.id}`} className="font-medium underline">
          {entity.displayName}
        </Link>
        <span className="text-slate-500">{entity.type}</span>
        <StateBadge state={entity.currentState} />
        <span className={`${BADGE} border-slate-300 bg-slate-50 text-slate-800`}>
          {classificationLabel(item.classification)}
        </span>
        <span className="text-slate-500">
          {item.distance === null ? 'via attribution' : stepsText(item.distance)}
        </span>
        {entity.type === 'Order' ? (
          <span>
            {value?.current ? formatMoney(value.current.amount, value.current.currency) : 'No recorded value'}
          </span>
        ) : null}
        {item.pathCount > 0 ? (
          <span className="text-slate-500">
            {`${item.pathCount}${item.morePaths ? '+' : ''} ${item.pathCount === 1 && !item.morePaths ? 'path' : 'paths'}`}
          </span>
        ) : null}
      </p>

      {flags.inferredOnly || flags.stateUnknown || flags.otherCause || value?.disagreement === true ? (
        <p className="flex flex-wrap items-center gap-2">
          {flags.inferredOnly ? (
            <span className={`${BADGE} border-dashed border-amber-400 bg-amber-50 text-amber-800`}>
              {weakest === null
                ? 'Only inferred links'
                : `Only inferred links (${weakest.origin} / ${weakest.confidence})`}
            </span>
          ) : null}
          {flags.stateUnknown ? (
            <span className={`${BADGE} border-slate-300 bg-slate-100 text-slate-700`}>State unknown</span>
          ) : null}
          {flags.otherCause ? (
            <span className={`${BADGE} border-orange-300 bg-orange-50 text-orange-800`}>
              Impaired for another reason
            </span>
          ) : null}
          {value?.disagreement === true ? (
            <span className={`${BADGE} border-violet-300 bg-violet-50 text-violet-800`}>
              Sources disagree on the value
            </span>
          ) : null}
        </p>
      ) : null}

      {item.primaryPath !== null ? (
        <details>
          <summary className="cursor-pointer text-slate-600">Path</summary>
          <PathView start={start} path={item.primaryPath} direction="downstream" />
        </details>
      ) : null}
      {item.shortestPath !== null ? (
        <details>
          <summary className="cursor-pointer text-slate-600">Shortest path</summary>
          <PathView start={start} path={item.shortestPath} direction="downstream" />
        </details>
      ) : null}

      {item.attributions.length > 0 ? (
        <div>
          <p className="font-semibold">Attributed through</p>
          <ul className="flex flex-col gap-1">
            {item.attributions.map((attribution) => (
              <li key={attribution.entity.id}>
                <p className="flex flex-wrap items-center gap-2">
                  <Link to={`/entities/${attribution.entity.id}`} className="underline">
                    {attribution.entity.displayName}
                  </Link>
                  <span className="text-slate-500">{classificationLabel(attribution.classification)}</span>
                </p>
                <details>
                  <summary className="cursor-pointer text-slate-600">Link to the customer</summary>
                  <PathView
                    start={asTraced(attribution.entity)}
                    path={attribution.link}
                    direction="upstream"
                  />
                </details>
              </li>
            ))}
          </ul>
          {hiddenAttributions > 0 ? <p className="text-slate-600">{`and ${hiddenAttributions} more`}</p> : null}
        </div>
      ) : null}

      <div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {expanded ? (
        <AffectedEntityDetail entityId={start.id} depth={depth} targetId={entity.id} />
      ) : null}
    </li>
  );
}
