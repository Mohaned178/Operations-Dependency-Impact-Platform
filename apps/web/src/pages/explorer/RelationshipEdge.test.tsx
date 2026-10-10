import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { flowFor, renderFlow } from './flow-test-utils';
import { blockersStub, edge, node, response, smallResponse, uuid } from './test-fixtures';

afterEach(cleanup);

function edgePath(key: string): SVGElement {
  const el = document.querySelector(`[data-testid="rf__edge-${key}"] path.react-flow__edge-path`);
  if (!(el instanceof SVGElement)) {
    throw new Error(`no edge path for ${key}`);
  }
  return el;
}

function twoNodeResponse(origin: 'SOURCE' | 'INFERRED' | 'MANUAL', confidence: 'HIGH' | 'MEDIUM' | 'LOW') {
  return response(
    [node({ n: 1, name: 'A' }), node({ n: 2, parent: 1, via: 1, name: 'B' })],
    [edge({ k: 1, type: 'REQUIRES', from: 1, to: 2, origin, confidence })],
  );
}

describe('RelationshipEdge', () => {
  it('styles a SOURCE / HIGH edge: solid, thick, no label', () => {
    const { nodes, edges } = flowFor(twoNodeResponse('SOURCE', 'HIGH'));
    renderFlow(nodes, edges);
    const path = edgePath(uuid(1001));
    expect(path.style.strokeWidth).toBe('2.5');
    expect(path.style.strokeDasharray).toBe('');
    expect(path.style.stroke).toBe('#64748b');
    expect(screen.queryByText(/Source ·/)).not.toBeInTheDocument();
  });

  it('draws an INFERRED / LOW edge dashed, thin, faded, with a text label', () => {
    const { nodes, edges } = flowFor(twoNodeResponse('INFERRED', 'LOW'));
    renderFlow(nodes, edges);
    const path = edgePath(uuid(1001));
    expect(path.style.strokeDasharray).toBe('8 4');
    expect(path.style.strokeWidth).toBe('1');
    expect(path.style.opacity).toBe('0.7');
    expect(screen.getByText('Inferred · LOW')).toBeInTheDocument();
  });

  it('curves parallel edges between two same-layer nodes differently', () => {
    // Same-layer edges leave and enter on the right, where the bezier curvature takes effect.
    const r = response(
      [node({ n: 1, name: 'A' }), node({ n: 2, parent: 1, via: 1, name: 'B' })],
      [
        edge({ k: 1, type: 'RELATES_TO', from: 1, to: 2 }),
        edge({ k: 2, type: 'GOVERNS', from: 1, to: 2 }),
      ],
    );
    const { nodes, edges } = flowFor(r);
    renderFlow(nodes, edges);
    const first = edgePath(uuid(1001)).getAttribute('d');
    const second = edgePath(uuid(1002)).getAttribute('d');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it('draws a MANUAL edge dotted with a label', () => {
    const { nodes, edges } = flowFor(twoNodeResponse('MANUAL', 'MEDIUM'));
    renderFlow(nodes, edges);
    expect(edgePath(uuid(1001)).style.strokeDasharray).toBe('2 4');
    expect(screen.getByText('Manual · MEDIUM')).toBeInTheDocument();
  });

  it('labels a selected edge with its type, origin and confidence', () => {
    const { nodes, edges } = flowFor(twoNodeResponse('SOURCE', 'HIGH'), {
      selection: { kind: 'edge', key: uuid(1001) },
    });
    renderFlow(nodes, edges);
    expect(screen.getByText('REQUIRES · Source · HIGH')).toBeInTheDocument();
    expect(edgePath(uuid(1001)).style.stroke).toBe('#2563eb');
  });

  it('draws a highlighted blocker edge red and a dimmed one faint', () => {
    const r = {
      ...smallResponse(),
      blockers: blockersStub({ paths: [[[2, 1]]], direct: [2], deepest: [2] }),
    };
    const { nodes, edges } = flowFor(r);
    renderFlow(nodes, edges);
    expect(edgePath(uuid(1001)).style.stroke).toBe('#dc2626');
    expect(edgePath(uuid(1002)).style.opacity).toBe('0.15');
  });
});
