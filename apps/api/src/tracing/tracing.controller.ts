import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  BlockersQuerySchema,
  DependenciesQuerySchema,
  NeighborhoodQuerySchema,
  type BlockersQuery,
  type BlockersResponse,
  type DependenciesQuery,
  type DependenciesResponse,
  type NeighborhoodQuery,
  type NeighborhoodResponse,
} from '@opsgraph/shared';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { NeighborhoodService } from './neighborhood.service';
import { TracingService } from './tracing.service';

@Controller('entities')
export class TracingController {
  constructor(
    private readonly tracing: TracingService,
    private readonly neighborhoodService: NeighborhoodService,
  ) {}

  @Get(':id/blockers')
  blockers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(BlockersQuerySchema)) query: BlockersQuery,
  ): Promise<BlockersResponse> {
    return this.tracing.blockers(id, query);
  }

  @Get(':id/dependencies')
  dependencies(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(DependenciesQuerySchema)) query: DependenciesQuery,
  ): Promise<DependenciesResponse> {
    return this.tracing.dependencies(id, query);
  }

  @Get(':id/neighborhood')
  neighborhood(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(NeighborhoodQuerySchema)) query: NeighborhoodQuery,
  ): Promise<NeighborhoodResponse> {
    return this.neighborhoodService.neighborhood(id, query);
  }
}
