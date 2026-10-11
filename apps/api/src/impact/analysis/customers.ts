import type { CustomerAttribution } from '../../graph/graph.repository';
import { compareCodeUnits } from '../../graph/traversal/path-order';
import type { Affected } from './types';

interface Attributed {
  attribution: CustomerAttribution;
  attributed: Affected;
}

function compareAttributed(a: Attributed, b: Attributed): number {
  const aCurrent = a.attributed.classification === 'CURRENT' ? 0 : 1;
  const bCurrent = b.attributed.classification === 'CURRENT' ? 0 : 1;
  return (
    aCurrent - bCurrent ||
    compareCodeUnits(a.attributed.entity.type, b.attributed.entity.type) ||
    compareCodeUnits(a.attributed.entity.displayName, b.attributed.entity.displayName) ||
    compareCodeUnits(a.attributed.entity.id, b.attributed.entity.id)
  );
}

/**
 * Spec FR-010, research R5: adds the customers that own a counted order or SLA commitment.
 * Attributions of entities that are not counted (or not in the analysis) and attributions to the
 * start entity are ignored. A customer the walk reached itself keeps its distance and path.
 */
export function mergeCustomers(
  affected: readonly Affected[],
  attributions: readonly CustomerAttribution[],
  startId: string,
): Affected[] {
  const byId = new Map(affected.map((item) => [item.entity.id, item]));

  const byCustomer = new Map<string, Attributed[]>();
  for (const attribution of attributions) {
    const attributed = byId.get(attribution.attributedEntityId);
    if (
      attributed === undefined ||
      attributed.classification === 'NOT_COUNTED' ||
      attribution.customer.id === startId
    ) {
      continue;
    }
    const list = byCustomer.get(attribution.customer.id);
    if (list === undefined) {
      byCustomer.set(attribution.customer.id, [{ attribution, attributed }]);
    } else {
      list.push({ attribution, attributed });
    }
  }

  const merged = affected.map((item): Affected => {
    const group = byCustomer.get(item.entity.id);
    if (group === undefined || item.entity.type !== 'Customer') {
      return item;
    }
    byCustomer.delete(item.entity.id);
    // A reached customer that is itself terminal stays "not counted" and gets no attributions.
    if (item.classification === 'NOT_COUNTED') {
      return item;
    }
    const sorted = [...group].sort(compareAttributed);
    const currentByAttribution = group.some(
      (entry) => entry.attributed.classification === 'CURRENT',
    );
    return {
      ...item,
      classification: currentByAttribution ? 'CURRENT' : item.classification,
      flags: {
        ...item.flags,
        // A customer made current by a live attribution is impacted by the start, not another cause.
        otherCause: currentByAttribution ? false : item.flags.otherCause,
        inferredOnly:
          item.flags.inferredOnly && group.every((entry) => entry.attributed.flags.inferredOnly),
      },
      attributions: sorted.map((entry) => entry.attribution),
    };
  });

  const attributedOnly = [...byCustomer.entries()]
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([, group]): Affected => {
      const sorted = [...group].sort(compareAttributed);
      const customer = sorted[0]?.attribution.customer;
      if (customer === undefined) {
        throw new Error('impact invariant: customer group without attributions');
      }
      return {
        entity: customer,
        classification: group.some((entry) => entry.attributed.classification === 'CURRENT')
          ? 'CURRENT'
          : 'POTENTIAL',
        notCountedReason: null,
        distance: null,
        directness: 'INDIRECT',
        primaryPath: null,
        shortestPath: null,
        flags: {
          stateUnknown: false,
          otherCause: false,
          inferredOnly: group.every((entry) => entry.attributed.flags.inferredOnly),
        },
        attributions: sorted.map((entry) => entry.attribution),
      };
    });

  return [...merged, ...attributedOnly];
}
