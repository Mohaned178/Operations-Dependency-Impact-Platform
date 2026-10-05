import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  type CreateUserRequest,
  type ListUsersQuery,
  type PublicUser,
  type UpdateUserRequest,
  type UserListResponse,
} from '@opsgraph/shared';
import { Prisma, type User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { Errors } from '../common/errors/app-error';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { toPublicUser } from './user.mapper';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery): Promise<UserListResponse> {
    const filters: Prisma.UserWhereInput = {};
    if (query.q !== undefined && query.q.length > 0) {
      filters.OR = [
        { email: { contains: query.q, mode: 'insensitive' } },
        { displayName: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.role !== undefined) {
      filters.role = query.role;
    }
    if (query.status !== undefined) {
      filters.status = query.status;
    }

    const take = query.limit + 1;
    let rows: User[];

    if (query.cursor !== undefined) {
      const cursor = await this.prisma.user.findUnique({ where: { id: query.cursor } });
      if (!cursor) {
        throw Errors.validation([{ path: 'cursor', message: 'Unknown cursor' }]);
      }
      rows = await this.prisma.user.findMany({
        where: {
          AND: [
            filters,
            {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
    } else {
      rows = await this.prisma.user.findMany({
        where: filters,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
    }

    const hasMore = rows.length > query.limit;
    const items = (hasMore ? rows.slice(0, query.limit) : rows).map(toPublicUser);
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async create(input: CreateUserRequest): Promise<PublicUser> {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            role: input.role,
            passwordHash,
            mustChangePassword: true,
          },
        });
        await this.audit.record(tx, {
          action: AUDIT_ACTIONS.USER_CREATED,
          targetType: 'user',
          targetId: user.id,
          after: toPublicUser(user),
        });
        return toPublicUser(user);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.emailTaken();
      }
      throw error;
    }
  }

  async get(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw Errors.notFound('User');
    }
    return toPublicUser(user);
  }

  async update(id: string, input: UpdateUserRequest): Promise<PublicUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) {
        throw Errors.notFound('User');
      }

      const roleChanges =
        input.role !== undefined && input.role !== before.role;
      if (roleChanges && before.role === 'ADMIN' && before.status === 'ACTIVE') {
        await this.assertNotLastAdmin(tx, id);
      }

      const after = await tx.user.update({
        where: { id },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
        },
      });

      if (input.displayName !== undefined && input.displayName !== before.displayName) {
        await this.audit.record(tx, {
          action: AUDIT_ACTIONS.USER_UPDATED,
          targetType: 'user',
          targetId: after.id,
          before: { displayName: before.displayName },
          after: { displayName: after.displayName },
        });
      }

      if (roleChanges) {
        await this.audit.record(tx, {
          action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
          targetType: 'user',
          targetId: after.id,
          before: { role: before.role },
          after: { role: after.role },
        });
      }

      return toPublicUser(after);
    });
  }

  async deactivate(id: string): Promise<PublicUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) {
        throw Errors.notFound('User');
      }
      if (before.status === 'DEACTIVATED') {
        return toPublicUser(before);
      }

      if (before.role === 'ADMIN') {
        await this.assertNotLastAdmin(tx, id);
      }

      const after = await tx.user.update({
        where: { id },
        data: { status: 'DEACTIVATED' },
      });
      await this.tokens.revokeAllForUser(tx, id);
      await this.audit.record(tx, {
        action: AUDIT_ACTIONS.USER_DEACTIVATED,
        targetType: 'user',
        targetId: after.id,
        before: { status: before.status },
        after: { status: after.status },
      });
      return toPublicUser(after);
    });
  }

  async reactivate(id: string): Promise<PublicUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) {
        throw Errors.notFound('User');
      }
      if (before.status === 'ACTIVE') {
        return toPublicUser(before);
      }

      const after = await tx.user.update({
        where: { id },
        data: { status: 'ACTIVE' },
      });
      await this.audit.record(tx, {
        action: AUDIT_ACTIONS.USER_REACTIVATED,
        targetType: 'user',
        targetId: after.id,
        before: { status: before.status },
        after: { status: after.status },
      });
      return toPublicUser(after);
    });
  }

  async resetPassword(id: string, temporaryPassword: string): Promise<void> {
    const passwordHash = await this.passwords.hash(temporaryPassword);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) {
        throw Errors.notFound('User');
      }

      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
      });
      await this.tokens.revokeAllForUser(tx, id);
      await this.audit.record(tx, {
        action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
        targetType: 'user',
        targetId: id,
      });
    });
  }

  private async assertNotLastAdmin(tx: Tx, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('opsgraph:last-admin'))`;
    const remainingAdmins = await tx.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE', id: { not: userId } },
    });
    if (remainingAdmins === 0) {
      throw Errors.lastAdmin();
    }
  }
}
