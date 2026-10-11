import { Injectable } from '@nestjs/common';
import type {
  BlockerDto,
  BlockersResponse,
  EntityEvidenceDto,
  RelationshipEvidenceDto,
  RootCauseCandidateDto,
  RootCauseQuery,
  RootCauseResponse,
  TracedEntityDto,
} from '@opsgraph/shared';
import { compareCodeUnits } from '../graph/traversal/path-order';
import { explainBlockingPath } from '../tracing/explanation';
import { TracingService } from '../tracing/tracing.service';
import { groupCandidates, orderCandidates } from './analysis/candidates';
import { computeConfidence } from './analysis/confidence';
import { evidenceSentence, headline, summarizeRootCause } from './analysis/explanation';
import { eventCount, keyEvidence } from './analysis/key-evidence';
import { rootCauseLabel } from './analysis/label';
import { toCausalChain } from './analysis/roles';
import type { CandidateGroup } from './analysis/types';
import { EvidenceReader, type EvidenceBundle } from './evidence.reader';

/** A candidate before ordering: the headline needs the final candidate count. */
interface CandidateDraft {
  confidence: RootCauseCandidateDto['confidence'];
  /** Index of the primary chain in the blockers `paths`: the tie-break when ordering. */
  primaryIndex: number;
  evidenceSentence: string;
  fields: Omit<RootCauseCandidateDto, 'explanation'>;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`root-cause invariant: ${what}`);
  }
  return value;
}

@Injectable()
export class RootCauseService {
  constructor(
    private readonly tracing: TracingService,
    private readonly evidenceReader: EvidenceReader,
  ) {}

  async analyze(id: string, query: RootCauseQuery): Promise<RootCauseResponse> {
    const computedAt = new Date();
    const evaluatedAt = query.evaluatedAt === undefined ? computedAt : new Date(query.evaluatedAt);

    const blockers = await this.tracing.blockers(id, {
      depth: query.depth,
      relationshipTypes: [],
      entityTypes: [],
    });
    const { start } = blockers;

    const header = {
      query: { entityId: id, depth: query.depth, evaluatedAt: evaluatedAt.toISOString() },
      computedAt: computedAt.toISOString(),
      start,
      truncation: blockers.truncation,
    };

    if (blockers.paths.length === 0) {
      if (start.state.classification === 'SATISFIED') {
        return {
          ...header,
          status: 'NOT_BLOCKED',
          summary: summarizeRootCause(start, 'NOT_BLOCKED', [], query.depth),
          candidates: [],
          evidence: { entities: [], relationships: [] },
        };
      }
      const bundle = await this.evidenceReader.load({
        entityIds: [start.id],
        relationshipIds: [],
        rootCauseEntityIds: [],
      });
      return {
        ...header,
        status: 'UNEXPLAINED',
        summary: summarizeRootCause(start, 'UNEXPLAINED', [], query.depth),
        candidates: [],
        evidence: {
          entities: [required(bundle.entities.get(start.id), `no evidence for ${start.id}`)],
          relationships: [],
        },
      };
    }

    const groups = groupCandidates(blockers.paths);
    const bundle = await this.evidenceReader.load({
      entityIds: [
        ...new Set([start.id, ...blockers.paths.flatMap((path) => path.hops.map((hop) => hop.entity.id))]),
      ],
      relationshipIds: [
        ...new Set(
          blockers.paths.flatMap((path) =>
            path.hops.flatMap((hop) => hop.assertions.map((assertion) => assertion.relationshipId)),
          ),
        ),
      ],
      rootCauseEntityIds: groups.map((group) => group.deepestEntityId),
    });

    const drafts = groups.map((group) =>
      this.draftCandidate(group, blockers, bundle, query.depth, evaluatedAt),
    );
    const ordered = orderCandidates(drafts);
    const candidates: RootCauseCandidateDto[] = ordered.map(({ fields, evidenceSentence: evidence }) => ({
      ...fields,
      explanation: {
        headline: headline(fields, ordered.length, query.depth),
        chain: fields.primaryChain.sentences,
        confidence: fields.confidenceRules.filter((rule) => rule.applied).map((rule) => rule.reason),
        evidence,
      },
    }));

    return {
      ...header,
      status: 'ROOT_CAUSES_FOUND',
      summary: summarizeRootCause(start, 'ROOT_CAUSES_FOUND', candidates, query.depth),
      candidates,
      evidence: assembleEvidence(start, candidates, bundle),
    };
  }

  private draftCandidate(
    group: CandidateGroup,
    blockers: BlockersResponse,
    bundle: EvidenceBundle,
    depth: number,
    evaluatedAt: Date,
  ): CandidateDraft {
    const { start } = blockers;
    const deepest: BlockerDto = required(
      blockers.deepestBlockers.find((blocker) => blocker.entity.id === group.deepestEntityId),
      `no deepest blocker for ${group.deepestEntityId}`,
    );
    const rootCause: TracedEntityDto = required(
      group.primary.hops.at(-1)?.entity,
      'a primary chain has hops',
    );

    const { label, labelRule } = rootCauseLabel(rootCause, bundle.attributes.get(rootCause.id));
    const { confidence, outcomes } = computeConfidence({
      chain: group.primary,
      start,
      deepest,
      truncation: blockers.truncation,
      depth,
      evaluatedAt,
      entityEvidence: bundle.entities,
      relationshipEvidence: bundle.relationships,
    });

    const hedged = confidence === 'LOW';
    const chainOf = (path: CandidateGroup['primary']) =>
      toCausalChain(
        start,
        path,
        hedged ? explainBlockingPath(start, path, 'HEDGED') : path.explanation,
      );
    const primaryChain = chainOf(group.primary);
    const key = keyEvidence(primaryChain, bundle.entities);
    const events = eventCount(primaryChain, bundle.entities);

    return {
      confidence,
      primaryIndex: group.primaryIndex,
      evidenceSentence: evidenceSentence(key, events),
      fields: {
        rootCause,
        label,
        labelRule,
        possible: deepest.possible,
        inCycle: deepest.inCycle,
        continuesBeyondDepth: deepest.continuesBeyondDepth,
        insufficientEvidence: hedged,
        confidence,
        confidenceRules: outcomes,
        primaryChain,
        alternativeChains: group.alternatives.map(chainOf),
        keyEvidence: key,
        eventCount: events,
      },
    };
  }
}

/** Data-model §4.6: the start, then each candidate's primary then alternative chains, hop by hop. */
function assembleEvidence(
  start: TracedEntityDto,
  candidates: readonly RootCauseCandidateDto[],
  bundle: EvidenceBundle,
): RootCauseResponse['evidence'] {
  const entityIds = new Set<string>([start.id]);
  const relationshipIds = new Set<string>();

  for (const candidate of candidates) {
    for (const chain of [candidate.primaryChain, ...candidate.alternativeChains]) {
      for (const step of chain.steps) {
        entityIds.add(step.entity.id);
        const assertionIds = (step.hop?.assertions ?? [])
          .map((assertion) => assertion.relationshipId)
          .sort(compareCodeUnits);
        for (const assertionId of assertionIds) {
          relationshipIds.add(assertionId);
        }
      }
    }
  }

  const entities: EntityEvidenceDto[] = [...entityIds].map((entityId) =>
    required(bundle.entities.get(entityId), `no evidence for entity ${entityId}`),
  );
  const relationships: RelationshipEvidenceDto[] = [...relationshipIds].map((relationshipId) =>
    required(bundle.relationships.get(relationshipId), `no evidence for relationship ${relationshipId}`),
  );
  return { entities, relationships };
}
