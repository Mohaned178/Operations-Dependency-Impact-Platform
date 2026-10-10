import type { ExplorerUrlParams, NeighborhoodResponse } from '@opsgraph/shared';
import { ReactFlowProvider } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { computeEmphasis } from './emphasis';
import { EdgeDetailsPanel } from './EdgeDetailsPanel';
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

/** Contract ui.md §15 step 1-2: validate the URL, then remount the view when it changes. */
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
    <ExplorerView
      key={`${id}?${canonicalSearch}`}
      id={id}
      params={parsed.params}
      search={canonicalSearch}
    />
  );
}

interface ExplorerViewProps {
  id: string;
  params: ExplorerUrlParams;
  search: string;
}

function ExplorerView({ id, params, search }: ExplorerViewProps) {
  const neighborhood = useNeighborhood(id, params, []);
  const [selection, setSelection] = useState<Selection>(null);
  const [centerOn, setCenterOn] = useState<{ id: string; nonce: number } | null>(null);

  const response = neighborhood.data;

  // A selection that is not in the current response counts as no selection (ui.md §15 step 7).
  const activeSelection = useMemo<Selection>(() => {
    if (response === undefined || selection === null) {
      return null;
    }
    if (selection.kind === 'node') {
      return response.nodes.some((n) => n.id === selection.id) ? selection : null;
    }
    return response.edges.some((e) => e.key === selection.key) ? selection : null;
  }, [response, selection]);

  const view = useMemo(() => {
    if (response === undefined) {
      return null;
    }
    const layout = layoutNeighborhood(response);
    const emphasis = computeEmphasis({
      response,
      selection: activeSelection,
      focusMode: false,
      selectedPathIndex: null,
    });
    const flow = toFlow({ response, layout, emphasis, selection: activeSelection });
    return { layout, emphasis, flow };
  }, [response, activeSelection]);

  if (neighborhood.isPending) {
    return <p>Loading…</p>;
  }
  if (response === undefined || view === null) {
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
    <div className="grid grid-cols-1 gap-4 lg:h-[calc(100vh-8rem)] lg:grid-cols-[1fr_380px]">
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
        <ExplorerToolbar params={params} />
        <div className="relative h-[480px] overflow-hidden rounded border bg-white lg:h-auto lg:min-h-[480px] lg:flex-1">
          <ReactFlowProvider>
            <GraphCanvas
              nodes={view.flow.nodes}
              edges={view.flow.edges}
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
              centers={view.layout.center}
            />
          </ReactFlowProvider>
          <SidePanel
            response={response}
            selection={activeSelection}
            search={search}
            onClose={() => {
              setSelection(null);
            }}
          />
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto">
        <ExplorerList
          response={response}
          selection={activeSelection}
          emphasis={view.emphasis}
          onSelectNode={selectFromList}
          onSelectEdge={(key) => {
            setSelection({ kind: 'edge', key });
          }}
        />
      </div>
    </div>
  );
}

interface SidePanelProps {
  response: NeighborhoodResponse;
  selection: Selection;
  search: string;
  onClose: () => void;
}

function SidePanel({ response, selection, search, onClose }: SidePanelProps) {
  if (selection === null) {
    return null;
  }
  if (selection.kind === 'node') {
    const node = response.nodes.find((n) => n.id === selection.id);
    return node === undefined ? null : (
      <NodeDetailsPanel key={node.id} node={node} search={search} onClose={onClose} />
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
