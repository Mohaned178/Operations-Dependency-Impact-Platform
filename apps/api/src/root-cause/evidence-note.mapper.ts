import type { Prisma } from '@prisma/client';
import type { EvidenceNoteDto, EvidenceNoteStance, NoteEvidenceDto } from '@opsgraph/shared';
import { compareCodeUnits } from '../graph/traversal/path-order';

/** The `evidence_notes` column that names a note's target. Always one of these two literals. */
export type NoteTargetColumn = 'entity_id' | 'relationship_id';

/**
 * The one note order (contracts/api.md): createdAt descending, then id descending, both by code
 * units. `createdAt` is the millisecond ISO string, so SQL that picks the top N must order by
 * `date_trunc('milliseconds', created_at)` to agree with it.
 */
export function compareNotesNewestFirst(a: EvidenceNoteDto, b: EvidenceNoteDto): number {
  return compareCodeUnits(b.createdAt, a.createdAt) || compareCodeUnits(b.id, a.id);
}

/** What `EvidenceNotesService` loads: the note with its author and, when retracted, who retracted it. */
export const EVIDENCE_NOTE_INCLUDE = {
  author: true,
  retraction: { include: { retractedBy: true } },
} satisfies Prisma.EvidenceNoteInclude;

export type EvidenceNoteWithRelations = Prisma.EvidenceNoteGetPayload<{
  include: typeof EVIDENCE_NOTE_INCLUDE;
}>;

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

function fromPrismaNote(note: EvidenceNoteWithRelations): EvidenceNoteRow {
  return {
    id: note.id,
    entityId: note.entityId,
    relationshipId: note.relationshipId,
    stance: note.stance,
    text: note.text,
    reference: note.reference,
    authorId: note.authorId,
    authorName: note.author.displayName,
    createdAt: note.createdAt,
    retraction:
      note.retraction === null
        ? null
        : {
            retractedById: note.retraction.retractedById,
            retractedByName: note.retraction.retractedBy.displayName,
            reason: note.retraction.reason,
            retractedAt: note.retraction.retractedAt,
          },
  };
}

/**
 * A note is active if and only if it has no retraction (data-model §1c). Accepts the Prisma row
 * (with its author and retraction included) or the flattened row `EvidenceReader` builds from SQL.
 */
export function toEvidenceNoteDto(source: EvidenceNoteRow | EvidenceNoteWithRelations): EvidenceNoteDto {
  const row = 'author' in source ? fromPrismaNote(source) : source;
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
export function toNoteEvidenceDto(
  source: EvidenceNoteRow | EvidenceNoteWithRelations,
): NoteEvidenceDto {
  return { ...toEvidenceNoteDto(source), rule: 'MANUAL_NOTE', origin: 'MANUAL' };
}
