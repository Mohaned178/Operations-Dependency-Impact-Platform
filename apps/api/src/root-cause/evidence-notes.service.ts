import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  type CreateEvidenceNoteRequest,
  type EvidenceNoteDto,
  type EvidenceNoteListQuery,
  type EvidenceNoteListResponse,
} from '@opsgraph/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { Errors } from '../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { compareCodeUnits } from '../graph/traversal/path-order';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  EVIDENCE_NOTE_INCLUDE,
  toEvidenceNoteDto,
  type EvidenceNoteWithRelations,
} from './evidence-note.mapper';

const NoteCursorSchema = z.object({ createdAt: z.string().datetime(), id: z.string().uuid() });

const AUDIT_TARGET_TYPE = 'evidence_note';

/** The HTTP request a retraction came from, recorded when it is refused. */
export interface RetractRequestInfo {
  method: string;
  path: string;
}

interface IdRow {
  id: string;
}

type NoteTargetColumn = 'entity_id' | 'relationship_id';

/** Notes are ordered by createdAt (ISO, milliseconds) descending, then id descending (contracts/api.md). */
function compareNewestFirst(a: EvidenceNoteDto, b: EvidenceNoteDto): number {
  return compareCodeUnits(b.createdAt, a.createdAt) || compareCodeUnits(b.id, a.id);
}

@Injectable()
export class EvidenceNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateEvidenceNoteRequest, user: AuthUser): Promise<EvidenceNoteDto> {
    return this.prisma.$transaction(async (tx) => {
      const { target } = input;
      if (target.kind === 'ENTITY') {
        const entity = await tx.entity.findUnique({
          where: { id: target.entityId },
          select: { id: true },
        });
        if (entity === null) {
          throw Errors.validation([{ path: 'target.entityId', message: 'Entity not found' }]);
        }
      } else {
        const relationship = await tx.relationship.findUnique({
          where: { id: target.relationshipId },
          select: { id: true },
        });
        if (relationship === null) {
          throw Errors.validation([
            { path: 'target.relationshipId', message: 'Relationship not found' },
          ]);
        }
      }

      const created = await tx.evidenceNote.create({
        data: {
          ...(target.kind === 'ENTITY'
            ? { entityId: target.entityId }
            : { relationshipId: target.relationshipId }),
          stance: input.stance,
          text: input.text,
          reference: input.reference,
          authorId: user.id,
        },
        include: EVIDENCE_NOTE_INCLUDE,
      });
      const dto = toEvidenceNoteDto(created);
      await this.audit.record(tx, {
        action: AUDIT_ACTIONS.EVIDENCE_NOTE_CREATED,
        targetType: AUDIT_TARGET_TYPE,
        targetId: dto.id,
        after: dto,
      });
      return dto;
    });
  }

  async retract(
    noteId: string,
    reason: string,
    user: AuthUser,
    request: RetractRequestInfo,
  ): Promise<EvidenceNoteDto> {
    const note = await this.findNote(this.prisma, noteId);
    if (note === null) {
      throw Errors.notFound('Evidence note');
    }
    if (note.retraction !== null) {
      return toEvidenceNoteDto(note);
    }
    if (note.authorId !== user.id && user.role !== 'ADMIN') {
      await this.audit.recordStandalone({
        action: AUDIT_ACTIONS.AUTH_FORBIDDEN,
        metadata: { method: request.method, path: request.path, role: user.role },
      });
      throw Errors.forbidden();
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Inserted before the audit row: a concurrent retraction fails here, rolls this
        // transaction back and leaves no second audit row behind.
        await tx.evidenceNoteRetraction.create({
          data: { noteId, retractedById: user.id, reason },
        });
        const after = await this.findNote(tx, noteId);
        if (after === null) {
          throw new Error(`evidence note ${noteId} disappeared during retraction`);
        }
        const afterDto = toEvidenceNoteDto(after);
        await this.audit.record(tx, {
          action: AUDIT_ACTIONS.EVIDENCE_NOTE_RETRACTED,
          targetType: AUDIT_TARGET_TYPE,
          targetId: noteId,
          before: toEvidenceNoteDto(note),
          after: afterDto,
        });
        return afterDto;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Someone else retracted it first: report the note as already retracted.
        const current = await this.findNote(this.prisma, noteId);
        if (current !== null && current.retraction !== null) {
          return toEvidenceNoteDto(current);
        }
      }
      throw error;
    }
  }

  async listForEntity(id: string, page: EvidenceNoteListQuery): Promise<EvidenceNoteListResponse> {
    const entity = await this.prisma.entity.findUnique({ where: { id }, select: { id: true } });
    if (entity === null) {
      throw Errors.notFound('Entity');
    }
    return this.list('entity_id', id, page);
  }

  async listForRelationship(
    id: string,
    page: EvidenceNoteListQuery,
  ): Promise<EvidenceNoteListResponse> {
    const relationship = await this.prisma.relationship.findUnique({
      where: { id },
      select: { id: true },
    });
    if (relationship === null) {
      throw Errors.notFound('Relationship');
    }
    return this.list('relationship_id', id, page);
  }

  private findNote(
    client: Tx,
    id: string,
  ): Promise<EvidenceNoteWithRelations | null> {
    return client.evidenceNote.findUnique({ where: { id }, include: EVIDENCE_NOTE_INCLUDE });
  }

  /**
   * Keyset paging at millisecond precision. `created_at` has microsecond precision but the cursor
   * and the DTO carry milliseconds, so the order and the cursor comparison both use the value
   * truncated to milliseconds; otherwise a row could fall between two pages.
   */
  private async list(
    column: NoteTargetColumn,
    targetId: string,
    page: EvidenceNoteListQuery,
  ): Promise<EvidenceNoteListResponse> {
    const cursor =
      page.cursor === undefined ? undefined : decodeCursor(NoteCursorSchema, page.cursor);
    // `column` is one of two string literals, never user input.
    const targetColumn = Prisma.raw(`n.${column}`);
    const after =
      cursor === undefined
        ? Prisma.empty
        : Prisma.sql`AND (date_trunc('milliseconds', n.created_at), n.id)
            < (${new Date(cursor.createdAt)}::timestamptz, ${cursor.id}::uuid)`;

    const rows = await this.prisma.$queryRaw<IdRow[]>`
      SELECT n.id::text AS id
      FROM evidence_notes n
      WHERE ${targetColumn} = ${targetId}::uuid ${after}
      ORDER BY date_trunc('milliseconds', n.created_at) DESC, n.id DESC
      LIMIT ${page.limit + 1}`;

    const hasMore = rows.length > page.limit;
    const ids = rows.slice(0, page.limit).map((row) => row.id);
    const notes = await this.prisma.evidenceNote.findMany({
      where: { id: { in: ids } },
      include: EVIDENCE_NOTE_INCLUDE,
    });
    const items = notes.map(toEvidenceNoteDto).sort(compareNewestFirst);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }
}
