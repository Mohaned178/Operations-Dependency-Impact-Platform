import type { BlockingPathDto, TracedEntityDto } from '@opsgraph/shared';
import { Fragment } from 'react';
import { Link } from 'react-router';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Display name → entity id for the start entity and every hop entity. A name shared by two
 * different entities is left out, because a link to either one could be wrong.
 */
export function linkTargets(start: TracedEntityDto, path: BlockingPathDto): Map<string, string> {
  const targets = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entity of [start, ...path.hops.map((hop) => hop.entity)]) {
    const known = targets.get(entity.displayName);
    if (known !== undefined && known !== entity.id) {
      ambiguous.add(entity.displayName);
    }
    targets.set(entity.displayName, entity.id);
  }
  for (const name of ambiguous) {
    targets.delete(name);
  }
  return targets;
}

export interface ExplanationSentenceProps {
  sentence: string;
  targets: ReadonlyMap<string, string>;
}

/** Spec FR-029: every entity named in an explanation links to its Entity 360 page. */
export function ExplanationSentence({ sentence, targets }: ExplanationSentenceProps) {
  const names = [...targets.keys()].filter((name) => name !== '');
  if (names.length === 0) {
    return <>{sentence}</>;
  }
  // Longest first, so "Budget code for Order #18492" wins over "Order #18492".
  const pattern = new RegExp(
    `(${names
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|')})`,
  );
  const parts = sentence.split(pattern);

  return (
    <>
      {parts.map((part, index) => {
        const id = index % 2 === 1 ? targets.get(part) : undefined;
        return id === undefined ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <Link key={index} to={`/entities/${id}`} className="underline">
            {part}
          </Link>
        );
      })}
    </>
  );
}
