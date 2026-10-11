import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  ErrorResponseSchema,
  EvidenceNoteDtoSchema,
  EvidenceNoteListResponseSchema,
  type EvidenceNoteDto,
  type EvidenceNoteListResponse,
} from '@opsgraph/shared';
import type { User } from '@prisma/client';
import request from 'supertest';
import { SeedService } from '../src/ingestion/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, entityIdByKey, login, resetDb, TEST_PASSWORD } from './helpers';

const CREATED = 'evidence_note.created';
const RETRACTED = 'evidence_note.retracted';
const FORBIDDEN = 'auth.forbidden';

describe('Evidence notes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let analystA: User;
  let analystB: User;
  let admin: User;
  const tokens = {} as Record<'a' | 'b' | 'c', string>;
  let entityId: string;
  let otherEntityId: string;
  let relationshipId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Server;

    await resetDb(prisma);
    analystA = await createUser(prisma, { role: 'ANALYST' });
    analystB = await createUser(prisma, { role: 'ANALYST' });
    admin = await createUser(prisma, { role: 'ADMIN' });
    tokens.a = (await login(app, analystA.email, TEST_PASSWORD)).accessToken;
    tokens.b = (await login(app, analystB.email, TEST_PASSWORD)).accessToken;
    tokens.c = (await login(app, admin.email, TEST_PASSWORD)).accessToken;

    const report = await app.get(SeedService).seedScenario39();
    expect(report?.outcome).toBe('APPLIED');
    entityId = await entityIdByKey(prisma, 'BudgetRequirement', 'FinanceApprovals', 'BR-18492');
    otherEntityId = await entityIdByKey(prisma, 'Order', 'OMS', '18492');
    const approvalId = await entityIdByKey(prisma, 'Approval', 'FinanceApprovals', 'APR-2291');
    const relationship = await prisma.relationship.findFirstOrThrow({
      where: { type: 'REQUIRES', fromEntityId: approvalId, toEntityId: entityId },
    });
    relationshipId = relationship.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (who: 'a' | 'b' | 'c') => `Bearer ${tokens[who]}`;

  async function createNote(
    who: 'a' | 'b' | 'c',
    body: Record<string, unknown>,
  ): Promise<EvidenceNoteDto> {
    const response = await request(server)
      .post('/api/evidence-notes')
      .set('Authorization', auth(who))
      .send(body);
    expect(response.status).toBe(201);
    return EvidenceNoteDtoSchema.parse(response.body);
  }

  const entityNote = (text: string, extra: Record<string, unknown> = {}) => ({
    target: { kind: 'ENTITY', entityId },
    stance: 'SUPPORTS',
    text,
    ...extra,
  });

  const retract = (who: 'a' | 'b' | 'c', noteId: string, reason = 'No longer true') =>
    request(server)
      .post(`/api/evidence-notes/${noteId}/retract`)
      .set('Authorization', auth(who))
      .send({ reason });

  const auditCount = (action: string) => prisma.auditEntry.count({ where: { action } });

  async function list(path: string, query = ''): Promise<EvidenceNoteListResponse> {
    const response = await request(server).get(`${path}${query}`).set('Authorization', auth('a'));
    expect(response.status).toBe(200);
    return EvidenceNoteListResponseSchema.parse(response.body);
  }

  describe('creation', () => {
    it('creates a note on an entity: 201, active, author set, one audit row', async () => {
      const text = 'Finance confirmed the budget code was never submitted';
      const note = await createNote('a', entityNote(text, { reference: '  Ticket FIN-4410  ' }));

      expect(note).toMatchObject({
        target: { kind: 'ENTITY', entityId },
        stance: 'SUPPORTS',
        text,
        reference: 'Ticket FIN-4410',
        author: { id: analystA.id, displayName: analystA.email },
        active: true,
        retraction: null,
      });
      const rows = await prisma.auditEntry.findMany({ where: { action: CREATED, targetId: note.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        targetType: 'evidence_note',
        actorId: analystA.id,
        before: null,
        after: { id: note.id, text, active: true },
      });
    });

    it('creates a note on a relationship with a null reference when none is given', async () => {
      const note = await createNote('b', {
        target: { kind: 'RELATIONSHIP', relationshipId },
        stance: 'DISPUTES',
        text: 'Approval record APR-2291 is out of date',
        reference: '',
      });
      expect(note.target).toEqual({ kind: 'RELATIONSHIP', relationshipId });
      expect(note.reference).toBeNull();
      expect(note.stance).toBe('DISPUTES');
      expect(await prisma.auditEntry.count({ where: { action: CREATED, targetId: note.id } })).toBe(1);
    });
  });

  describe('validation and access', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['blank text', entityNote('   '), 'text'],
      ['text of 2,001 characters', entityNote('x'.repeat(2001)), 'text'],
      ['an unknown stance', { ...entityNote('ok'), stance: 'MAYBE' }, 'stance'],
      ['an unknown target kind', { ...entityNote('ok'), target: { kind: 'TEAM' } }, 'target.kind'],
      ['reference over 500 characters', entityNote('ok', { reference: 'r'.repeat(501) }), 'reference'],
    ];

    it.each(cases)('rejects %s with 400 and writes nothing', async (_name, body, path) => {
      const notes = await prisma.evidenceNote.count();
      const audits = (await auditCount(CREATED)) + (await auditCount(RETRACTED));
      const response = await request(server)
        .post('/api/evidence-notes')
        .set('Authorization', auth('a'))
        .send(body);

      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.map((detail) => detail.path)).toContain(path);
      expect(await prisma.evidenceNote.count()).toBe(notes);
      expect((await auditCount(CREATED)) + (await auditCount(RETRACTED))).toBe(audits);
    });

    it('rejects an extra property (strict) with 400', async () => {
      const response = await request(server)
        .post('/api/evidence-notes')
        .set('Authorization', auth('a'))
        .send({ ...entityNote('ok'), authorId: analystB.id });
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a nonexistent entity with the exact detail and writes nothing', async () => {
      const notes = await prisma.evidenceNote.count();
      const audits = await auditCount(CREATED);
      const response = await request(server)
        .post('/api/evidence-notes')
        .set('Authorization', auth('a'))
        .send({ ...entityNote('ok'), target: { kind: 'ENTITY', entityId: randomUUID() } });

      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.details).toEqual([
        { path: 'target.entityId', message: 'Entity not found' },
      ]);
      expect(await prisma.evidenceNote.count()).toBe(notes);
      expect(await auditCount(CREATED)).toBe(audits);
    });

    it('rejects a nonexistent relationship with the exact detail', async () => {
      const response = await request(server)
        .post('/api/evidence-notes')
        .set('Authorization', auth('a'))
        .send({
          ...entityNote('ok'),
          target: { kind: 'RELATIONSHIP', relationshipId: randomUUID() },
        });
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.details).toEqual([
        { path: 'target.relationshipId', message: 'Relationship not found' },
      ]);
    });

    it('rejects a retraction reason over 500 characters', async () => {
      const note = await createNote('a', entityNote('to be retracted later'));
      const response = await retract('a', note.id, 'r'.repeat(501));
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.details?.[0]?.path).toBe('reason');
      expect((await prisma.evidenceNoteRetraction.count({ where: { noteId: note.id } }))).toBe(0);
    });

    it('answers 401 on all four routes without a token', async () => {
      const id = randomUUID();
      const responses = await Promise.all([
        request(server).post('/api/evidence-notes').send(entityNote('ok')),
        request(server).post(`/api/evidence-notes/${id}/retract`).send({ reason: 'x' }),
        request(server).get(`/api/entities/${id}/evidence-notes`),
        request(server).get(`/api/relationships/${id}/evidence-notes`),
      ]);
      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    });

    it('answers 400 for a malformed id and 404 for an unknown one on the list routes', async () => {
      const malformed = await request(server)
        .get('/api/entities/not-a-uuid/evidence-notes')
        .set('Authorization', auth('a'));
      expect(malformed.status).toBe(400);

      for (const path of ['entities', 'relationships']) {
        const response = await request(server)
          .get(`/api/${path}/${randomUUID()}/evidence-notes`)
          .set('Authorization', auth('a'));
        expect(response.status).toBe(404);
        expect(ErrorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('listing', () => {
    it('pages 3 notes with limit=2, newest first, and a cursor for the second page', async () => {
      const target = otherEntityId;
      const created: EvidenceNoteDto[] = [];
      for (const text of ['first', 'second', 'third']) {
        created.push(
          await createNote('a', {
            target: { kind: 'ENTITY', entityId: target },
            stance: 'CONTEXT',
            text,
          }),
        );
        // created_at has millisecond-visible resolution; keep the three notes distinct.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const path = `/api/entities/${target}/evidence-notes`;
      const firstPage = await list(path, '?limit=2');
      expect(firstPage.items.map((note) => note.text)).toEqual(['third', 'second']);
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPage = await list(path, `?limit=2&cursor=${firstPage.nextCursor ?? ''}`);
      expect(secondPage.items.map((note) => note.text)).toEqual(['first']);
      expect(secondPage.nextCursor).toBeNull();
    });

    it('lists the notes of a relationship, including retracted ones', async () => {
      const response = await list(`/api/relationships/${relationshipId}/evidence-notes`);
      expect(response.items.length).toBeGreaterThanOrEqual(1);
      expect(response.items.every((note) => note.target.kind === 'RELATIONSHIP')).toBe(true);
    });

    it('does not skip or repeat a note whose microseconds differ within one millisecond', async () => {
      const target = await entityIdByKey(prisma, 'Payment', 'Payments', 'PAY-88213');
      const high = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const low = '00000000-0000-4000-8000-000000000001';
      await prisma.$executeRaw`
        INSERT INTO evidence_notes (id, entity_id, stance, text, author_id, created_at)
        VALUES (${high}::uuid, ${target}::uuid, 'CONTEXT'::"EvidenceNoteStance", 'later microseconds',
                ${analystA.id}::uuid, '2026-09-30T09:15:00.123456Z'::timestamptz),
               (${low}::uuid, ${target}::uuid, 'CONTEXT'::"EvidenceNoteStance", 'earlier microseconds',
                ${analystA.id}::uuid, '2026-09-30T09:15:00.123200Z'::timestamptz)`;

      const path = `/api/entities/${target}/evidence-notes`;
      const first = await list(path, '?limit=1');
      expect(first.items.map((note) => note.id)).toEqual([high]);
      expect(first.items[0]?.createdAt).toBe('2026-09-30T09:15:00.123Z');
      const second = await list(path, `?limit=1&cursor=${first.nextCursor ?? ''}`);
      expect(second.items.map((note) => note.id)).toEqual([low]);
      expect(second.nextCursor).toBeNull();
    });

    it('rejects a malformed cursor with 400', async () => {
      const response = await request(server)
        .get(`/api/entities/${entityId}/evidence-notes?cursor=not-a-cursor`)
        .set('Authorization', auth('a'));
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.details?.[0]?.path).toBe('cursor');
    });
  });

  describe('retraction', () => {
    it('lets the author retract: 200, inactive, with before/after in the audit row', async () => {
      const note = await createNote('a', entityNote('author retracts this'));
      const response = await retract('a', note.id, 'Mistaken');
      expect(response.status).toBe(200);
      const body = EvidenceNoteDtoSchema.parse(response.body);
      expect(body.active).toBe(false);
      expect(body.retraction).toMatchObject({
        retractedBy: { id: analystA.id },
        reason: 'Mistaken',
      });

      const rows = await prisma.auditEntry.findMany({ where: { action: RETRACTED, targetId: note.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        targetType: 'evidence_note',
        actorId: analystA.id,
        before: { id: note.id, active: true },
        after: { id: note.id, active: false },
      });
    });

    it("lets an admin retract another user's note", async () => {
      const note = await createNote('b', entityNote('admin retracts this'));
      const response = await retract('c', note.id, 'Admin cleanup');
      expect(response.status).toBe(200);
      expect(EvidenceNoteDtoSchema.parse(response.body).retraction?.retractedBy.id).toBe(admin.id);
    });

    it("refuses another analyst: 403, one auth.forbidden row, the note unchanged", async () => {
      const note = await createNote('b', entityNote('only B or an admin may retract this'));
      const forbidden = await auditCount(FORBIDDEN);
      const retracted = await auditCount(RETRACTED);

      const response = await retract('a', note.id);
      expect(response.status).toBe(403);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('FORBIDDEN');
      expect(await auditCount(FORBIDDEN)).toBe(forbidden + 1);
      expect(await auditCount(RETRACTED)).toBe(retracted);
      expect(await prisma.evidenceNoteRetraction.count({ where: { noteId: note.id } })).toBe(0);

      const latest = await prisma.auditEntry.findFirstOrThrow({
        where: { action: FORBIDDEN },
        orderBy: { id: 'desc' },
      });
      expect(latest.metadata).toEqual({
        method: 'POST',
        path: `/api/evidence-notes/${note.id}/retract`,
        role: 'ANALYST',
      });
    });

    it('answers 200 for a repeated retraction, keeps the first reason and writes no audit row', async () => {
      const note = await createNote('b', entityNote('retracted twice'));
      expect((await retract('b', note.id, 'First reason')).status).toBe(200);
      const retracted = await auditCount(RETRACTED);

      const again = await retract('b', note.id, 'Second reason');
      expect(again.status).toBe(200);
      const body = EvidenceNoteDtoSchema.parse(again.body);
      expect(body.active).toBe(false);
      expect(body.retraction?.reason).toBe('First reason');
      expect(await auditCount(RETRACTED)).toBe(retracted);
    });

    it('treats a repeat by a non-author as already retracted rather than forbidden', async () => {
      const note = await createNote('b', entityNote('already gone'));
      await retract('b', note.id, 'Gone');
      const forbidden = await auditCount(FORBIDDEN);
      const response = await retract('a', note.id);
      expect(response.status).toBe(200);
      expect(await auditCount(FORBIDDEN)).toBe(forbidden);
    });

    it('answers 404 for a missing note', async () => {
      const response = await retract('a', randomUUID());
      expect(response.status).toBe(404);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
    });

    it('keeps a retracted note in the list, marked inactive', async () => {
      const note = await createNote('a', entityNote('listed after retraction'));
      await retract('a', note.id, 'Superseded');
      const page = await list(`/api/entities/${entityId}/evidence-notes`, '?limit=200');
      const listed = page.items.find((item) => item.id === note.id);
      expect(listed).toMatchObject({ active: false, retraction: { reason: 'Superseded' } });
    });

    it('records exactly one retraction when two users retract at once', async () => {
      const note = await createNote('a', entityNote('raced'));
      const retracted = await auditCount(RETRACTED);
      const [fromAuthor, fromAdmin] = await Promise.all([
        retract('a', note.id, 'Author reason'),
        retract('c', note.id, 'Admin reason'),
      ]);
      expect([fromAuthor.status, fromAdmin.status]).toEqual([200, 200]);
      expect(await prisma.evidenceNoteRetraction.count({ where: { noteId: note.id } })).toBe(1);
      expect(await auditCount(RETRACTED)).toBe(retracted + 1);
    });
  });

  describe('database immutability (SC-006)', () => {
    it('rejects UPDATE and DELETE on notes and DELETE on retractions', async () => {
      const note = await createNote('a', entityNote('immutable'));
      await retract('a', note.id, 'Immutable too');

      await expect(
        prisma.$executeRaw`UPDATE evidence_notes SET text = 'x' WHERE id = ${note.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM evidence_notes`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM evidence_note_retractions`).rejects.toThrow(
        /append-only/,
      );
      await expect(
        prisma.$executeRaw`UPDATE evidence_note_retractions SET reason = 'x'`,
      ).rejects.toThrow(/append-only/);

      const stored = await prisma.evidenceNote.findUniqueOrThrow({ where: { id: note.id } });
      expect(stored.text).toBe('immutable');
    });
  });
});
