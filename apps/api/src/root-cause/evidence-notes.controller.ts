import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateEvidenceNoteRequestSchema,
  EvidenceNoteListQuerySchema,
  RetractEvidenceNoteRequestSchema,
  type CreateEvidenceNoteRequest,
  type EvidenceNoteDto,
  type EvidenceNoteListQuery,
  type EvidenceNoteListResponse,
  type RetractEvidenceNoteRequest,
} from '@opsgraph/shared';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { EvidenceNotesService } from './evidence-notes.service';

@Controller()
export class EvidenceNotesController {
  constructor(private readonly notes: EvidenceNotesService) {}

  @Post('evidence-notes')
  create(
    @Body(new ZodValidationPipe(CreateEvidenceNoteRequestSchema)) body: CreateEvidenceNoteRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<EvidenceNoteDto> {
    return this.notes.create(body, user);
  }

  @Post('evidence-notes/:noteId/retract')
  @HttpCode(200)
  retract(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body(new ZodValidationPipe(RetractEvidenceNoteRequestSchema)) body: RetractEvidenceNoteRequest,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<EvidenceNoteDto> {
    return this.notes.retract(noteId, body.reason, user, {
      method: request.method,
      path: request.path,
    });
  }

  @Get('entities/:id/evidence-notes')
  listForEntity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(EvidenceNoteListQuerySchema)) query: EvidenceNoteListQuery,
  ): Promise<EvidenceNoteListResponse> {
    return this.notes.listForEntity(id, query);
  }

  @Get('relationships/:id/evidence-notes')
  listForRelationship(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(EvidenceNoteListQuerySchema)) query: EvidenceNoteListQuery,
  ): Promise<EvidenceNoteListResponse> {
    return this.notes.listForRelationship(id, query);
  }
}
