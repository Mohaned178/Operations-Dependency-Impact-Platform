import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ImportRequestFieldsSchema,
  PageQuerySchema,
  type ImportListResponse,
  type ImportReport,
  type ImportRequestFields,
  type PageQuery,
} from '@opsgraph/shared';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Errors } from '../common/errors/app-error';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { ImportService } from './import.service';
import { ImportUploadInterceptor } from './import-upload.interceptor';

@Roles('ADMIN')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportService) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(ImportUploadInterceptor)
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ImportRequestFieldsSchema)) fields: ImportRequestFields,
  ): Promise<ImportReport> {
    if (file === undefined) {
      throw Errors.validation([{ path: 'file', message: 'A file is required' }]);
    }
    return this.imports.run({
      format: fields.format,
      kind: fields.kind,
      fileName: file.originalname,
      byteSize: file.size,
      content: file.buffer,
      dryRun: fields.dryRun,
      actor: { type: 'user', id: user.id },
    });
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(PageQuerySchema)) query: PageQuery,
  ): Promise<ImportListResponse> {
    return this.imports.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ImportReport> {
    return this.imports.get(id);
  }
}
