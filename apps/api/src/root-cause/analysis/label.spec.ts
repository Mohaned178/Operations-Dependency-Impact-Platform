import { OperationalStateSchema, type OperationalState } from '@opsgraph/shared';
import { traced } from '../../../test/root-cause-builders';
import { humanize, rootCauseLabel, stateWords } from './label';

describe('rootCauseLabel (research R5)', () => {
  it('uses the required field and the state words: Budget Code Missing', () => {
    const budget = traced('Budget code for Order #18492', 'MISSING', { type: 'BudgetRequirement' });
    expect(rootCauseLabel(budget, { requiredField: 'budgetCode' })).toEqual({
      label: 'Budget Code Missing',
      labelRule: 'REQUIRED_FIELD',
    });
  });

  it.each([
    ['empty string', ''],
    ['number', 42],
    ['null', null],
    ['object', { name: 'budgetCode' }],
  ])('falls back to the display name when requiredField is a %s', (_name, requiredField) => {
    const payment = traced('Payment PAY-88213', 'PENDING', { type: 'Payment' });
    expect(rootCauseLabel(payment, { requiredField })).toEqual({
      label: 'Payment PAY-88213 Pending',
      labelRule: 'DISPLAY_NAME_STATE',
    });
  });

  it('falls back to the display name when the entity has no attributes or no requiredField', () => {
    const approval = traced('Finance approval APR-2291', 'AT_RISK', { type: 'Approval' });
    const expected = { label: 'Finance approval APR-2291 At Risk', labelRule: 'DISPLAY_NAME_STATE' };
    expect(rootCauseLabel(approval, undefined)).toEqual(expected);
    expect(rootCauseLabel(approval, {})).toEqual(expected);
  });
});

describe('humanize', () => {
  it.each([
    ['budgetCode', 'Budget Code'],
    ['cost_center', 'Cost Center'],
    ['po-number', 'Po Number'],
    ['x', 'X'],
    ['approvalChainOwner', 'Approval Chain Owner'],
    ['__leading_and--double__', 'Leading And Double'],
  ])('turns %s into %s', (field, expected) => {
    expect(humanize(field)).toBe(expected);
  });
});

describe('stateWords', () => {
  const expected: Record<OperationalState, string> = {
    ACTIVE: 'Active',
    PENDING: 'Pending',
    WAITING: 'Waiting',
    BLOCKED: 'Blocked',
    MISSING: 'Missing',
    DELAYED: 'Delayed',
    AT_RISK: 'At Risk',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    SUSPENDED: 'Suspended',
    UNKNOWN: 'Unknown',
  };

  it('covers all 12 states', () => {
    expect(Object.keys(expected).sort()).toEqual([...OperationalStateSchema.options].sort());
    expect(OperationalStateSchema.options).toHaveLength(12);
  });

  it.each(Object.entries(expected))('turns %s into %s', (state, words) => {
    expect(stateWords(OperationalStateSchema.parse(state))).toBe(words);
  });
});
