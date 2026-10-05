import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { RequestContextModule } from './common/context/request-context';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [RequestContextModule, PrismaModule, AuditModule, AuthModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
