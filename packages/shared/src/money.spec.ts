import { describe, expect, it } from 'vitest';
import { AmountStringSchema, CurrencyCodeSchema, MoneyDtoSchema } from './money';

describe('AmountStringSchema', () => {
  it.each(['0', '12480.00', '1.2345'])('accepts %s', (amount) => {
    expect(AmountStringSchema.safeParse(amount).success).toBe(true);
  });

  it.each(['01', '1.23456', '-1', '1e3'])('rejects %s', (amount) => {
    expect(AmountStringSchema.safeParse(amount).success).toBe(false);
  });
});

describe('CurrencyCodeSchema', () => {
  it('accepts an upper-case code and rejects a lower-case one', () => {
    expect(CurrencyCodeSchema.safeParse('USD').success).toBe(true);
    expect(CurrencyCodeSchema.safeParse('usd').success).toBe(false);
  });
});

describe('MoneyDtoSchema', () => {
  it('parses an amount with a currency', () => {
    expect(MoneyDtoSchema.parse({ amount: '12480.00', currency: 'USD' })).toEqual({
      amount: '12480.00',
      currency: 'USD',
    });
  });
});
