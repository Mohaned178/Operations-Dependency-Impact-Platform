import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUDIT_ACTIONS, type Role } from '@opsgraph/shared';
import { AuditService } from '../../audit/audit.service';
import { Errors } from '../../common/errors/app-error';
import type { AuthUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

type GuardedRequest = Request & { user?: AuthUser };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const user = request.user;
    if (user && roles.includes(user.role)) {
      return true;
    }

    await this.audit.recordStandalone({
      action: AUDIT_ACTIONS.AUTH_FORBIDDEN,
      metadata: { method: request.method, path: request.path, role: user?.role ?? null },
    });
    throw Errors.forbidden();
  }
}
