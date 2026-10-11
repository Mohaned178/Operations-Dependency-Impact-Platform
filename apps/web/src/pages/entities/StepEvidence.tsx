import type {
  EntityEvidenceDto,
  EventEvidenceDto,
  NoteEvidenceDto,
  RelationshipEvidenceDto,
  RequirementSourceDto,
  StateRecordEvidenceDto,
} from '@opsgraph/shared';
import type { ReactNode } from 'react';
import { formatTimestamp } from '../../lib/format';
import { OriginBadge } from './OriginBadge';
import { StateBadge } from './StateBadge';

export interface StepEvidenceProps {
  evidence: EntityEvidenceDto;
  relationships?: RelationshipEvidenceDto[];
  /** Name of the entity the evidence is about, used in requirement-source lines. */
  entityName?: string;
  /** The hop as recorded, e.g. `Order #18492 REQUIRES Payment PAY-88213`, naming the relationships. */
  relationshipLabel?: string;
}

/** One step's evidence, grouped as in FR-011. Notes are read-only until the note form lands. */
export function StepEvidence({
  evidence,
  relationships = [],
  entityName = 'this entity',
  relationshipLabel,
}: StepEvidenceProps) {
  const notes: NoteEvidenceDto[] = [
    ...evidence.notes.items,
    ...relationships.flatMap((relationship) => relationship.notes.items),
  ];

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

      <Group title="Notes" isEmpty={notes.length === 0}>
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <NoteItem key={note.id} note={note} />
          ))}
        </ul>
      </Group>
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

function NoteItem({ note }: { note: NoteEvidenceDto }) {
  return (
    <li className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-dotted border-violet-400 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
          Manual
        </span>
        {note.active ? null : <span className="font-medium text-slate-700">retracted</span>}
      </span>
      <span>{note.text}</span>
      <span className="text-slate-600">{`Stance: ${note.stance} · Author: ${note.author.displayName}`}</span>
    </li>
  );
}
