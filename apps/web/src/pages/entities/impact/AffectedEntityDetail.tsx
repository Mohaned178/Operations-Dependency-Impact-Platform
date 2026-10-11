import { Link } from 'react-router';
import { PathView } from '../PathView';
import { asTraced, classificationLabel } from './impact-labels';
import { useImpactItem } from './useImpactItem';

export interface AffectedEntityDetailProps {
  /** The analyzed entity. */
  entityId: string;
  depth: number;
  /** The affected entity whose detail is shown. */
  targetId: string;
}

/** Every path to one affected entity and, for a customer, every attribution (research R8). */
export function AffectedEntityDetail({ entityId, depth, targetId }: AffectedEntityDetailProps) {
  const query = useImpactItem(entityId, depth, targetId);

  if (query.isPending) {
    return <p>Loading details…</p>;
  }
  if (query.isError) {
    return <p role="alert">Unable to load the details of this entity.</p>;
  }

  const { alternativePaths, attributions, attributionCount, start } = query.data;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <h4 className="font-semibold">Other paths</h4>
        {alternativePaths.length === 0 ? (
          <p>No other paths.</p>
        ) : (
          alternativePaths.map((path, index) => (
            <details key={path.hops.map((item) => item.key).join('/')}>
              <summary className="cursor-pointer text-slate-600">
                {`Alternative path ${index + 1} (${path.length} ${path.length === 1 ? 'hop' : 'hops'})`}
              </summary>
              <PathView start={start} path={path} direction="downstream" />
            </details>
          ))
        )}
      </div>

      {attributionCount > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="font-semibold">{`Attributions (${attributionCount})`}</h4>
          {attributionCount > attributions.length ? (
            <p>{`Showing ${attributions.length} of ${attributionCount}.`}</p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {attributions.map((attribution) => (
              <li key={attribution.entity.id} className="rounded border bg-white p-2">
                <p className="flex flex-wrap items-center gap-2">
                  <Link to={`/entities/${attribution.entity.id}`} className="font-medium underline">
                    {attribution.entity.displayName}
                  </Link>
                  <span className="text-slate-500">{attribution.entity.type}</span>
                  <span>{classificationLabel(attribution.classification)}</span>
                </p>
                <details>
                  <summary className="cursor-pointer text-slate-600">Link to the customer</summary>
                  <PathView
                    start={asTraced(attribution.entity)}
                    path={attribution.link}
                    direction="upstream"
                  />
                </details>
                <details>
                  <summary className="cursor-pointer text-slate-600">How it is affected</summary>
                  <PathView start={start} path={attribution.primaryPath} direction="downstream" />
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
