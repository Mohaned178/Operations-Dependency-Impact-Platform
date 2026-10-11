import { blockingPath, traced } from '../../../test/root-cause-builders';
import { groupCandidates, orderCandidates } from './candidates';

const start = traced('Order #18492', 'BLOCKED');
const middle = traced('Payment PAY-88213', 'PENDING', { type: 'Payment' });
const x = traced('Budget code X', 'MISSING', { type: 'BudgetRequirement' });
const y = traced('Contract Y', 'SUSPENDED', { type: 'Contract' });

describe('groupCandidates (research R3)', () => {
  it('groups paths by deepest entity in first-appearance order, keeping alternatives in order', () => {
    const path0 = blockingPath(start, [{ entity: middle }, { entity: x }]);
    const path1 = blockingPath(start, [{ entity: y }]);
    const path2 = blockingPath(start, [{ entity: x }]);

    const groups = groupCandidates([path0, path1, path2]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      deepestEntityId: x.id,
      primary: path0,
      primaryIndex: 0,
      alternatives: [path2],
    });
    expect(groups[1]).toEqual({
      deepestEntityId: y.id,
      primary: path1,
      primaryIndex: 1,
      alternatives: [],
    });
  });

  it('returns [] for no paths', () => {
    expect(groupCandidates([])).toEqual([]);
  });

  it('refuses a path without hops', () => {
    const broken = { ...blockingPath(start, [{ entity: x }]), hops: [] };
    expect(() => groupCandidates([broken])).toThrow('path without hops');
  });
});

describe('orderCandidates', () => {
  it('puts a HIGH candidate before a MEDIUM one that was found first', () => {
    const medium = { name: 'X', confidence: 'MEDIUM' as const, primaryIndex: 0 };
    const high = { name: 'Y', confidence: 'HIGH' as const, primaryIndex: 1 };
    expect(orderCandidates([medium, high]).map((item) => item.name)).toEqual(['Y', 'X']);
  });

  it('keeps primaryIndex order for equal confidence', () => {
    const items = [
      { name: 'late', confidence: 'MEDIUM' as const, primaryIndex: 5 },
      { name: 'early', confidence: 'MEDIUM' as const, primaryIndex: 1 },
      { name: 'low', confidence: 'LOW' as const, primaryIndex: 0 },
    ];
    expect(orderCandidates(items).map((item) => item.name)).toEqual(['early', 'late', 'low']);
  });

  it('does not mutate its input', () => {
    const items = [
      { confidence: 'LOW' as const, primaryIndex: 0 },
      { confidence: 'HIGH' as const, primaryIndex: 1 },
    ];
    const snapshot = [...items];
    orderCandidates(items);
    expect(items).toEqual(snapshot);
  });

  it('returns [] for no items', () => {
    expect(orderCandidates([])).toEqual([]);
  });
});
