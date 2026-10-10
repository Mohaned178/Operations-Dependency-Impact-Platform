import { describe, expect, it } from 'vitest';
import { computeEmphasis } from './emphasis';
import { NODE_HEIGHT, NODE_WIDTH, type Selection } from './flow-types';
import { layoutNeighborhood } from './layout';
import { edge, node, response, smallResponse, uuid } from './test-fixtures';
import { toFlow } from './to-flow';

function flowOf(r = smallResponse(), selection: Selection = null) {
  return toFlow({
    response: r,
    layout: layoutNeighborhood(r),
    emphasis: computeEmphasis({ response: r, selection, focusMode: false, selectedPathIndex: null }),
    selection,
  });
}

describe('toFlow nodes', () => {
  const { nodes } = flowOf();

  it('maps one node per response node, in order, with fixed size and positions', () => {
    expect(nodes.map((n) => n.id)).toEqual(smallResponse().nodes.map((n) => n.id));
    expect(nodes[0]).toMatchObject({
      type: 'entity',
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      position: { x: -NODE_WIDTH / 2, y: -NODE_HEIGHT / 2 },
      draggable: false,
      connectable: false,
      deletable: false,
      selectable: true,
    });
  });

  it('flags the focus and sets data fields', () => {
    expect(nodes[0]?.data).toMatchObject({
      isFocus: true,
      isConnector: false,
      hasConflict: false,
      emphasis: 'normal',
      blockerRole: 'none',
      canExpand: false,
    });
    expect(nodes[1]?.data.isFocus).toBe(false);
  });

  it('labels nodes for assistive technology', () => {
    expect(nodes[0]?.ariaLabel).toBe('Order Focus, Pending');
  });

  it('detects a conflict and a connector', () => {
    const r = response(
      [
        node({
          n: 1,
          latestBySource: [
            { sourceSystem: 'OMS', state: 'BLOCKED' },
            { sourceSystem: 'ERP', state: 'PENDING' },
          ],
        }),
        node({ n: 2, parent: 1, via: 1, reasons: ['CONNECTOR'] }),
        node({ n: 3, parent: 1, via: 2, reasons: ['CONNECTOR', 'NEIGHBORHOOD'] }),
      ],
      [
        edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 }),
        edge({ k: 2, type: 'REQUIRES', from: 1, to: 3 }),
      ],
    );
    const result = flowOf(r).nodes;
    expect(result[0]?.data.hasConflict).toBe(true);
    expect(result[1]?.data.isConnector).toBe(true);
    expect(result[2]?.data.isConnector).toBe(false);
  });

  it('marks only the selected node as selected', () => {
    const selected = flowOf(smallResponse(), { kind: 'node', id: uuid(3) }).nodes;
    expect(selected.filter((n) => n.selected).map((n) => n.id)).toEqual([uuid(3)]);
  });
});

describe('toFlow edges', () => {
  it('maps one edge per response edge, as recorded, with accessibility and hit width', () => {
    const { edges } = flowOf();
    expect(edges.map((e) => e.id)).toEqual(smallResponse().edges.map((e) => e.key));
    const first = edges[0];
    expect(first).toMatchObject({
      type: 'relationship',
      source: uuid(1),
      target: uuid(2),
      deletable: false,
      focusable: true,
      selectable: true,
      interactionWidth: 16,
      ariaLabel: 'Focus REQUIRES Upstream, SOURCE HIGH',
    });
    expect(first?.markerEnd).toMatchObject({ width: 14, height: 14 });
  });

  it('chooses handles from the layer order: from > to, from < to and the same layer', () => {
    const { edges } = flowOf();
    // 1 (layer 0) REQUIRES 2 (layer -1): from > to.
    expect(edges[0]).toMatchObject({ sourceHandle: 'out-left', targetHandle: 'in-right' });
    // 1 (layer 0) RELATES_TO 4 (layer 0): same layer.
    expect(edges[2]).toMatchObject({ sourceHandle: 'out-right', targetHandle: 'in-right' });
    // 6 (layer 2) REQUIRES 3 (layer 1): from > to.
    expect(edges[4]).toMatchObject({ sourceHandle: 'out-left', targetHandle: 'in-right' });
  });

  it('uses out-right / in-left when the source layer is lower than the target layer', () => {
    // BLOCKS from 1 to 2: 2 depends on 1, so 2 is downstream (layer +1).
    const r = response(
      [node({ n: 1 }), node({ n: 2, parent: 1, via: 1 })],
      [edge({ k: 1, type: 'BLOCKS', from: 1, to: 2 })],
    );
    expect(flowOf(r).edges[0]).toMatchObject({
      sourceHandle: 'out-right',
      targetHandle: 'in-left',
    });
  });

  it('numbers parallel edges between the same unordered pair by key', () => {
    const r = response(
      [node({ n: 1 }), node({ n: 2, parent: 1, via: 1 })],
      [
        edge({ k: 3, type: 'BLOCKS', from: 2, to: 1 }),
        edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 }),
        edge({ k: 2, type: 'DEPENDS_ON', from: 1, to: 2 }),
      ],
    );
    const byId = new Map(flowOf(r).edges.map((e) => [e.id, e.data?.parallelIndex]));
    expect(byId.get(uuid(1001))).toBe(0);
    expect(byId.get(uuid(1002))).toBe(1);
    expect(byId.get(uuid(1003))).toBe(2);
  });

  it('marks only the selected edge as selected and gives it the selected stroke', () => {
    const { edges } = flowOf(smallResponse(), { kind: 'edge', key: uuid(1002) });
    expect(edges.filter((e) => e.selected).map((e) => e.id)).toEqual([uuid(1002)]);
    expect(edges.find((e) => e.id === uuid(1002))?.markerEnd).toMatchObject({ color: '#2563eb' });
  });

  it('gives RELATES_TO no arrow marker', () => {
    expect(flowOf().edges[2]?.markerEnd).toBeUndefined();
  });
});
