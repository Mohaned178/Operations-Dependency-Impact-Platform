import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TracingModule } from '../tracing/tracing.module';
import { EvidenceReader } from './evidence.reader';
import { RootCauseController } from './root-cause.controller';
import { RootCauseService } from './root-cause.service';

@Module({
  imports: [TracingModule, GraphModule, PrismaModule],
  controllers: [RootCauseController],
  providers: [RootCauseService, EvidenceReader],
})
export class RootCauseModule {}
