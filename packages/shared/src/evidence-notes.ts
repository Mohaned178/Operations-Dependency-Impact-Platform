import { z } from 'zod';
import { PageQuerySchema } from './common';

export const EvidenceNoteStanceSchema = z.enum(['SUPPORTS', 'DISPUTES', 'CONTEXT']);
export type EvidenceNoteStance = z.infer<typeof EvidenceNoteStanceSchema>;

export const EVIDENCE_NOTE_LIMITS = { textMax: 2000, referenceMax: 500, reasonMax: 500 } as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const EvidenceNoteTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ENTITY'), entityId: z.string().uuid() }),
  z.object({ kind: z.literal('RELATIONSHIP'), relationshipId: z.string().uuid() }),
]);
export type EvidenceNoteTarget = z.infer<typeof EvidenceNoteTargetSchema>;

export const CreateEvidenceNoteRequestSchema = z
  .object({
    target: EvidenceNoteTargetSchema,
    stance: EvidenceNoteStanceSchema,
    text: trimmed(EVIDENCE_NOTE_LIMITS.textMax),
    reference: z
      .string()
      .trim()
      .max(EVIDENCE_NOTE_LIMITS.referenceMax)
      .optional()
      .transform((value) => (value === undefined || value === '' ? null : value)),
  })
  .strict();
export type CreateEvidenceNoteRequest = z.infer<typeof CreateEvidenceNoteRequestSchema>;

export const RetractEvidenceNoteRequestSchema = z
  .object({
    reason: trimmed(EVIDENCE_NOTE_LIMITS.reasonMax),
  })
  .strict();
export type RetractEvidenceNoteRequest = z.infer<typeof RetractEvidenceNoteRequestSchema>;

export const EvidenceNoteListQuerySchema = PageQuerySchema;
export type EvidenceNoteListQuery = z.infer<typeof EvidenceNoteListQuerySchema>;

export const UserRefDtoSchema = z.object({ id: z.string().uuid(), displayName: z.string() });
export type UserRefDto = z.infer<typeof UserRefDtoSchema>;

export const EvidenceNoteDtoSchema = z.object({
  id: z.string().uuid(),
  target: EvidenceNoteTargetSchema,
  stance: EvidenceNoteStanceSchema,
  text: z.string(),
  reference: z.string().nullable(),
  author: UserRefDtoSchema,
  createdAt: z.string().datetime(),
  /** False if and only if `retraction` is not null. */
  active: z.boolean(),
  retraction: z
    .object({
      retractedBy: UserRefDtoSchema,
      reason: z.string(),
      retractedAt: z.string().datetime(),
    })
    .nullable(),
});
export type EvidenceNoteDto = z.infer<typeof EvidenceNoteDtoSchema>;

export const EvidenceNoteListResponseSchema = z.object({
  items: z.array(EvidenceNoteDtoSchema),
  nextCursor: z.string().nullable(),
});
export type EvidenceNoteListResponse = z.infer<typeof EvidenceNoteListResponseSchema>;
