import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExplorerUrlParams } from '@opsgraph/shared';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNeighborhood } from './useNeighborhood';
import { smallResponse, uuid } from './test-fixtures';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', () => ({ apiFetch: apiFetchMock }));

const FOCUS_ID = uuid(1);
const PARAMS: ExplorerUrlParams = {
  direction: 'all',
  depth: 2,
  relationshipTypes: [],
  entityTypes: [],
  blockers: false,
};

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useNeighborhood', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    apiFetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
  });

  it('requests the neighborhood URL with the settings and expand list in order', async () => {
    const a = uuid(2);
    const b = uuid(3);
    apiFetchMock.mockResolvedValue(smallResponse());

    renderHook(() => useNeighborhood(FOCUS_ID, PARAMS, [a, b]), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    const path = apiFetchMock.mock.calls[0]?.[0] as string;
    const [pathname, search = ''] = path.split('?');
    expect(pathname).toBe(`/entities/${FOCUS_ID}/neighborhood`);
    expect(search).toContain('direction=all&depth=2&blockers=false');
    // URLSearchParams encodes the comma as %2C; decode before comparing.
    expect(new URLSearchParams(search).get('expand')).toBe(`${a},${b}`);
  });

  it('keeps the previous data while a new expand list loads', async () => {
    const first = smallResponse();
    let resolveSecond: (value: unknown) => void = () => undefined;
    apiFetchMock
      .mockResolvedValueOnce(first)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const { result, rerender } = renderHook(
      ({ expand }: { expand: readonly string[] }) => useNeighborhood(FOCUS_ID, PARAMS, expand),
      {
        wrapper: wrapperFor(queryClient),
        initialProps: { expand: [] as readonly string[] },
      },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(first);
    });

    rerender({ expand: [uuid(2)] });

    await waitFor(() => {
      expect(result.current.isPlaceholderData).toBe(true);
    });
    expect(result.current.data).toEqual(first);

    resolveSecond(smallResponse());

    await waitFor(() => {
      expect(result.current.isPlaceholderData).toBe(false);
    });
  });
});
