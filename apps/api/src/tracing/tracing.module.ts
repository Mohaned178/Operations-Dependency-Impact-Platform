import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NeighborhoodService } from './neighborhood.service';
import { StateEvidenceReader } from './state-evidence.reader';
import { TracingController } from './tracing.controller';
import { TracingService } from './tracing.service';

@Module({
  imports: [GraphModule, PrismaModule],
  controllers: [TracingController],
  providers: [TracingService, NeighborhoodService, StateEvidenceReader],
  exports: [TracingService],
})
export class TracingModule {}
