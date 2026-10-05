import { describe, expect, it } from 'vitest';
import { formatMoney, formatTimestamp } from './format';

describe('formatMoney', () => {
  it('groups digits and pads to two decimals', () => {
    expect(formatMoney('12480.00', 'USD')).toBe('12,480.00 USD');
  });

  it('pads an integer amount to two decimals', () => {
    expect(formatMoney('5', 'USD')).toBe('5.00 USD');
  });

  it('keeps four-decimal amounts', () => {
    expect(formatMoney('1.2345', 'EUR')).toBe('1.2345 EUR');
  });

  it('does not round a huge amount', () => {
    expect(formatMoney('9999999999999.99', 'USD')).toBe('9,999,999,999,999.99 USD');
  });

  it('handles zero and one-decimal amounts', () => {
    expect(formatMoney('0', 'USD')).toBe('0.00 USD');
    expect(formatMoney('12480.5', 'USD')).toBe('12,480.50 USD');
  });
});

describe('formatTimestamp', () => {
  it('renders a readable date and time', () => {
    const formatted = formatTimestamp('2026-09-29T11:40:00.000Z');
    expect(formatted).toContain('2026');
    expect(formatted).toContain('40');
    expect(formatted).not.toBe('2026-09-29T11:40:00.000Z');
  });
});
