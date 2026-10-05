import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUDIT_ACTIONS } from '@opsgraph/shared';
import type { User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors/app-error';
import { env } from '../config/env';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const REFRESH_TOKEN_BYTES = 32;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface RefreshRotation {
  user: User;
  raw: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  signAccess(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId });
  }

  async verifyAccess(token: string): Promise<{ sub: string }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string }>(token);
      if (!payload.sub) {
        throw new Error('Token payload is missing sub');
      }
      return { sub: payload.sub };
    } catch {
      throw Errors.unauthenticated();
    }
  }

  async issueRefresh(
    tx: Tx,
    userId: string,
    familyId?: string,
    familyCreatedAt?: Date,
  ): Promise<{ raw: string; expiresAt: Date }> {
    const raw = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const now = new Date();
    const familyStart = familyCreatedAt ?? now;
    const expiresAt = new Date(
      Math.min(
        now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY,
        familyStart.getTime() + env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY,
      ),
    );

    await tx.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        familyId: familyId ?? randomUUID(),
        familyCreatedAt: familyStart,
        expiresAt,
      },
    });

    return { raw, expiresAt };
  }

  async rotateRefresh(raw: string): Promise<RefreshRotation> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: true },
    });

    if (!token) {
      await this.refuse('unknown');
      throw Errors.unauthenticated();
    }

    if (token.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: token.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.refuse('reuse_detected', token.userId);
      throw Errors.unauthenticated();
    }

    if (token.expiresAt.getTime() <= Date.now()) {
      await this.refuse('expired', token.userId);
      throw Errors.unauthenticated();
    }

    const familyExpiresAt = token.familyCreatedAt.getTime() + env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY;
    if (familyExpiresAt <= Date.now()) {
      await this.refuse('expired', token.userId);
      throw Errors.unauthenticated();
    }

    if (token.user.status !== 'ACTIVE') {
      await this.refuse('deactivated', token.userId);
      throw Errors.unauthenticated();
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      });
      const issued = await this.issueRefresh(tx, token.userId, token.familyId, token.familyCreatedAt);
      return { user: token.user, raw: issued.raw, expiresAt: issued.expiresAt };
    });
  }

  async revokeFamilyByRaw(raw: string): Promise<string | undefined> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!token) {
      return undefined;
    }
    await this.prisma.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return token.userId;
  }

  async revokeAllForUser(tx: Tx, userId: string, exceptFamilyId?: string): Promise<void> {
    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  private async refuse(reason: string, userId?: string): Promise<void> {
    await this.audit.recordStandalone({
      action: AUDIT_ACTIONS.AUTH_REFRESH_REFUSED,
      ...(userId
        ? { actorType: 'user' as const, actorId: userId }
        : { actorType: 'anonymous' as const }),
      metadata: { reason },
    });
  }
}
