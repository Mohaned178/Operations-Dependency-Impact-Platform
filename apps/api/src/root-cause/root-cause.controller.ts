import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  RootCauseQuerySchema,
  type RootCauseQuery,
  type RootCauseResponse,
} from '@opsgraph/shared';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { RootCauseService } from './root-cause.service';

@Controller('entities')
export class RootCauseController {
  constructor(private readonly rootCause: RootCauseService) {}

  @Get(':id/root-cause')
  analyze(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(RootCauseQuerySchema)) query: RootCauseQuery,
  ): Promise<RootCauseResponse> {
    return this.rootCause.analyze(id, query);
  }
}
