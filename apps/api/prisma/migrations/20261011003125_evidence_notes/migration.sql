-- CreateEnum
CREATE TYPE "EvidenceNoteStance" AS ENUM ('SUPPORTS', 'DISPUTES', 'CONTEXT');

-- CreateTable
CREATE TABLE "evidence_notes" (
    "id" UUID NOT NULL,
    "entity_id" UUID,
    "relationship_id" UUID,
    "stance" "EvidenceNoteStance" NOT NULL,
    "text" TEXT NOT NULL,
    "reference" TEXT,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_note_retractions" (
    "note_id" UUID NOT NULL,
    "retracted_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "retracted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_note_retractions_pkey" PRIMARY KEY ("note_id")
);

-- CreateIndex
CREATE INDEX "evidence_notes_entity_id_created_at_id_idx" ON "evidence_notes"("entity_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "evidence_notes_relationship_id_created_at_id_idx" ON "evidence_notes"("relationship_id", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "evidence_notes" ADD CONSTRAINT "evidence_notes_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_notes" ADD CONSTRAINT "evidence_notes_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_notes" ADD CONSTRAINT "evidence_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_note_retractions" ADD CONSTRAINT "evidence_note_retractions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "evidence_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_note_retractions" ADD CONSTRAINT "evidence_note_retractions_retracted_by_id_fkey" FOREIGN KEY ("retracted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evidence notes are append-only (research R9)
ALTER TABLE evidence_notes
  ADD CONSTRAINT evidence_notes_one_target CHECK (num_nonnulls(entity_id, relationship_id) = 1),
  ADD CONSTRAINT evidence_notes_text_length CHECK (char_length(text) BETWEEN 1 AND 2000),
  ADD CONSTRAINT evidence_notes_reference_length
    CHECK (reference IS NULL OR char_length(reference) BETWEEN 1 AND 500);

ALTER TABLE evidence_note_retractions
  ADD CONSTRAINT evidence_note_retractions_reason_length CHECK (char_length(reason) BETWEEN 1 AND 500);

CREATE TRIGGER evidence_notes_append_only
BEFORE UPDATE OR DELETE ON evidence_notes
FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER evidence_notes_append_only_truncate
BEFORE TRUNCATE ON evidence_notes
FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER evidence_note_retractions_append_only
BEFORE UPDATE OR DELETE ON evidence_note_retractions
FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER evidence_note_retractions_append_only_truncate
BEFORE TRUNCATE ON evidence_note_retractions
FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
