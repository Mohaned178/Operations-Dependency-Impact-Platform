import { useQuery } from '@tanstack/react-query';
import { BlockersResponseSchema } from '@opsgraph/shared';
import { apiFetch } from '../../lib/api-client';

/** One shared request for the blocker callout and the Blockers section. */
export function useBlockers(entityId: string) {
  return useQuery({
    queryKey: ['entities', entityId, 'blockers'],
    queryFn: () => apiFetch(`/entities/${entityId}/blockers`, { schema: BlockersResponseSchema }),
    enabled: entityId !== '',
  });
}
