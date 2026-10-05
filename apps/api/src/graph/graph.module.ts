import { Module } from '@nestjs/common';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';
import { GRAPH_REPOSITORY } from './graph.repository';
import { PrismaGraphRepository } from './prisma-graph.repository';
import { SourceSystemsController } from './source-systems.controller';
import { TimelineService } from './timeline.service';

@Module({
  controllers: [EntitiesController, SourceSystemsController],
  providers: [
    EntitiesService,
    TimelineService,
    { provide: GRAPH_REPOSITORY, useClass: PrismaGraphRepository },
  ],
  exports: [GRAPH_REPOSITORY],
})
export class GraphModule {}
