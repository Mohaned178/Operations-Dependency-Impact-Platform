import { DEPENDENCY_DIRECTION, RelationshipTypeSchema } from '@opsgraph/shared';
import { describe, expect, it } from 'vitest';
import { COLUMN_GAP, ROW_GAP } from './flow-types';
import { layoutNeighborhood, stepBetween } from './layout';
import { edge, node, response, smallResponse, uuid } from './test-fixtures';

describe('stepBetween', () => {
  it.each(RelationshipTypeSchema.options)('%s moves in opposite directions each way', (type) => {
    const e = edge({ k: 1, type, from: 1, to: 2 });
    if (type === 'RELATES_TO') {
      expect(stepBetween(e, uuid(1))).toBe(0);
      expect(stepBetween(e, uuid(2))).toBe(0);
      return;
    }
    const dependentIsFrom = DEPENDENCY_DIRECTION[type] === 'FROM_DEPENDS_ON_TO';
    // From the dependent to the depended-on is upstream (left, -1).
    expect(stepBetween(e, uuid(dependentIsFrom ? 1 : 2))).toBe(-1);
    expect(stepBetween(e, uuid(dependentIsFrom ? 2 : 1))).toBe(1);
  });

  it('treats REQUIRES from -> to as the dependent relying on the target', () => {
    const e = edge({ k: 1, type: 'REQUIRES', from: 1, to: 2 });
    expect(stepBetween(e, uuid(1))).toBe(-1);
    expect(stepBetween(e, uuid(2))).toBe(1);
  });

  it('treats BLOCKS from -> to as the target depending on the source', () => {
    const e = edge({ k: 1, type: 'BLOCKS', from: 1, to: 2 });
    expect(stepBetween(e, uuid(2))).toBe(-1);
    expect(stepBetween(e, uuid(1))).toBe(1);
  });
});

describe('layoutNeighborhood', () => {
  const layout = layoutNeighborhood(smallResponse());
  const at = (n: number) => layout.center.get(uuid(n));

  it('puts upstream nodes in negative layers and downstream in positive', () => {
    expect(layout.layer.get(uuid(1))).toBe(0);
    expect(layout.layer.get(uuid(2))).toBe(-1);
    expect(layout.layer.get(uuid(5))).toBe(-2);
    expect(layout.layer.get(uuid(3))).toBe(1);
    expect(layout.layer.get(uuid(6))).toBe(2);
  });

  it('places a RELATES_TO sibling in layer 0 below the focus', () => {
    expect(layout.layer.get(uuid(4))).toBe(0);
    expect(at(4)).toEqual({ x: 0, y: ROW_GAP });
  });

  it('puts the focus at (0, 0)', () => {
    expect(at(1)).toEqual({ x: 0, y: 0 });
  });

  it('spaces columns by COLUMN_GAP and centers each non-zero column', () => {
    expect(at(2)).toEqual({ x: -COLUMN_GAP, y: 0 });
    expect(at(3)).toEqual({ x: COLUMN_GAP, y: 0 });
    expect(at(5)).toEqual({ x: -2 * COLUMN_GAP, y: 0 });
    expect(at(6)).toEqual({ x: 2 * COLUMN_GAP, y: 0 });
  });

  it('centers a column with several nodes and orders rows by tree order', () => {
    // Focus 1 with three downstream children 2, 3, 4 (each REQUIRES the focus).
    const wide = layoutNeighborhood(
      response(
        [
          node({ n: 1 }),
          node({ n: 2, parent: 1, via: 1 }),
          node({ n: 3, parent: 1, via: 2 }),
          node({ n: 4, parent: 1, via: 3 }),
        ],
        [
          edge({ k: 1, type: 'REQUIRES', from: 2, to: 1 }),
          edge({ k: 2, type: 'REQUIRES', from: 3, to: 1 }),
          edge({ k: 3, type: 'REQUIRES', from: 4, to: 1 }),
        ],
      ),
    );
    expect([2, 3, 4].map((n) => wide.center.get(uuid(n))?.y)).toEqual([
      -ROW_GAP,
      0,
      ROW_GAP,
    ]);
  });

  it('sorts a column by depth-first tree order, keeping grandchildren under their parents', () => {
    // Downstream: 2 and 3 are children of the focus; 4 is a child of 2, 5 of 3, all in layer 1/2.
    // Layer 2 must list 4 (under 2) before 5 (under 3) even though response order is 5, 4.
    const result = layoutNeighborhood(
      response(
        [
          node({ n: 1 }),
          node({ n: 2, parent: 1, via: 1 }),
          node({ n: 3, parent: 1, via: 2 }),
          node({ n: 5, parent: 3, via: 4 }),
          node({ n: 4, parent: 2, via: 3 }),
        ],
        [
          edge({ k: 1, type: 'REQUIRES', from: 2, to: 1 }),
          edge({ k: 2, type: 'REQUIRES', from: 3, to: 1 }),
          edge({ k: 3, type: 'REQUIRES', from: 4, to: 2 }),
          edge({ k: 4, type: 'REQUIRES', from: 5, to: 3 }),
        ],
      ),
    );
    const y4 = result.center.get(uuid(4))?.y ?? 0;
    const y5 = result.center.get(uuid(5))?.y ?? 0;
    expect(y4).toBeLessThan(y5);
  });

  it('puts a two-hop sibling (down then up) in layer 0 below the focus, in tree order', () => {
    // Node 2 requires the focus, so it sits downstream (layer 1). Nodes 3 and 4 are things node 2
    // requires, so from 2 they are one step upstream: 1 + (-1) = layer 0, next to the focus.
    const result = layoutNeighborhood(
      response(
        [
          node({ n: 1 }),
          node({ n: 2, parent: 1, via: 1 }),
          node({ n: 3, parent: 2, via: 2 }),
          node({ n: 4, parent: 2, via: 3 }),
        ],
        [
          edge({ k: 1, type: 'REQUIRES', from: 2, to: 1 }),
          edge({ k: 2, type: 'REQUIRES', from: 2, to: 3 }),
          edge({ k: 3, type: 'REQUIRES', from: 2, to: 4 }),
        ],
      ),
    );
    expect(result.layer.get(uuid(3))).toBe(0);
    expect(result.layer.get(uuid(4))).toBe(0);
    expect(result.center.get(uuid(3))).toEqual({ x: 0, y: ROW_GAP });
    expect(result.center.get(uuid(4))).toEqual({ x: 0, y: 2 * ROW_GAP });
  });

  it('is deterministic', () => {
    const again = layoutNeighborhood(smallResponse());
    expect([...again.layer]).toEqual([...layout.layer]);
    expect([...again.center]).toEqual([...layout.center]);
  });

  it('places every node exactly once', () => {
    expect(layout.center.size).toBe(smallResponse().nodes.length);
  });

  it('throws when a parent edge is missing from the response', () => {
    expect(() =>
      layoutNeighborhood(response([node({ n: 1 }), node({ n: 2, parent: 1 })], [])),
    ).toThrow('explorer layout');
  });
});
