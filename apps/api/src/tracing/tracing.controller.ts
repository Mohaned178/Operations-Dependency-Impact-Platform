import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  BlockersQuerySchema,
  type BlockersQuery,
  type BlockersResponse,
} from '@opsgraph/shared';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { TracingService } from './tracing.service';

@Controller('entities')
export class TracingController {
  constructor(private readonly tracing: TracingService) {}

  @Get(':id/blockers')
  blockers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(BlockersQuerySchema)) query: BlockersQuery,
  ): Promise<BlockersResponse> {
    return this.tracing.blockers(id, query);
  }
}
