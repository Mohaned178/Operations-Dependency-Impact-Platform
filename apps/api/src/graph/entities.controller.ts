import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ListEntitiesQuerySchema,
  NeighborQuerySchema,
  PageQuerySchema,
  type EntityDetailDto,
  type EntityListResponse,
  type ListEntitiesQuery,
  type NeighborListResponse,
  type NeighborQuery,
  type PageQuery,
  type SourceRecordListResponse,
  type StateHistoryResponse,
  type TimelineResponse,
} from '@opsgraph/shared';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { EntitiesService } from './entities.service';
import { TimelineService } from './timeline.service';

@Controller('entities')
export class EntitiesController {
  constructor(
    private readonly entities: EntitiesService,
    private readonly timeline: TimelineService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListEntitiesQuerySchema)) query: ListEntitiesQuery,
  ): Promise<EntityListResponse> {
    return this.entities.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<EntityDetailDto> {
    return this.entities.detail(id);
  }

  @Get(':id/neighbors')
  neighbors(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(NeighborQuerySchema)) query: NeighborQuery,
  ): Promise<NeighborListResponse> {
    return this.entities.neighbors(id, query);
  }

  @Get(':id/timeline')
  timelineForEntity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(PageQuerySchema)) query: PageQuery,
  ): Promise<TimelineResponse> {
    return this.timeline.list(id, query);
  }

  @Get(':id/states')
  states(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(PageQuerySchema)) query: PageQuery,
  ): Promise<StateHistoryResponse> {
    return this.entities.states(id, query);
  }

  @Get(':id/source-records')
  sourceRecords(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(PageQuerySchema)) query: PageQuery,
  ): Promise<SourceRecordListResponse> {
    return this.entities.sourceRecords(id, query);
  }
}
