import { useInfiniteQuery } from '@tanstack/react-query';
import { ImpactListResponseSchema, type ImpactListSelector } from '@opsgraph/shared';
import { apiFetch } from '../../../lib/api-client';
import { toImpactListQueryString } from './impact-params';

/** One drill-down list, loaded page by page through nextCursor. Idle while no selector is open. */
export function useImpactList(
  entityId: string,
  depth: number,
  selector: ImpactListSelector | null,
) {
  return useInfiniteQuery({
    queryKey: ['entities', entityId, 'impact', depth, 'items', selector],
    queryFn: ({ pageParam }) => {
      if (selector === null) {
        throw new Error('impact list requested without a selector');
      }
      return apiFetch(
        `/entities/${entityId}/impact/items${toImpactListQueryString(depth, selector, pageParam, 50)}`,
        { schema: ImpactListResponseSchema },
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: entityId !== '' && selector !== null,
  });
}
