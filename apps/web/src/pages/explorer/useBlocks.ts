import { useQuery } from '@tanstack/react-query';
import { BLOCKER_RELATIONSHIP_TYPES, DependenciesResponseSchema } from '@opsgraph/shared';
import { apiFetch } from '../../lib/api-client';

/** research R11: what this entity blocks, one hop downstream over the blocking relationship types. */
export function useBlocks(id: string) {
  return useQuery({
    queryKey: ['entities', id, 'blocks'],
    queryFn: () =>
      apiFetch(
        `/entities/${id}/dependencies?direction=downstream&depth=1&relationshipTypes=${BLOCKER_RELATIONSHIP_TYPES.join(',')}&limit=200`,
        { schema: DependenciesResponseSchema },
      ),
    enabled: id !== '',
  });
}
