import { useQuery } from '@tanstack/react-query';
import { SourceRecordListResponseSchema, type NeighborhoodNodeDto } from '@opsgraph/shared';
import { Link } from 'react-router';
import { apiFetch } from '../../lib/api-client';
import { formatTimestamp } from '../../lib/format';
import { OriginBadge } from '../entities/OriginBadge';
import { StateBadge, stateLabel } from '../entities/StateBadge';
import { useBlockers } from '../entities/useBlockers';
import { hasConflict } from './NodeChips';
import { useBlocks } from './useBlocks';

export const PANEL_CLASS =
  'absolute right-0 top-0 z-10 h-full w-[360px] overflow-y-auto border-l bg-white p-4 shadow-lg';

export interface EntityLinksProps {
  id: string;
  name: string;
  /** Canonical settings query string for the secondary Explore link. */
  search: string;
}

/** Spec FR-025: every entity named in a panel links to Entity 360 and can be explored. */
export function EntityLinks({ id, name, search }: EntityLinksProps) {
  return (
    <>
      <Link to={`/entities/${id}`} className="font-medium underline">
        {name}
      </Link>{' '}
      <Link
        to={search === '' ? `/graph/${id}` : `/graph/${id}?${search}`}
        className="text-xs text-slate-500 underline"
        aria-label={`Explore ${name}`}
      >
        Explore
      </Link>
    </>
  );
}

export interface NodeDetailsPanelProps {
  node: NeighborhoodNodeDto;
  /** Canonical explorer settings, for the Explore links. */
  search: string;
  onClose: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-sm font-semibold">{children}</h3>;
}

function BlockedBy({ node, search }: { node: NeighborhoodNodeDto; search: string }) {
  const blockers = useBlockers(node.id);
  return (
    <section className="flex flex-col gap-1">
      <SectionTitle>Blocked by</SectionTitle>
      {blockers.isPending ? <p className="text-sm">Loading…</p> : null}
      {blockers.isError ? <p role="alert" className="text-sm">Unable to load blockers.</p> : null}
      {blockers.isSuccess && blockers.data.directBlockers.length === 0 ? (
        <p className="text-sm">{`No blockers found within ${blockers.data.query.depth} steps.`}</p>
      ) : null}
      {blockers.isSuccess ? (
        <ul className="flex flex-col gap-1 text-sm">
          {blockers.data.directBlockers.map((blocker) => (
            <li key={blocker.entity.id} className="flex flex-wrap items-center gap-2">
              <EntityLinks id={blocker.entity.id} name={blocker.entity.displayName} search={search} />
              <StateBadge state={blocker.entity.currentState} />
              {blocker.possible ? <span className="text-slate-500">Possible blocker</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Blocks({ node, search }: { node: NeighborhoodNodeDto; search: string }) {
  const satisfied = node.state.classification === 'SATISFIED';
  // A satisfied entity blocks nothing (feature 003 FR-006), so nothing is requested for it.
  const blocks = useBlocks(satisfied ? '' : node.id);
  return (
    <section className="flex flex-col gap-1">
      <SectionTitle>Blocks</SectionTitle>
      {satisfied ? (
        <p className="text-sm">{`${stateLabel(node.currentState)} — not blocking anything.`}</p>
      ) : null}
      {!satisfied && blocks.isPending ? <p className="text-sm">Loading…</p> : null}
      {!satisfied && blocks.isError ? <p role="alert" className="text-sm">Unable to load dependents.</p> : null}
      {!satisfied && blocks.isSuccess && blocks.data.items.length === 0 ? (
        <p className="text-sm">Nothing depends on it through REQUIRES, DEPENDS_ON or BLOCKS.</p>
      ) : null}
      {!satisfied && blocks.isSuccess ? (
        <ul className="flex flex-col gap-1 text-sm">
          {blocks.data.items.map((item) => {
            const first = item.path.hops[0];
            return (
              <li key={item.entity.id} className="flex flex-wrap items-center gap-2">
                <EntityLinks id={item.entity.id} name={item.entity.displayName} search={search} />
                <StateBadge state={item.entity.currentState} />
                {first === undefined ? null : (
                  <OriginBadge origin={first.effectiveOrigin} confidence={first.effectiveConfidence} />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function Evidence({ node }: { node: NeighborhoodNodeDto }) {
  const records = useQuery({
    queryKey: ['entities', node.id, 'source-records', 'first10'],
    queryFn: () =>
      apiFetch(`/entities/${node.id}/source-records?limit=10`, {
        schema: SourceRecordListResponseSchema,
      }),
  });
  return (
    <section className="flex flex-col gap-1">
      <SectionTitle>Evidence</SectionTitle>
      {records.isPending ? <p className="text-sm">Loading…</p> : null}
      {records.isError ? <p role="alert" className="text-sm">Unable to load source records.</p> : null}
      {records.isSuccess && records.data.items.length === 0 ? (
        <p className="text-sm">No source records.</p>
      ) : null}
      {records.isSuccess ? (
        <ul className="flex flex-col gap-1 text-sm">
          {records.data.items.map((record) => (
            <li key={record.id}>
              {`${record.sourceSystem} · ${record.sourceId} · observed ${formatTimestamp(record.observedAt)}`}
            </li>
          ))}
        </ul>
      ) : null}
      <Link to={`/entities/${node.id}`} className="text-sm underline">
        See all on Entity 360
      </Link>
    </section>
  );
}

/** Contract ui.md §14: what a selected entity is, what blocks it, what it blocks, and its evidence. */
export function NodeDetailsPanel({ node, search, onClose }: NodeDetailsPanelProps) {
  const observation = node.state.observation;
  return (
    <aside className={PANEL_CLASS} aria-label={`Details of ${node.displayName}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{node.type}</p>
          <h2 className="text-base font-semibold">{node.displayName}</h2>
          <p className="break-all text-xs text-slate-500">{node.id}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded border px-2 py-1 text-sm">
          Close
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <section className="flex flex-col gap-1">
          <SectionTitle>State</SectionTitle>
          <div>
            <StateBadge state={node.currentState} />
          </div>
          {observation === null ? (
            <p className="text-sm text-slate-500">No state observation recorded.</p>
          ) : (
            <p className="text-sm">{`Reported by ${observation.sourceSystem} · ${formatTimestamp(observation.observedAt)}`}</p>
          )}
          {hasConflict(node) ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-amber-800">Sources disagree on this entity's state:</p>
              <ul className="flex flex-col gap-1 text-sm">
                {node.state.latestBySource.map((entry) => (
                  <li key={entry.id}>
                    {`${entry.sourceSystem}: ${stateLabel(entry.state)} · ${formatTimestamp(entry.observedAt)}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <BlockedBy node={node} search={search} />
        <Blocks node={node} search={search} />
        <Evidence node={node} />

        <div className="flex flex-wrap gap-3 text-sm">
          <Link to={`/entities/${node.id}`} className="underline">
            Open Entity 360
          </Link>
        </div>
      </div>
    </aside>
  );
}
