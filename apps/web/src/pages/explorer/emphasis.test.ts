import { describe, expect, it } from 'vitest';
import { computeEmphasis } from './emphasis';
import { blockersStub, smallResponse, uuid } from './test-fixtures';

const base = smallResponse();
const withBlockers = {
  ...base,
  blockers: blockersStub({
    // Path 1: focus -> 2 (edge 1) -> 5 (edge 4). Path 2: focus -> 3 (edge 2).
    paths: [
      [
        [2, 1],
        [5, 4],
      ],
      [[3, 2]],
    ],
    direct: [2, 3],
    deepest: [5, 3],
  }),
};

describe('computeEmphasis', () => {
  it('is all normal with no blockers and no focus mode', () => {
    const result = computeEmphasis({
      response: base,
      selection: null,
      focusMode: false,
      selectedPathIndex: null,
    });
    expect([...result.nodes.values()].every((e) => e === 'normal')).toBe(true);
    expect([...result.edges.values()].every((e) => e === 'normal')).toBe(true);
    expect([...result.blockerRole.values()].every((r) => r === 'none')).toBe(true);
    expect(result.nodes.size).toBe(base.nodes.length);
    expect(result.edges.size).toBe(base.edges.length);
  });

  it('highlights every blocker path, keeps the focus normal and dims the rest', () => {
    const result = computeEmphasis({
      response: withBlockers,
      selection: null,
      focusMode: false,
      selectedPathIndex: null,
    });
    expect(result.nodes.get(uuid(1))).toBe('normal');
    for (const n of [2, 3, 5]) {
      expect(result.nodes.get(uuid(n))).toBe('highlighted');
    }
    for (const n of [4, 6]) {
      expect(result.nodes.get(uuid(n))).toBe('dimmed');
    }
    for (const k of [1, 2, 4]) {
      expect(result.edges.get(uuid(1000 + k))).toBe('highlighted');
    }
    for (const k of [3, 5]) {
      expect(result.edges.get(uuid(1000 + k))).toBe('dimmed');
    }
  });

  it('marks direct, deepest and both roles', () => {
    const result = computeEmphasis({
      response: withBlockers,
      selection: null,
      focusMode: false,
      selectedPathIndex: null,
    });
    expect(result.blockerRole.get(uuid(2))).toBe('direct');
    expect(result.blockerRole.get(uuid(5))).toBe('deepest');
    expect(result.blockerRole.get(uuid(3))).toBe('direct-and-deepest');
    expect(result.blockerRole.get(uuid(4))).toBe('none');
  });

  it('restricts highlighting to the selected path but keeps blocker roles', () => {
    const result = computeEmphasis({
      response: withBlockers,
      selection: null,
      focusMode: false,
      selectedPathIndex: 1,
    });
    expect(result.nodes.get(uuid(3))).toBe('highlighted');
    expect(result.nodes.get(uuid(2))).toBe('dimmed');
    expect(result.nodes.get(uuid(5))).toBe('dimmed');
    expect(result.edges.get(uuid(1002))).toBe('highlighted');
    expect(result.edges.get(uuid(1001))).toBe('dimmed');
    expect(result.blockerRole.get(uuid(5))).toBe('deepest');
    expect(result.blockerRole.get(uuid(2))).toBe('direct');
  });

  it('treats a response with zero blocker paths as no highlighting', () => {
    const result = computeEmphasis({
      response: { ...base, blockers: blockersStub({ paths: [], direct: [], deepest: [] }) },
      selection: null,
      focusMode: false,
      selectedPathIndex: null,
    });
    expect([...result.nodes.values()].every((e) => e === 'normal')).toBe(true);
  });

  it('focus mode dims everything outside the selected node and its neighbors', () => {
    const result = computeEmphasis({
      response: base,
      selection: { kind: 'node', id: uuid(3) },
      focusMode: true,
      selectedPathIndex: null,
    });
    // Node 3 is joined to the focus (edge 2) and to node 6 (edge 5).
    for (const n of [3, 1, 6]) {
      expect(result.nodes.get(uuid(n))).toBe('normal');
    }
    for (const n of [2, 4, 5]) {
      expect(result.nodes.get(uuid(n))).toBe('dimmed');
    }
    for (const k of [2, 5]) {
      expect(result.edges.get(uuid(1000 + k))).toBe('normal');
    }
    for (const k of [1, 3, 4]) {
      expect(result.edges.get(uuid(1000 + k))).toBe('dimmed');
    }
  });

  it('focus mode restores dimmed neighbors to normal but keeps highlights', () => {
    const result = computeEmphasis({
      response: withBlockers,
      selection: { kind: 'node', id: uuid(3) },
      focusMode: true,
      selectedPathIndex: null,
    });
    // 6 was dimmed by the blocker rule and is a neighbor of 3: back to normal.
    expect(result.nodes.get(uuid(6))).toBe('normal');
    expect(result.edges.get(uuid(1005))).toBe('normal');
    // 3 stays highlighted (blocker path), 2 is outside the keep set: dimmed.
    expect(result.nodes.get(uuid(3))).toBe('highlighted');
    expect(result.nodes.get(uuid(2))).toBe('dimmed');
    expect(result.edges.get(uuid(1002))).toBe('highlighted');
  });

  it('ignores focus mode for an edge selection or no selection', () => {
    for (const selection of [{ kind: 'edge' as const, key: uuid(1001) }, null]) {
      const result = computeEmphasis({
        response: base,
        selection,
        focusMode: true,
        selectedPathIndex: null,
      });
      expect([...result.nodes.values()].every((e) => e === 'normal')).toBe(true);
      expect([...result.edges.values()].every((e) => e === 'normal')).toBe(true);
    }
  });
});
