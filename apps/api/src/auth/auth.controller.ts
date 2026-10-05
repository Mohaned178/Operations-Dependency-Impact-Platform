import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  type AuthSession,
  type ChangePasswordRequest,
  type LoginRequest,
  type PublicUser,
} from '@opsgraph/shared';
import type { Request, Response } from 'express';
import { Errors } from '../common/errors/app-error';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { AuthService } from './auth.service';
import { AllowDuringPasswordChange } from './decorators/allow-password-change.decorator';
import { CurrentUser, type AuthUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const result = await this.auth.login(body.email, body.password);
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return result.session;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const raw = readRefreshCookie(req);
    if (!raw) {
      clearRefreshCookie(res);
      throw Errors.unauthenticated();
    }
    try {
      const result = await this.auth.refresh(raw);
      setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
      return result.session;
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  }

  @Public()
  @AllowDuringPasswordChange()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = readRefreshCookie(req);
    await this.auth.logout(raw);
    clearRefreshCookie(res);
  }

  @AllowDuringPasswordChange()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }

  @AllowDuringPasswordChange()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema)) body: ChangePasswordRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const result = await this.auth.changePassword(
      user,
      body.currentPassword,
      body.newPassword,
    );
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return result.session;
  }
}
