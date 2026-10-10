import {
  RelationshipTypeSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  type BlockersResponse,
  type NeighborhoodQuery,
  type RelationshipType,
} from '@opsgraph/shared';
import { AppError } from '../common/errors/app-error';
import type {
  GraphEntityRef,
  GraphRepository,
  NeighborhoodReached,
  NeighborhoodTrace,
  NeighborhoodTraceQuery,
  RelationshipGroup,
} from '../graph/graph.repository';
import { NeighborhoodService } from './neighborhood.service';
import type { EntityStateEvidence, StateEvidenceReader } from './state-evidence.reader';
import type { TracingService } from './tracing.service';

const FOCUS: GraphEntityRef = { id: 'focus', type: 'Order', displayName: 'Focus', currentState: 'BLOCKED' };

function ent(id: string, type: GraphEntityRef['type'] = 'Order'): GraphEntityRef {
  return { id, type, displayName: id, currentState: 'PENDING' };
}

function reached(entity: GraphEntityRef, parent: string, key: string): NeighborhoodReached {
  return {
    entity,
    distance: 1,
    pathEntityIds: [parent, entity.id],
    pathEdgeKeys: [key],
    weakestConfidence: 'HIGH',
    nonSourceHops: 0,
  };
}

function trace(start: GraphEntityRef, rows: NeighborhoodReached[]): NeighborhoodTrace {
  return { start, reached: rows, explorationLimitReached: false };
}

function group(
  key: string,
  type: RelationshipType,
  fromEntityId: string,
  toEntityId: string,
): RelationshipGroup {
  return {
    key,
    type,
    fromEntityId,
    toEntityId,
    effectiveOrigin: 'SOURCE',
    effectiveConfidence: 'HIGH',
    assertions: [
      {
        relationshipId: key,
        origin: 'SOURCE',
        confidence: 'HIGH',
        basis: null,
        sourceSystem: 'SYS',
        sourceId: `src-${key}`,
        observedAt: new Date('2026-09-29T11:40:00.000Z'),
        importId: 'import-1',
      },
    ],
  };
}

function query(overrides: Partial<NeighborhoodQuery> = {}): NeighborhoodQuery {
  return {
    direction: 'all',
    depth: 2,
    relationshipTypes: [],
    entityTypes: [],
    expand: [],
    blockers: false,
    ...overrides,
  };
}

function blockersResponse(hops: Array<{ entity: GraphEntityRef; key: string }>): BlockersResponse {
  // Only the fields the explorer reads: paths[].hops[].{key, entity}.
  return {
    paths: [
      {
        hops: hops.map((hop) => ({
          key: hop.key,
          entity: { ...hop.entity, state: { classification: 'UNSATISFIED', observation: null, latestBySource: [] } },
        })),
      },
    ],
  } as unknown as BlockersResponse;
}

interface Fixture {
  service: NeighborhoodService;
  traceNeighborhood: jest.Mock<Promise<NeighborhoodTrace | null>, [NeighborhoodTraceQuery]>;
  findRelationshipsAmong: jest.Mock<
    Promise<RelationshipGroup[]>,
    [readonly string[], readonly RelationshipType[]]
  >;
  blockers: jest.Mock;
  load: jest.Mock;
}

function setup(): Fixture {
  const traceNeighborhood = jest.fn<Promise<NeighborhoodTrace | null>, [NeighborhoodTraceQuery]>();
  const findRelationshipsAmong = jest.fn<
    Promise<RelationshipGroup[]>,
    [readonly string[], readonly RelationshipType[]]
  >();
  findRelationshipsAmong.mockResolvedValue([]);
  const graph: GraphRepository = {
    findNeighbors: jest.fn(),
    countNeighbors: jest.fn(),
    traceDependencies: jest.fn(),
    traceBlockers: jest.fn(),
    traceNeighborhood,
    findRelationshipsAmong,
  };
  const blockers = jest.fn();
  const load = jest.fn((ids: readonly string[]) => {
    const evidence: EntityStateEvidence = { observation: null, latestBySource: [] };
    return Promise.resolve(new Map(ids.map((id) => [id, evidence])));
  });
  const service = new NeighborhoodService(
    graph,
    { blockers } as unknown as TracingService,
    { load } as unknown as StateEvidenceReader,
  );
  return { service, traceNeighborhood, findRelationshipsAmong, blockers, load };
}

describe('NeighborhoodService', () => {
  it('rejects an expand list containing the focus before any repository call', async () => {
    const { service, traceNeighborhood, findRelationshipsAmong, blockers } = setup();
    const error = await service
      .neighborhood('focus', query({ expand: ['other', 'focus'] }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect((error as AppError).details).toEqual([
      { path: 'expand', message: 'expand must not include the focus entity' },
    ]);
    expect(traceNeighborhood).not.toHaveBeenCalled();
    expect(findRelationshipsAmong).not.toHaveBeenCalled();
    expect(blockers).not.toHaveBeenCalled();
  });

  it('treats ids case-insensitively: lower-cases the focus and the expand list', async () => {
    const { service, traceNeighborhood, findRelationshipsAmong } = setup();
    const a = ent('a');
    traceNeighborhood.mockImplementation((q) =>
      Promise.resolve(
        q.startId === 'focus' ? trace(FOCUS, [reached(a, 'focus', 'ka')]) : trace(a, []),
      ),
    );
    findRelationshipsAmong.mockResolvedValue([group('ka', 'REQUIRES', 'focus', 'a')]);
    const response = await service.neighborhood('FOCUS', query({ expand: ['A', 'a'] }));
    expect(traceNeighborhood.mock.calls.map(([q]) => q.startId)).toEqual(['focus', 'a']);
    expect(response.focusId).toBe('focus');
    expect(response.query.entityId).toBe('focus');
    expect(response.query.expand).toEqual(['a']);
    expect(response.nodes.find((n) => n.id === 'a')?.expanded).toBe(true);
  });

  it('rejects an upper-case spelling of the focus in expand', async () => {
    const { service, traceNeighborhood } = setup();
    const error = await service
      .neighborhood('focus', query({ expand: ['FOCUS'] }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect(traceNeighborhood).not.toHaveBeenCalled();
  });

  it('defaults to the 12 relationship types for all and the 11 traceable ones for upstream', async () => {
    const all = setup();
    all.traceNeighborhood.mockResolvedValue(trace(FOCUS, []));
    const allResponse = await all.service.neighborhood('focus', query({ direction: 'all' }));
    expect(allResponse.query.relationshipTypes).toEqual([...RelationshipTypeSchema.options]);
    expect(allResponse.query.relationshipTypes).toHaveLength(12);
    expect(all.traceNeighborhood).toHaveBeenCalledWith({
      startId: 'focus',
      walk: 'ALL',
      maxDepth: 2,
      relationshipTypes: [...RelationshipTypeSchema.options],
    });

    const up = setup();
    up.traceNeighborhood.mockResolvedValue(trace(FOCUS, []));
    const upResponse = await up.service.neighborhood('focus', query({ direction: 'upstream' }));
    expect(upResponse.query.relationshipTypes).toEqual([...TRACEABLE_RELATIONSHIP_TYPES]);
    expect(upResponse.query.relationshipTypes).toHaveLength(11);
    expect(up.traceNeighborhood.mock.calls[0]?.[0].walk).toBe('UPSTREAM');
  });

  it('uses explicitly requested relationship types as they are', async () => {
    const { service, traceNeighborhood } = setup();
    traceNeighborhood.mockResolvedValue(trace(FOCUS, []));
    const response = await service.neighborhood(
      'focus',
      query({ direction: 'downstream', relationshipTypes: ['REQUIRES'], depth: 3 }),
    );
    expect(response.query).toMatchObject({ relationshipTypes: ['REQUIRES'], depth: 3 });
    expect(traceNeighborhood.mock.calls[0]?.[0]).toMatchObject({
      walk: 'DOWNSTREAM',
      maxDepth: 3,
      relationshipTypes: ['REQUIRES'],
    });
  });

  it('throws NOT_FOUND when the focus does not exist', async () => {
    const { service, traceNeighborhood, findRelationshipsAmong } = setup();
    traceNeighborhood.mockResolvedValue(null);
    const error = await service.neighborhood('focus', query()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('NOT_FOUND');
    expect(findRelationshipsAmong).not.toHaveBeenCalled();
  });

  it('does not call TracingService.blockers when blockers is false', async () => {
    const { service, traceNeighborhood, blockers } = setup();
    traceNeighborhood.mockResolvedValue(trace(FOCUS, []));
    const response = await service.neighborhood('focus', query({ blockers: false }));
    expect(blockers).not.toHaveBeenCalled();
    expect(response.blockers).toBeNull();
    expect(response.query.blockers).toBe(false);
  });

  it('traces expansions sequentially, in request order, at depth 1', async () => {
    const { service, traceNeighborhood, findRelationshipsAmong } = setup();
    findRelationshipsAmong.mockResolvedValue([
      group('ka', 'REQUIRES', 'focus', 'a'),
      group('kb', 'REQUIRES', 'focus', 'b'),
    ]);
    const a = ent('a');
    const b = ent('b');
    const events: string[] = [];
    let releaseA: (value: NeighborhoodTrace) => void = () => undefined;
    traceNeighborhood.mockImplementation((q) => {
      events.push(`start:${q.startId}`);
      if (q.startId === 'focus') {
        return Promise.resolve(
          trace(FOCUS, [reached(a, 'focus', 'ka'), reached(b, 'focus', 'kb')]),
        );
      }
      if (q.startId === 'a') {
        return new Promise((resolve) => {
          releaseA = (value) => {
            events.push('end:a');
            resolve(value);
          };
        });
      }
      events.push(`end:${q.startId}`);
      return Promise.resolve(trace(b, []));
    });

    const pending = service.neighborhood('focus', query({ expand: ['a', 'b'], depth: 1 }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(['start:focus', 'start:a']);
    releaseA(trace(a, []));
    await pending;
    expect(events).toEqual(['start:focus', 'start:a', 'end:a', 'start:b', 'end:b']);
    expect(traceNeighborhood.mock.calls.slice(1).map(([q]) => [q.startId, q.maxDepth])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  describe('edge filtering', () => {
    function build() {
      const f = setup();
      const payment = ent('pay', 'Payment');
      const approval = ent('apr', 'Approval');
      f.traceNeighborhood.mockResolvedValue(
        trace(FOCUS, [reached(payment, 'focus', 'k-req')]),
      );
      f.blockers.mockResolvedValue(
        blockersResponse([
          { entity: approval, key: 'k-blk' },
        ]),
      );
      f.findRelationshipsAmong.mockResolvedValue([
        group('k-blk', 'BLOCKS', 'apr', 'focus'),
        group('k-req', 'REQUIRES', 'focus', 'pay'),
        group('k-other', 'BLOCKS', 'pay', 'focus'),
        group('k-ctx', 'GOVERNS', 'apr', 'pay'),
      ]);
      return f;
    }

    it('keeps an out-of-filter group only when its key is a blocker hop key', async () => {
      const f = build();
      const response = await f.service.neighborhood(
        'focus',
        query({ direction: 'upstream', relationshipTypes: ['REQUIRES'], blockers: true }),
      );
      expect(response.edges.map((e) => e.key)).toEqual(['k-blk', 'k-req']);
      const [visibleIds, edgeTypes] = f.findRelationshipsAmong.mock.calls[0] ?? [];
      expect(visibleIds).toEqual(['focus', 'apr', 'pay']);
      expect(edgeTypes).toEqual(['REQUIRES', 'DEPENDS_ON', 'BLOCKS']);
      expect(f.blockers).toHaveBeenCalledWith('focus', {
        depth: 6,
        relationshipTypes: [],
        entityTypes: [],
      });
    });

    it('queries only the requested types when blockers are off', async () => {
      const f = setup();
      f.traceNeighborhood.mockResolvedValue(trace(FOCUS, []));
      await f.service.neighborhood('focus', query({ relationshipTypes: ['GOVERNS'] }));
      expect(f.findRelationshipsAmong.mock.calls[0]?.[1]).toEqual(['GOVERNS']);
    });

    it('returns edges sorted by key', async () => {
      const f = build();
      f.findRelationshipsAmong.mockResolvedValue([
        group('k-req', 'REQUIRES', 'focus', 'pay'),
        group('k-blk', 'BLOCKS', 'apr', 'focus'),
      ]);
      const response = await f.service.neighborhood(
        'focus',
        query({ direction: 'upstream', relationshipTypes: ['REQUIRES'], blockers: true }),
      );
      expect(response.edges.map((e) => e.key)).toEqual(['k-blk', 'k-req']);
    });
  });

  it('builds nodes with the composed fields and the totals', async () => {
    const { service, traceNeighborhood, findRelationshipsAmong } = setup();
    const a = ent('a');
    traceNeighborhood.mockResolvedValue(trace(FOCUS, [reached(a, 'focus', 'ka')]));
    findRelationshipsAmong.mockResolvedValue([group('ka', 'REQUIRES', 'focus', 'a')]);
    const response = await service.neighborhood('focus', query());
    expect(response.focusId).toBe('focus');
    expect(response.nodes.map((n) => [n.id, n.reasons, n.distance, n.parentId, n.viaEdgeKey])).toEqual([
      ['focus', ['FOCUS'], 0, null, null],
      ['a', ['NEIGHBORHOOD'], 1, 'focus', 'ka'],
    ]);
    expect(response.totals).toEqual({ visible: 2, omitted: 0, omittedIsLowerBound: false });
    expect(response.ignoredExpansions).toEqual([]);
  });

  it('throws when a node viaEdgeKey is missing from the kept edges', async () => {
    const { service, traceNeighborhood, findRelationshipsAmong } = setup();
    traceNeighborhood.mockResolvedValue(trace(FOCUS, [reached(ent('a'), 'focus', 'ka')]));
    findRelationshipsAmong.mockResolvedValue([]);
    await expect(service.neighborhood('focus', query())).rejects.toThrow('explorer invariant');
  });

  it('throws when the viaEdgeKey edge does not join the node to its parent', async () => {
    const { service, traceNeighborhood, findRelationshipsAmong } = setup();
    traceNeighborhood.mockResolvedValue(trace(FOCUS, [reached(ent('a'), 'focus', 'ka')]));
    findRelationshipsAmong.mockResolvedValue([group('ka', 'REQUIRES', 'x', 'y')]);
    await expect(service.neighborhood('focus', query())).rejects.toThrow('explorer invariant');
  });
});
