import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NeighborhoodDirectionSchema, type NeighborhoodResponse } from '@opsgraph/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { F1_BLOCKERS, N4_EDGE_KEYS, OFF_PATH_ID, RECORDS_STUB, n4Response } from './page-test-data';
import { SHP_ID } from '../entities/tracing-test-data';
import { ExplorerPage } from './ExplorerPage';
import { smallResponse, uuid } from './test-fixtures';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

// jsdom has no layout, so which nodes count as "visible" is meaningless there: draw them all.
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlow: (props: React.ComponentProps<typeof actual.ReactFlow>) => (
      <actual.ReactFlow {...props} onlyRenderVisibleElements={false} />
    ),
  };
});

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="location">{`${location.pathname}${location.search}`}</p>
      <button
        type="button"
        onClick={() => {
          void navigate(-1);
        }}
      >
        Go back
      </button>
    </>
  );
}

function respond(
  neighborhood: NeighborhoodResponse | ((path: string) => Promise<NeighborhoodResponse>) = smallResponse(),
) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path.includes('/neighborhood')) {
      return typeof neighborhood === 'function' ? neighborhood(path) : Promise.resolve(neighborhood);
    }
    if (path.includes('/blockers')) {
      return Promise.resolve({ ...F1_BLOCKERS, directBlockers: [], deepestBlockers: [], paths: [] });
    }
    if (path.includes('/dependencies')) {
      return Promise.resolve({
        query: F1_BLOCKERS.query,
        computedAt: F1_BLOCKERS.computedAt,
        start: F1_BLOCKERS.start,
        truncation: F1_BLOCKERS.truncation,
        totalReached: 0,
        items: [],
        nextCursor: null,
        cycleClosingHops: [],
        cycleClosingHopCount: 0,
      });
    }
    if (path.includes('/source-records')) {
      return Promise.resolve(RECORDS_STUB);
    }
    return Promise.reject(new Error(`unexpected request ${path}`));
  });
}

function renderPage(url = `/graph/${uuid(1)}`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/graph/:id" element={<ExplorerPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const neighborhoodCalls = () =>
  apiFetchMock.mock.calls.filter(([path]) => String(path).includes('/neighborhood'));

function listButton(id: string): HTMLElement {
  const el = document.querySelector(`button[data-entity-id="${id}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`no list row for ${id}`);
  }
  return el;
}

function flowNode(id: string): HTMLElement {
  const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`no graph node for ${id}`);
  }
  return el;
}

describe('ExplorerPage', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      toJSON: () => ({}),
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('URL validation', () => {
    it('shows each issue and a reset link, and makes no API request', () => {
      renderPage(`/graph/${uuid(1)}?depth=9&direction=sideways`);
      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(/^depth:/)).toBeInTheDocument();
      expect(within(alert).getByText(/^direction:/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Reset settings' })).toHaveAttribute(
        'href',
        `/graph/${uuid(1)}`,
      );
      expect(apiFetchMock).not.toHaveBeenCalled();
    });
  });

  describe('loading states', () => {
    it('shows Loading… and then the view', async () => {
      respond();
      renderPage();
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
        'Focus — all directions, 2 steps: 6 entities, 5 relationships',
      );
    });

    it('requests the neighborhood with the URL settings', async () => {
      respond();
      renderPage(`/graph/${uuid(1)}?depth=3`);
      await screen.findByRole('heading', { level: 1 });
      expect(neighborhoodCalls()).toHaveLength(1);
      expect(String(neighborhoodCalls()[0]?.[0])).toBe(
        `/entities/${uuid(1)}/neighborhood?direction=all&depth=3&blockers=false`,
      );
    });

    it('shows a not-found message with a way back for a 404', async () => {
      apiFetchMock.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Entity not found'));
      renderPage();
      expect(await screen.findByText(/Entity not found\./)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to entities' })).toHaveAttribute(
        'href',
        '/entities',
      );
    });

    it('shows an alert for any other error', async () => {
      apiFetchMock.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
      renderPage();
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the graph explorer.');
    });
  });

  describe('graph and list together', () => {
    it('draws every entity in both the graph and the list', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      const response = smallResponse();
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(response.nodes.length);
      });
      for (const node of response.nodes) {
        expect(flowNode(node.id)).toBeInTheDocument();
        expect(listButton(node.id)).toBeInTheDocument();
      }
      expect(screen.getByRole('region', { name: 'Entities and relationships' })).toBeInTheDocument();
      expect(screen.getByTestId('graph-canvas')).toBeInTheDocument();
    });

    it('selecting a list row highlights it in both views and opens the entity panel', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(6);
      });

      await userEvent.click(listButton(uuid(3)));
      expect(listButton(uuid(3))).toHaveAttribute('aria-pressed', 'true');
      await waitFor(() => {
        expect(flowNode(uuid(3))).toHaveClass('selected');
      });
      expect(await screen.findByLabelText('Details of Downstream')).toBeInTheDocument();
    });

    it('selecting a graph node highlights the list row and opens the panel', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(6);
      });

      fireEvent.click(flowNode(uuid(2)));
      await waitFor(() => {
        expect(listButton(uuid(2))).toHaveAttribute('aria-pressed', 'true');
      });
      expect(await screen.findByLabelText('Details of Upstream')).toBeInTheDocument();
    });

    it('selecting a relationship from the list opens the relationship panel', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      const edgeRow = document.querySelector(`button[data-edge-key="${uuid(1001)}"]`);
      expect(edgeRow).not.toBeNull();
      await userEvent.click(edgeRow as HTMLElement);
      expect(await screen.findByLabelText('Relationship details')).toBeInTheDocument();
      expect(within(screen.getByTestId('recorded-sentence')).getByText('REQUIRES')).toBeInTheDocument();
    });

    it('Close clears the selection in both views', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      await userEvent.click(listButton(uuid(3)));
      await screen.findByLabelText('Details of Downstream');
      await waitFor(() => {
        expect(flowNode(uuid(3))).toHaveClass('selected');
      });

      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByLabelText('Details of Downstream')).not.toBeInTheDocument();
      expect(listButton(uuid(3))).toHaveAttribute('aria-pressed', 'false');
      await waitFor(() => {
        expect(document.querySelector('.react-flow__node.selected')).toBeNull();
      });
    });

    it('selecting a relationship in the graph highlights its list row and opens the panel', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(5);
      });
      const edgeEl = document.querySelector(`.react-flow__edge[data-id="${uuid(1001)}"]`);
      expect(edgeEl).not.toBeNull();
      fireEvent.click(edgeEl as Element);
      expect(await screen.findByLabelText('Relationship details')).toBeInTheDocument();
      expect(document.querySelector(`button[data-edge-key="${uuid(1001)}"]`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('draws every relationship in both views', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(5);
      });
      for (const e of smallResponse().edges) {
        expect(document.querySelector(`.react-flow__edge[data-id="${e.key}"]`)).not.toBeNull();
        expect(document.querySelector(`button[data-edge-key="${e.key}"]`)).not.toBeNull();
      }
    });
  });

  describe('summary', () => {
    it('shows the omitted-count notice when entities were left out', async () => {
      const base = smallResponse();
      respond({ ...base, totals: { visible: base.nodes.length, omitted: 4, omittedIsLowerBound: false } });
      renderPage();
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Showing 6 of 10 entities — 4 more. Refine filters, reduce the step limit, or choose a direction.',
      );
    });

    it('keeps the last loaded view and shows an alert when a refresh fails', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      apiFetchMock.mockImplementation(() => Promise.reject(new ApiError(500, 'INTERNAL', 'boom')));

      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh the view');
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(listButton(uuid(2))).toBeInTheDocument();
    });

    it('changing Steps updates the URL and requests the new depth', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Steps' }), '3');
      expect(screen.getByTestId('location')).toHaveTextContent(`/graph/${uuid(1)}?depth=3`);
      await waitFor(() => {
        expect(neighborhoodCalls()).toHaveLength(2);
      });
      expect(String(neighborhoodCalls()[1]?.[0])).toContain('depth=3');
    });
  });

  describe('blocker highlighting (N4 shape)', () => {
    const n4Url = `/graph/${SHP_ID}?blockers=true`;

    function edgeStroke(key: string): CSSStyleDeclaration {
      const el = document.querySelector<SVGElement>(
        `[data-testid="rf__edge-${key}"] path.react-flow__edge-path`,
      );
      if (el === null) {
        throw new Error(`no edge ${key}`);
      }
      return el.style;
    }

    async function renderN4() {
      respond(n4Response());
      renderPage(n4Url);
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(6);
      });
    }

    it('requests blockers=true and shows the feature 003 summary above the list', async () => {
      await renderN4();
      expect(String(neighborhoodCalls()[0]?.[0])).toContain('blockers=true');
      const panel = screen.getByRole('region', { name: 'Blockers' });
      expect(within(panel).getByText(F1_BLOCKERS.summary)).toBeInTheDocument();
      expect(
        panel.compareDocumentPosition(screen.getByRole('region', { name: 'Entities and relationships' })) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('marks the Budget code as the deepest blocker and the direct blockers in graph and list', async () => {
      await renderN4();
      const budget = flowNode(F1_BLOCKERS.deepestBlockers[0]?.entity.id ?? '');
      expect(within(budget).getByText('Deepest blocker')).toBeInTheDocument();
      expect(
        within(listButton(F1_BLOCKERS.deepestBlockers[0]?.entity.id ?? '')).getByText('Deepest blocker'),
      ).toBeInTheDocument();
      for (const direct of F1_BLOCKERS.directBlockers) {
        expect(within(flowNode(direct.entity.id)).getByText('Direct blocker')).toBeInTheDocument();
      }
    });

    it('dims entities and relationships that are on no blocking path', async () => {
      await renderN4();
      expect(flowNode(OFF_PATH_ID).firstElementChild?.className).toContain('opacity-20');
      expect(flowNode(SHP_ID).firstElementChild?.className).not.toContain('opacity-20');
      expect(flowNode(F1_BLOCKERS.directBlockers[0]?.entity.id ?? '').firstElementChild?.className).toContain(
        'border-red-600',
      );
      expect(edgeStroke(N4_EDGE_KEYS.toOrder()).stroke).toBe('#dc2626');
      expect(edgeStroke(N4_EDGE_KEYS.manual()).stroke).toBe('#dc2626');
    });

    it('lists the entity added by the blocking path under its own group', async () => {
      await renderN4();
      const heading = screen.getByRole('heading', { name: 'Added by blocking path (1)' });
      const group = heading.parentElement as HTMLElement;
      expect(within(group).getByText('Budget code for Order #18492')).toBeInTheDocument();
    });

    it('selecting Path 2 highlights only that path and Show all paths restores both', async () => {
      await renderN4();
      await userEvent.click(screen.getByRole('button', { name: 'Path 2' }));

      await waitFor(() => {
        expect(edgeStroke(N4_EDGE_KEYS.toOrder()).opacity).toBe('0.15');
      });
      expect(edgeStroke(N4_EDGE_KEYS.toPayment()).opacity).toBe('0.15');
      for (const key of [N4_EDGE_KEYS.manual(), N4_EDGE_KEYS.toApproval(), N4_EDGE_KEYS.toBudget()]) {
        expect(edgeStroke(key).stroke).toBe('#dc2626');
      }
      // The blocker roles still come from all paths.
      const budgetId = F1_BLOCKERS.deepestBlockers[0]?.entity.id ?? '';
      expect(within(flowNode(budgetId)).getByText('Deepest blocker')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Show all paths' }));
      await waitFor(() => {
        expect(edgeStroke(N4_EDGE_KEYS.toOrder()).stroke).toBe('#dc2626');
      });
    });

    it('shows no blockers panel when highlighting is off', async () => {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('region', { name: 'Blockers' })).not.toBeInTheDocument();
    });
  });

  describe('expand and collapse', () => {
    /** Answers neighborhood requests from the request itself: nodes in `expand` are marked expanded. */
    function respondExpanding(options: { ignore?: string[]; hold?: Promise<void> } = {}) {
      const ignore = options.ignore ?? [];
      let calls = 0;
      respond((path) => {
        calls += 1;
        const expand = new URLSearchParams(path.split('?')[1]).get('expand')?.split(',') ?? [];
        const base = smallResponse();
        const answer: NeighborhoodResponse = {
          ...base,
          nodes: base.nodes.map((n) => ({
            ...n,
            expanded: expand.includes(n.id) && !ignore.includes(n.id),
          })),
          query: { ...base.query, expand },
          ignoredExpansions: expand.filter((e) => ignore.includes(e)),
        };
        return calls > 1 && options.hold !== undefined
          ? options.hold.then(() => answer)
          : Promise.resolve(answer);
      });
    }

    const expandParams = (index: number): string[] => {
      const path = String(neighborhoodCalls()[index]?.[0]);
      return new URLSearchParams(path.split('?')[1]).get('expand')?.split(',') ?? [];
    };

    async function ready() {
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(6);
      });
    }

    it('expanding a node requests expand=<id> without selecting the node', async () => {
      respondExpanding();
      renderPage();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Expand Upstream' }));

      await waitFor(() => {
        expect(neighborhoodCalls()).toHaveLength(2);
      });
      expect(expandParams(0)).toEqual([]);
      expect(expandParams(1)).toEqual([uuid(2)]);
      expect(screen.queryByLabelText('Details of Upstream')).not.toBeInTheDocument();
    });

    it('sends expansions in the order they were made, and collapse removes one', async () => {
      respondExpanding();
      renderPage();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Expand Downstream' }));
      await screen.findByRole('button', { name: 'Collapse Downstream' });
      fireEvent.click(screen.getByRole('button', { name: 'Expand Upstream' }));
      await screen.findByRole('button', { name: 'Collapse Upstream' });
      expect(expandParams(neighborhoodCalls().length - 1)).toEqual([uuid(3), uuid(2)]);

      fireEvent.click(screen.getByRole('button', { name: 'Collapse Downstream' }));
      await screen.findByRole('button', { name: 'Expand Downstream' });
      expect(expandParams(neighborhoodCalls().length - 1)).toEqual([uuid(2)]);
    });

    it('drops expansions the server ignored from its state', async () => {
      respondExpanding({ ignore: [uuid(2)] });
      renderPage();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Expand Upstream' }));

      await waitFor(() => {
        expect(neighborhoodCalls()).toHaveLength(3);
      });
      expect(expandParams(1)).toEqual([uuid(2)]);
      expect(expandParams(2)).toEqual([]);
      expect(screen.getByRole('button', { name: 'Expand Upstream' })).toBeInTheDocument();
    });

    it('resets expansions when a setting changes', async () => {
      respondExpanding();
      renderPage();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Expand Upstream' }));
      await screen.findByRole('button', { name: 'Collapse Upstream' });

      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Steps' }), '3');
      await waitFor(() => {
        expect(String(neighborhoodCalls().at(-1)?.[0])).toContain('depth=3');
      });
      expect(expandParams(neighborhoodCalls().length - 1)).toEqual([]);
    });

    it('shows Updating… while the previous graph stays on screen', async () => {
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      respondExpanding({ hold });
      renderPage();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Expand Upstream' }));

      expect(await screen.findByText(/Updating…/)).toBeInTheDocument();
      expect(document.querySelectorAll('.react-flow__node')).toHaveLength(6);

      release();
      await waitFor(() => {
        expect(screen.queryByText(/Updating…/)).not.toBeInTheDocument();
      });
    });

    it('expands from the list for the selected row', async () => {
      respondExpanding();
      renderPage();
      await ready();
      await userEvent.click(listButton(uuid(3)));
      await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
      await waitFor(() => {
        expect(neighborhoodCalls()).toHaveLength(2);
      });
      expect(expandParams(1)).toEqual([uuid(3)]);
    });
  });

  describe('focus mode', () => {
    async function ready() {
      respond();
      renderPage();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(6);
      });
    }
    const card = (id: string) => flowNode(id).firstElementChild?.className ?? '';

    it('dims everything outside the selected node and its neighbors but keeps it rendered', async () => {
      await ready();
      await userEvent.click(listButton(uuid(3)));
      await userEvent.click(screen.getByRole('button', { name: 'Focus mode on' }));

      await waitFor(() => {
        expect(card(uuid(2))).toContain('opacity-20');
      });
      // Node 3 is joined to the focus (1) and to 6.
      for (const kept of [3, 1, 6]) {
        expect(card(uuid(kept))).not.toContain('opacity-20');
      }
      for (const dimmed of [2, 4, 5]) {
        expect(card(uuid(dimmed))).toContain('opacity-20');
        expect(flowNode(uuid(dimmed))).toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: 'Focus mode off' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Focus mode off' }));
      await waitFor(() => {
        expect(card(uuid(2))).not.toContain('opacity-20');
      });
    });

    it('turns itself off when the selection is cleared', async () => {
      await ready();
      await userEvent.click(listButton(uuid(3)));
      await userEvent.click(screen.getByRole('button', { name: 'Focus mode on' }));
      await waitFor(() => {
        expect(card(uuid(2))).toContain('opacity-20');
      });

      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => {
        expect(card(uuid(2))).not.toContain('opacity-20');
      });
      await userEvent.click(listButton(uuid(3)));
      expect(screen.getByRole('button', { name: 'Focus mode on' })).toBeInTheDocument();
      expect(card(uuid(2))).not.toContain('opacity-20');
    });

    it('turns itself off when a relationship is selected', async () => {
      await ready();
      await userEvent.click(listButton(uuid(3)));
      await userEvent.click(screen.getByRole('button', { name: 'Focus mode on' }));
      await waitFor(() => {
        expect(card(uuid(2))).toContain('opacity-20');
      });
      await userEvent.click(
        document.querySelector(`button[data-edge-key="${uuid(1001)}"]`) as HTMLElement,
      );
      await waitFor(() => {
        expect(card(uuid(2))).not.toContain('opacity-20');
      });
    });
  });

  describe('Explore from here', () => {
    async function ready(url?: string) {
      respond();
      renderPage(url);
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(document.querySelectorAll('.react-flow__node')).toHaveLength(6);
      });
    }

    it('re-centers from the list with the same settings, and Back returns to the previous focus', async () => {
      await ready(`/graph/${uuid(1)}?depth=3&blockers=true`);
      await userEvent.click(listButton(uuid(3)));
      const list = screen.getByRole('region', { name: 'Entities and relationships' });
      await userEvent.click(within(list).getByRole('button', { name: 'Explore from here' }));

      expect(screen.getByTestId('location')).toHaveTextContent(
        `/graph/${uuid(3)}?depth=3&blockers=true`,
      );
      await waitFor(() => {
        expect(
          neighborhoodCalls().some(([path]) =>
            String(path).startsWith(`/entities/${uuid(3)}/neighborhood?direction=all&depth=3`),
          ),
        ).toBe(true);
      });
      expect(String(neighborhoodCalls().at(-1)?.[0])).toContain('blockers=true');

      await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/graph/${uuid(1)}?depth=3&blockers=true`,
      );
    });

    it('re-centers from the entity panel', async () => {
      await ready();
      await userEvent.click(listButton(uuid(2)));
      const panel = await screen.findByLabelText('Details of Upstream');
      await userEvent.click(within(panel).getByRole('button', { name: 'Explore from here' }));
      expect(screen.getByTestId('location')).toHaveTextContent(`/graph/${uuid(2)}`);
    });

    it('offers no Explore from here for the focus entity', async () => {
      await ready();
      await userEvent.click(listButton(uuid(1)));
      const panel = await screen.findByLabelText('Details of Focus');
      expect(within(panel).queryByRole('button', { name: 'Explore from here' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Explore from here' })).not.toBeInTheDocument();
    });
  });

  describe('shareable state (FR-003)', () => {
    it('requests exactly the settings in the URL and shows them in the toolbar and summary', async () => {
      // Answer like the API: echo the requested direction and depth in the response query.
      respond((path) => {
        const requested = new URLSearchParams(path.split('?')[1]);
        const base = smallResponse();
        return Promise.resolve({
          ...base,
          query: {
            ...base.query,
            direction: NeighborhoodDirectionSchema.parse(requested.get('direction')),
            depth: Number(requested.get('depth')),
          },
        });
      });
      renderPage(
        `/graph/${uuid(1)}?direction=downstream&depth=4&entityTypes=Order,Shipment&blockers=true`,
      );
      await screen.findByRole('heading', { level: 1 });

      const path = String(neighborhoodCalls()[0]?.[0]);
      expect(path.startsWith(`/entities/${uuid(1)}/neighborhood?`)).toBe(true);
      const query = new URLSearchParams(path.split('?')[1]);
      expect(Object.fromEntries(query)).toEqual({
        direction: 'downstream',
        depth: '4',
        entityTypes: 'Order,Shipment',
        blockers: 'true',
      });

      expect(screen.getByRole('radio', { name: 'Downstream only' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('combobox', { name: 'Steps' })).toHaveValue('4');
      expect(screen.getByRole('checkbox', { name: 'Highlight blockers' })).toBeChecked();
      expect(screen.getByText('Entity types (2)')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'downstream only, 4 steps',
      );
      expect(screen.getByText('Entity types: Order, Shipment')).toBeInTheDocument();
    });

    it('reproduces the same request when the link is opened again', async () => {
      respond();
      const url = `/graph/${uuid(1)}?relationshipTypes=REQUIRES&depth=3`;
      renderPage(url);
      await screen.findByRole('heading', { level: 1 });
      const first = String(neighborhoodCalls()[0]?.[0]);
      cleanup();
      apiFetchMock.mockClear();
      respond();
      renderPage(url);
      await screen.findByRole('heading', { level: 1 });
      expect(String(neighborhoodCalls()[0]?.[0])).toBe(first);
    });

    it('rejects an invalid link without any API request', () => {
      respond();
      renderPage(`/graph/${uuid(1)}?depth=9`);
      expect(screen.getByRole('alert')).toHaveTextContent('depth:');
      expect(apiFetchMock).not.toHaveBeenCalled();
    });
  });
});
