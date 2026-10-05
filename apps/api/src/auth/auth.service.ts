import { Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, type AuthSession, type PublicUser } from '@opsgraph/shared';
import type { User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors/app-error';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from '../users/user.mapper';
import type { AuthUser } from './decorators/current-user.decorator';
import { DUMMY_HASH, PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface AuthResult {
  session: AuthSession;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const MAX_FAILED_LOGINS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordValid = await this.passwords.verify(user?.passwordHash ?? DUMMY_HASH, password);

    if (!user) {
      await this.prisma.$transaction((tx) =>
        this.audit.record(tx, {
          action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
          actorType: 'anonymous',
          metadata: { email, reason: 'unknown_email' },
        }),
      );
      throw Errors.invalidCredentials();
    }

    if (user.status !== 'ACTIVE') {
      await this.recordLoginFailure(user, 'deactivated');
      throw Errors.invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      await this.recordLoginFailure(user, 'locked');
      throw Errors.invalidCredentials();
    }

    if (!passwordValid) {
      await this.handleBadPassword(user, now);
      throw Errors.invalidCredentials();
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
      });
      const refresh = await this.tokens.issueRefresh(tx, user.id);
      await this.audit.record(tx, {
        action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCEEDED,
        actorType: 'user',
        actorId: user.id,
        targetType: 'user',
        targetId: user.id,
      });
      return this.toAuthResult(updated, refresh.raw, refresh.expiresAt);
    });
  }

  async refresh(raw: string): Promise<AuthResult> {
    const rotated = await this.tokens.rotateRefresh(raw);
    return this.toAuthResult(rotated.user, rotated.raw, rotated.expiresAt);
  }

  async logout(raw?: string): Promise<void> {
    if (!raw) {
      return;
    }
    const userId = await this.tokens.revokeFamilyByRaw(raw);
    if (userId) {
      await this.audit.recordStandalone({
        action: AUDIT_ACTIONS.AUTH_LOGOUT,
        actorType: 'user',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
      });
    }
  }

  async changePassword(
    user: AuthUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResult> {
    const stored = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!stored || !(await this.passwords.verify(stored.passwordHash, currentPassword))) {
      throw Errors.invalidCredentials();
    }

    const passwordHash = await this.passwords.hash(newPassword);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      });
      await this.tokens.revokeAllForUser(tx, user.id);
      const refresh = await this.tokens.issueRefresh(tx, user.id);
      await this.audit.record(tx, {
        action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
        targetType: 'user',
        targetId: user.id,
      });
      return this.toAuthResult(updated, refresh.raw, refresh.expiresAt);
    });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw Errors.unauthenticated();
    }
    return toPublicUser(user);
  }

  private async handleBadPassword(user: User, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const withinWindow =
        fresh.lastFailedLoginAt !== null &&
        now.getTime() - fresh.lastFailedLoginAt.getTime() < ATTEMPT_WINDOW_MS;
      const failedLoginCount = withinWindow ? fresh.failedLoginCount + 1 : 1;
      const alreadyLocked =
        fresh.lockedUntil !== null && fresh.lockedUntil.getTime() > now.getTime();
      const locked = failedLoginCount >= MAX_FAILED_LOGINS && !alreadyLocked;
      const lockedUntil = locked ? new Date(now.getTime() + LOCK_DURATION_MS) : null;

      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lastFailedLoginAt: now,
          ...(locked ? { lockedUntil } : {}),
        },
      });

      await this.audit.record(tx, {
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email, reason: 'bad_password' },
      });

      if (locked) {
        await this.audit.record(tx, {
          action: AUDIT_ACTIONS.AUTH_ACCOUNT_LOCKED,
          targetType: 'user',
          targetId: user.id,
          after: { lockedUntil },
        });
      }
    });
  }

  private async recordLoginFailure(user: User, reason: 'locked' | 'deactivated'): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email, reason },
      }),
    );
  }

  private async toAuthResult(
    user: User,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<AuthResult> {
    return {
      session: {
        accessToken: await this.tokens.signAccess(user.id),
        expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
        user: toPublicUser(user),
      },
      refreshToken,
      refreshExpiresAt,
    };
  }
}
