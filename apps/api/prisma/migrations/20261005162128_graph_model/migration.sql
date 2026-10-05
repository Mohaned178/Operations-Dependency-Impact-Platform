-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('Customer', 'Contract', 'Order', 'Product', 'Payment', 'Invoice', 'Approval', 'Warehouse', 'Shipment', 'Supplier', 'SLA', 'BudgetRequirement');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('HAS', 'PLACED', 'GOVERNS', 'CONTAINS', 'GENERATES', 'REQUIRES', 'DEPENDS_ON', 'BLOCKS', 'FULFILLED_BY', 'SUPPLIED_BY', 'DEFINES', 'RELATES_TO');

-- CreateEnum
CREATE TYPE "RelationshipOrigin" AS ENUM ('SOURCE', 'INFERRED', 'MANUAL');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "OperationalState" AS ENUM ('ACTIVE', 'PENDING', 'WAITING', 'BLOCKED', 'MISSING', 'DELAYED', 'AT_RISK', 'COMPLETED', 'FAILED', 'CANCELLED', 'SUSPENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceRecordKind" AS ENUM ('ENTITY', 'RELATIONSHIP', 'EVENT');

-- CreateEnum
CREATE TYPE "ImportFormat" AS ENUM ('JSON', 'CSV');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('ENTITIES', 'RELATIONSHIPS', 'EVENTS');

-- CreateEnum
CREATE TYPE "ImportOutcome" AS ENUM ('APPLIED', 'REJECTED', 'DRY_RUN');

-- CreateEnum
CREATE TYPE "ImportTrigger" AS ENUM ('API', 'SEED');

-- CreateEnum
CREATE TYPE "EventEntityRole" AS ENUM ('SUBJECT', 'RELATED');

-- CreateTable
CREATE TABLE "imports" (
    "id" UUID NOT NULL,
    "trigger" "ImportTrigger" NOT NULL,
    "format" "ImportFormat" NOT NULL,
    "csv_kind" "ImportKind",
    "dry_run" BOOLEAN NOT NULL,
    "outcome" "ImportOutcome" NOT NULL,
    "actor_type" TEXT NOT NULL,
    "submitted_by_id" UUID,
    "file_name" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "counts" JSONB NOT NULL,
    "file_errors" JSONB NOT NULL,
    "row_errors" JSONB NOT NULL,
    "correlation_id" UUID NOT NULL,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL,
    "type" "EntityType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "current_state" "OperationalState" NOT NULL DEFAULT 'UNKNOWN',
    "last_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_identifiers" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "source_system" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entity_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_records" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "kind" "SourceRecordKind" NOT NULL,
    "source_system" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "normalized" JSONB NOT NULL,
    "import_id" UUID NOT NULL,
    "entity_id" UUID,
    "relationship_id" UUID,
    "event_id" UUID,

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_observations" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "entity_id" UUID NOT NULL,
    "source_record_id" UUID NOT NULL,
    "state" "OperationalState" NOT NULL,
    "source_status" TEXT,
    "source_system" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "import_id" UUID NOT NULL,

    CONSTRAINT "state_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationships" (
    "id" UUID NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "from_entity_id" UUID NOT NULL,
    "to_entity_id" UUID NOT NULL,
    "origin" "RelationshipOrigin" NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "basis" TEXT,
    "source_system" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "import_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "description" TEXT,
    "source_system" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "import_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_entities" (
    "event_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "role" "EventEntityRole" NOT NULL,

    CONSTRAINT "event_entities_pkey" PRIMARY KEY ("event_id","entity_id")
);

-- CreateIndex
CREATE INDEX "imports_received_at_id_idx" ON "imports"("received_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "entities_display_name_id_idx" ON "entities"("display_name", "id");

-- CreateIndex
CREATE INDEX "entities_type_display_name_id_idx" ON "entities"("type", "display_name", "id");

-- CreateIndex
CREATE INDEX "entities_current_state_display_name_id_idx" ON "entities"("current_state", "display_name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_identifiers_seq_key" ON "entity_identifiers"("seq");

-- CreateIndex
CREATE INDEX "entity_identifiers_entity_id_seq_idx" ON "entity_identifiers"("entity_id", "seq");

-- CreateIndex
CREATE INDEX "entity_identifiers_source_system_idx" ON "entity_identifiers"("source_system");

-- CreateIndex
CREATE INDEX "entity_identifiers_source_id_idx" ON "entity_identifiers"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_identifiers_entity_type_source_system_source_id_key" ON "entity_identifiers"("entity_type", "source_system", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_records_seq_key" ON "source_records"("seq");

-- CreateIndex
CREATE INDEX "source_records_entity_id_observed_at_seq_idx" ON "source_records"("entity_id", "observed_at" DESC, "seq" DESC);

-- CreateIndex
CREATE INDEX "source_records_relationship_id_idx" ON "source_records"("relationship_id");

-- CreateIndex
CREATE INDEX "source_records_event_id_idx" ON "source_records"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "state_observations_seq_key" ON "state_observations"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "state_observations_source_record_id_key" ON "state_observations"("source_record_id");

-- CreateIndex
CREATE INDEX "state_observations_entity_id_observed_at_seq_idx" ON "state_observations"("entity_id", "observed_at", "seq");

-- CreateIndex
CREATE INDEX "relationships_from_entity_id_type_idx" ON "relationships"("from_entity_id", "type");

-- CreateIndex
CREATE INDEX "relationships_to_entity_id_type_idx" ON "relationships"("to_entity_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "relationships_source_system_source_id_key" ON "relationships"("source_system", "source_id");

-- CreateIndex
CREATE INDEX "events_occurred_at_id_idx" ON "events"("occurred_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "events_source_system_source_id_key" ON "events"("source_system", "source_id");

-- CreateIndex
CREATE INDEX "event_entities_entity_id_idx" ON "event_entities"("entity_id");

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_identifiers" ADD CONSTRAINT "entity_identifiers_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "state_observations" ADD CONSTRAINT "state_observations_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "state_observations" ADD CONSTRAINT "state_observations_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "state_observations" ADD CONSTRAINT "state_observations_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_entity_id_fkey" FOREIGN KEY ("from_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_entity_id_fkey" FOREIGN KEY ("to_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_entities" ADD CONSTRAINT "event_entities_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_entities" ADD CONSTRAINT "event_entities_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual constraints from data-model.md "Migrations"
ALTER TABLE relationships ADD CONSTRAINT relationships_no_self_loop CHECK (from_entity_id <> to_entity_id);
ALTER TABLE source_records ADD CONSTRAINT source_records_owner_matches_kind CHECK (
  (kind = 'ENTITY'       AND entity_id IS NOT NULL AND relationship_id IS NULL AND event_id IS NULL) OR
  (kind = 'RELATIONSHIP' AND relationship_id IS NOT NULL AND entity_id IS NULL AND event_id IS NULL) OR
  (kind = 'EVENT'        AND event_id IS NOT NULL AND entity_id IS NULL AND relationship_id IS NULL));
CREATE UNIQUE INDEX event_entities_one_subject ON event_entities (event_id) WHERE role = 'SUBJECT';
