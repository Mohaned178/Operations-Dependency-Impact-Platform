import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { NeighborhoodResponseSchema, type ExplorerUrlParams } from '@opsgraph/shared';
import { apiFetch } from '../../lib/api-client';
import { toNeighborhoodQueryString } from './explorer-params';

/** research R11: neighborhood request; the previous graph stays on screen while a new expand list loads. */
export function useNeighborhood(id: string, params: ExplorerUrlParams, expand: readonly string[]) {
  return useQuery({
    queryKey: ['entities', id, 'neighborhood', params, expand],
    queryFn: () =>
      apiFetch(`/entities/${id}/neighborhood?${toNeighborhoodQueryString(params, expand)}`, {
        schema: NeighborhoodResponseSchema,
      }),
    placeholderData: keepPreviousData,
    enabled: id !== '',
  });
}
