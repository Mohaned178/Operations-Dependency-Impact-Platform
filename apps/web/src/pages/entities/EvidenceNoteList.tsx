import {
  EVIDENCE_NOTE_LIMITS,
  type EvidenceNoteDto,
  type EvidenceNoteStance,
} from '@opsgraph/shared';
import { useId, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/useAuth';
import { formatTimestamp } from '../../lib/format';
import { useRetractEvidenceNote } from './useEvidenceNotes';

export interface EvidenceNoteListProps {
  /** Newest first, as the server sends them. Rendered in the order given. */
  notes: readonly EvidenceNoteDto[];
}

const STANCE_LABELS: Record<EvidenceNoteStance, string> = {
  SUPPORTS: 'Supports',
  DISPUTES: 'Disputes',
  CONTEXT: 'Context',
};

const STANCE_CLASSES: Record<EvidenceNoteStance, string> = {
  SUPPORTS: 'border-emerald-400 bg-emerald-50 text-emerald-800',
  DISPUTES: 'border-rose-400 bg-rose-50 text-rose-800',
  CONTEXT: 'border-slate-400 bg-slate-50 text-slate-700',
};

/** The notes of one target. Each note carries its own retract form state. */
export function EvidenceNoteList({ notes }: EvidenceNoteListProps) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} />
      ))}
    </ul>
  );
}

function NoteItem({ note }: { note: EvidenceNoteDto }) {
  const { user } = useAuth();
  const retract = useRetractEvidenceNote();
  const reasonId = useId();
  const [isRetracting, setIsRetracting] = useState(false);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const canRetract = note.active && (user?.id === note.author.id || user?.role === 'ADMIN');

  function openForm() {
    setReason('');
    setFormError(null);
    setIsRetracting(true);
  }

  function closeForm() {
    setIsRetracting(false);
    setReason('');
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed === '') {
      setFormError('A reason is required');
      return;
    }
    setFormError(null);
    try {
      await retract.mutateAsync({ noteId: note.id, reason: trimmed });
      closeForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to retract the note.');
    }
  }

  return (
    <li className="flex flex-col gap-1 rounded border bg-white p-3">
      <span className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded border px-2 py-0.5 text-xs font-medium ${STANCE_CLASSES[note.stance]}`}
        >
          {STANCE_LABELS[note.stance]}
        </span>
        <span className="rounded border border-dotted border-violet-400 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
          Manual
        </span>
        {note.active ? null : <span className="font-medium text-slate-700">Retracted</span>}
      </span>
      <span className={note.active ? undefined : 'line-through'}>{note.text}</span>
      {note.reference === null ? null : (
        <span className="text-slate-600">{`Reference: ${note.reference}`}</span>
      )}
      <span className="text-slate-500">
        {`${note.author.displayName} · ${formatTimestamp(note.createdAt)}`}
      </span>
      {note.retraction === null ? null : (
        <span className="text-slate-700">
          {`Retracted by ${note.retraction.retractedBy.displayName} on ${formatTimestamp(note.retraction.retractedAt)}: ${note.retraction.reason}`}
        </span>
      )}

      {canRetract && !isRetracting ? (
        <button
          type="button"
          onClick={openForm}
          className="w-fit rounded border px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
        >
          Retract
        </button>
      ) : null}

      {isRetracting ? (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          className="flex flex-col gap-2 pt-1"
        >
          <label htmlFor={reasonId} className="text-slate-700">
            Reason
          </label>
          <input
            id={reasonId}
            type="text"
            value={reason}
            maxLength={EVIDENCE_NOTE_LIMITS.reasonMax}
            onChange={(event) => setReason(event.target.value)}
            className="rounded border px-2 py-1 text-sm"
          />
          {formError === null ? null : (
            <p role="alert" className="text-rose-700">
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={retract.isPending}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-white disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="rounded border px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
