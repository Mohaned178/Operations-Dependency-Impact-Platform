import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { R1_ORDER, R4_NOT_BLOCKED, R5_UNEXPLAINED } from './root-cause-test-data';
import { RootCauseSection } from './RootCauseSection';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

function renderSection(entityId = R1_ORDER.query.entityId) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootCauseSection entityId={entityId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootCauseSection', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('is the #root-cause section with a Root cause heading and a loading line', () => {
    apiFetchMock.mockReturnValue(new Promise(() => undefined));
    const { container } = renderSection();

    expect(container.querySelector('section#root-cause')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Root cause' })).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows its own alert when the request fails, without throwing', async () => {
    apiFetchMock.mockRejectedValue(new Error('down'));
    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the root cause.');
    expect(screen.getByRole('heading', { level: 2, name: 'Root cause' })).toBeInTheDocument();
  });

  it('requests the root-cause endpoint of the entity', async () => {
    apiFetchMock.mockResolvedValue(R1_ORDER);
    renderSection();

    await screen.findByText(R1_ORDER.summary);
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe(`/entities/${R1_ORDER.query.entityId}/root-cause`);
  });

  it('NOT_BLOCKED: a single line with the summary and no candidates', async () => {
    apiFetchMock.mockResolvedValue(R4_NOT_BLOCKED);
    renderSection(R4_NOT_BLOCKED.query.entityId);

    expect(await screen.findByText(R4_NOT_BLOCKED.summary)).toBeInTheDocument();
    expect(screen.queryByText(/Root cause: /)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'State records' })).toBeNull();
  });

  it('UNEXPLAINED: the summary plus the start entity evidence', async () => {
    apiFetchMock.mockResolvedValue(R5_UNEXPLAINED);
    renderSection(R5_UNEXPLAINED.query.entityId);

    expect(await screen.findByText(R5_UNEXPLAINED.summary)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'State records' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requirement sources' })).toBeInTheDocument();
    expect(screen.getByText(/Contract CON-4330 GOVERNS/)).toBeInTheDocument();
  });

  it('ROOT_CAUSES_FOUND: the summary, then one candidate per root cause', async () => {
    apiFetchMock.mockResolvedValue(R1_ORDER);
    renderSection();

    expect(await screen.findByText(R1_ORDER.summary)).toBeInTheDocument();
    const [candidate] = R1_ORDER.candidates;
    expect(screen.getByText(candidate?.explanation.headline ?? 'missing')).toBeInTheDocument();
  });
});
