import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  BlockersResponseSchema,
  DependenciesResponseSchema,
  ErrorResponseSchema,
  type BlockersResponse,
  type Confidence,
  type DependenciesResponse,
  type EntityType,
  type OperationalState,
  type RelationshipOrigin,
  type RelationshipType,
} from '@opsgraph/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  createUser,
  entityIdByKey,
  login,
  resetDb,
  runImport,
  TEST_PASSWORD,
} from './helpers';

const T1 = '2026-09-14T08:00:00+00:00';

interface NodeSpec {
  /** Source id; the display name is `Node <id>`. */
  id: string;
  state?: OperationalState;
  type?: EntityType;
}

interface EdgeSpec {
  type: RelationshipType;
  from: string;
  to: string;
  origin?: RelationshipOrigin;
  confidence?: Confidence;
  sourceSystem?: string;
}

describe('Dependency tracing: blockers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Resets the database, imports the graph, signs in an analyst, and returns the entity ids by
   * source id. Throws with the row errors when the import is not applied.
   */
  async function setup(
    nodes: readonly NodeSpec[],
    edges: readonly EdgeSpec[] = [],
  ): Promise<Record<string, string>> {
    await resetDb(prisma);
    const analyst = await createUser(prisma, { role: 'ANALYST' });
    token = (await login(app, analyst.email, TEST_PASSWORD)).accessToken;

    if (nodes.length === 0) {
      return {};
    }

    const typeOf = new Map(nodes.map((node) => [node.id, node.type ?? 'Customer']));
    const ref = (id: string) => ({
      entityType: typeOf.get(id) ?? 'Customer',
      sourceSystem: 'CRM',
      sourceId: id,
    });
    const report = await runImport(app, {
      format: 'json',
      content: JSON.stringify({
        entities: nodes.map((node) => ({
          type: node.type ?? 'Customer',
          sourceSystem: 'CRM',
          sourceId: node.id,
          displayName: `Node ${node.id}`,
          ...(node.state === undefined ? {} : { state: node.state }),
          observedAt: T1,
        })),
        relationships: edges.map((edge) => {
          const origin = edge.origin ?? 'SOURCE';
          const sourceSystem = edge.sourceSystem ?? 'OPSGRAPH';
          return {
            type: edge.type,
            sourceSystem,
            sourceId: `rel-${edge.type}-${edge.from}-${edge.to}-${sourceSystem}`,
            from: ref(edge.from),
            to: ref(edge.to),
            origin,
            confidence: edge.confidence ?? 'HIGH',
            ...(origin === 'SOURCE' ? {} : { basis: `test basis for ${origin}` }),
            observedAt: T1,
          };
        }),
      }),
    });
    if (report?.outcome !== 'APPLIED') {
      throw new Error(
        `Test graph import was ${report?.outcome ?? 'missing'}: ${JSON.stringify([
          ...(report?.fileErrors ?? []),
          ...(report?.rowErrors ?? []),
        ])}`,
      );
    }

    const ids: Record<string, string> = {};
    for (const node of nodes) {
      ids[node.id] = await entityIdByKey(prisma, node.type ?? 'Customer', 'CRM', node.id);
    }
    return ids;
  }

  function get(path: string, authorized = true): request.Test {
    const req = request(server).get(path);
    return authorized ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  async function blockersOf(id: string, query = ''): Promise<BlockersResponse> {
    const response = await get(`/api/entities/${id}/blockers${query}`);
    expect(response.status).toBe(200);
    return BlockersResponseSchema.parse(response.body);
  }

  async function dependenciesOf(id: string, query = ''): Promise<DependenciesResponse> {
    const response = await get(`/api/entities/${id}/dependencies${query}`);
    expect(response.status).toBe(200);
    return DependenciesResponseSchema.parse(response.body);
  }

  function pathIds(response: BlockersResponse): string[][] {
    return response.paths.map((path) => path.hops.map((hop) => hop.entity.id));
  }

  describe('authentication and lookup', () => {
    it('answers 401 without a token', async () => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/blockers`, false);
      expect(response.status).toBe(401);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 404 for an unknown entity', async () => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/blockers`);
      expect(response.status).toBe(404);
      expect(ErrorResponseSchema.parse(response.body).error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Entity not found',
      });
    });
  });

  describe('validation', () => {
    const cases: Array<[string, string, string]> = [
      ['depth=0', '?depth=0', 'depth'],
      ['depth=11', '?depth=11', 'depth'],
      ['depth=2.5', '?depth=2.5', 'depth'],
      ['depth=abc', '?depth=abc', 'depth'],
      ['relationshipTypes=FULFILLED_BY', '?relationshipTypes=FULFILLED_BY', 'relationshipTypes.0'],
      ['entityTypes=Order,Truck', '?entityTypes=Order,Truck', 'entityTypes.1'],
    ];

    it.each(cases)('answers 400 for %s', async (_name, query, path) => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/blockers${query}`);
      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.[0]?.path).toBe(path);
    });

    it('answers 400 for an id that is not a UUID', async () => {
      await setup([]);
      const response = await get('/api/entities/not-a-uuid/blockers');
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('graph shapes', () => {
    it('handles a 2-node cycle and says so in the summary', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'PENDING' },
          { id: 'B', state: 'PENDING' },
        ],
        [
          { type: 'REQUIRES', from: 'A', to: 'B' },
          { type: 'REQUIRES', from: 'B', to: 'A' },
        ],
      );
      const body = await blockersOf(ids['A'] ?? '');

      expect(pathIds(body)).toEqual([[ids['B']]]);
      expect(body.paths[0]?.endsInCycle).toBe(true);
      expect(body.deepestBlockers).toHaveLength(1);
      expect(body.deepestBlockers[0]).toMatchObject({ inCycle: true, pathLength: 1 });
      expect(body.cycleClosingHopCount).toBe(1);
      expect(body.cycleClosingHops).toHaveLength(1);
      expect(body.cycleClosingHops[0]).toMatchObject({
        relationshipType: 'REQUIRES',
        fromEntityId: ids['B'],
        toEntityId: ids['A'],
      });
      expect(body.cycleClosingHops[0]?.relationshipIds).toHaveLength(1);
      expect(body.summary.endsWith(' It is part of a dependency cycle.')).toBe(true);
    });

    it('treats an UNKNOWN middle entity as a possible blocker and continues through it', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'BLOCKED' },
          { id: 'U' },
          { id: 'M', state: 'MISSING' },
        ],
        [
          { type: 'REQUIRES', from: 'A', to: 'U' },
          { type: 'REQUIRES', from: 'U', to: 'M' },
        ],
      );
      const body = await blockersOf(ids['A'] ?? '');

      expect(pathIds(body)).toEqual([[ids['U'], ids['M']]]);
      expect(body.paths[0]?.explanation).toEqual([
        'Node A is blocked because it requires Node U, whose state is unknown.',
        'Node U has an unknown state, and it requires Node M, which is MISSING.',
      ]);
      expect(body.deepestBlockers.map((b) => [b.entity.id, b.possible])).toEqual([
        [ids['M'], false],
      ]);
      expect(body.directBlockers.map((b) => [b.entity.id, b.possible])).toEqual([
        [ids['U'], true],
      ]);
    });

    it('marks an UNKNOWN last entity as a possible blocker', async () => {
      const ids = await setup(
        [{ id: 'A', state: 'BLOCKED' }, { id: 'U' }],
        [{ type: 'REQUIRES', from: 'A', to: 'U' }],
      );
      const body = await blockersOf(ids['A'] ?? '');

      expect(body.deepestBlockers).toHaveLength(1);
      expect(body.deepestBlockers[0]).toMatchObject({ possible: true, pathLength: 1 });
      expect(body.summary).toBe(
        'Node A is BLOCKED. 1 deepest blocker: Node U (state unknown, possible blocker), 1 step away.',
      );
    });

    it('stops at a satisfied entity', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'PENDING' },
          { id: 'S', state: 'ACTIVE' },
          { id: 'M', state: 'MISSING' },
        ],
        [
          { type: 'REQUIRES', from: 'A', to: 'S' },
          { type: 'REQUIRES', from: 'S', to: 'M' },
        ],
      );
      const body = await blockersOf(ids['A'] ?? '');

      expect(body.paths).toEqual([]);
      expect(body.totalPaths).toBe(0);
      expect(body.summary).toBe('Node A is PENDING. No blockers found within 6 steps.');
    });

    it('ignores RELATES_TO relationships', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'PENDING' },
          { id: 'B', state: 'MISSING' },
        ],
        [{ type: 'RELATES_TO', from: 'A', to: 'B' }],
      );
      expect((await blockersOf(ids['A'] ?? '')).paths).toEqual([]);
    });

    it('groups the same link asserted by two sources into one hop with two assertions', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'PENDING' },
          { id: 'B', state: 'PENDING' },
        ],
        [
          {
            type: 'REQUIRES',
            from: 'A',
            to: 'B',
            origin: 'MANUAL',
            confidence: 'LOW',
            sourceSystem: 'ANALYST',
          },
          { type: 'REQUIRES', from: 'A', to: 'B', confidence: 'MEDIUM', sourceSystem: 'ERP' },
        ],
      );
      const body = await blockersOf(ids['A'] ?? '');

      expect(body.paths).toHaveLength(1);
      const [hop] = body.paths[0]?.hops ?? [];
      expect(hop?.assertions).toHaveLength(2);
      expect(hop?.assertions.map((a) => [a.origin, a.confidence, a.sourceSystem])).toEqual([
        ['SOURCE', 'MEDIUM', 'ERP'],
        ['MANUAL', 'LOW', 'ANALYST'],
      ]);
      expect(hop).toMatchObject({ effectiveOrigin: 'SOURCE', effectiveConfidence: 'MEDIUM' });
      expect(body.paths[0]).toMatchObject({ weakestConfidence: 'MEDIUM', nonSourceHops: 0 });
    });
  });

  describe('filters and depth', () => {
    it('keeps only the paths that contain an entity of a selected type', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'BLOCKED' },
          { id: 'AP', state: 'PENDING', type: 'Approval' },
          { id: 'M', state: 'MISSING' },
          { id: 'C', state: 'PENDING' },
        ],
        [
          { type: 'REQUIRES', from: 'A', to: 'AP' },
          { type: 'REQUIRES', from: 'AP', to: 'M' },
          { type: 'DEPENDS_ON', from: 'A', to: 'C' },
        ],
      );

      const all = await blockersOf(ids['A'] ?? '');
      expect(all.totalPaths).toBe(2);

      const filtered = await blockersOf(ids['A'] ?? '', '?entityTypes=Approval');
      expect(filtered.query.entityTypes).toEqual(['Approval']);
      expect(filtered.totalPaths).toBe(1);
      expect(pathIds(filtered)).toEqual([[ids['AP'], ids['M']]]);
      expect(filtered.directBlockers.map((b) => b.entity.id)).toEqual([ids['AP']]);
    });

    it('drops a path that needs a relationship type outside the filter', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'BLOCKED' },
          { id: 'B', state: 'PENDING' },
          { id: 'C', state: 'PENDING' },
        ],
        [
          { type: 'DEPENDS_ON', from: 'A', to: 'B' },
          { type: 'REQUIRES', from: 'A', to: 'C' },
        ],
      );

      const filtered = await blockersOf(ids['A'] ?? '', '?relationshipTypes=REQUIRES');
      expect(filtered.query.relationshipTypes).toEqual(['REQUIRES']);
      expect(pathIds(filtered)).toEqual([[ids['C']]]);
    });

    it('cuts a 3-chain at depth 1 and flags the depth limit', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'BLOCKED' },
          { id: 'B', state: 'PENDING' },
          { id: 'C', state: 'MISSING' },
        ],
        [
          { type: 'REQUIRES', from: 'A', to: 'B' },
          { type: 'REQUIRES', from: 'B', to: 'C' },
        ],
      );
      const body = await blockersOf(ids['A'] ?? '', '?depth=1');

      expect(pathIds(body)).toEqual([[ids['B']]]);
      expect(body.paths[0]).toMatchObject({ length: 1, continuesBeyondDepth: true });
      expect(body.truncation).toEqual({
        depthLimit: true,
        explorationLimit: false,
        pathLimit: false,
      });
      expect(body.deepestBlockers[0]).toMatchObject({ continuesBeyondDepth: true });
      expect(body.directBlockers[0]).toMatchObject({ continuesBeyondDepth: false });
    });
  });

  describe('dependencies authentication and lookup', () => {
    it('answers 401 without a token', async () => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/dependencies?direction=upstream`, false);
      expect(response.status).toBe(401);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 404 for an unknown entity', async () => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/dependencies?direction=upstream`);
      expect(response.status).toBe(404);
      expect(ErrorResponseSchema.parse(response.body).error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Entity not found',
      });
    });
  });

  describe('dependencies validation', () => {
    const cases: Array<[string, string, string]> = [
      ['missing direction', '', 'direction'],
      ['sideways', '?direction=sideways', 'direction'],
      [
        'RELATES_TO at index 1',
        '?direction=upstream&relationshipTypes=REQUIRES,RELATES_TO',
        'relationshipTypes.1',
      ],
    ];

    it.each(cases)('answers 400 for %s', async (_name, query, path) => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/dependencies${query}`);
      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.[0]?.path).toBe(path);
    });

    it('answers 400 for an invalid cursor', async () => {
      const ids = await setup([{ id: 'A', state: 'PENDING' }]);
      const response = await get(
        `/api/entities/${ids['A'] ?? ''}/dependencies?direction=upstream&cursor=not-a-cursor`,
      );
      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.[0]?.path).toBe('cursor');
    });
  });

  describe('dependencies graph shapes', () => {
    it('ignores RELATES_TO relationships', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'PENDING' },
          { id: 'B', state: 'MISSING' },
        ],
        [{ type: 'RELATES_TO', from: 'A', to: 'B' }],
      );
      const body = await dependenciesOf(ids['A'] ?? '', '?direction=upstream&limit=200');
      expect(body.totalReached).toBe(0);
      expect(body.items).toEqual([]);
    });

    it('reaches both entities once on a 2-node cycle', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'PENDING' },
          { id: 'B', state: 'PENDING' },
        ],
        [
          { type: 'REQUIRES', from: 'A', to: 'B' },
          { type: 'REQUIRES', from: 'B', to: 'A' },
        ],
      );
      const up = await dependenciesOf(ids['A'] ?? '', '?direction=upstream&limit=200');
      expect(up.totalReached).toBe(1);
      expect(up.items.map((item) => item.entity.id)).toEqual([ids['B']]);
      expect(up.cycleClosingHopCount).toBeGreaterThanOrEqual(1);
      const down = await dependenciesOf(ids['A'] ?? '', '?direction=downstream&limit=200');
      expect(down.totalReached).toBe(1);
      expect(down.items.map((item) => item.entity.id)).toEqual([ids['B']]);
    });

    it('is symmetric on A REQUIRES B', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'PENDING' },
          { id: 'B', state: 'MISSING' },
        ],
        [{ type: 'REQUIRES', from: 'A', to: 'B' }],
      );
      const up = await dependenciesOf(ids['A'] ?? '', '?direction=upstream&limit=200');
      expect(up.items.map((item) => item.entity.id)).toEqual([ids['B']]);
      const down = await dependenciesOf(ids['B'] ?? '', '?direction=downstream&limit=200');
      expect(down.items.map((item) => item.entity.id)).toEqual([ids['A']]);
    });

    it('paginates a star of 5 dependencies in 3 pages', async () => {
      const ids = await setup(
        [
          { id: 'C', state: 'PENDING' },
          { id: 'L1', state: 'PENDING' },
          { id: 'L2', state: 'PENDING' },
          { id: 'L3', state: 'PENDING' },
          { id: 'L4', state: 'PENDING' },
          { id: 'L5', state: 'PENDING' },
        ],
        [
          { type: 'REQUIRES', from: 'C', to: 'L1' },
          { type: 'REQUIRES', from: 'C', to: 'L2' },
          { type: 'REQUIRES', from: 'C', to: 'L3' },
          { type: 'REQUIRES', from: 'C', to: 'L4' },
          { type: 'REQUIRES', from: 'C', to: 'L5' },
        ],
      );
      const center = ids['C'] ?? '';
      const first = await dependenciesOf(center, '?direction=upstream&limit=2');
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await dependenciesOf(
        center,
        `?direction=upstream&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      );
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).not.toBeNull();
      const third = await dependenciesOf(
        center,
        `?direction=upstream&limit=2&cursor=${encodeURIComponent(second.nextCursor ?? '')}`,
      );
      expect(third.items).toHaveLength(1);
      expect(third.nextCursor).toBeNull();

      const all = await dependenciesOf(center, '?direction=upstream&limit=200');
      expect([...first.items, ...second.items, ...third.items]).toEqual(all.items);
      expect(all.nextCursor).toBeNull();
    });

    it('reaches 10 entities at depth 10 on an 11-chain and flags the depth limit', async () => {
      const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `N${i}`, state: 'PENDING' as const }));
      const edges = Array.from({ length: 11 }, (_, i) => ({
        type: 'REQUIRES' as const,
        from: `N${i}`,
        to: `N${i + 1}`,
      }));
      const ids = await setup(nodes, edges);
      const body = await dependenciesOf(ids['N0'] ?? '', '?direction=upstream&depth=10&limit=200');
      expect(body.totalReached).toBe(10);
      expect(body.truncation.depthLimit).toBe(true);
      expect(body.truncation.pathLimit).toBe(false);
    });
  });

  describe('read-only', () => {
    it('tracing changes no data for any signed-in role (FR-023, FR-024)', async () => {
      const ids = await setup(
        [
          { id: 'A', state: 'PENDING' },
          { id: 'B', state: 'MISSING' },
        ],
        [{ type: 'REQUIRES', from: 'A', to: 'B' }],
      );
      const startId = ids['A'] ?? '';
      const analystToken = token;
      const manager = await createUser(prisma, { role: 'OPS_MANAGER' });
      const managerToken = (await login(app, manager.email, TEST_PASSWORD)).accessToken;
      const admin = await createUser(prisma, { role: 'ADMIN' });
      const adminToken = (await login(app, admin.email, TEST_PASSWORD)).accessToken;

      async function countTables(): Promise<[number, number, number, number]> {
        const [audits, entities, relationships, observations] = await Promise.all([
          prisma.auditEntry.count(),
          prisma.entity.count(),
          prisma.relationship.count(),
          prisma.stateObservation.count(),
        ]);
        return [audits, entities, relationships, observations];
      }

      const before = await countTables();

      for (const roleToken of [analystToken, managerToken, adminToken]) {
        for (let i = 0; i < 5; i += 1) {
          const blockers = await request(server)
            .get(`/api/entities/${startId}/blockers`)
            .set('Authorization', `Bearer ${roleToken}`);
          expect(blockers.status).toBe(200);
          const upstream = await request(server)
            .get(`/api/entities/${startId}/dependencies?direction=upstream`)
            .set('Authorization', `Bearer ${roleToken}`);
          expect(upstream.status).toBe(200);
          const downstream = await request(server)
            .get(`/api/entities/${startId}/dependencies?direction=downstream`)
            .set('Authorization', `Bearer ${roleToken}`);
          expect(downstream.status).toBe(200);
        }
      }

      expect(await countTables()).toEqual(before);
    });
  });
});
