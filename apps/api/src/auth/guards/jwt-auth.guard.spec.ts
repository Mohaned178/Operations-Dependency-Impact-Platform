import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { Errors } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AllowDuringPasswordChange } from '../decorators/allow-password-change.decorator';
import { Public } from '../decorators/public.decorator';
import { TokenService } from '../token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

jest.mock('../token.service', () => ({
  TokenService: class TokenServiceMock {},
}));

const USER_ID = '5c2f8a1b-6d3e-4f7a-8b9c-0d1e2f3a4b5c';
const CORRELATION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

class TestController {
  @Public()
  publicRoute(this: void): void {}

  @AllowDuringPasswordChange()
  passwordChangeRoute(this: void): void {}

  guardedRoute(this: void): void {}
}

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

function buildContext(
  handler: () => void,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

async function createGuard(user: User | null) {
  const tokenService = { verifyAccess: jest.fn() };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  const requestContext = {
    correlationId: CORRELATION_ID,
    ip: '10.0.0.1',
    userId: undefined as string | undefined,
    setUserId: jest.fn(),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      JwtAuthGuard,
      Reflector,
      { provide: AuditService, useValue: {} },
      { provide: TokenService, useValue: tokenService },
      { provide: PrismaService, useValue: prisma },
      { provide: RequestContext, useValue: requestContext },
    ],
  }).compile();

  return { guard: moduleRef.get(JwtAuthGuard), tokenService, prisma, requestContext };
}

describe('JwtAuthGuard', () => {
  it('lets a public route bypass the guard', async () => {
    const { guard, tokenService, prisma } = await createGuard(null);

    await expect(
      guard.canActivate(buildContext(TestController.prototype.publicRoute, { headers: {} })),
    ).resolves.toBe(true);

    expect(tokenService.verifyAccess).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token with UNAUTHENTICATED', async () => {
    const { guard } = await createGuard(null);

    await expect(
      guard.canActivate(buildContext(TestController.prototype.guardedRoute, { headers: {} })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an invalid bearer token with UNAUTHENTICATED', async () => {
    const { guard, tokenService } = await createGuard(null);
    tokenService.verifyAccess.mockRejectedValue(Errors.unauthenticated());

    await expect(
      guard.canActivate(
        buildContext(TestController.prototype.guardedRoute, {
          headers: { authorization: 'Bearer not-a-token' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a deactivated user with UNAUTHENTICATED', async () => {
    const { guard, tokenService } = await createGuard(buildUser({ status: 'DEACTIVATED' }));
    tokenService.verifyAccess.mockResolvedValue({ sub: USER_ID });

    const request: Record<string, unknown> = { headers: { authorization: 'Bearer valid' } };
    await expect(
      guard.canActivate(buildContext(TestController.prototype.guardedRoute, request)),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(request.user).toBeUndefined();
  });

  it('requires a password change on a route that does not allow it', async () => {
    const { guard, tokenService } = await createGuard(buildUser({ mustChangePassword: true }));
    tokenService.verifyAccess.mockResolvedValue({ sub: USER_ID });

    await expect(
      guard.canActivate(
        buildContext(TestController.prototype.guardedRoute, {
          headers: { authorization: 'Bearer valid' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it('allows a password change when the route permits it', async () => {
    const { guard, tokenService } = await createGuard(buildUser({ mustChangePassword: true }));
    tokenService.verifyAccess.mockResolvedValue({ sub: USER_ID });

    await expect(
      guard.canActivate(
        buildContext(TestController.prototype.passwordChangeRoute, {
          headers: { authorization: 'Bearer valid' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('attaches the user and registers the request context on success', async () => {
    const { guard, tokenService, requestContext } = await createGuard(buildUser());
    tokenService.verifyAccess.mockResolvedValue({ sub: USER_ID });

    const request: Record<string, unknown> = { headers: { authorization: 'Bearer valid' } };
    await expect(
      guard.canActivate(buildContext(TestController.prototype.guardedRoute, request)),
    ).resolves.toBe(true);

    expect(request.user).toEqual({
      id: USER_ID,
      email: 'analyst@opsgraph.local',
      displayName: 'Ada Analyst',
      role: 'ANALYST',
      status: 'ACTIVE',
      mustChangePassword: false,
    });
    expect(requestContext.setUserId).toHaveBeenCalledWith(USER_ID);
  });
});
