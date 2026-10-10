import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  BlockersResponse,
  DependenciesResponse,
  NeighborhoodNodeDto,
  SourceRecordListResponse,
} from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  F1_BLOCKERS,
  ORDER,
  ORDER_ID,
  PAYMENT,
  PAY_ID,
  SHP_ID,
  SHIPMENT,
  hop,
} from '../entities/tracing-test-data';
import { NodeDetailsPanel } from './NodeDetailsPanel';
import { node } from './test-fixtures';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

const IMPORT_ID = '99999999-9999-4999-8999-999999999999';

function shipmentNode(overrides: Partial<NeighborhoodNodeDto> = {}): NeighborhoodNodeDto {
  const base = node({ n: 1, name: SHIPMENT.displayName, type: 'Shipment', state: 'DELAYED' });
  return {
    ...base,
    id: SHP_ID,
    ...overrides,
    state: {
      ...base.state,
      observation: {
        ...(base.state.observation as NonNullable<NeighborhoodNodeDto['state']['observation']>),
        sourceSystem: 'TMS',
        observedAt: '2026-09-29T14:32:00.000Z',
      },
      ...(overrides.state ?? {}),
    },
  };
}

const DEPENDENTS: DependenciesResponse = {
  query: {
    entityId: SHP_ID,
    kind: 'downstream',
    depth: 1,
    relationshipTypes: ['REQUIRES', 'DEPENDS_ON', 'BLOCKS'],
    entityTypes: [],
  },
  computedAt: '2026-10-06T09:00:00.000Z',
  start: SHIPMENT,
  truncation: { depthLimit: false, explorationLimit: false, pathLimit: false },
  totalReached: 2,
  items: [
    {
      entity: ORDER,
      distance: 1,
      path: {
        hops: [hop('DEPENDS_ON', 'REVERSE', ORDER_ID, SHP_ID, ORDER)],
        length: 1,
        weakestConfidence: 'HIGH',
        nonSourceHops: 0,
        continuesBeyondDepth: false,
      },
    },
    {
      entity: PAYMENT,
      distance: 1,
      path: {
        hops: [
          hop('BLOCKS', 'REVERSE', PAY_ID, SHP_ID, PAYMENT, {
            origin: 'MANUAL',
            confidence: 'MEDIUM',
          }),
        ],
        length: 1,
        weakestConfidence: 'MEDIUM',
        nonSourceHops: 1,
        continuesBeyondDepth: false,
      },
    },
  ],
  nextCursor: null,
  cycleClosingHops: [],
  cycleClosingHopCount: 0,
};

const RECORDS: SourceRecordListResponse = {
  items: [
    {
      id: '12121212-1212-4212-8212-121212121212',
      kind: 'ENTITY',
      sourceSystem: 'TMS',
      sourceId: 'SHP-77120',
      observedAt: '2026-09-29T14:32:00.000Z',
      receivedAt: '2026-09-29T14:33:00.000Z',
      importId: IMPORT_ID,
      rawPayload: {},
    },
    {
      id: '13131313-1313-4313-8313-131313131313',
      kind: 'ENTITY',
      sourceSystem: 'WMS',
      sourceId: 'SHP-77120-W',
      observedAt: '2026-09-29T14:00:00.000Z',
      receivedAt: '2026-09-29T14:01:00.000Z',
      importId: IMPORT_ID,
      rawPayload: {},
    },
  ],
  nextCursor: null,
};

function respond(blockers: BlockersResponse = F1_BLOCKERS, dependents = DEPENDENTS) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path.includes('/blockers')) {
      return Promise.resolve(blockers);
    }
    if (path.includes('/dependencies')) {
      return Promise.resolve(dependents);
    }
    if (path.includes('/source-records')) {
      return Promise.resolve(RECORDS);
    }
    return Promise.reject(new Error(`unexpected request ${path}`));
  });
}

function renderPanel(target: NeighborhoodNodeDto, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NodeDetailsPanel node={target} search="depth=3" onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NodeDetailsPanel', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });
  afterEach(cleanup);

  it('shows identity and the reporting source with its time', async () => {
    respond();
    renderPanel(shipmentNode());
    expect(screen.getByRole('heading', { name: SHIPMENT.displayName })).toBeInTheDocument();
    expect(screen.getByText('Shipment')).toBeInTheDocument();
    expect(screen.getByText(SHP_ID)).toBeInTheDocument();
    expect(screen.getByText(/^Reported by TMS · /)).toBeInTheDocument();
    await screen.findByText('See all on Entity 360');
  });

  it('lists every source state when sources disagree', async () => {
    respond();
    const base = shipmentNode();
    renderPanel({
      ...base,
      state: {
        ...base.state,
        latestBySource: [
          {
            id: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
            state: 'BLOCKED',
            sourceStatus: 'ON_HOLD',
            sourceSystem: 'OMS',
            sourceId: '18492',
            observedAt: '2026-09-29T11:40:00.000Z',
            receivedAt: '2026-09-29T11:41:00.000Z',
            importId: IMPORT_ID,
          },
          {
            id: 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
            state: 'PENDING',
            sourceStatus: 'OPEN',
            sourceSystem: 'ERP',
            sourceId: 'SO-18492',
            observedAt: '2026-09-29T09:20:00.000Z',
            receivedAt: '2026-09-29T09:21:00.000Z',
            importId: IMPORT_ID,
          },
        ],
      },
    });
    expect(screen.getByText(/Sources disagree/)).toBeInTheDocument();
    expect(screen.getByText(/^OMS: Blocked · /)).toBeInTheDocument();
    expect(screen.getByText(/^ERP: Pending · /)).toBeInTheDocument();
    await screen.findByText('See all on Entity 360');
  });

  it('lists the direct blockers from /blockers with state and links', async () => {
    respond();
    renderPanel(shipmentNode());
    const section = (await screen.findByRole('heading', { name: 'Blocked by' })).parentElement;
    for (const blocker of F1_BLOCKERS.directBlockers) {
      const link = await within(section as HTMLElement).findByRole('link', {
        name: blocker.entity.displayName,
      });
      expect(link).toHaveAttribute('href', `/entities/${blocker.entity.id}`);
    }
    expect(
      within(section as HTMLElement).getByRole('link', { name: `Explore ${ORDER.displayName}` }),
    ).toHaveAttribute('href', `/graph/${ORDER_ID}?depth=3`);
  });

  it('says so when nothing blocks it, naming the searched depth', async () => {
    respond({ ...F1_BLOCKERS, directBlockers: [], deepestBlockers: [], paths: [], totalPaths: 0 });
    renderPanel(shipmentNode());
    expect(await screen.findByText('No blockers found within 6 steps.')).toBeInTheDocument();
  });

  it('lists what it blocks, with state and the origin of the first hop', async () => {
    respond();
    renderPanel(shipmentNode());
    const section = (await screen.findByRole('heading', { name: 'Blocks' })).parentElement;
    const scoped = within(section as HTMLElement);
    expect(await scoped.findByRole('link', { name: ORDER.displayName })).toBeInTheDocument();
    expect(scoped.getByRole('link', { name: PAYMENT.displayName })).toBeInTheDocument();
    expect(scoped.getByText('Manual · MEDIUM')).toBeInTheDocument();
    expect(scoped.getByText('Source · HIGH')).toBeInTheDocument();
  });

  it('states that nothing depends on it when there are no dependents', async () => {
    respond(F1_BLOCKERS, { ...DEPENDENTS, items: [], totalReached: 0 });
    renderPanel(shipmentNode());
    expect(
      await screen.findByText('Nothing depends on it through REQUIRES, DEPENDS_ON or BLOCKS.'),
    ).toBeInTheDocument();
  });

  it('does not list dependents for a satisfied entity and does not request them', async () => {
    respond();
    const base = shipmentNode({ currentState: 'ACTIVE' });
    renderPanel({ ...base, state: { ...base.state, classification: 'SATISFIED' } });
    expect(screen.getByText('Active — not blocking anything.')).toBeInTheDocument();
    await screen.findByText('See all on Entity 360');
    expect(apiFetchMock.mock.calls.some(([path]) => String(path).includes('/dependencies'))).toBe(
      false,
    );
  });

  it('shows the first source records as evidence and links to Entity 360', async () => {
    respond();
    renderPanel(shipmentNode());
    expect(await screen.findByText(/^TMS · SHP-77120 · observed /)).toBeInTheDocument();
    expect(screen.getByText(/^WMS · SHP-77120-W · observed /)).toBeInTheDocument();
    expect(
      apiFetchMock.mock.calls.some(
        ([path]) => path === `/entities/${SHP_ID}/source-records?limit=10`,
      ),
    ).toBe(true);
    expect(screen.getByRole('link', { name: 'See all on Entity 360' })).toHaveAttribute(
      'href',
      `/entities/${SHP_ID}`,
    );
    expect(screen.getByRole('link', { name: 'Open Entity 360' })).toHaveAttribute(
      'href',
      `/entities/${SHP_ID}`,
    );
  });

  it('closes on request', async () => {
    respond();
    const onClose = vi.fn();
    renderPanel(shipmentNode(), onClose);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await screen.findByText('See all on Entity 360');
  });
});
