import type {
  CausalChainDto,
  EntityEvidenceDto,
  EntityRefDto,
  KeyEvidenceItemDto,
  StateRecordEvidenceDto,
} from '@opsgraph/shared';

/** Contracts/api.md § Key evidence. */

function evidenceOf(
  entityEvidence: ReadonlyMap<string, EntityEvidenceDto>,
  entityId: string,
): EntityEvidenceDto {
  const found = entityEvidence.get(entityId);
  if (found === undefined) {
    throw new Error(`key-evidence: no evidence for entity ${entityId}`);
  }
  return found;
}

function recordFields(
  record: StateRecordEvidenceDto,
): Pick<KeyEvidenceItemDto, 'sourceRecordId' | 'sourceSystem' | 'sourceId' | 'observedAt'> {
  return {
    sourceRecordId: record.sourceRecord.id,
    sourceSystem: record.sourceRecord.sourceSystem,
    sourceId: record.sourceRecord.sourceId,
    observedAt: record.sourceRecord.observedAt,
  };
}

/**
 * For each step in chain order: its state records, then the state records of its requirement
 * sources. De-duplicated by source record id (first occurrence wins); requirement sources
 * without a state record are skipped.
 */
export function keyEvidence(
  chain: CausalChainDto,
  entityEvidence: ReadonlyMap<string, EntityEvidenceDto>,
): KeyEvidenceItemDto[] {
  const seen = new Set<string>();
  const items: KeyEvidenceItemDto[] = [];
  const add = (item: KeyEvidenceItemDto): void => {
    if (!seen.has(item.sourceRecordId)) {
      seen.add(item.sourceRecordId);
      items.push(item);
    }
  };

  for (const step of chain.steps) {
    const evidence = evidenceOf(entityEvidence, step.entity.id);
    const stepEntity: EntityRefDto = {
      id: step.entity.id,
      type: step.entity.type,
      displayName: step.entity.displayName,
      currentState: step.entity.currentState,
    };

    for (const record of evidence.stateRecords) {
      add({ rule: 'STATE_RECORD', origin: record.origin, entity: stepEntity, ...recordFields(record) });
    }
    for (const requirement of evidence.requirementSources.items) {
      if (requirement.stateRecord !== null) {
        add({
          rule: 'REQUIREMENT_SOURCE',
          origin: requirement.origin,
          entity: requirement.entity,
          ...recordFields(requirement.stateRecord),
        });
      }
    }
  }
  return items;
}

/** The number of distinct events among the steps' returned events. */
export function eventCount(
  chain: CausalChainDto,
  entityEvidence: ReadonlyMap<string, EntityEvidenceDto>,
): number {
  const ids = new Set<string>();
  for (const step of chain.steps) {
    for (const event of evidenceOf(entityEvidence, step.entity.id).events.items) {
      ids.add(event.id);
    }
  }
  return ids.size;
}
