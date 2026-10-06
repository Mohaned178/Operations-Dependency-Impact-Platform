import { useBlockers } from './useBlockers';

export interface BlockerCalloutProps {
  entityId: string;
}

/** The most relevant answer above the fold: renders nothing unless something is blocking. */
export function BlockerCallout({ entityId }: BlockerCalloutProps) {
  const blockersQuery = useBlockers(entityId);

  const first = blockersQuery.data?.paths[0];
  if (blockersQuery.data === undefined || first === undefined) {
    return null;
  }

  return (
    <div
      role="note"
      className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm"
    >
      <p className="font-medium">{blockersQuery.data.summary}</p>
      <ul className="flex flex-col gap-1">
        {first.explanation.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <a href="#blockers" className="self-start underline">
        See all blocking paths
      </a>
    </div>
  );
}
