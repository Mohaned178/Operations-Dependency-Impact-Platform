import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockerCallout } from './BlockerCallout';
import { BlockersSection } from './BlockersSection';
import { F1_BLOCKERS, F4_BLOCKERS, SHP_ID } from './tracing-test-data';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

function renderWith(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Lets the mocked request resolve and React Query notify its observers. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('BlockerCallout', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the summary, the first path sentences and a link to the Blockers section', async () => {
    apiFetchMock.mockResolvedValue(F1_BLOCKERS);
    renderWith(<BlockerCallout entityId={SHP_ID} />);

    expect(await screen.findByText(F1_BLOCKERS.summary)).toBeInTheDocument();
    for (const sentence of F1_BLOCKERS.paths[0]?.explanation ?? []) {
      expect(screen.getByText(sentence)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'See all blocking paths' })).toHaveAttribute(
      'href',
      '#blockers',
    );
  });

  it('renders nothing while loading, when nothing blocks, and on error', async () => {
    apiFetchMock.mockReturnValue(new Promise(() => undefined));
    const loading = renderWith(<BlockerCallout entityId={SHP_ID} />);
    expect(loading.container).toBeEmptyDOMElement();
    loading.unmount();

    apiFetchMock.mockResolvedValue(F4_BLOCKERS);
    const empty = renderWith(<BlockerCallout entityId={SHP_ID} />);
    await settle();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();

    apiFetchMock.mockRejectedValue(new Error('down'));
    const failed = renderWith(<BlockerCallout entityId={SHP_ID} />);
    await settle();
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    expect(failed.container).toBeEmptyDOMElement();
  });

  it('shares one request with the Blockers section', async () => {
    apiFetchMock.mockResolvedValue(F1_BLOCKERS);
    renderWith(
      <>
        <BlockerCallout entityId={SHP_ID} />
        <BlockersSection entityId={SHP_ID} />
      </>,
    );

    await screen.findAllByText(F1_BLOCKERS.summary);
    const blockerCalls = apiFetchMock.mock.calls.filter(
      ([path]) => path === `/entities/${SHP_ID}/blockers`,
    );
    expect(blockerCalls).toHaveLength(1);
  });
});
