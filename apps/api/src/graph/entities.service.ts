import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type {
  EntityDetailDto,
  EntityListResponse,
  JsonValue,
  ListEntitiesQuery,
  NeighborListResponse,
  NeighborQuery,
  PageQuery,
  SourceRecordListResponse,
  SourceSystemListResponse,
  StateHistoryResponse,
} from '@opsgraph/shared';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  toEntityListItemDto,
  toIdentifierDto,
  toSourceRecordDto,
  toStateObservationDto,
} from './entity.mapper';
import { GRAPH_REPOSITORY, type GraphRepository } from './graph.repository';

const EntityListCursorSchema = z.object({
  displayName: z.string(),
  id: z.string().uuid(),
});

const ObservationCursorSchema = z.object({
  observedAt: z.string().datetime(),
  seq: z.string().regex(/^\d+$/),
});

type ObservationCursor = z.infer<typeof ObservationCursorSchema>;

function observationCursorFilter(cursor: ObservationCursor): Prisma.StateObservationWhereInput {
  const observedAt = new Date(cursor.observedAt);
  return {
    OR: [
      { observedAt: { lt: observedAt } },
      { observedAt, seq: { lt: BigInt(cursor.seq) } },
    ],
  };
}

function sourceRecordCursorFilter(cursor: ObservationCursor): Prisma.SourceRecordWhereInput {
  const observedAt = new Date(cursor.observedAt);
  return {
    OR: [
      { observedAt: { lt: observedAt } },
      { observedAt, seq: { lt: BigInt(cursor.seq) } },
    ],
  };
}

@Injectable()
export class EntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GRAPH_REPOSITORY) private readonly graph: GraphRepository,
  ) {}

  async list(query: ListEntitiesQuery): Promise<EntityListResponse> {
    const filters: Prisma.EntityWhereInput = {};
    if (query.type !== undefined) {
      filters.type = query.type;
    }
    if (query.state !== undefined) {
      filters.currentState = query.state;
    }
    if (query.sourceSystem !== undefined) {
      filters.identifiers = { some: { sourceSystem: query.sourceSystem } };
    }
    if (query.q !== undefined) {
      filters.OR = [
        { displayName: { contains: query.q, mode: 'insensitive' } },
        { identifiers: { some: { sourceId: { contains: query.q, mode: 'insensitive' } } } },
      ];
    }

    const where: Prisma.EntityWhereInput = { ...filters };
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(EntityListCursorSchema, query.cursor);
      where.AND = [
        {
          OR: [
            { displayName: { gt: cursor.displayName } },
            { displayName: cursor.displayName, id: { gt: cursor.id } },
          ],
        },
      ];
    }

    const rows = await this.prisma.entity.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      include: { identifiers: { orderBy: { seq: 'asc' } } },
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = page.map(toEntityListItemDto);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ displayName: last.displayName, id: last.id })
          : null,
    };
  }

  async detail(id: string): Promise<EntityDetailDto> {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
      include: { identifiers: { orderBy: { seq: 'asc' } } },
    });
    if (entity === null) {
      throw Errors.notFound('Entity');
    }

    const [currentStateObservation, latestStateBySource, sourceRecords, stateObservations, relationships, events] =
      await Promise.all([
        this.prisma.stateObservation.findFirst({
          where: { entityId: id },
          orderBy: [{ observedAt: 'desc' }, { seq: 'desc' }],
        }),
        this.prisma.stateObservation.findMany({
          where: { entityId: id },
          distinct: ['sourceSystem'],
          orderBy: [{ sourceSystem: 'asc' }, { observedAt: 'desc' }, { seq: 'desc' }],
        }),
        this.prisma.sourceRecord.count({ where: { entityId: id } }),
        this.prisma.stateObservation.count({ where: { entityId: id } }),
        this.graph.countNeighbors(id),
        this.prisma.eventEntity.count({ where: { entityId: id } }),
      ]);

    const identifiers = entity.identifiers.map(toIdentifierDto);

    return {
      id: entity.id,
      type: entity.type,
      displayName: entity.displayName,
      attributes: entity.attributes as Record<string, JsonValue>,
      currentState: entity.currentState,
      currentStateObservation:
        currentStateObservation === null ? null : toStateObservationDto(currentStateObservation),
      latestStateBySource: latestStateBySource.map(toStateObservationDto),
      identifiers,
      sourceSystems: [...new Set(identifiers.map((identifier) => identifier.sourceSystem))].sort(),
      lastObservedAt: entity.lastObservedAt.toISOString(),
      createdAt: entity.createdAt.toISOString(),
      counts: {
        sourceRecords,
        stateObservations,
        relationships,
        events,
      },
    };
  }

  async neighbors(id: string, query: NeighborQuery): Promise<NeighborListResponse> {
    await this.assertEntityExists(id);

    const page = await this.graph.findNeighbors({
      entityId: id,
      direction: query.direction,
      relationshipTypes:
        query.relationshipType === undefined ? undefined : [query.relationshipType],
      neighborTypes: query.neighborType === undefined ? undefined : [query.neighborType],
      cursor: query.cursor,
      limit: query.limit,
    });

    return {
      items: page.items.map((row) => ({
        relationship: {
          ...row.relationship,
          observedAt: row.relationship.observedAt.toISOString(),
        },
        neighbor: row.neighbor,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async states(id: string, query: PageQuery): Promise<StateHistoryResponse> {
    await this.assertEntityExists(id);

    const where: Prisma.StateObservationWhereInput = { entityId: id };
    if (query.cursor !== undefined) {
      where.AND = [observationCursorFilter(decodeCursor(ObservationCursorSchema, query.cursor))];
    }

    const rows = await this.prisma.stateObservation.findMany({
      where,
      orderBy: [{ observedAt: 'desc' }, { seq: 'desc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toStateObservationDto),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ observedAt: last.observedAt.toISOString(), seq: last.seq.toString() })
          : null,
    };
  }

  async sourceRecords(id: string, query: PageQuery): Promise<SourceRecordListResponse> {
    await this.assertEntityExists(id);

    const where: Prisma.SourceRecordWhereInput = { entityId: id, kind: 'ENTITY' };
    if (query.cursor !== undefined) {
      where.AND = [sourceRecordCursorFilter(decodeCursor(ObservationCursorSchema, query.cursor))];
    }

    const rows = await this.prisma.sourceRecord.findMany({
      where,
      orderBy: [{ observedAt: 'desc' }, { seq: 'desc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toSourceRecordDto),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ observedAt: last.observedAt.toISOString(), seq: last.seq.toString() })
          : null,
    };
  }

  async listSourceSystems(): Promise<SourceSystemListResponse> {
    const rows = await this.prisma.entityIdentifier.findMany({
      distinct: ['sourceSystem'],
      orderBy: { sourceSystem: 'asc' },
      select: { sourceSystem: true },
    });
    return { items: rows.map((row) => row.sourceSystem) };
  }

  private async assertEntityExists(id: string): Promise<void> {
    const entity = await this.prisma.entity.findUnique({ where: { id }, select: { id: true } });
    if (entity === null) {
      throw Errors.notFound('Entity');
    }
  }
}
