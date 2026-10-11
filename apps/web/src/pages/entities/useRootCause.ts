import { useQuery } from '@tanstack/react-query';
import { RootCauseResponseSchema } from '@opsgraph/shared';
import { apiFetch } from '../../lib/api-client';

/** One shared request for the root-cause section and the header callout. */
export function useRootCause(entityId: string) {
  return useQuery({
    queryKey: ['entities', entityId, 'root-cause'],
    queryFn: () =>
      apiFetch(`/entities/${entityId}/root-cause`, { schema: RootCauseResponseSchema }),
    enabled: entityId !== '',
  });
}
