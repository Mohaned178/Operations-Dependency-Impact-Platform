import type { ImpactListSelector } from '@opsgraph/shared';
import { describe, expect, it } from 'vitest';
import { classificationLabel, selectorTitle, stepsText, summaryCountFor } from './impact-labels';
import { I1_SUMMARY, RANGE_SUMMARY } from './impact-test-data';

describe('selectorTitle', () => {
  it.each<[ImpactListSelector, string]>([
    [{ list: 'category', type: 'Order', bucket: 'current' }, 'Customer orders — current'],
    [{ list: 'category', type: 'SLA', bucket: 'inferredOnly' }, 'SLA commitments — only inferred'],
    [{ list: 'category', type: 'PurchaseOrder', bucket: 'stateUnknown' }, 'Purchase orders — state unknown'],
    [{ list: 'exposure', currency: 'USD', bucket: 'total' }, 'Exposure in USD — total'],
    [{ list: 'valueUnknown' }, 'Customer orders without a recorded value'],
    [{ list: 'notCounted', type: null }, 'Not counted (completed or cancelled)'],
    [{ list: 'notCounted', type: 'Order' }, 'Not counted (completed or cancelled) — Customer orders'],
  ])('titles %j', (selector, expected) => {
    expect(selectorTitle(selector)).toBe(expected);
  });
});

describe('summaryCountFor', () => {
  it('reads the category cell of the same selector', () => {
    expect(summaryCountFor({ list: 'category', type: 'Order', bucket: 'current' }, I1_SUMMARY)).toBe(6);
    expect(summaryCountFor({ list: 'category', type: 'Product', bucket: 'inferredOnly' }, I1_SUMMARY)).toBe(1);
    expect(summaryCountFor({ list: 'category', type: 'Invoice', bucket: 'total' }, I1_SUMMARY)).toBe(0);
  });

  it('reads the exposure share order counts', () => {
    const count = (bucket: 'total' | 'current' | 'potential' | 'inferredOnly', currency = 'USD') =>
      summaryCountFor({ list: 'exposure', currency, bucket }, I1_SUMMARY);
    expect(count('total')).toBe(12);
    expect(count('current')).toBe(6);
    expect(count('potential')).toBe(6);
    expect(count('inferredOnly')).toBe(1);
    expect(count('total', 'EUR')).toBe(0);
  });

  it('reads the value-unknown and not-counted numbers', () => {
    expect(summaryCountFor({ list: 'valueUnknown' }, RANGE_SUMMARY)).toBe(2);
    expect(summaryCountFor({ list: 'notCounted', type: null }, I1_SUMMARY)).toBe(2);
    expect(summaryCountFor({ list: 'notCounted', type: 'Order' }, I1_SUMMARY)).toBe(1);
    expect(summaryCountFor({ list: 'notCounted', type: 'Shipment' }, I1_SUMMARY)).toBe(0);
  });
});

describe('labels', () => {
  it('words the classifications and steps', () => {
    expect(classificationLabel('CURRENT')).toBe('Current');
    expect(classificationLabel('POTENTIAL')).toBe('Potential');
    expect(classificationLabel('NOT_COUNTED')).toBe('Not counted (completed or cancelled)');
    expect(stepsText(1)).toBe('1 step');
    expect(stepsText(2)).toBe('2 steps');
  });
});
