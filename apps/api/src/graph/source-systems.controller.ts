import { Controller, Get } from '@nestjs/common';
import type { SourceSystemListResponse } from '@opsgraph/shared';
import { EntitiesService } from './entities.service';

@Controller('source-systems')
export class SourceSystemsController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  list(): Promise<SourceSystemListResponse> {
    return this.entities.listSourceSystems();
  }
}
