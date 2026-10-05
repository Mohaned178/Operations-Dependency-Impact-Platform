import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role, UserStatus } from '@opsgraph/shared';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user) {
      throw new Error('CurrentUser used without JwtAuthGuard');
    }
    return request.user;
  },
);
