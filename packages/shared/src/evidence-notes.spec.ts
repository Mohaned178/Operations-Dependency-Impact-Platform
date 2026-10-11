import { describe, expect, it } from 'vitest';
import {
  CreateEvidenceNoteRequestSchema,
  EvidenceNoteListQuerySchema,
  RetractEvidenceNoteRequestSchema,
} from './evidence-notes';

const ENTITY_ID = '6f1b3c2a-4d5e-4f60-8a9b-1c2d3e4f5a6b';
const RELATIONSHIP_ID = '7a2c4d3b-5e6f-4071-9b0c-2d3e4f5a6b7c';

const valid = {
  target: { kind: 'ENTITY', entityId: ENTITY_ID },
  stance: 'SUPPORTS',
  text: 'Finance confirmed the budget code was never submitted',
};

function firstIssuePath(input: unknown): (string | number)[] | undefined {
  const result = CreateEvidenceNoteRequestSchema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.path;
}

describe('CreateEvidenceNoteRequestSchema', () => {
  it('trims the text', () => {
    const parsed = CreateEvidenceNoteRequestSchema.parse({ ...valid, text: '  x  ' });
    expect(parsed.text).toBe('x');
  });

  it.each([
    ['whitespace only', '   '],
    ['2,001 characters', 'a'.repeat(2001)],
  ])('rejects text of %s at path text', (_name, text) => {
    expect(firstIssuePath({ ...valid, text })).toEqual(['text']);
  });

  it('accepts text of exactly 2,000 characters', () => {
    expect(
      CreateEvidenceNoteRequestSchema.safeParse({ ...valid, text: 'a'.repeat(2000) }).success,
    ).toBe(true);
  });

  it('turns an empty reference into null', () => {
    expect(CreateEvidenceNoteRequestSchema.parse({ ...valid, reference: '' }).reference).toBeNull();
    expect(
      CreateEvidenceNoteRequestSchema.parse({ ...valid, reference: '   ' }).reference,
    ).toBeNull();
  });

  it('turns an absent reference into null', () => {
    expect(CreateEvidenceNoteRequestSchema.parse(valid).reference).toBeNull();
  });

  it('keeps a trimmed reference', () => {
    const parsed = CreateEvidenceNoteRequestSchema.parse({
      ...valid,
      reference: ' Call with Finance ',
    });
    expect(parsed.reference).toBe('Call with Finance');
  });

  it('rejects a reference over 500 characters', () => {
    expect(firstIssuePath({ ...valid, reference: 'r'.repeat(501) })).toEqual(['reference']);
  });

  it('rejects an unknown stance', () => {
    expect(firstIssuePath({ ...valid, stance: 'MAYBE' })).toEqual(['stance']);
  });

  it('rejects an unknown target kind', () => {
    expect(firstIssuePath({ ...valid, target: { kind: 'TEAM' } })).toEqual(['target', 'kind']);
  });

  it('accepts a relationship target', () => {
    const parsed = CreateEvidenceNoteRequestSchema.parse({
      ...valid,
      target: { kind: 'RELATIONSHIP', relationshipId: RELATIONSHIP_ID },
    });
    expect(parsed.target).toEqual({ kind: 'RELATIONSHIP', relationshipId: RELATIONSHIP_ID });
  });

  it('rejects an extra property', () => {
    expect(CreateEvidenceNoteRequestSchema.safeParse({ ...valid, extra: true }).success).toBe(
      false,
    );
  });
});

describe('RetractEvidenceNoteRequestSchema', () => {
  it('trims the reason', () => {
    expect(RetractEvidenceNoteRequestSchema.parse({ reason: '  confirmed  ' }).reason).toBe(
      'confirmed',
    );
  });

  it('rejects a reason over 500 characters', () => {
    const result = RetractEvidenceNoteRequestSchema.safeParse({ reason: 'r'.repeat(501) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['reason']);
    }
  });

  it('rejects an empty reason and an extra property', () => {
    expect(RetractEvidenceNoteRequestSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(RetractEvidenceNoteRequestSchema.safeParse({ reason: 'ok', extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('EvidenceNoteListQuerySchema', () => {
  it('uses the shared page query defaults', () => {
    expect(EvidenceNoteListQuerySchema.parse({})).toEqual({ limit: 50 });
  });
});
