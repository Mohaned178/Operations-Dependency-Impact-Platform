import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NeighborhoodResponse } from '@opsgraph/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function respond(neighborhood: NeighborhoodResponse = smallResponse()) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path.includes('/neighborhood')) {
      return Promise.resolve(neighborhood);
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
});
