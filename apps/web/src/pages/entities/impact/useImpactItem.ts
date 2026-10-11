import { useQuery } from '@tanstack/react-query';
import { ImpactItemDetailResponseSchema } from '@opsgraph/shared';
import { apiFetch } from '../../../lib/api-client';

/** Loaded only while a row is expanded: pass the target id then, and null otherwise. */
export function useImpactItem(entityId: string, depth: number, targetId: string | null) {
  return useQuery({
    queryKey: ['entities', entityId, 'impact', depth, 'item', targetId],
    queryFn: () =>
      apiFetch(`/entities/${entityId}/impact/items/${targetId}?depth=${depth}`, {
        schema: ImpactItemDetailResponseSchema,
      }),
    enabled: entityId !== '' && targetId !== null,
  });
}
