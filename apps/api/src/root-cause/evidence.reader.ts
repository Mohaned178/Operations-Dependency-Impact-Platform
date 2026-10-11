import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  JsonValueSchema,
  REQUIREMENT_SOURCE_RELATIONSHIP_TYPES,
  ROOT_CAUSE_LIMITS,
  type Confidence,
  type EntityEvidenceDto,
  type EntityRefDto,
  type EntityType,
  type EventEvidenceDto,
  type JsonValue,
  type NoteEvidenceDto,
  type OperationalState,
  type RelationshipEvidenceDto,
  type RelationshipOrigin,
  type RequirementSourceDto,
  type SourceRecordDto,
  type StateRecordEvidenceDto,
} from '@opsgraph/shared';
import { GRAPH_REPOSITORY, type GraphRepository } from '../graph/graph.repository';
import { compareCodeUnits } from '../graph/traversal/path-order';
import { PrismaService } from '../prisma/prisma.service';
import { toNoteEvidenceDto, type EvidenceNoteRow } from './evidence-note.mapper';

export interface EvidenceRequest {
  /** Every chain entity, start included, de-duplicated. */
  entityIds: readonly string[];
  /** Every assertion id on every chain hop. */
  relationshipIds: readonly string[];
  /** For attributes (the label rule). */
  rootCauseEntityIds: readonly string[];
}

export interface EvidenceBundle {
  entities: Map<string, EntityEvidenceDto>;
  relationships: Map<string, RelationshipEvidenceDto>;
  /** Root-cause entities only. */
  attributes: Map<string, Record<string, JsonValue>>;
}

interface RawStateRecordRow {
  entity_id: string;
  so_id: string;
  state: OperationalState;
  source_status: string | null;
  so_source_system: string;
  so_source_id: string;
  so_observed_at: Date;
  so_received_at: Date;
  so_import_id: string;
  sr_id: string;
  sr_kind: SourceRecordDto['kind'];
  sr_source_system: string;
  sr_source_id: string;
  sr_observed_at: Date;
  sr_received_at: Date;
  sr_import_id: string;
  raw_payload: unknown;
}

interface RawRelationshipRecordRow {
  relationship_id: string;
  origin: RelationshipOrigin;
  confidence: Confidence;
  sr_id: string | null;
  sr_kind: SourceRecordDto['kind'] | null;
  sr_source_system: string | null;
  sr_source_id: string | null;
  sr_observed_at: Date | null;
  sr_received_at: Date | null;
  sr_import_id: string | null;
  raw_payload: unknown;
}

interface RawEventRow {
  entity_id: string;
  entity_role: 'SUBJECT' | 'RELATED';
  id: string;
  event_type: string;
  occurred_at: Date;
  observed_at: Date;
  description: string | null;
  source_system: string;
  source_id: string;
  import_id: string;
}

interface RawEventEntityRow {
  event_id: string;
  role: 'SUBJECT' | 'RELATED';
  id: string;
  type: EntityType;
  display_name: string;
  current_state: OperationalState;
}

interface RawCountRow {
  target_id: string;
  total: number;
}

interface RawNoteRow {
  id: string;
  entity_id: string | null;
  relationship_id: string | null;
  stance: EvidenceNoteRow['stance'];
  text: string;
  reference: string | null;
  author_id: string;
  author_name: string;
  created_at: Date;
  retracted_by_id: string | null;
  retracted_by_name: string | null;
  retraction_reason: string | null;
  retracted_at: Date | null;
}

type NoteTargetColumn = 'entity_id' | 'relationship_id';

const AttributesSchema = z.record(JsonValueSchema);

function toStateRecord(row: RawStateRecordRow, current: boolean): StateRecordEvidenceDto {
  return {
    rule: 'STATE_RECORD',
    origin: 'SOURCE',
    current,
    observation: {
      id: row.so_id,
      state: row.state,
      sourceStatus: row.source_status,
      sourceSystem: row.so_source_system,
      sourceId: row.so_source_id,
      observedAt: row.so_observed_at.toISOString(),
      receivedAt: row.so_received_at.toISOString(),
      importId: row.so_import_id,
    },
    sourceRecord: {
      id: row.sr_id,
      kind: row.sr_kind,
      sourceSystem: row.sr_source_system,
      sourceId: row.sr_source_id,
      observedAt: row.sr_observed_at.toISOString(),
      receivedAt: row.sr_received_at.toISOString(),
      importId: row.sr_import_id,
      rawPayload: JsonValueSchema.parse(row.raw_payload),
    },
  };
}

function toNoteRow(row: RawNoteRow): EvidenceNoteRow {
  const retraction =
    row.retracted_by_id === null ||
    row.retracted_by_name === null ||
    row.retraction_reason === null ||
    row.retracted_at === null
      ? null
      : {
          retractedById: row.retracted_by_id,
          retractedByName: row.retracted_by_name,
          reason: row.retraction_reason,
          retractedAt: row.retracted_at,
        };
  return {
    id: row.id,
    entityId: row.entity_id,
    relationshipId: row.relationship_id,
    stance: row.stance,
    text: row.text,
    reference: row.reference,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
    retraction,
  };
}

/** Newest first; ties by id, both in code-unit order (research R4). */
function compareNotes(a: NoteEvidenceDto, b: NoteEvidenceDto): number {
  return compareCodeUnits(b.createdAt, a.createdAt) || compareCodeUnits(b.id, a.id);
}

function compareEvents(a: EventEvidenceDto, b: EventEvidenceDto): number {
  return (
    compareCodeUnits(b.occurredAt, a.occurredAt) ||
    compareCodeUnits(a.sourceSystem, b.sourceSystem) ||
    compareCodeUnits(a.sourceId, b.sourceId)
  );
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
}

/**
 * Loads the evidence of research R4 with a fixed number of batched queries, never one per step.
 * Every query reads non-graph tables, or the one-hop GraphRepository method, so none of them is
 * traversal. Every list is re-sorted in TypeScript; SQL ordering only picks the top N.
 */
@Injectable()
export class EvidenceReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GRAPH_REPOSITORY) private readonly graph: GraphRepository,
  ) {}

  async load(request: EvidenceRequest): Promise<EvidenceBundle> {
    const entityIds = [...new Set(request.entityIds)];
    const relationshipIds = [...new Set(request.relationshipIds)];
    const rootIds = [...new Set(request.rootCauseEntityIds)];

    const incoming = await this.graph.findIncomingRelationships(
      entityIds,
      REQUIREMENT_SOURCE_RELATIONSHIP_TYPES,
    );
    const requirementRows = new Map<string, typeof incoming>();
    for (const row of incoming) {
      pushTo(requirementRows, row.targetEntityId, row);
    }
    const keptRequirementRows = [...requirementRows.values()].flatMap((rows) =>
      rows.slice(0, ROOT_CAUSE_LIMITS.requirementSourcesPerEntity),
    );
    const definerIds = keptRequirementRows.map((row) => row.source.id);

    const [stateRecords, events, entityNotes, relationshipEvidence, attributes] = await Promise.all([
      this.loadStateRecords([...new Set([...entityIds, ...definerIds])]),
      this.loadEvents(entityIds),
      this.loadNotes('entity_id', entityIds),
      this.loadRelationshipEvidence(relationshipIds),
      this.loadAttributes(rootIds),
    ]);

    const entities = new Map<string, EntityEvidenceDto>();
    for (const id of entityIds) {
      const rows = requirementRows.get(id) ?? [];
      const requirementSources: RequirementSourceDto[] = rows
        .slice(0, ROOT_CAUSE_LIMITS.requirementSourcesPerEntity)
        .map((row) => {
          const type = row.relationship.type;
          if (type !== 'DEFINES' && type !== 'GOVERNS') {
            throw new Error(`evidence reader: unexpected requirement relationship type ${type}`);
          }
          const definer: EntityRefDto = {
            id: row.source.id,
            type: row.source.type,
            displayName: row.source.displayName,
            currentState: row.source.currentState,
          };
          return {
            rule: 'REQUIREMENT_SOURCE',
            origin: row.relationship.origin,
            confidence: row.relationship.confidence,
            relationship: {
              id: row.relationship.id,
              type,
              fromEntityId: row.source.id,
              toEntityId: row.targetEntityId,
              basis: row.relationship.basis,
              sourceSystem: row.relationship.sourceSystem,
              sourceId: row.relationship.sourceId,
              observedAt: row.relationship.observedAt.toISOString(),
            },
            entity: definer,
            attributes: row.source.attributes,
            stateRecord: stateRecords.get(row.source.id)?.at(0) ?? null,
          };
        });

      const eventEvidence = events.get(id);
      const noteEvidence = entityNotes.get(id);
      entities.set(id, {
        entityId: id,
        stateRecords: stateRecords.get(id) ?? [],
        requirementSources: { items: requirementSources, total: rows.length },
        events: eventEvidence ?? { items: [], total: 0 },
        notes: noteEvidence ?? { items: [], total: 0 },
      });
    }

    return { entities, relationships: relationshipEvidence, attributes };
  }

  /** The current observation first, then the latest from each other source system. */
  private async loadStateRecords(ids: string[]): Promise<Map<string, StateRecordEvidenceDto[]>> {
    const result = new Map<string, StateRecordEvidenceDto[]>();
    if (ids.length === 0) {
      return result;
    }

    const columns = Prisma.sql`
      so.entity_id::text AS entity_id, so.id::text AS so_id, so.state::text AS state, so.source_status,
      so.source_system AS so_source_system, so.source_id AS so_source_id,
      so.observed_at AS so_observed_at, so.received_at AS so_received_at, so.import_id::text AS so_import_id,
      sr.id::text AS sr_id, sr.kind::text AS sr_kind, sr.source_system AS sr_source_system,
      sr.source_id AS sr_source_id, sr.observed_at AS sr_observed_at, sr.received_at AS sr_received_at,
      sr.import_id::text AS sr_import_id, sr.raw_payload AS raw_payload`;

    const [current, perSource] = await Promise.all([
      this.prisma.$queryRaw<RawStateRecordRow[]>`
        SELECT DISTINCT ON (so.entity_id) ${columns}
        FROM state_observations so
        JOIN source_records sr ON sr.id = so.source_record_id
        WHERE so.entity_id = ANY(${ids}::uuid[])
        ORDER BY so.entity_id, so.observed_at DESC, so.seq DESC`,
      this.prisma.$queryRaw<RawStateRecordRow[]>`
        SELECT DISTINCT ON (so.entity_id, so.source_system) ${columns}
        FROM state_observations so
        JOIN source_records sr ON sr.id = so.source_record_id
        WHERE so.entity_id = ANY(${ids}::uuid[])
        ORDER BY so.entity_id, so.source_system, so.observed_at DESC, so.seq DESC`,
    ]);

    const currentById = new Map(current.map((row) => [row.entity_id, row]));
    const others = new Map<string, RawStateRecordRow[]>();
    for (const row of perSource) {
      if (currentById.get(row.entity_id)?.so_id !== row.so_id) {
        pushTo(others, row.entity_id, row);
      }
    }

    for (const [entityId, row] of currentById) {
      const rest = (others.get(entityId) ?? []).sort((a, b) =>
        compareCodeUnits(a.so_source_system, b.so_source_system),
      );
      result.set(entityId, [toStateRecord(row, true), ...rest.map((other) => toStateRecord(other, false))]);
    }
    return result;
  }

  /** The newest 20 events per entity, plus the total. */
  private async loadEvents(
    ids: string[],
  ): Promise<Map<string, { items: EventEvidenceDto[]; total: number }>> {
    const result = new Map<string, { items: EventEvidenceDto[]; total: number }>();
    if (ids.length === 0) {
      return result;
    }

    const [ranked, counts] = await Promise.all([
      this.prisma.$queryRaw<RawEventRow[]>`
        SELECT entity_id, entity_role, id, event_type, occurred_at, observed_at, description,
               source_system, source_id, import_id
        FROM (
          SELECT ee.entity_id::text AS entity_id, ee.role::text AS entity_role, e.id::text AS id,
                 e.type AS event_type, e.occurred_at, e.observed_at, e.description,
                 e.source_system, e.source_id, e.import_id::text AS import_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY ee.entity_id
                   ORDER BY e.occurred_at DESC, e.source_system COLLATE "C", e.source_id COLLATE "C"
                 ) AS rn
          FROM event_entities ee
          JOIN events e ON e.id = ee.event_id
          WHERE ee.entity_id = ANY(${ids}::uuid[])
        ) ranked
        WHERE rn <= ${ROOT_CAUSE_LIMITS.eventsPerEntity}`,
      this.prisma.$queryRaw<RawCountRow[]>`
        SELECT entity_id::text AS target_id, count(*)::int AS total
        FROM event_entities
        WHERE entity_id = ANY(${ids}::uuid[])
        GROUP BY entity_id`,
    ]);

    const eventIds = [...new Set(ranked.map((row) => row.id))];
    const linked =
      eventIds.length === 0
        ? []
        : await this.prisma.$queryRaw<RawEventEntityRow[]>`
            SELECT ee.event_id::text AS event_id, ee.role::text AS role, en.id::text AS id,
                   en.type::text AS type, en.display_name, en.current_state::text AS current_state
            FROM event_entities ee
            JOIN entities en ON en.id = ee.entity_id
            WHERE ee.event_id = ANY(${eventIds}::uuid[])`;
    const linksByEvent = new Map<string, RawEventEntityRow[]>();
    for (const row of linked) {
      pushTo(linksByEvent, row.event_id, row);
    }

    const totals = new Map(counts.map((row) => [row.target_id, row.total]));
    const itemsByEntity = new Map<string, EventEvidenceDto[]>();
    for (const row of ranked) {
      const links = [...(linksByEvent.get(row.id) ?? [])].sort(
        (a, b) =>
          (a.role === b.role ? 0 : a.role === 'SUBJECT' ? -1 : 1) ||
          compareCodeUnits(a.display_name, b.display_name) ||
          compareCodeUnits(a.id, b.id),
      );
      pushTo(itemsByEntity, row.entity_id, {
        rule: 'EVENT',
        origin: 'SOURCE',
        id: row.id,
        eventType: row.event_type,
        occurredAt: row.occurred_at.toISOString(),
        observedAt: row.observed_at.toISOString(),
        description: row.description,
        role: row.entity_role,
        entities: links.map((link) => ({
          entity: {
            id: link.id,
            type: link.type,
            displayName: link.display_name,
            currentState: link.current_state,
          },
          role: link.role,
        })),
        sourceSystem: row.source_system,
        sourceId: row.source_id,
        importId: row.import_id,
      });
    }

    for (const id of ids) {
      const items = (itemsByEntity.get(id) ?? []).sort(compareEvents);
      result.set(id, { items, total: totals.get(id) ?? 0 });
    }
    return result;
  }

  /** The newest 50 notes per target (retracted ones included), plus the total. */
  private async loadNotes(
    column: NoteTargetColumn,
    ids: string[],
  ): Promise<Map<string, { items: NoteEvidenceDto[]; total: number }>> {
    const result = new Map<string, { items: NoteEvidenceDto[]; total: number }>();
    if (ids.length === 0) {
      return result;
    }
    // `column` is one of two string literals, never user input.
    const target = Prisma.raw(`n.${column}`);
    const targetColumn = Prisma.raw(column);

    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<RawNoteRow[]>`
        SELECT id, entity_id, relationship_id, stance, text, reference, author_id, author_name,
               created_at, retracted_by_id, retracted_by_name, retraction_reason, retracted_at
        FROM (
          SELECT n.id::text AS id, n.entity_id::text AS entity_id, n.relationship_id::text AS relationship_id,
                 n.stance::text AS stance, n.text, n.reference, n.author_id::text AS author_id,
                 author.display_name AS author_name, n.created_at,
                 rt.retracted_by_id::text AS retracted_by_id, retractor.display_name AS retracted_by_name,
                 rt.reason AS retraction_reason, rt.retracted_at,
                 ROW_NUMBER() OVER (PARTITION BY ${target} ORDER BY n.created_at DESC, n.id DESC) AS rn
          FROM evidence_notes n
          JOIN users author ON author.id = n.author_id
          LEFT JOIN evidence_note_retractions rt ON rt.note_id = n.id
          LEFT JOIN users retractor ON retractor.id = rt.retracted_by_id
          WHERE ${target} = ANY(${ids}::uuid[])
        ) ranked
        WHERE rn <= ${ROOT_CAUSE_LIMITS.notesPerTarget}`,
      this.prisma.$queryRaw<RawCountRow[]>`
        SELECT ${targetColumn}::text AS target_id, count(*)::int AS total
        FROM evidence_notes
        WHERE ${targetColumn} = ANY(${ids}::uuid[])
        GROUP BY ${targetColumn}`,
    ]);

    const totals = new Map(counts.map((row) => [row.target_id, row.total]));
    const itemsByTarget = new Map<string, NoteEvidenceDto[]>();
    for (const row of rows) {
      const targetId = column === 'entity_id' ? row.entity_id : row.relationship_id;
      if (targetId !== null) {
        pushTo(itemsByTarget, targetId, toNoteEvidenceDto(toNoteRow(row)));
      }
    }
    for (const id of ids) {
      result.set(id, {
        items: (itemsByTarget.get(id) ?? []).sort(compareNotes),
        total: totals.get(id) ?? 0,
      });
    }
    return result;
  }

  /** The latest source record of each assertion, with the assertion's own origin and confidence. */
  private async loadRelationshipEvidence(
    ids: string[],
  ): Promise<Map<string, RelationshipEvidenceDto>> {
    const result = new Map<string, RelationshipEvidenceDto>();
    if (ids.length === 0) {
      return result;
    }

    const [rows, notes] = await Promise.all([
      this.prisma.$queryRaw<RawRelationshipRecordRow[]>`
        SELECT r.id::text AS relationship_id, r.origin::text AS origin, r.confidence::text AS confidence,
               sr.id::text AS sr_id, sr.kind::text AS sr_kind, sr.source_system AS sr_source_system,
               sr.source_id AS sr_source_id, sr.observed_at AS sr_observed_at,
               sr.received_at AS sr_received_at, sr.import_id::text AS sr_import_id,
               sr.raw_payload AS raw_payload
        FROM relationships r
        LEFT JOIN LATERAL (
          SELECT * FROM source_records
          WHERE relationship_id = r.id
          ORDER BY observed_at DESC, seq DESC
          LIMIT 1
        ) sr ON true
        WHERE r.id = ANY(${ids}::uuid[])`,
      this.loadNotes('relationship_id', ids),
    ]);

    const byId = new Map(rows.map((row) => [row.relationship_id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (row === undefined) {
        throw new Error(`evidence reader: relationship ${id} does not exist`);
      }
      const record: SourceRecordDto | null =
        row.sr_id === null ||
        row.sr_kind === null ||
        row.sr_source_system === null ||
        row.sr_source_id === null ||
        row.sr_observed_at === null ||
        row.sr_received_at === null ||
        row.sr_import_id === null
          ? null
          : {
              id: row.sr_id,
              kind: row.sr_kind,
              sourceSystem: row.sr_source_system,
              sourceId: row.sr_source_id,
              observedAt: row.sr_observed_at.toISOString(),
              receivedAt: row.sr_received_at.toISOString(),
              importId: row.sr_import_id,
              rawPayload: JsonValueSchema.parse(row.raw_payload),
            };
      result.set(id, {
        relationshipId: id,
        rule: 'RELATIONSHIP_RECORD',
        origin: row.origin,
        confidence: row.confidence,
        record,
        notes: notes.get(id) ?? { items: [], total: 0 },
      });
    }
    return result;
  }

  private async loadAttributes(ids: string[]): Promise<Map<string, Record<string, JsonValue>>> {
    const result = new Map<string, Record<string, JsonValue>>();
    if (ids.length === 0) {
      return result;
    }
    const rows = await this.prisma.entity.findMany({
      where: { id: { in: ids } },
      select: { id: true, attributes: true },
    });
    for (const row of rows) {
      result.set(row.id, AttributesSchema.parse(row.attributes));
    }
    return result;
  }
}
