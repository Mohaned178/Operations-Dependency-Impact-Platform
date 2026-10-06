import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BlockersResponse } from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockersSection } from './BlockersSection';
import { F1_BLOCKERS, F4_BLOCKERS, SHP_ID, tracedEntity } from './tracing-test-data';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BlockersSection entityId={SHP_ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function card(index: number): HTMLElement {
  const heading = screen.getByRole('heading', { name: `Path ${index}` });
  const article = heading.closest('article');
  if (article === null) {
    throw new Error(`No card for Path ${index}`);
  }
  return article;
}

describe('BlockersSection', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the summary and one card per path for F1-shaped data', async () => {
    apiFetchMock.mockResolvedValue(F1_BLOCKERS);
    const { container } = renderSection();

    expect(await screen.findByText(F1_BLOCKERS.summary)).toBeInTheDocument();
    expect(container.querySelector('section#blockers')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Blockers' })).toBeInTheDocument();

    expect(screen.getAllByRole('heading', { name: /^Path \d+$/ })).toHaveLength(2);
    const first = within(card(1));
    expect(
      first.getByText(
        'Shipment SHP-77120 (consolidated) is delayed because it depends on Order #18492, which is BLOCKED.',
      ),
    ).toBeInTheDocument();
    expect(first.queryByText('Manual · MEDIUM')).not.toBeInTheDocument();

    const second = within(card(2));
    expect(second.getAllByText('Manual · MEDIUM').length).toBeGreaterThan(0);
    expect(
      second.getByText(/blocks it \(manually recorded, medium confidence/),
    ).toBeInTheDocument();
    const blockerCalls = apiFetchMock.mock.calls.filter(
      ([path]) => path === `/entities/${SHP_ID}/blockers`,
    );
    expect(blockerCalls).toHaveLength(1);
  });

  it('lists the direct and deepest blockers as links', async () => {
    apiFetchMock.mockResolvedValue(F1_BLOCKERS);
    renderSection();

    await screen.findByText(F1_BLOCKERS.summary);
    const direct = screen.getByRole('heading', { name: 'Direct blockers' }).parentElement;
    const deepest = screen.getByRole('heading', { name: 'Deepest blockers' }).parentElement;
    if (direct === null || deepest === null) {
      throw new Error('expected the blocker lists');
    }
    expect(within(direct).getByRole('link', { name: 'Order #18492' })).toBeInTheDocument();
    expect(within(direct).getByRole('link', { name: 'Payment PAY-88213' })).toBeInTheDocument();
    expect(
      within(deepest).getByRole('link', { name: 'Budget code for Order #18492' }),
    ).toBeInTheDocument();
    expect(within(deepest).getByText('4 steps away')).toBeInTheDocument();
  });

  it('shows only the summary line when nothing blocks (F4 shape)', async () => {
    apiFetchMock.mockResolvedValue(F4_BLOCKERS);
    const { container } = renderSection();

    expect(await screen.findByText(F4_BLOCKERS.summary)).toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /^Path/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Direct blockers' })).not.toBeInTheDocument();
  });

  it('shows an alert when the request fails, and nothing else from the section', async () => {
    apiFetchMock.mockRejectedValue(new Error('down'));
    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load blockers.');
    expect(screen.getByRole('heading', { name: 'Blockers' })).toBeInTheDocument();
  });

  it('badges cycles, depth cuts and possible blockers, and shows the truncation notices', async () => {
    const unknown = tracedEntity(
      '77777777-7777-4777-8777-777777777777',
      'Order',
      'Mystery',
      'UNKNOWN',
    );
    const source = F1_BLOCKERS.paths[0];
    const hop = source?.hops[0];
    if (source === undefined || hop === undefined) {
      throw new Error('missing fixture');
    }
    const data: BlockersResponse = {
      ...F1_BLOCKERS,
      query: { ...F1_BLOCKERS.query, depth: 3 },
      truncation: { depthLimit: true, explorationLimit: true, pathLimit: true },
      cycleClosingHopCount: 2,
      paths: [
        {
          ...source,
          hops: [{ ...hop, entity: unknown }],
          length: 1,
          continuesBeyondDepth: true,
          endsInCycle: true,
        },
      ],
    };
    apiFetchMock.mockResolvedValue(data);
    renderSection();

    await screen.findByText(data.summary);
    const only = within(card(1));
    expect(only.getByText('Ends in a cycle')).toBeInTheDocument();
    expect(only.getByText('Continues beyond depth 3')).toBeInTheDocument();
    expect(only.getByText('Possible blocker (state unknown)')).toBeInTheDocument();

    expect(screen.getByText('Showing the first 100 blocking paths.')).toBeInTheDocument();
    expect(screen.getByText('Some chains continue beyond depth 3.')).toBeInTheDocument();
    expect(screen.getByText(/Exploration stopped after 10,000 entities/)).toBeInTheDocument();
    expect(
      screen.getByText('2 relationships close a dependency cycle and were not followed.'),
    ).toBeInTheDocument();
  });
});
