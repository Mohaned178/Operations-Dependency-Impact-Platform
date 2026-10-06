import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDetailDto } from '@opsgraph/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurrentStateSection } from './CurrentStateSection';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

const ENTITY_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const IMPORT_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70';

function detail(overrides: Partial<EntityDetailDto> = {}): EntityDetailDto {
  return {
    id: ENTITY_ID,
    type: 'Order',
    displayName: 'Order #18492',
    attributes: { amount: '12480.00', currency: 'USD' },
    currentState: 'BLOCKED',
    currentStateObservation: {
      id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7081',
      state: 'BLOCKED',
      sourceStatus: 'ON_HOLD',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: '2026-09-29T11:40:00.000Z',
      receivedAt: '2026-09-29T11:41:00.000Z',
      importId: IMPORT_ID,
    },
    latestStateBySource: [
      {
        id: 'f6a7b8c9-d0e1-4f2a-8b3c-4d5e6f708192',
        state: 'PENDING',
        sourceStatus: null,
        sourceSystem: 'ERP',
        sourceId: 'SO-18492',
        observedAt: '2026-09-29T09:20:00.000Z',
        receivedAt: '2026-09-29T09:21:00.000Z',
        importId: IMPORT_ID,
      },
      {
        id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3',
        state: 'BLOCKED',
        sourceStatus: 'ON_HOLD',
        sourceSystem: 'OMS',
        sourceId: '18492',
        observedAt: '2026-09-29T11:40:00.000Z',
        receivedAt: '2026-09-29T11:41:00.000Z',
        importId: IMPORT_ID,
      },
    ],
    identifiers: [
      { sourceSystem: 'OMS', sourceId: '18492', firstSeenAt: '2026-09-29T09:12:00.000Z' },
      { sourceSystem: 'ERP', sourceId: 'SO-18492', firstSeenAt: '2026-09-29T09:20:00.000Z' },
    ],
    sourceSystems: ['ERP', 'OMS'],
    lastObservedAt: '2026-09-29T11:40:00.000Z',
    createdAt: '2026-09-29T09:12:00.000Z',
    counts: { sourceRecords: 3, stateObservations: 2, relationships: 0, events: 0 },
    ...overrides,
  };
}

function renderSection(entity: EntityDetailDto): void {
  apiFetchMock.mockResolvedValue({ items: [], nextCursor: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CurrentStateSection entity={entity} />
    </QueryClientProvider>,
  );
}

describe('CurrentStateSection', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('shows both source states beside the overall current state when they disagree', () => {
    renderSection(detail());

    const current = screen.getByRole('heading', { name: 'Current state' }).nextElementSibling;
    expect(current?.textContent).toContain('Blocked');
    expect(current?.textContent).toContain('OMS');

    const bySource = screen.getByRole('heading', { name: 'By source' }).nextElementSibling;
    expect(bySource?.textContent).toContain('ERP');
    expect(bySource?.textContent).toContain('Pending');
    expect(bySource?.textContent).toContain('OMS');
    expect(bySource?.textContent).toContain('Blocked');
  });

  it('shows "No state observed" for an entity with only UNKNOWN state', () => {
    renderSection(
      detail({ currentState: 'UNKNOWN', currentStateObservation: null, latestStateBySource: [] }),
    );

    expect(screen.getByText('No state observed')).toBeInTheDocument();
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument();
  });
});
