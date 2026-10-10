import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  ErrorResponseSchema,
  NeighborhoodResponseSchema,
  type Confidence,
  type NeighborhoodResponse,
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
}

interface EdgeSpec {
  type: RelationshipType;
  from: string;
  to: string;
  origin?: RelationshipOrigin;
  confidence?: Confidence;
  sourceSystem?: string;
}

describe('Graph explorer: neighborhood (e2e)', () => {
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

  /** Resets the database, imports the graph, signs in an analyst and returns ids by source id. */
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

    const ref = (id: string) => ({ entityType: 'Customer', sourceSystem: 'CRM', sourceId: id });
    const report = await runImport(app, {
      format: 'json',
      content: JSON.stringify({
        entities: nodes.map((node) => ({
          type: 'Customer',
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
      ids[node.id] = await entityIdByKey(prisma, 'Customer', 'CRM', node.id);
    }
    return ids;
  }

  function get(path: string, authorized = true): request.Test {
    const req = request(server).get(path);
    return authorized ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  async function neighborhoodOf(id: string, query = ''): Promise<NeighborhoodResponse> {
    const response = await get(`/api/entities/${id}/neighborhood${query}`);
    expect(response.status).toBe(200);
    return NeighborhoodResponseSchema.parse(response.body);
  }

  describe('success', () => {
    it('answers 200 with a response that parses against the shared schema', async () => {
      const ids = await setup(
        [{ id: 'A', state: 'PENDING' }, { id: 'B', state: 'BLOCKED' }, { id: 'C' }],
        [
          { type: 'REQUIRES', from: 'A', to: 'B' },
          { type: 'RELATES_TO', from: 'B', to: 'C' },
        ],
      );
      const body = await neighborhoodOf(ids.A as string);
      expect(body.focusId).toBe(ids.A);
      expect(body.query).toMatchObject({
        direction: 'all',
        depth: 2,
        entityTypes: [],
        expand: [],
        blockers: false,
      });
      expect(body.query.relationshipTypes).toHaveLength(12);
      expect(body.nodes.map((n) => n.displayName)).toEqual(['Node A', 'Node B', 'Node C']);
      expect(body.nodes[0]).toMatchObject({ reasons: ['FOCUS'], distance: 0, parentId: null });
      expect(body.edges).toHaveLength(2);
      expect(body.totals).toEqual({ visible: 3, omitted: 0, omittedIsLowerBound: false });
      expect(body.blockers).toBeNull();
    });
  });

  describe('authentication, existence and validation', () => {
    it('answers 401 without a token', async () => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/neighborhood`, false);
      expect(response.status).toBe(401);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 404 for an unknown entity', async () => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/neighborhood`);
      expect(response.status).toBe(404);
      expect(ErrorResponseSchema.parse(response.body).error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Entity not found',
      });
    });

    it('answers 400 for an id that is not a UUID', async () => {
      await setup([]);
      const response = await get('/api/entities/not-a-uuid/neighborhood');
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('VALIDATION_FAILED');
    });

    const cases: Array<[string, string, string]> = [
      ['depth=0', '?depth=0', 'depth'],
      ['depth=5', '?depth=5', 'depth'],
      ['depth=2.5', '?depth=2.5', 'depth'],
      ['an unknown entity type', '?entityTypes=Foo', 'entityTypes.0'],
      ['blockers=yes', '?blockers=yes', 'blockers'],
      [
        'RELATES_TO with upstream',
        '?direction=upstream&relationshipTypes=RELATES_TO',
        'relationshipTypes',
      ],
      ['a malformed expand id', '?expand=nope', 'expand.0'],
    ];
    it.each(cases)('answers 400 for %s', async (_name, query, path) => {
      await setup([]);
      const response = await get(`/api/entities/${randomUUID()}/neighborhood${query}`);
      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.[0]?.path).toBe(path);
    });

    it('answers 400 when expand contains the focus', async () => {
      const ids = await setup([{ id: 'A' }, { id: 'B' }], [{ type: 'REQUIRES', from: 'A', to: 'B' }]);
      const response = await get(
        `/api/entities/${ids.A as string}/neighborhood?expand=${ids.A as string}`,
      );
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.details?.[0]?.path).toBe('expand');
    });
  });

  describe('generated graphs', () => {
    it('G2: a two-node cycle terminates with 2 nodes and 2 edges', async () => {
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
      const body = await neighborhoodOf(ids.A as string, '?direction=all&depth=4');
      expect(body.nodes).toHaveLength(2);
      expect(body.nodes.map((n) => n.id)).toEqual([ids.A, ids.B]);
      expect(body.edges).toHaveLength(2);
      expect(body.totals.omitted).toBe(0);
    });

    it('G3: one relationship asserted by two sources is one edge with both assertions', async () => {
      const ids = await setup(
        [{ id: 'A' }, { id: 'B' }],
        [
          {
            type: 'REQUIRES',
            from: 'A',
            to: 'B',
            origin: 'SOURCE',
            confidence: 'LOW',
            sourceSystem: 'OMS',
          },
          {
            type: 'REQUIRES',
            from: 'A',
            to: 'B',
            origin: 'INFERRED',
            confidence: 'HIGH',
            sourceSystem: 'LEGACY',
          },
        ],
      );
      const body = await neighborhoodOf(ids.A as string);
      expect(body.edges).toHaveLength(1);
      const [edge] = body.edges;
      expect(edge).toMatchObject({
        relationshipType: 'REQUIRES',
        effectiveOrigin: 'SOURCE',
        effectiveConfidence: 'LOW',
      });
      expect(edge?.assertions).toHaveLength(2);
      expect(edge?.assertions.map((a) => a.origin)).toEqual(['SOURCE', 'INFERRED']);
    });
  });
});
