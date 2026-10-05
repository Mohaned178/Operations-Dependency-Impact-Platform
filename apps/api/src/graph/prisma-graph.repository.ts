import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Confidence, EntityType, OperationalState, RelationshipType } from '@opsgraph/shared';
import { RelationshipTypeSchema } from '@opsgraph/shared';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { PrismaService } from '../prisma/prisma.service';
import type {
  GraphRepository,
  NeighborPage,
  NeighborQuery,
  NeighborRow,
} from './graph.repository';

const NeighborCursorSchema = z.object({
  relType: RelationshipTypeSchema,
  direction: z.enum(['OUT', 'IN']),
  neighborDisplayName: z.string(),
  relationshipId: z.string().uuid(),
});
type NeighborCursor = z.infer<typeof NeighborCursorSchema>;

interface RawNeighborRow {
  relationship_id: string;
  rel_type_text: RelationshipType;
  direction: 'OUT' | 'IN';
  origin: NeighborRow['relationship']['origin'];
  confidence: Confidence;
  basis: string | null;
  source_system: string;
  source_id: string;
  observed_at: Date;
  import_id: string;
  neighbor_id: string;
  neighbor_type: EntityType;
  neighbor_display_name: string;
  neighbor_current_state: OperationalState;
}

const NEIGHBOR_COLUMNS = Prisma.sql`
  r.id::text AS relationship_id,
  r.type::text AS rel_type_text,
  r.origin::text AS origin,
  r.confidence::text AS confidence,
  r.basis AS basis,
  r.source_system AS source_system,
  r.source_id AS source_id,
  r.observed_at AS observed_at,
  r.import_id::text AS import_id,
  e.id::text AS neighbor_id,
  e.type::text AS neighbor_type,
  e.display_name AS neighbor_display_name,
  e.current_state::text AS neighbor_current_state`;

@Injectable()
export class PrismaGraphRepository implements GraphRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findNeighbors(query: NeighborQuery): Promise<NeighborPage> {
    const cursor =
      query.cursor === undefined ? null : decodeCursor(NeighborCursorSchema, query.cursor);

    const relationshipTypes = [...(query.relationshipTypes ?? [])];
    const neighborTypes = [...(query.neighborTypes ?? [])];
    const relTypeFilter =
      relationshipTypes.length > 0
        ? Prisma.sql`AND r.type::text = ANY(${relationshipTypes}::text[])`
        : Prisma.empty;
    const neighborTypeFilter =
      neighborTypes.length > 0
        ? Prisma.sql`AND e.type::text = ANY(${neighborTypes}::text[])`
        : Prisma.empty;

    const outPart = Prisma.sql`
      SELECT ${NEIGHBOR_COLUMNS}, 'OUT'::text AS direction
      FROM relationships r
      JOIN entities e ON e.id = r.to_entity_id
      WHERE r.from_entity_id = ${query.entityId}::uuid
        ${relTypeFilter}
        ${neighborTypeFilter}`;
    const inPart = Prisma.sql`
      SELECT ${NEIGHBOR_COLUMNS}, 'IN'::text AS direction
      FROM relationships r
      JOIN entities e ON e.id = r.from_entity_id
      WHERE r.to_entity_id = ${query.entityId}::uuid
        ${relTypeFilter}
        ${neighborTypeFilter}`;

    const parts =
      query.direction === 'OUT'
        ? [outPart]
        : query.direction === 'IN'
          ? [inPart]
          : [outPart, inPart];

    const cursorFilter =
      cursor === null
        ? Prisma.empty
        : Prisma.sql`WHERE (rel_type_text, direction, neighbor_display_name, relationship_id)
            > (${cursor.relType}::text, ${cursor.direction}::text, ${cursor.neighborDisplayName}::text, ${cursor.relationshipId}::text)`;

    const rows = await this.prisma.$queryRaw<RawNeighborRow[]>`
      SELECT * FROM (${Prisma.join(parts, ' UNION ALL ')}) AS neighbors
      ${cursorFilter}
      ORDER BY rel_type_text, direction, neighbor_display_name, relationship_id
      LIMIT ${query.limit + 1}`;

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);

    return {
      items: pageRows.map((row) => ({
        relationship: {
          id: row.relationship_id,
          type: row.rel_type_text,
          direction: row.direction,
          origin: row.origin,
          confidence: row.confidence,
          basis: row.basis,
          sourceSystem: row.source_system,
          sourceId: row.source_id,
          observedAt: row.observed_at,
          importId: row.import_id,
        },
        neighbor: {
          id: row.neighbor_id,
          type: row.neighbor_type,
          displayName: row.neighbor_display_name,
          currentState: row.neighbor_current_state,
        },
      })),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({
              relType: last.rel_type_text,
              direction: last.direction,
              neighborDisplayName: last.neighbor_display_name,
              relationshipId: last.relationship_id,
            } satisfies NeighborCursor)
          : null,
    };
  }

  async countNeighbors(entityId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM relationships
      WHERE from_entity_id = ${entityId}::uuid OR to_entity_id = ${entityId}::uuid`;
    return Number(rows[0]?.count ?? 0n);
  }
}
