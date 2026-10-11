import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ImpactResponseSchema } from '@opsgraph/shared';
import { apiFetch } from '../../../lib/api-client';

export function useImpact(entityId: string, depth: number) {
  return useQuery({
    queryKey: ['entities', entityId, 'impact', depth],
    queryFn: () =>
      apiFetch(`/entities/${entityId}/impact?depth=${depth}`, { schema: ImpactResponseSchema }),
    enabled: entityId !== '',
    // The section stays on screen while a new depth loads.
    placeholderData: keepPreviousData,
  });
}
