import { AUDIT_ACTIONS } from '@opsgraph/shared';
import type { RequestContext } from '../common/context/request-context';
import type { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

const CORRELATION_ID = '4f8a2c1e-3b7d-4a6f-9e2c-5d1b8a3f7c90';
const ACTOR_ID = '0f2b4c6d-8e1a-4b3c-9d5e-7f8a1b2c3d4e';

interface MockContext {
  correlationId: string;
  ip?: string;
  userId?: string;
}

interface AuditCreateArgs {
  data: Record<string, unknown>;
}

function createService(context: MockContext): {
  service: AuditService;
  create: jest.Mock<Promise<unknown>, [AuditCreateArgs]>;
  standaloneCreate: jest.Mock<Promise<unknown>, [AuditCreateArgs]>;
} {
  const create = jest.fn<Promise<unknown>, [AuditCreateArgs]>().mockResolvedValue({});
  const standaloneCreate = jest.fn<Promise<unknown>, [AuditCreateArgs]>().mockResolvedValue({});
  const prisma = { auditEntry: { create: standaloneCreate } } as unknown as PrismaService;
  const requestContext = context as unknown as RequestContext;

  return { service: new AuditService(prisma, requestContext), create, standaloneCreate };
}

describe('AuditService', () => {
  it('defaults the actor to the request user and redacts before/after', async () => {
    const { service, create } = createService({
      correlationId: CORRELATION_ID,
      ip: '10.0.0.7',
      userId: ACTOR_ID,
    });
    const tx = { auditEntry: { create } } as unknown as Tx;

    await service.record(tx, {
      action: AUDIT_ACTIONS.USER_UPDATED,
      targetType: 'user',
      targetId: ACTOR_ID,
      before: { displayName: 'Old', passwordHash: 'hash-value' },
      after: { displayName: 'New' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]?.[0];
    expect(arg?.data).toEqual({
      action: 'user.updated',
      targetType: 'user',
      targetId: ACTOR_ID,
      before: { displayName: 'Old' },
      after: { displayName: 'New' },
      metadata: undefined,
      actorType: 'user',
      actorId: ACTOR_ID,
      correlationId: CORRELATION_ID,
      ipAddress: '10.0.0.7',
    });
  });

  it('uses anonymous when no user context and no explicit actor is given', async () => {
    const { service, create } = createService({ correlationId: CORRELATION_ID });
    const tx = { auditEntry: { create } } as unknown as Tx;

    await service.record(tx, {
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
      metadata: { email: 'nobody@opsgraph.local', reason: 'unknown_email' },
    });

    const arg = create.mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      actorType: 'anonymous',
      actorId: null,
      ipAddress: null,
      metadata: { email: 'nobody@opsgraph.local', reason: 'unknown_email' },
    });
  });

  it('honours an explicit system actor and redacts metadata', async () => {
    const { service, create } = createService({ correlationId: CORRELATION_ID, userId: ACTOR_ID });
    const tx = { auditEntry: { create } } as unknown as Tx;

    await service.record(tx, {
      action: AUDIT_ACTIONS.USER_CREATED,
      targetType: 'user',
      targetId: ACTOR_ID,
      actorType: 'system',
      metadata: { refreshToken: 'raw-token', displayName: 'Ada' },
    });

    const arg = create.mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      actorType: 'system',
      actorId: null,
      metadata: { displayName: 'Ada' },
    });
  });

  it('recordStandalone writes through the Prisma client', async () => {
    const { service, standaloneCreate } = createService({
      correlationId: CORRELATION_ID,
      userId: ACTOR_ID,
    });

    await service.recordStandalone({
      action: AUDIT_ACTIONS.AUTH_FORBIDDEN,
      metadata: { method: 'GET', path: '/api/users', role: 'ANALYST' },
    });

    expect(standaloneCreate).toHaveBeenCalledTimes(1);
    const arg = standaloneCreate.mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({ actorType: 'user', actorId: ACTOR_ID });
  });
});
