import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TracingModule } from '../tracing/tracing.module';
import { EvidenceNotesController } from './evidence-notes.controller';
import { EvidenceNotesService } from './evidence-notes.service';
import { EvidenceReader } from './evidence.reader';
import { RootCauseController } from './root-cause.controller';
import { RootCauseService } from './root-cause.service';

@Module({
  imports: [TracingModule, GraphModule, PrismaModule],
  controllers: [RootCauseController, EvidenceNotesController],
  providers: [RootCauseService, EvidenceReader, EvidenceNotesService],
})
export class RootCauseModule {}
