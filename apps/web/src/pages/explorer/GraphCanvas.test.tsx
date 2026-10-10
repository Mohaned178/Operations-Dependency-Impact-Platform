import { ReactFlowProvider } from '@xyflow/react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerActionsContext } from './explorer-actions';
import { flowFor } from './flow-test-utils';
import { GraphCanvas } from './GraphCanvas';
import { layoutNeighborhood } from './layout';
import { smallResponse, uuid } from './test-fixtures';

const { setCenter } = vi.hoisted(() => ({ setCenter: vi.fn() }));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), setCenter, getZoom: () => 1.5 }),
  };
});

const response = smallResponse();
const flow = flowFor(response);
const centers = layoutNeighborhood(response).center;

function renderCanvas(centerOn: { id: string; nonce: number } | null) {
  const props = {
    nodes: flow.nodes,
    edges: flow.edges,
    onSelectNode: vi.fn(),
    onSelectEdge: vi.fn(),
    onClearSelection: vi.fn(),
    centers,
  };
  const tree = (next: { id: string; nonce: number } | null) => (
    <ExplorerActionsContext.Provider value={{ toggleExpand: vi.fn() }}>
      <ReactFlowProvider>
        <GraphCanvas {...props} centerOn={next} />
      </ReactFlowProvider>
    </ExplorerActionsContext.Provider>
  );
  const view = render(tree(centerOn));
  return {
    rerenderWith: (next: { id: string; nonce: number } | null) => {
      view.rerender(tree(next));
    },
  };
}

describe('GraphCanvas centerOn', () => {
  beforeEach(() => {
    setCenter.mockReset();
  });
  afterEach(cleanup);

  it('does nothing without a centerOn request', () => {
    renderCanvas(null);
    expect(setCenter).not.toHaveBeenCalled();
  });

  it('pans to the node, keeping the current zoom, when centerOn is set', () => {
    const { rerenderWith } = renderCanvas(null);
    rerenderWith({ id: uuid(3), nonce: 1 });
    const target = centers.get(uuid(3));
    expect(setCenter).toHaveBeenCalledTimes(1);
    expect(setCenter).toHaveBeenCalledWith(target?.x, target?.y, { zoom: 1.5, duration: 200 });
  });

  it('pans again only for a new nonce', () => {
    const { rerenderWith } = renderCanvas({ id: uuid(3), nonce: 1 });
    rerenderWith({ id: uuid(3), nonce: 1 });
    expect(setCenter).toHaveBeenCalledTimes(1);
    rerenderWith({ id: uuid(3), nonce: 2 });
    expect(setCenter).toHaveBeenCalledTimes(2);
  });

  it('ignores a node that has no layout position', () => {
    renderCanvas({ id: uuid(99), nonce: 1 });
    expect(setCenter).not.toHaveBeenCalled();
  });
});
