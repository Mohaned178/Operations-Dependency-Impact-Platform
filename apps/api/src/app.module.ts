import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { RequestContextModule } from './common/context/request-context';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { GraphModule } from './graph/graph.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { PrismaModule } from './prisma/prisma.module';
import { TracingModule } from './tracing/tracing.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    RequestContextModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    HealthModule,
    GraphModule,
    IngestionModule,
    TracingModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
