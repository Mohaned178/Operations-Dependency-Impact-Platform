import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateUserRequestSchema,
  ListUsersQuerySchema,
  ResetPasswordRequestSchema,
  UpdateUserRequestSchema,
  type CreateUserRequest,
  type ListUsersQuery,
  type PublicUser,
  type ResetPasswordRequest,
  type UpdateUserRequest,
  type UserListResponse,
} from '@opsgraph/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { UsersService } from './users.service';

@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<UserListResponse> {
    return this.users.list(query);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateUserRequestSchema)) body: CreateUserRequest,
  ): Promise<PublicUser> {
    return this.users.create(body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.users.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserRequestSchema)) body: UpdateUserRequest,
  ): Promise<PublicUser> {
    return this.users.update(id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.users.deactivate(id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.users.reactivate(id);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ResetPasswordRequestSchema)) body: ResetPasswordRequest,
  ): Promise<void> {
    return this.users.resetPassword(id, body.temporaryPassword);
  }
}
