import type { EvidenceNoteDto, EvidenceNoteStance, NoteEvidenceDto } from '@opsgraph/shared';

/** One evidence note joined to its author and, when retracted, its retraction. */
export interface EvidenceNoteRow {
  id: string;
  entityId: string | null;
  relationshipId: string | null;
  stance: EvidenceNoteStance;
  text: string;
  reference: string | null;
  authorId: string;
  authorName: string;
  createdAt: Date;
  retraction: {
    retractedById: string;
    retractedByName: string;
    reason: string;
    retractedAt: Date;
  } | null;
}

function toTarget(row: EvidenceNoteRow): EvidenceNoteDto['target'] {
  if (row.entityId !== null) {
    return { kind: 'ENTITY', entityId: row.entityId };
  }
  if (row.relationshipId !== null) {
    return { kind: 'RELATIONSHIP', relationshipId: row.relationshipId };
  }
  throw new Error(`evidence note ${row.id} has no target`);
}

/** A note is active if and only if it has no retraction (data-model §1c). */
export function toEvidenceNoteDto(row: EvidenceNoteRow): EvidenceNoteDto {
  return {
    id: row.id,
    target: toTarget(row),
    stance: row.stance,
    text: row.text,
    reference: row.reference,
    author: { id: row.authorId, displayName: row.authorName },
    createdAt: row.createdAt.toISOString(),
    active: row.retraction === null,
    retraction:
      row.retraction === null
        ? null
        : {
            retractedBy: { id: row.retraction.retractedById, displayName: row.retraction.retractedByName },
            reason: row.retraction.reason,
            retractedAt: row.retraction.retractedAt.toISOString(),
          },
  };
}

/** The same note as evidence on a chain step or hop (contracts/api.md `NoteEvidenceDto`). */
export function toNoteEvidenceDto(row: EvidenceNoteRow): NoteEvidenceDto {
  return { ...toEvidenceNoteDto(row), rule: 'MANUAL_NOTE', origin: 'MANUAL' };
}
