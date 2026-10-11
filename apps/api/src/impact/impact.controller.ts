import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ImpactListQuerySchema,
  ImpactQuerySchema,
  type ImpactItemDetailResponse,
  type ImpactListQuery,
  type ImpactListResponse,
  type ImpactQuery,
  type ImpactResponse,
} from '@opsgraph/shared';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { ImpactService } from './impact.service';

@Controller('entities')
export class ImpactController {
  constructor(private readonly impact: ImpactService) {}

  @Get(':id/impact')
  summary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ImpactQuerySchema)) query: ImpactQuery,
  ): Promise<ImpactResponse> {
    return this.impact.summary(id, query);
  }

  @Get(':id/impact/items')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ImpactListQuerySchema)) query: ImpactListQuery,
  ): Promise<ImpactListResponse> {
    return this.impact.list(id, query);
  }

  @Get(':id/impact/items/:targetId')
  item(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Query(new ZodValidationPipe(ImpactQuerySchema)) query: ImpactQuery,
  ): Promise<ImpactItemDetailResponse> {
    return this.impact.item(id, targetId, query);
  }
}
