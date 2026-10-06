import { Injectable } from '@nestjs/common';
import type { OperationalState, StateObservationDto } from '@opsgraph/shared';
import { compareCodeUnits } from '../graph/traversal/path-order';
import { PrismaService } from '../prisma/prisma.service';

export interface EntityStateEvidence {
  /** Latest observation by (observed_at, seq), or null when the entity has none. */
  observation: StateObservationDto | null;
  /** One observation per source system. Empty unless the sources disagree on the state. */
  latestBySource: StateObservationDto[];
}

interface RawObservationRow {
  id: string;
  entity_id: string;
  state: OperationalState;
  source_status: string | null;
  source_system: string;
  source_id: string;
  observed_at: Date;
  received_at: Date;
  import_id: string;
}

function toDto(row: RawObservationRow): StateObservationDto {
  return {
    id: row.id,
    state: row.state,
    sourceStatus: row.source_status,
    sourceSystem: row.source_system,
    sourceId: row.source_id,
    observedAt: row.observed_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
    importId: row.import_id,
  };
}

/**
 * Reads state_observations only, so it is evidence loading and not graph traversal
 * (data-model §3). Call it only for the entities that appear in the response.
 */
@Injectable()
export class StateEvidenceReader {
  constructor(private readonly prisma: PrismaService) {}

  async load(entityIds: readonly string[]): Promise<Map<string, EntityStateEvidence>> {
    const evidence = new Map<string, EntityStateEvidence>();
    if (entityIds.length === 0) {
      return evidence;
    }

    const ids = [...entityIds];
    const [current, perSource] = await Promise.all([
      this.prisma.$queryRaw<RawObservationRow[]>`
        SELECT DISTINCT ON (entity_id)
               id::text AS id, entity_id::text AS entity_id, state::text AS state, source_status,
               source_system, source_id, observed_at, received_at, import_id::text AS import_id
        FROM state_observations
        WHERE entity_id = ANY(${ids}::uuid[])
        ORDER BY entity_id, observed_at DESC, seq DESC`,
      this.prisma.$queryRaw<RawObservationRow[]>`
        SELECT DISTINCT ON (entity_id, source_system)
               id::text AS id, entity_id::text AS entity_id, state::text AS state, source_status,
               source_system, source_id, observed_at, received_at, import_id::text AS import_id
        FROM state_observations
        WHERE entity_id = ANY(${ids}::uuid[])
        ORDER BY entity_id, source_system, observed_at DESC, seq DESC`,
    ]);

    for (const id of ids) {
      evidence.set(id, { observation: null, latestBySource: [] });
    }

    for (const row of current) {
      evidence.set(row.entity_id, { observation: toDto(row), latestBySource: [] });
    }

    const bySource = new Map<string, StateObservationDto[]>();
    for (const row of perSource) {
      const group = bySource.get(row.entity_id);
      if (group === undefined) {
        bySource.set(row.entity_id, [toDto(row)]);
      } else {
        group.push(toDto(row));
      }
    }

    for (const [entityId, observations] of bySource) {
      const entry = evidence.get(entityId);
      if (entry === undefined) {
        continue;
      }
      const distinctStates = new Set(observations.map((observation) => observation.state));
      if (distinctStates.size >= 2) {
        entry.latestBySource = observations.sort((a, b) =>
          compareCodeUnits(a.sourceSystem, b.sourceSystem),
        );
      }
    }

    return evidence;
  }
}
