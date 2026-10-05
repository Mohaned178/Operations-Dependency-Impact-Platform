import { AUDIT_ACTIONS } from '@opsgraph/shared';
import type { User } from '@prisma/client';
import type { AuditRecordInput, AuditService } from '../audit/audit.service';
import type { PasswordService } from '../auth/password.service';
import type { TokenService } from '../auth/token.service';
import type { PrismaService, Tx } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('../auth/token.service', () => ({
  TokenService: class TokenServiceMock {},
}));

jest.mock('../auth/password.service', () => ({
  PasswordService: class PasswordServiceMock {},
  DUMMY_HASH: 'dummy',
}));

const ADMIN_ID = '2d6c1f3a-9b4e-4c7d-8a1f-5e2b3c6d7a80';
const USER_ID = '7f3a9c2e-1d5b-4e8f-9c6a-2b4d7e1f3a90';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: 'analyst@opsgraph.local',
    displayName: 'Ada Analyst',
    passwordHash: 'hash',
    role: 'ANALYST',
    status: 'ACTIVE',
    mustChangePassword: false,
    failedLoginCount: 0,
    lastFailedLoginAt: null,
    lockedUntil: null,
    passwordChangedAt: new Date('2026-10-05T00:00:00.000Z'),
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    updatedAt: new Date('2026-10-05T00:00:00.000Z'),
    ...overrides,
  };
}

interface UserModelArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
}

interface MockTx {
  user: {
    findUnique: jest.Mock<Promise<User | null>, [UserModelArgs]>;
    update: jest.Mock<Promise<User>, [UserModelArgs]>;
    count: jest.Mock<Promise<number>, [UserModelArgs]>;
  };
  $executeRaw: jest.Mock<Promise<number>, [TemplateStringsArray, ...unknown[]]>;
}

interface Mocks {
  service: UsersService;
  tx: MockTx;
  audit: { record: jest.Mock<Promise<void>, [Tx, AuditRecordInput]> };
  tokens: { revokeAllForUser: jest.Mock<Promise<void>, [Tx, string]> };
}

function createService(): Mocks {
  const tx: MockTx = {
    user: {
      findUnique: jest.fn<Promise<User | null>, [UserModelArgs]>(),
      update: jest.fn<Promise<User>, [UserModelArgs]>(),
      count: jest.fn<Promise<number>, [UserModelArgs]>(),
    },
    $executeRaw: jest.fn<Promise<number>, [TemplateStringsArray, ...unknown[]]>(),
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: Tx) => Promise<unknown>) =>
      fn(tx as unknown as Tx),
    ),
    user: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const passwords = { hash: jest.fn(() => Promise.resolve('hashed')) };
  const tokens = {
    revokeAllForUser: jest.fn<Promise<void>, [Tx, string]>(() => Promise.resolve()),
  };
  const audit = {
    record: jest.fn<Promise<void>, [Tx, AuditRecordInput]>(() => Promise.resolve()),
    recordStandalone: jest.fn(),
  };

  const service = new UsersService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    tokens as unknown as TokenService,
    audit as unknown as AuditService,
  );

  return { service, tx, audit, tokens };
}

describe('UsersService', () => {
  it('refuses to demote the last active administrator with LAST_ADMIN', async () => {
    const { service, tx, audit } = createService();
    tx.user.findUnique.mockResolvedValue(buildUser({ id: ADMIN_ID, role: 'ADMIN' }));
    tx.user.count.mockResolvedValue(0);

    await expect(service.update(ADMIN_ID, { role: 'ANALYST' })).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('deactivates a non-admin user and revokes their refresh tokens', async () => {
    const { service, tx, audit, tokens } = createService();
    tx.user.findUnique.mockResolvedValue(buildUser({ id: USER_ID, role: 'OPS_MANAGER' }));
    tx.user.update.mockResolvedValue(
      buildUser({ id: USER_ID, role: 'OPS_MANAGER', status: 'DEACTIVATED' }),
    );

    const result = await service.deactivate(USER_ID);

    expect(result.status).toBe('DEACTIVATED');
    expect(tokens.revokeAllForUser.mock.calls[0]?.[1]).toBe(USER_ID);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[1]).toEqual({
      action: AUDIT_ACTIONS.USER_DEACTIVATED,
      targetType: 'user',
      targetId: USER_ID,
      before: { status: 'ACTIVE' },
      after: { status: 'DEACTIVATED' },
    });
  });

  it('treats deactivating an already deactivated user as a no-op', async () => {
    const { service, tx, audit, tokens } = createService();
    tx.user.findUnique.mockResolvedValue(
      buildUser({ id: USER_ID, role: 'ANALYST', status: 'DEACTIVATED' }),
    );

    const result = await service.deactivate(USER_ID);

    expect(result.status).toBe('DEACTIVATED');
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('writes a user.updated and a user.role_changed entry when both fields change', async () => {
    const { service, tx, audit } = createService();
    tx.user.findUnique.mockResolvedValue(
      buildUser({ id: USER_ID, role: 'ANALYST', displayName: 'Old Name' }),
    );
    tx.user.update.mockResolvedValue(
      buildUser({ id: USER_ID, role: 'OPS_MANAGER', displayName: 'New Name' }),
    );

    await service.update(USER_ID, { displayName: 'New Name', role: 'OPS_MANAGER' });

    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record.mock.calls.map(([, input]) => input.action)).toEqual([
      AUDIT_ACTIONS.USER_UPDATED,
      AUDIT_ACTIONS.USER_ROLE_CHANGED,
    ]);
    expect(audit.record.mock.calls[1]?.[1]).toEqual({
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      targetType: 'user',
      targetId: USER_ID,
      before: { role: 'ANALYST' },
      after: { role: 'OPS_MANAGER' },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
