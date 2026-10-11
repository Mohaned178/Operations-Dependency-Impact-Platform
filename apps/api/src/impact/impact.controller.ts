import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ImpactQuerySchema, type ImpactQuery, type ImpactResponse } from '@opsgraph/shared';
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
}
