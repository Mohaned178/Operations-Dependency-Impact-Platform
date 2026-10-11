import { EXPLORER_LIMITS, type ExplorerUrlParams, type NeighborhoodResponse } from '@opsgraph/shared';
import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { BlockerHighlightPanel } from './BlockerHighlightPanel';
import { computeEmphasis } from './emphasis';
import { EdgeDetailsPanel } from './EdgeDetailsPanel';
import { ExplorerActionsContext } from './explorer-actions';
import { expansionLimitReached, toggleExpansion } from './expansion';
import { ExplorerList } from './ExplorerList';
import { parseExplorerParams, writeExplorerParams } from './explorer-params';
import { ExplorerSummary } from './ExplorerSummary';
import { ExplorerToolbar } from './ExplorerToolbar';
import type { Selection } from './flow-types';
import { GraphCanvas } from './GraphCanvas';
import { layoutNeighborhood } from './layout';
import { NodeDetailsPanel } from './NodeDetailsPanel';
import { toFlow } from './to-flow';
import { useNeighborhood } from './useNeighborhood';

/**
 * Contract ui.md §15 step 1-2: validate the URL, then remount the view when it changes. The
 * toolbar sits outside the keyed view so it keeps its focus and open checklists while the new
 * settings load.
 */
export function ExplorerPage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const parsed = parseExplorerParams(searchParams);

  if (!parsed.ok) {
    return (
      <section className="flex flex-col gap-2">
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-medium">This link has invalid explorer settings.</p>
          <ul className="list-disc pl-5">
            {parsed.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
        <Link to={`/graph/${id}`} className="text-sm underline">
          Reset settings
        </Link>
      </section>
    );
  }

  const canonicalSearch = writeExplorerParams(new URLSearchParams(), parsed.params).toString();
  return (
    <div className="flex flex-col gap-3">
      <ExplorerToolbar params={parsed.params} />
      <ExplorerView
        key={`${id}?${canonicalSearch}`}
        id={id}
        params={parsed.params}
        search={canonicalSearch}
      />
    </div>
  );
}

interface ExplorerViewProps {
  id: string;
  params: ExplorerUrlParams;
  search: string;
}

interface GoodView {
  response: NeighborhoodResponse;
  expand: string[];
}

function selectionIn(response: NeighborhoodResponse, selection: Selection): boolean {
  if (selection === null) {
    return false;
  }
  return selection.kind === 'node'
    ? response.nodes.some((n) => n.id === selection.id)
    : response.edges.some((e) => e.key === selection.key);
}

function ExplorerView({ id, params, search }: ExplorerViewProps) {
  const navigate = useNavigate();
  const [expand, setExpand] = useState<string[]>([]);
  const neighborhood = useNeighborhood(id, params, expand);
  const [selection, setSelection] = useState<Selection>(null);
  const [focusModeOn, setFocusModeOn] = useState(false);
  const [selectedPathIndex, setSelectedPathIndex] = useState<number | null>(null);
  const [centerOn, setCenterOn] = useState<{ id: string; nonce: number } | null>(null);
  const [lastGood, setLastGood] = useState<GoodView | null>(null);
  const [restoredNotice, setRestoredNotice] = useState(false);

  const settled = neighborhood.data !== undefined && !neighborhood.isPlaceholderData;
  useEffect(() => {
    if (neighborhood.data !== undefined && settled) {
      setLastGood({ response: neighborhood.data, expand });
    }
  }, [neighborhood.data, settled, expand]);

  // A failed expand or collapse (a new query that has no data) rolls the expansions back to the
  // last request that worked, instead of leaving the user on an error page.
  const failedWithoutData = neighborhood.isError && neighborhood.data === undefined;
  useEffect(() => {
    if (failedWithoutData && lastGood !== null) {
      setExpand(lastGood.expand);
      setRestoredNotice(true);
    }
  }, [failedWithoutData, lastGood]);

  const response = neighborhood.data ?? lastGood?.response;

  // A selection that is not in the current response is dropped (data-model §4), so it cannot
  // come back when the node reappears.
  const stale =
    response !== undefined &&
    settled &&
    selection !== null &&
    !selectionIn(response, selection);
  useEffect(() => {
    if (stale) {
      setSelection(null);
    }
  }, [stale]);
  const activeSelection = useMemo<Selection>(
    () => (response !== undefined && selectionIn(response, selection) ? selection : null),
    [response, selection],
  );

  // Focus mode only applies to a selected node; it turns itself off otherwise (data-model §4).
  const focusMode = focusModeOn && activeSelection?.kind === 'node';
  useEffect(() => {
    if (focusModeOn && activeSelection?.kind !== 'node') {
      setFocusModeOn(false);
    }
  }, [focusModeOn, activeSelection]);

  // Expansions the server could not apply (unknown, or not visible) are dropped from the state.
  const ignored = settled ? response?.ignoredExpansions : undefined;
  useEffect(() => {
    if (ignored !== undefined && ignored.length > 0) {
      setExpand((previous) => previous.filter((expandedId) => !ignored.includes(expandedId)));
    }
  }, [ignored]);

  // Toggling while a request is in flight would leave the labels out of step with the state.
  const loading = neighborhood.isPlaceholderData;
  const toggleExpand = useCallback(
    (entityId: string): void => {
      if (loading) {
        return;
      }
      setRestoredNotice(false);
      setExpand((previous) => toggleExpansion(previous, entityId));
    },
    [loading],
  );
  const actions = useMemo(() => ({ toggleExpand }), [toggleExpand]);

  const exploreFrom = useCallback(
    (entityId: string): void => {
      void navigate(search === '' ? `/graph/${entityId}` : `/graph/${entityId}?${search}`);
    },
    [navigate, search],
  );

  // Layout depends only on the response, so selecting or focusing does not re-run it (ui.md §15.5).
  const layout = useMemo(
    () => (response === undefined ? null : layoutNeighborhood(response)),
    [response],
  );
  const emphasis = useMemo(
    () =>
      response === undefined
        ? null
        : computeEmphasis({ response, selection: activeSelection, focusMode, selectedPathIndex }),
    [response, activeSelection, focusMode, selectedPathIndex],
  );
  const flow = useMemo(
    () =>
      response === undefined || layout === null || emphasis === null
        ? null
        : toFlow({ response, layout, emphasis, selection: activeSelection }),
    [response, layout, emphasis, activeSelection],
  );

  if (neighborhood.isPending && response === undefined) {
    return <p>Loading…</p>;
  }
  if (response === undefined || layout === null || emphasis === null || flow === null) {
    if (neighborhood.error instanceof ApiError && neighborhood.error.status === 404) {
      return (
        <p>
          Entity not found. <Link to="/entities">Back to entities</Link>
        </p>
      );
    }
    return <p role="alert">Unable to load the graph explorer.</p>;
  }

  const selectFromList = (nextId: string): void => {
    setSelection({ kind: 'node', id: nextId });
    setCenterOn((previous) => ({ id: nextId, nonce: (previous?.nonce ?? 0) + 1 }));
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:h-[calc(100vh-12rem)] lg:grid-cols-[1fr_380px]">
      <div className="flex min-h-0 flex-col gap-2">
        <ExplorerSummary
          response={response}
          settings={params}
          onRefresh={() => {
            void neighborhood.refetch();
          }}
          isUpdating={neighborhood.isPlaceholderData}
        />
        {neighborhood.isError ? (
          <p role="alert" className="text-sm text-red-700">
            Could not refresh the view. Showing the last loaded data.
          </p>
        ) : null}
        {restoredNotice ? (
          <p role="alert" className="text-sm text-red-700">
            Could not expand or collapse that node, so the view was restored to its last state.
          </p>
        ) : null}
        {expansionLimitReached(expand) ? (
          <p role="status" className="text-sm text-amber-900">
            {`You have expanded the maximum of ${EXPLORER_LIMITS.maxExpansions} nodes. Collapse one to expand another.`}
          </p>
        ) : null}
        <div className="relative h-[480px] overflow-hidden rounded border bg-white lg:h-auto lg:min-h-[480px] lg:flex-1">
          <ExplorerActionsContext.Provider value={actions}>
            <ReactFlowProvider>
              <GraphCanvas
                nodes={flow.nodes}
                edges={flow.edges}
                onSelectNode={(nodeId) => {
                  setSelection({ kind: 'node', id: nodeId });
                }}
                onSelectEdge={(key) => {
                  setSelection({ kind: 'edge', key });
                }}
                onClearSelection={() => {
                  setSelection(null);
                }}
                centerOn={centerOn}
                centers={layout.center}
              />
            </ReactFlowProvider>
          </ExplorerActionsContext.Provider>
          <SidePanel
            response={response}
            selection={activeSelection}
            search={search}
            onExploreFrom={exploreFrom}
            onClose={() => {
              setSelection(null);
            }}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {response.blockers === null ? null : (
          <BlockerHighlightPanel
            blockers={response.blockers}
            selectedPathIndex={selectedPathIndex}
            onSelectPath={setSelectedPathIndex}
          />
        )}
        <ExplorerList
          response={response}
          selection={activeSelection}
          emphasis={emphasis}
          onSelectNode={selectFromList}
          onSelectEdge={(key) => {
            setSelection({ kind: 'edge', key });
          }}
          onToggleExpand={toggleExpand}
          onToggleFocusMode={() => {
            setFocusModeOn((previous) => !previous);
          }}
          focusMode={focusMode}
          onExploreFrom={exploreFrom}
        />
      </div>
    </div>
  );
}

interface SidePanelProps {
  response: NeighborhoodResponse;
  selection: Selection;
  search: string;
  onExploreFrom: (id: string) => void;
  onClose: () => void;
}

function SidePanel({ response, selection, search, onExploreFrom, onClose }: SidePanelProps) {
  if (selection === null) {
    return null;
  }
  if (selection.kind === 'node') {
    const node = response.nodes.find((n) => n.id === selection.id);
    return node === undefined ? null : (
      <NodeDetailsPanel
        key={node.id}
        node={node}
        search={search}
        isFocus={node.id === response.focusId}
        onExploreFrom={onExploreFrom}
        onClose={onClose}
      />
    );
  }
  const edge = response.edges.find((e) => e.key === selection.key);
  return edge === undefined ? null : (
    <EdgeDetailsPanel
      key={edge.key}
      edge={edge}
      nodesById={new Map(response.nodes.map((n) => [n.id, n]))}
      search={search}
      onClose={onClose}
    />
  );
}
