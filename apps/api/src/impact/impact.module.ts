import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TracingModule } from '../tracing/tracing.module';
import { ImpactController } from './impact.controller';
import { ImpactService } from './impact.service';
import { OrderValueReader } from './order-value.reader';

@Module({
  imports: [GraphModule, TracingModule, PrismaModule],
  controllers: [ImpactController],
  providers: [ImpactService, OrderValueReader],
})
export class ImpactModule {}
