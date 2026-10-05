import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type {
  EntityType,
  OperationalState,
  PageQuery,
  TimelineItemDto,
  TimelineResponse,
} from '@opsgraph/shared';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';

const TimelineCursorSchema = z.object({
  at: z.string().datetime(),
  kindRank: z.union([z.literal(0), z.literal(1)]),
  id: z.string().uuid(),
});
type TimelineCursor = z.infer<typeof TimelineCursorSchema>;

interface TimelineEventRecord {
  id: string;
  type: string;
  occurredAt: Date;
  observedAt: Date;
  description: string | null;
  sourceSystem: string;
  sourceId: string;
  importId: string;
  entities: ReadonlyArray<{
    entityId: string;
    role: 'SUBJECT' | 'RELATED';
    entity: {
      id: string;
      type: EntityType;
      displayName: string;
      currentState: OperationalState;
    };
  }>;
}

interface TimelineStateRecord {
  id: string;
  state: OperationalState;
  sourceStatus: string | null;
  sourceSystem: string;
  sourceId: string;
  observedAt: Date;
  importId: string;
}

function eventCursorWhere(cursor: TimelineCursor | null): Prisma.EventWhereInput {
  if (cursor === null) {
    return {};
  }
  const at = new Date(cursor.at);
  if (cursor.kindRank === 0) {
    return {
      OR: [{ occurredAt: { gt: at } }, { occurredAt: at, id: { gt: cursor.id } }],
    };
  }
  return { occurredAt: { gt: at } };
}

function stateCursorWhere(cursor: TimelineCursor | null): Prisma.StateObservationWhereInput {
  if (cursor === null) {
    return {};
  }
  const at = new Date(cursor.at);
  if (cursor.kindRank === 1) {
    return {
      OR: [{ observedAt: { gt: at } }, { observedAt: at, id: { gt: cursor.id } }],
    };
  }
  return { observedAt: { gte: at } };
}

function toTimelineEvent(entityId: string, event: TimelineEventRecord): TimelineItemDto {
  const links = [...event.entities].sort((left, right) =>
    left.role === right.role ? 0 : left.role === 'SUBJECT' ? -1 : 1,
  );
  const selfLink = links.find((link) => link.entityId === entityId);

  return {
    kind: 'EVENT',
    id: event.id,
    at: event.occurredAt.toISOString(),
    eventType: event.type,
    description: event.description,
    role: selfLink?.role ?? 'RELATED',
    entities: links.map((link) => ({
      entity: {
        id: link.entity.id,
        type: link.entity.type,
        displayName: link.entity.displayName,
        currentState: link.entity.currentState,
      },
      role: link.role,
    })),
    sourceSystem: event.sourceSystem,
    sourceId: event.sourceId,
    observedAt: event.observedAt.toISOString(),
    importId: event.importId,
  };
}

function toTimelineState(state: TimelineStateRecord): TimelineItemDto {
  return {
    kind: 'STATE',
    id: state.id,
    at: state.observedAt.toISOString(),
    state: state.state,
    sourceStatus: state.sourceStatus,
    sourceSystem: state.sourceSystem,
    sourceId: state.sourceId,
    observedAt: state.observedAt.toISOString(),
    importId: state.importId,
  };
}

export function mergeTimeline(
  entityId: string,
  events: readonly TimelineEventRecord[],
  states: readonly TimelineStateRecord[],
): TimelineItemDto[] {
  const merged: TimelineItemDto[] = [];
  let eventIndex = 0;
  let stateIndex = 0;

  while (eventIndex < events.length || stateIndex < states.length) {
    const event = events[eventIndex];
    const state = states[stateIndex];

    if (
      event !== undefined &&
      (state === undefined || event.occurredAt.getTime() <= state.observedAt.getTime())
    ) {
      merged.push(toTimelineEvent(entityId, event));
      eventIndex += 1;
    } else if (state !== undefined) {
      merged.push(toTimelineState(state));
      stateIndex += 1;
    }
  }

  return merged;
}

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async list(entityId: string, query: PageQuery): Promise<TimelineResponse> {
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (entity === null) {
      throw Errors.notFound('Entity');
    }

    const cursor =
      query.cursor === undefined ? null : decodeCursor(TimelineCursorSchema, query.cursor);
    const take = query.limit + 1;

    const [events, states] = await Promise.all([
      this.prisma.event.findMany({
        where: { entities: { some: { entityId } }, ...eventCursorWhere(cursor) },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        include: { entities: { include: { entity: true } } },
        take,
      }),
      this.prisma.stateObservation.findMany({
        where: { entityId, ...stateCursorWhere(cursor) },
        orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    ]);

    const merged = mergeTimeline(entityId, events, states);
    const page = merged.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page,
      nextCursor:
        merged.length > query.limit && last !== undefined
          ? encodeCursor({
              at: last.at,
              kindRank: last.kind === 'EVENT' ? 0 : 1,
              id: last.id,
            })
          : null,
    };
  }
}
