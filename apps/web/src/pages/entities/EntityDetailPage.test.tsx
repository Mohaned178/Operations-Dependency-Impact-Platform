import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  EntityDetailDto,
  NeighborListResponse,
  SourceRecordListResponse,
  StateHistoryResponse,
  TimelineResponse,
} from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { EntityDetailPage } from './EntityDetailPage';
import { F1_BLOCKERS } from './tracing-test-data';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

const ENTITY_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PAYMENT_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const PRODUCT_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';
const IMPORT_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70';

const ENTITY: EntityDetailDto = {
  id: ENTITY_ID,
  type: 'Order',
  displayName: 'Order #18492',
  attributes: { amount: '12480.00', currency: 'USD', priority: 'high' },
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
    {
      sourceSystem: 'OMS',
      sourceId: '18492',
      firstSeenAt: '2026-09-29T09:12:00.000Z',
    },
    {
      sourceSystem: 'ERP',
      sourceId: 'SO-18492',
      firstSeenAt: '2026-09-29T09:20:00.000Z',
    },
  ],
  sourceSystems: ['ERP', 'OMS'],
  lastObservedAt: '2026-09-29T11:40:00.000Z',
  createdAt: '2026-09-29T09:12:00.000Z',
  counts: { sourceRecords: 4, stateObservations: 4, relationships: 7, events: 4 },
};

const NEIGHBORS: NeighborListResponse = {
  items: [
    {
      relationship: {
        id: 'b8c9d0e1-f2a3-4b4c-8d5e-6f708192a3b4',
        type: 'REQUIRES',
        direction: 'OUT',
        origin: 'SOURCE',
        confidence: 'HIGH',
        basis: null,
        sourceSystem: 'OPSGRAPH',
        sourceId: 'rel-1',
        observedAt: '2026-09-29T09:14:00.000Z',
        importId: IMPORT_ID,
      },
      neighbor: {
        id: PAYMENT_ID,
        type: 'Payment',
        displayName: 'Payment PAY-88213',
        currentState: 'PENDING',
      },
    },
    {
      relationship: {
        id: 'c9d0e1f2-a3b4-4c5d-8e6f-708192a3b4c5',
        type: 'RELATES_TO',
        direction: 'IN',
        origin: 'INFERRED',
        confidence: 'LOW',
        basis: 'Inferred from shared purchase-order history',
        sourceSystem: 'LEGACY',
        sourceId: 'rel-2',
        observedAt: '2026-09-29T10:00:00.000Z',
        importId: IMPORT_ID,
      },
      neighbor: {
        id: PRODUCT_ID,
        type: 'Product',
        displayName: 'Industrial Pallet Racking Kit',
        currentState: 'ACTIVE',
      },
    },
  ],
  nextCursor: null,
};

const TIMELINE: TimelineResponse = {
  items: [
    {
      kind: 'EVENT',
      id: 'd0e1f2a3-b4c5-4d6e-8f70-8192a3b4c5d6',
      at: '2026-09-29T09:12:00.000Z',
      eventType: 'order.created',
      description: 'Order created in the OMS',
      role: 'SUBJECT',
      entities: [
        {
          entity: {
            id: ENTITY_ID,
            type: 'Order',
            displayName: 'Order #18492',
            currentState: 'BLOCKED',
          },
          role: 'SUBJECT',
        },
      ],
      sourceSystem: 'OMS',
      sourceId: 'EV-1',
      observedAt: '2026-09-29T09:12:01.000Z',
      importId: IMPORT_ID,
    },
    {
      kind: 'STATE',
      id: 'e1f2a3b4-c5d6-4e7f-8a81-92a3b4c5d6e7',
      at: '2026-09-29T09:12:30.000Z',
      state: 'PENDING',
      sourceStatus: 'NEW',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: '2026-09-29T09:12:30.000Z',
      importId: IMPORT_ID,
    },
  ],
  nextCursor: null,
};

const STATES: StateHistoryResponse = {
  items: [
    {
      id: 'f2a3b4c5-d6e7-4f80-8b92-a3b4c5d6e7f8',
      state: 'BLOCKED',
      sourceStatus: 'ON_HOLD',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: '2026-09-29T11:40:00.000Z',
      receivedAt: '2026-09-29T11:41:00.000Z',
      importId: IMPORT_ID,
    },
    {
      id: 'a3b4c5d6-e7f8-4a91-8ca3-b4c5d6e7f809',
      state: 'PENDING',
      sourceStatus: null,
      sourceSystem: 'ERP',
      sourceId: 'SO-18492',
      observedAt: '2026-09-29T09:20:00.000Z',
      receivedAt: '2026-09-29T09:21:00.000Z',
      importId: IMPORT_ID,
    },
  ],
  nextCursor: null,
};

const SOURCE_RECORDS: SourceRecordListResponse = {
  items: [
    {
      id: 'b4c5d6e7-f809-4a1b-8c2d-3e4f5a6b7c8d',
      kind: 'ENTITY',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: '2026-09-29T11:40:00.000Z',
      receivedAt: '2026-09-29T11:41:00.000Z',
      importId: IMPORT_ID,
      rawPayload: { type: 'Order', state: 'BLOCKED', attribution: { system: 'OMS' } },
    },
  ],
  nextCursor: null,
};

function mockHappyPath(): void {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === `/entities/${ENTITY_ID}`) {
      return Promise.resolve(ENTITY);
    }
    if (path.startsWith(`/entities/${ENTITY_ID}/neighbors`)) {
      return Promise.resolve(NEIGHBORS);
    }
    if (path.startsWith(`/entities/${ENTITY_ID}/timeline`)) {
      return Promise.resolve(TIMELINE);
    }
    if (path.startsWith(`/entities/${ENTITY_ID}/states`)) {
      return Promise.resolve(STATES);
    }
    if (path.startsWith(`/entities/${ENTITY_ID}/source-records`)) {
      return Promise.resolve(SOURCE_RECORDS);
    }
    if (path === `/entities/${ENTITY_ID}/blockers`) {
      return Promise.resolve(F1_BLOCKERS);
    }
    if (path.startsWith(`/entities/${ENTITY_ID}/dependencies`)) {
      return Promise.resolve({
        query: {
          entityId: ENTITY_ID,
          kind: 'upstream',
          depth: 6,
          relationshipTypes: ['REQUIRES'],
          entityTypes: [],
        },
        computedAt: '2026-10-06T09:00:00.000Z',
        start: {
          id: ENTITY_ID,
          type: 'Order',
          displayName: 'Order #18492',
          currentState: 'BLOCKED',
          state: { classification: 'UNSATISFIED', observation: null, latestBySource: [] },
        },
        truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
        totalReached: 0,
        items: [],
        nextCursor: null,
        cycleClosingHops: [],
        cycleClosingHopCount: 0,
      });
    }
    return Promise.reject(new Error(`Unexpected path ${path}`));
  });
}

/** The Relationships section, so assertions do not match the same names in Blockers. */
async function relationshipsSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Relationships' });
  const section = heading.closest('section');
  if (section === null) {
    throw new Error('Relationships section not found');
  }
  return section;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/entities/${ENTITY_ID}`]}>
        <Routes>
          <Route path="/entities/:id" element={<EntityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntityDetailPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    mockHappyPath();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the header and all five sections with their data', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Order #18492' })).toBeInTheDocument();
    expect(screen.getAllByText('Order').length).toBeGreaterThan(0);

    expect(await screen.findByText('12,480.00 USD')).toBeInTheDocument();
    expect(screen.getAllByText(/OMS · 18492/).length).toBeGreaterThan(0);

    expect(
      await within(await relationshipsSection()).findByText('Payment PAY-88213'),
    ).toBeInTheDocument();

    expect(await screen.findByText('order.created')).toBeInTheDocument();
    expect(screen.getByText('State change')).toBeInTheDocument();

    expect(await screen.findByText('Raw payload')).toBeInTheDocument();
  });

  it('shows the blocker callout in the header and the Blockers section between Current state and Relationships', async () => {
    const { container } = renderPage();

    const callout = await screen.findByRole('note');
    expect(within(callout).getByText(F1_BLOCKERS.summary)).toBeInTheDocument();
    expect(
      within(callout).getByText(
        'Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING.',
      ),
    ).toBeInTheDocument();
    expect(callout.closest('header')).not.toBeNull();

    const headings = (await screen.findAllByRole('heading', { level: 2 })).map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual([
      'Identity',
      'Current state',
      'Blockers',
      'Dependencies',
      'Relationships',
      'Timeline',
      'Source records',
    ]);

    // FR-032: no risks, exceptions, impact or investigations sections, not even placeholders.
    expect(
      screen.queryAllByRole('heading', { name: /risk|exception|impact|investigation/i }),
    ).toEqual([]);

    // FR-031: tracing views are text and structured lists, never a graph diagram.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('shows one failing section without blanking the others', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith(`/entities/${ENTITY_ID}/neighbors`)) {
        return Promise.reject(new Error('down'));
      }
      if (path === `/entities/${ENTITY_ID}`) {
        return Promise.resolve(ENTITY);
      }
      if (path.startsWith(`/entities/${ENTITY_ID}/timeline`)) {
        return Promise.resolve(TIMELINE);
      }
      if (path.startsWith(`/entities/${ENTITY_ID}/states`)) {
        return Promise.resolve(STATES);
      }
      if (path === `/entities/${ENTITY_ID}/blockers`) {
        return Promise.resolve(F1_BLOCKERS);
      }
      if (path.startsWith(`/entities/${ENTITY_ID}/dependencies`)) {
        return Promise.resolve({
          query: {
            entityId: ENTITY_ID,
            kind: 'upstream',
            depth: 6,
            relationshipTypes: ['REQUIRES'],
            entityTypes: [],
          },
          computedAt: '2026-10-06T09:00:00.000Z',
          start: {
            id: ENTITY_ID,
            type: 'Order',
            displayName: 'Order #18492',
            currentState: 'BLOCKED',
            state: { classification: 'UNSATISFIED', observation: null, latestBySource: [] },
          },
          truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
          totalReached: 0,
          items: [],
          nextCursor: null,
          cycleClosingHops: [],
          cycleClosingHopCount: 0,
        });
      }
      return Promise.resolve(SOURCE_RECORDS);
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load relationships.');
    expect(screen.getByText('12,480.00 USD')).toBeInTheDocument();
    expect(await screen.findByText('order.created')).toBeInTheDocument();
  });

  it('shows the Blockers error while Identity, Dependencies and Relationships still render', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === `/entities/${ENTITY_ID}/blockers`) {
        return Promise.reject(new Error('down'));
      }
      if (path === `/entities/${ENTITY_ID}`) {
        return Promise.resolve(ENTITY);
      }
      if (path.startsWith(`/entities/${ENTITY_ID}/neighbors`)) {
        return Promise.resolve(NEIGHBORS);
      }
      if (path.startsWith(`/entities/${ENTITY_ID}/timeline`)) {
        return Promise.resolve(TIMELINE);
      }
      if (path.startsWith(`/entities/${ENTITY_ID}/states`)) {
        return Promise.resolve(STATES);
      }
      if (path.startsWith(`/entities/${ENTITY_ID}/dependencies`)) {
        return Promise.resolve({
          query: {
            entityId: ENTITY_ID,
            kind: 'upstream',
            depth: 6,
            relationshipTypes: ['REQUIRES'],
            entityTypes: [],
          },
          computedAt: '2026-10-06T09:00:00.000Z',
          start: {
            id: ENTITY_ID,
            type: 'Order',
            displayName: 'Order #18492',
            currentState: 'BLOCKED',
            state: { classification: 'UNSATISFIED', observation: null, latestBySource: [] },
          },
          truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
          totalReached: 0,
          items: [],
          nextCursor: null,
          cycleClosingHops: [],
          cycleClosingHopCount: 0,
        });
      }
      return Promise.resolve(SOURCE_RECORDS);
    });

    renderPage();

    expect(await screen.findByText('Unable to load blockers.')).toBeInTheDocument();
    expect(screen.getByText('12,480.00 USD')).toBeInTheDocument();
    expect(await screen.findByText('Nothing found within 6 steps.')).toBeInTheDocument();
    expect(
      await within(await relationshipsSection()).findByText('Payment PAY-88213'),
    ).toBeInTheDocument();
  });

  it('shows "Entity not found" for a 404', async () => {
    apiFetchMock.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Entity not found'));

    renderPage();

    expect(await screen.findByText(/Entity not found/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to entities' })).toBeInTheDocument();
  });

  it('shows the origin and confidence badge on relationship rows', async () => {
    renderPage();

    const relationships = within(await relationshipsSection());
    expect(await relationships.findByText('Source · HIGH')).toBeInTheDocument();
    expect(relationships.getByText('Inferred · LOW')).toBeInTheDocument();
    expect(relationships.getByText('Inferred · LOW').textContent).not.toContain('Source');
  });

  it('keeps the raw payload behind a details element', async () => {
    renderPage();

    const payload = await screen.findByText(/"system": "OMS"/);
    expect(payload.closest('details')).not.toBeNull();
    expect(screen.getByText('Raw payload').closest('summary')).not.toBeNull();
  });

  it('shows the source system and observation time on relationship and timeline rows', async () => {
    renderPage();

    await within(await relationshipsSection()).findByText('Payment PAY-88213');
    expect(
      screen.getAllByText(
        (content) => content.startsWith('OPSGRAPH · ') && content.includes('2026'),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((content) => content.startsWith('OMS · ') && content.includes('2026'))
        .length,
    ).toBeGreaterThan(0);
  });

  it('shows when a timeline event occurred, not only when it was observed', async () => {
    const { container } = renderPage();

    await screen.findByText('order.created');
    expect(container.querySelector('time[datetime="2026-09-29T09:12:00.000Z"]')).not.toBeNull();
  });
});
