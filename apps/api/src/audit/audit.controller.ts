import { Controller, Get, Query } from '@nestjs/common';
import {
  ListAuditQuerySchema,
  type AuditListResponse,
  type ListAuditQuery,
} from '@opsgraph/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { AuditService } from './audit.service';

@Roles('ADMIN')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListAuditQuerySchema)) query: ListAuditQuery,
  ): Promise<AuditListResponse> {
    return this.audit.list(query);
  }
}
