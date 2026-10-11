import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreateEvidenceNoteRequestSchema,
  EvidenceNoteDtoSchema,
  EvidenceNoteListResponseSchema,
  type EvidenceNoteTarget,
  type RetractEvidenceNoteRequest,
} from '@opsgraph/shared';
import type { z } from 'zod';
import { apiFetch } from '../../lib/api-client';

const PAGE_LIMIT = 50;

/** What the note form sends: `reference` may be omitted, the server turns empty into null. */
export type CreateEvidenceNoteInput = z.input<typeof CreateEvidenceNoteRequestSchema>;

export interface RetractEvidenceNoteInput extends RetractEvidenceNoteRequest {
  noteId: string;
}

export function evidenceNoteTargetId(target: EvidenceNoteTarget): string {
  return target.kind === 'ENTITY' ? target.entityId : target.relationshipId;
}

function listPath(target: EvidenceNoteTarget): string {
  return target.kind === 'ENTITY'
    ? `/entities/${target.entityId}/evidence-notes`
    : `/relationships/${target.relationshipId}/evidence-notes`;
}

/** Every note of one target, newest first, a page at a time. Used for "Show all n". */
export function useEvidenceNotes(target: EvidenceNoteTarget, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ['evidence-notes', target.kind, evidenceNoteTargetId(target)],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      return apiFetch(`${listPath(target)}?${params.toString()}`, {
        schema: EvidenceNoteListResponseSchema,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: options.enabled ?? true,
  });
}

/** A note changes the analysis (a DISPUTES note lowers confidence), so both caches are refreshed. */
function useInvalidateAfterNoteChange() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'evidence-notes' || query.queryKey[2] === 'root-cause',
    });
}

export function useCreateEvidenceNote() {
  const invalidate = useInvalidateAfterNoteChange();
  return useMutation({
    mutationFn: (input: CreateEvidenceNoteInput) =>
      apiFetch('/evidence-notes', { method: 'POST', body: input, schema: EvidenceNoteDtoSchema }),
    onSuccess: invalidate,
  });
}

export function useRetractEvidenceNote() {
  const invalidate = useInvalidateAfterNoteChange();
  return useMutation({
    mutationFn: ({ noteId, reason }: RetractEvidenceNoteInput) =>
      apiFetch(`/evidence-notes/${noteId}/retract`, {
        method: 'POST',
        body: { reason },
        schema: EvidenceNoteDtoSchema,
      }),
    onSuccess: invalidate,
  });
}
