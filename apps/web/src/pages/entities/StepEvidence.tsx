import type {
  EntityEvidenceDto,
  EventEvidenceDto,
  EvidenceNoteDto,
  EvidenceNoteTarget,
  RelationshipEvidenceDto,
  RequirementSourceDto,
  StateRecordEvidenceDto,
} from '@opsgraph/shared';
import { useState, type ReactNode } from 'react';
import { formatTimestamp } from '../../lib/format';
import { EvidenceNoteForm, type EvidenceNoteFormTarget } from './EvidenceNoteForm';
import { EvidenceNoteList } from './EvidenceNoteList';
import { OriginBadge } from './OriginBadge';
import { StateBadge } from './StateBadge';
import { useEvidenceNotes } from './useEvidenceNotes';

export interface StepEvidenceProps {
  evidence: EntityEvidenceDto;
  relationships?: RelationshipEvidenceDto[];
  /** Name of the entity the evidence is about, used in requirement-source lines. */
  entityName?: string;
  /** The hop as recorded, e.g. `Order #18492 REQUIRES Payment PAY-88213`, naming the relationships. */
  relationshipLabel?: string;
  /** The first assertion id of the hop to this step: the target of a note about "the link". */
  linkRelationshipId?: string;
}

/** One step's evidence, grouped as in FR-011, with the notes on the entity and on the link to it. */
export function StepEvidence({
  evidence,
  relationships = [],
  entityName = 'this entity',
  relationshipLabel,
  linkRelationshipId,
}: StepEvidenceProps) {
  const [adding, setAdding] = useState(false);
  const entityTarget: EvidenceNoteTarget = { kind: 'ENTITY', entityId: evidence.entityId };
  const noteTargets: EvidenceNoteFormTarget[] = [{ label: 'this entity', target: entityTarget }];
  if (linkRelationshipId !== undefined && relationshipLabel !== undefined) {
    noteTargets.push({
      label: `the link: ${relationshipLabel}`,
      target: { kind: 'RELATIONSHIP', relationshipId: linkRelationshipId },
    });
  }
  const hasNotes =
    evidence.notes.total > 0 || relationships.some((relationship) => relationship.notes.total > 0);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <Group title="State records" isEmpty={evidence.stateRecords.length === 0}>
        <ul className="flex flex-col gap-2">
          {evidence.stateRecords.map((record) => (
            <StateRecordItem key={record.sourceRecord.id} record={record} />
          ))}
        </ul>
      </Group>

      <Group title="Relationship records" isEmpty={relationships.length === 0}>
        <ul className="flex flex-col gap-2">
          {relationships.map((relationship) => (
            <RelationshipItem
              key={relationship.relationshipId}
              relationship={relationship}
              label={relationshipLabel}
            />
          ))}
        </ul>
      </Group>

      <Group
        title={
          evidence.requirementSources.total > evidence.requirementSources.items.length
            ? `Requirement sources (${evidence.requirementSources.items.length} of ${evidence.requirementSources.total})`
            : 'Requirement sources'
        }
        isEmpty={evidence.requirementSources.items.length === 0}
      >
        <ul className="flex flex-col gap-2">
          {evidence.requirementSources.items.map((source) => (
            <RequirementSourceItem
              key={source.relationship.id}
              source={source}
              entityName={entityName}
            />
          ))}
        </ul>
      </Group>

      <Group
        title={`Events (${evidence.events.items.length} of ${evidence.events.total})`}
        isEmpty={evidence.events.items.length === 0}
      >
        <ul className="flex flex-col gap-2">
          {evidence.events.items.map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
        </ul>
      </Group>

      <Group title="Notes" isEmpty={!hasNotes}>
        <div className="flex flex-col gap-3">
          <NotesOfTarget
            heading={relationships.length > 0 ? 'On this entity' : null}
            target={entityTarget}
            notes={evidence.notes.items}
            total={evidence.notes.total}
          />
          {relationships.map((relationship) => (
            <NotesOfTarget
              key={relationship.relationshipId}
              heading={relationshipLabel === undefined ? 'On the link' : `On the link: ${relationshipLabel}`}
              target={{ kind: 'RELATIONSHIP', relationshipId: relationship.relationshipId }}
              notes={relationship.notes.items}
              total={relationship.notes.total}
              linkSuffix=" on the link"
            />
          ))}
        </div>
      </Group>

      {adding ? (
        <section className="flex flex-col gap-2">
          <h4 className="font-medium">Add note</h4>
          <EvidenceNoteForm
            targets={noteTargets}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-fit rounded border px-2 py-1 text-slate-700 hover:bg-slate-100"
        >
          Add note
        </button>
      )}
    </div>
  );
}

interface GroupProps {
  title: string;
  isEmpty: boolean;
  children: ReactNode;
}

function Group({ title, isEmpty, children }: GroupProps) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="font-medium">{title}</h4>
      {isEmpty ? <p className="text-slate-500">None</p> : children}
    </section>
  );
}

function sourceLine(system: string, id: string, observedAt: string): string {
  return `${system} · ${id} · ${formatTimestamp(observedAt)}`;
}

function StateRecordItem({ record }: { record: StateRecordEvidenceDto }) {
  const { sourceRecord, observation } = record;
  return (
    <li className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <StateBadge state={observation.state} />
        <span>{record.current ? 'Current state' : 'Other source'}</span>
      </span>
      <span className="text-slate-500">
        {sourceLine(sourceRecord.sourceSystem, sourceRecord.sourceId, sourceRecord.observedAt)}
      </span>
    </li>
  );
}

interface RelationshipItemProps {
  relationship: RelationshipEvidenceDto;
  label: string | undefined;
}

function RelationshipItem({ relationship, label }: RelationshipItemProps) {
  const { record } = relationship;
  return (
    <li className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span>{label ?? `Relationship ${relationship.relationshipId}`}</span>
        {relationship.origin === 'SOURCE' ? null : (
          <OriginBadge origin={relationship.origin} confidence={relationship.confidence} />
        )}
      </span>
      <span className="text-slate-500">
        {record === null
          ? 'No source record'
          : sourceLine(record.sourceSystem, record.sourceId, record.observedAt)}
      </span>
    </li>
  );
}

function attributeText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

interface RequirementSourceItemProps {
  source: RequirementSourceDto;
  entityName: string;
}

function RequirementSourceItem({ source, entityName }: RequirementSourceItemProps) {
  const { relationship, entity, attributes } = source;
  return (
    <li className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span>{`${entity.displayName} ${relationship.type} ${entityName}`}</span>
        {source.origin === 'SOURCE' ? null : (
          <OriginBadge origin={source.origin} confidence={source.confidence} />
        )}
      </span>
      <span className="text-slate-500">
        {sourceLine(relationship.sourceSystem, relationship.sourceId, relationship.observedAt)}
      </span>
      {Object.entries(attributes).map(([key, value]) => (
        <span key={key} className="text-slate-600">
          {`${key}: ${attributeText(value)}`}
        </span>
      ))}
    </li>
  );
}

function EventItem({ event }: { event: EventEvidenceDto }) {
  return (
    <li className="flex flex-col gap-1">
      <span className="font-medium">{event.eventType}</span>
      {event.description === null ? null : <span>{event.description}</span>}
      <span>{`Role: ${event.role === 'SUBJECT' ? 'Subject' : 'Related'}`}</span>
      <span className="text-slate-500">{`Occurred ${formatTimestamp(event.occurredAt)}`}</span>
      <span className="text-slate-500">
        {sourceLine(event.sourceSystem, event.sourceId, event.observedAt)}
      </span>
    </li>
  );
}

interface NotesOfTargetProps {
  heading: string | null;
  target: EvidenceNoteTarget;
  notes: readonly EvidenceNoteDto[];
  total: number;
  linkSuffix?: string;
}

/** The notes already in the analysis for one target; "Show all n" pages in the rest. */
function NotesOfTarget({ heading, target, notes, total, linkSuffix = '' }: NotesOfTargetProps) {
  const [showAll, setShowAll] = useState(false);
  if (total === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {heading === null ? null : <h5 className="text-slate-600">{heading}</h5>}
      {showAll ? (
        <AllNotes target={target} />
      ) : (
        <>
          <EvidenceNoteList notes={notes} />
          {total > notes.length ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-fit text-slate-600 underline"
            >
              {`Show all ${total}${linkSuffix}`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function AllNotes({ target }: { target: EvidenceNoteTarget }) {
  const query = useEvidenceNotes(target);
  const notes = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isError) {
    return <p role="alert">Unable to load the notes.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {query.isPending ? <p>Loading…</p> : <EvidenceNoteList notes={notes} />}
      {query.hasNextPage ? (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="w-fit text-slate-600 underline"
        >
          Load more notes
        </button>
      ) : null}
    </div>
  );
}
