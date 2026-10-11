import {
  toEvidenceNoteDto,
  toNoteEvidenceDto,
  type EvidenceNoteRow,
  type EvidenceNoteWithRelations,
} from './evidence-note.mapper';

const NOTE_ID = '10000000-0000-4000-8000-000000000001';
const ENTITY_ID = '20000000-0000-4000-8000-000000000001';
const RELATIONSHIP_ID = '30000000-0000-4000-8000-000000000001';
const AUTHOR_ID = '40000000-0000-4000-8000-000000000001';
const RETRACTOR_ID = '40000000-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-09-30T09:15:00.123Z');
const RETRACTED_AT = new Date('2026-09-30T10:45:30.456Z');

function row(overrides: Partial<EvidenceNoteRow> = {}): EvidenceNoteRow {
  return {
    id: NOTE_ID,
    entityId: ENTITY_ID,
    relationshipId: null,
    stance: 'SUPPORTS',
    text: 'Finance confirmed the budget code was never submitted',
    reference: 'Call with Finance, ticket FIN-4410',
    authorId: AUTHOR_ID,
    authorName: 'Alice Analyst',
    createdAt: CREATED_AT,
    retraction: null,
    ...overrides,
  };
}

function user(id: string, displayName: string): EvidenceNoteWithRelations['author'] {
  return {
    id,
    email: `${id}@example.com`,
    displayName,
    passwordHash: 'hash',
    role: 'ANALYST',
    status: 'ACTIVE',
    mustChangePassword: false,
    failedLoginCount: 0,
    lastFailedLoginAt: null,
    lockedUntil: null,
    passwordChangedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

const RETRACTION = {
  retractedById: RETRACTOR_ID,
  retractedByName: 'Bob Analyst',
  reason: 'Confirmed with Finance: the approval record is current.',
  retractedAt: RETRACTED_AT,
};

describe('toEvidenceNoteDto', () => {
  it('maps an active note on an entity', () => {
    expect(toEvidenceNoteDto(row())).toEqual({
      id: NOTE_ID,
      target: { kind: 'ENTITY', entityId: ENTITY_ID },
      stance: 'SUPPORTS',
      text: 'Finance confirmed the budget code was never submitted',
      reference: 'Call with Finance, ticket FIN-4410',
      author: { id: AUTHOR_ID, displayName: 'Alice Analyst' },
      createdAt: '2026-09-30T09:15:00.123Z',
      active: true,
      retraction: null,
    });
  });

  it('maps a note on a relationship, keeping a null reference', () => {
    const dto = toEvidenceNoteDto(
      row({ entityId: null, relationshipId: RELATIONSHIP_ID, stance: 'DISPUTES', reference: null }),
    );
    expect(dto.target).toEqual({ kind: 'RELATIONSHIP', relationshipId: RELATIONSHIP_ID });
    expect(dto.stance).toBe('DISPUTES');
    expect(dto.reference).toBeNull();
  });

  it('maps a retracted note as inactive with who, why and when', () => {
    const dto = toEvidenceNoteDto(row({ retraction: RETRACTION }));
    expect(dto.active).toBe(false);
    expect(dto.retraction).toEqual({
      retractedBy: { id: RETRACTOR_ID, displayName: 'Bob Analyst' },
      reason: 'Confirmed with Finance: the approval record is current.',
      retractedAt: '2026-09-30T10:45:30.456Z',
    });
    expect(dto.text).toBe('Finance confirmed the budget code was never submitted');
  });

  it('accepts a Prisma row with its author and retraction included', () => {
    const prismaRow: EvidenceNoteWithRelations = {
      id: NOTE_ID,
      entityId: null,
      relationshipId: RELATIONSHIP_ID,
      stance: 'CONTEXT',
      text: 'Carrier rebooked the load',
      reference: null,
      authorId: AUTHOR_ID,
      createdAt: CREATED_AT,
      author: user(AUTHOR_ID, 'Alice Analyst'),
      retraction: {
        noteId: NOTE_ID,
        retractedById: RETRACTOR_ID,
        reason: 'Wrong shipment',
        retractedAt: RETRACTED_AT,
        retractedBy: user(RETRACTOR_ID, 'Bob Analyst'),
      },
    };

    expect(toEvidenceNoteDto(prismaRow)).toEqual({
      id: NOTE_ID,
      target: { kind: 'RELATIONSHIP', relationshipId: RELATIONSHIP_ID },
      stance: 'CONTEXT',
      text: 'Carrier rebooked the load',
      reference: null,
      author: { id: AUTHOR_ID, displayName: 'Alice Analyst' },
      createdAt: '2026-09-30T09:15:00.123Z',
      active: false,
      retraction: {
        retractedBy: { id: RETRACTOR_ID, displayName: 'Bob Analyst' },
        reason: 'Wrong shipment',
        retractedAt: '2026-09-30T10:45:30.456Z',
      },
    });
  });

  it('maps a Prisma row without a retraction as active', () => {
    const prismaRow: EvidenceNoteWithRelations = {
      id: NOTE_ID,
      entityId: ENTITY_ID,
      relationshipId: null,
      stance: 'SUPPORTS',
      text: 'Confirmed',
      reference: null,
      authorId: AUTHOR_ID,
      createdAt: CREATED_AT,
      author: user(AUTHOR_ID, 'Alice Analyst'),
      retraction: null,
    };
    const dto = toEvidenceNoteDto(prismaRow);
    expect(dto.active).toBe(true);
    expect(dto.retraction).toBeNull();
    expect(dto.target).toEqual({ kind: 'ENTITY', entityId: ENTITY_ID });
  });

  it('throws an invariant error for a note with no target', () => {
    expect(() => toEvidenceNoteDto(row({ entityId: null, relationshipId: null }))).toThrow(
      `evidence note ${NOTE_ID} has no target`,
    );
  });
});

describe('toNoteEvidenceDto', () => {
  it('adds the MANUAL_NOTE rule and the MANUAL origin to the same note', () => {
    expect(toNoteEvidenceDto(row())).toEqual({
      ...toEvidenceNoteDto(row()),
      rule: 'MANUAL_NOTE',
      origin: 'MANUAL',
    });
  });
});
