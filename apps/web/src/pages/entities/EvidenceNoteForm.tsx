import {
  CreateEvidenceNoteRequestSchema,
  EVIDENCE_NOTE_LIMITS,
  type EvidenceNoteStance,
  type EvidenceNoteTarget,
} from '@opsgraph/shared';
import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api-client';
import { type CreateEvidenceNoteInput, useCreateEvidenceNote } from './useEvidenceNotes';

export interface EvidenceNoteFormTarget {
  label: string;
  target: EvidenceNoteTarget;
}

export interface EvidenceNoteFormProps {
  targets: readonly EvidenceNoteFormTarget[];
  /** Called after a successful submit. */
  onDone?: () => void;
  /** When given, a "Cancel" button calls it. */
  onCancel?: () => void;
}

const STANCES: readonly { value: EvidenceNoteStance; label: string }[] = [
  { value: 'SUPPORTS', label: 'Supports' },
  { value: 'DISPUTES', label: 'Disputes' },
  { value: 'CONTEXT', label: 'Context' },
];

const FALLBACK_ERROR = 'Unable to save the note.';

function serverErrorLines(error: unknown): string[] {
  if (error instanceof ApiError && error.details !== undefined && error.details.length > 0) {
    return error.details.map((detail) => `${detail.path}: ${detail.message}`);
  }
  if (error instanceof Error && error.message !== '') {
    return [error.message];
  }
  return [FALLBACK_ERROR];
}

/** Adds a stance-tagged note to one entity or relationship, validated before any network call. */
export function EvidenceNoteForm({ targets, onDone, onCancel }: EvidenceNoteFormProps) {
  const id = useId();
  const create = useCreateEvidenceNote();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [stance, setStance] = useState<EvidenceNoteStance | null>(null);
  const [text, setText] = useState('');
  const [reference, setReference] = useState('');
  const [stanceError, setStanceError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const selected = targets[selectedIndex] ?? targets[0];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextStanceError = stance === null ? 'Choose a stance' : null;
    const nextTextError = text.trim() === '' ? 'Enter the note text' : null;
    setStanceError(nextStanceError);
    setTextError(nextTextError);
    setServerErrors([]);
    if (selected === undefined || stance === null || nextStanceError !== null || nextTextError !== null) {
      return;
    }

    const trimmedReference = reference.trim();
    const input: CreateEvidenceNoteInput = {
      target: selected.target,
      stance,
      text: text.trim(),
      ...(trimmedReference === '' ? {} : { reference: trimmedReference }),
    };
    if (!CreateEvidenceNoteRequestSchema.safeParse(input).success) {
      setServerErrors(['Check the note fields and try again']);
      return;
    }

    try {
      await create.mutateAsync(input);
    } catch (error: unknown) {
      setServerErrors(serverErrorLines(error));
      return;
    }
    setSelectedIndex(0);
    setStance(null);
    setText('');
    setReference('');
    onDone?.();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-3 text-sm">
      {targets.length > 1 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">Attach to</legend>
          {targets.map((option, index) => (
            <label key={index} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-target`}
                value={index}
                checked={selectedIndex === index}
                onChange={() => setSelectedIndex(index)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Stance</legend>
        <div className="flex flex-wrap gap-4">
          {STANCES.map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-stance`}
                value={option.value}
                checked={stance === option.value}
                onChange={() => setStance(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
        {stanceError !== null ? (
          <p role="alert" className="text-red-700">
            {stanceError}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className="font-medium">
          Note
        </label>
        <textarea
          id={`${id}-text`}
          required
          maxLength={EVIDENCE_NOTE_LIMITS.textMax}
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="rounded border px-2 py-1"
        />
        <span className="text-xs text-slate-600">
          {`${text.length} / ${EVIDENCE_NOTE_LIMITS.textMax}`}
        </span>
        {textError !== null ? (
          <p role="alert" className="text-red-700">
            {textError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-reference`} className="font-medium">
          Reference (optional)
        </label>
        <input
          id={`${id}-reference`}
          type="text"
          maxLength={EVIDENCE_NOTE_LIMITS.referenceMax}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          className="rounded border px-2 py-1"
        />
      </div>

      {serverErrors.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 text-red-700">
          {serverErrors.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded border border-slate-400 bg-slate-100 px-3 py-1 font-medium disabled:opacity-50"
        >
          Save note
        </button>
        {onCancel !== undefined ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border px-3 py-1"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
