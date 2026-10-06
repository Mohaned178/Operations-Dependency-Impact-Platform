import type { Confidence, RelationshipOrigin, TraceableRelationshipType } from '@opsgraph/shared';
import { enumerateBlockingPaths } from './blocking-paths';
import type { InternalPath, TraversalEdge } from './types';

interface EdgeOptions {
  type?: TraceableRelationshipType;
  origin?: RelationshipOrigin;
  confidence?: Confidence;
  traversal?: 'FORWARD' | 'REVERSE';
}

/** An edge walked from `sourceId` to `targetId`; `key` doubles as the hop key. */
function edge(key: string, sourceId: string, targetId: string, options: EdgeOptions = {}): TraversalEdge {
  const traversal = options.traversal ?? 'FORWARD';
  const origin = options.origin ?? 'SOURCE';
  return {
    key,
    type: options.type ?? 'REQUIRES',
    fromEntityId: traversal === 'FORWARD' ? sourceId : targetId,
    toEntityId: traversal === 'FORWARD' ? targetId : sourceId,
    sourceId,
    targetId,
    traversal,
    effectiveOrigin: origin,
    effectiveConfidence: options.confidence ?? 'HIGH',
    nonSource: origin !== 'SOURCE',
    assertions: [],
  };
}

function ids(paths: readonly InternalPath[]): string[] {
  return paths.map((path) => path.entityIds.join('>'));
}

describe('enumerateBlockingPaths', () => {
  it('returns one maximal path for a linear chain and no prefixes', () => {
    const result = enumerateBlockingPaths(
      'A',
      [edge('k1', 'A', 'B'), edge('k2', 'B', 'C')],
      6,
      1000,
    );
    expect(ids(result.paths)).toEqual(['A>B>C']);
    expect(result.paths[0]).toMatchObject({
      continuesBeyondDepth: false,
      endsInCycle: false,
      weakestConfidence: 'HIGH',
      nonSourceHops: 0,
    });
    expect(result.enumerationCapped).toBe(false);
    expect(result.cycleClosing).toEqual([]);
  });

  it('returns a branch as two paths in comparator order', () => {
    const result = enumerateBlockingPaths(
      'A',
      [edge('k2', 'A', 'C'), edge('k1', 'A', 'B')],
      6,
      1000,
    );
    expect(ids(result.paths)).toEqual(['A>B', 'A>C']);
  });

  it('closes a 2-node cycle A→B→A as one path ending in a cycle', () => {
    const closing = edge('k2', 'B', 'A');
    const result = enumerateBlockingPaths('A', [edge('k1', 'A', 'B'), closing], 6, 1000);
    expect(ids(result.paths)).toEqual(['A>B']);
    expect(result.paths[0]).toMatchObject({ endsInCycle: true, continuesBeyondDepth: false });
    expect(result.cycleClosing).toEqual([closing]);
  });

  it('closes a 3-node cycle A→B→C→A', () => {
    const closing = edge('k3', 'C', 'A');
    const result = enumerateBlockingPaths(
      'A',
      [edge('k1', 'A', 'B'), edge('k2', 'B', 'C'), closing],
      6,
      1000,
    );
    expect(ids(result.paths)).toEqual(['A>B>C']);
    expect(result.paths[0]?.endsInCycle).toBe(true);
    expect(result.cycleClosing).toEqual([closing]);
  });

  it('records a cycle-closing edge once even when several paths reach it', () => {
    const closing = edge('k9', 'C', 'A');
    const result = enumerateBlockingPaths(
      'A',
      [edge('k1', 'A', 'B'), edge('k2', 'B', 'C'), edge('k3', 'A', 'C'), closing],
      6,
      1000,
    );
    expect(ids(result.paths)).toEqual(['A>C', 'A>B>C']);
    expect(result.cycleClosing.map((e) => e.key)).toEqual(['k9']);
  });

  it('marks continuesBeyondDepth when maxDepth 1 cuts a longer chain', () => {
    const result = enumerateBlockingPaths(
      'A',
      [edge('k1', 'A', 'B'), edge('k2', 'B', 'C'), edge('k3', 'C', 'D')],
      1,
      1000,
    );
    expect(ids(result.paths)).toEqual(['A>B']);
    expect(result.paths[0]).toMatchObject({ continuesBeyondDepth: true, endsInCycle: false });
  });

  it('reports a cycle, not a depth cut, when the only edge past the limit closes a cycle', () => {
    const result = enumerateBlockingPaths('A', [edge('k1', 'A', 'B'), edge('k2', 'B', 'A')], 1, 1000);
    expect(ids(result.paths)).toEqual(['A>B']);
    expect(result.paths[0]).toMatchObject({ endsInCycle: true, continuesBeyondDepth: false });
  });

  it('stops at maxEnumerated paths and flags enumerationCapped', () => {
    const edges = [edge('k1', 'A', 'B'), edge('k2', 'A', 'C'), edge('k3', 'A', 'D')];
    const capped = enumerateBlockingPaths('A', edges, 6, 2);
    expect(ids(capped.paths)).toEqual(['A>B', 'A>C']);
    expect(capped.enumerationCapped).toBe(true);

    const uncapped = enumerateBlockingPaths('A', edges, 6, 4);
    expect(uncapped.paths).toHaveLength(3);
    expect(uncapped.enumerationCapped).toBe(false);
  });

  it('returns no paths for a start without edges', () => {
    expect(enumerateBlockingPaths('A', [], 6, 1000)).toEqual({
      paths: [],
      enumerationCapped: false,
      cycleClosing: [],
    });
    expect(enumerateBlockingPaths('A', [edge('k1', 'X', 'Y')], 6, 1000).paths).toEqual([]);
  });

  it('computes weakestConfidence and nonSourceHops from the edges of each path', () => {
    const result = enumerateBlockingPaths(
      'A',
      [
        edge('k1', 'A', 'B', { origin: 'INFERRED', confidence: 'MEDIUM' }),
        edge('k2', 'B', 'C', { confidence: 'LOW' }),
      ],
      6,
      1000,
    );
    expect(result.paths[0]).toMatchObject({ weakestConfidence: 'LOW', nonSourceHops: 1 });
  });

  it('ranks the all-HIGH 4-hop path above a MANUAL/MEDIUM BLOCKS shortcut (SHP-77120 shape)', () => {
    // SHP DEPENDS_ON ORD, ORD REQUIRES PAY, PAY REQUIRES APR, APR REQUIRES BUD,
    // plus PAY BLOCKS SHP (MANUAL / MEDIUM) walked in reverse from SHP to PAY.
    const result = enumerateBlockingPaths(
      'SHP',
      [
        edge('k1', 'SHP', 'ORD', { type: 'DEPENDS_ON' }),
        edge('k2', 'ORD', 'PAY'),
        edge('k3', 'PAY', 'APR'),
        edge('k4', 'APR', 'BUD'),
        edge('k5', 'SHP', 'PAY', {
          type: 'BLOCKS',
          traversal: 'REVERSE',
          origin: 'MANUAL',
          confidence: 'MEDIUM',
        }),
      ],
      6,
      1000,
    );
    expect(ids(result.paths)).toEqual(['SHP>ORD>PAY>APR>BUD', 'SHP>PAY>APR>BUD']);
    expect(result.paths[0]).toMatchObject({ weakestConfidence: 'HIGH', nonSourceHops: 0 });
    expect(result.paths[1]).toMatchObject({ weakestConfidence: 'MEDIUM', nonSourceHops: 1 });
  });
});
