import { compareUnits, formatAmount, formatMoneyText, parseAmount } from './money';

describe('parseAmount', () => {
  it('scales to units of 10^-4', () => {
    expect(parseAmount('12480.00')).toBe(124800000n);
    expect(parseAmount('0.0001')).toBe(1n);
    expect(parseAmount('0')).toBe(0n);
    expect(parseAmount('7')).toBe(70000n);
  });

  it('rejects anything that is not a valid amount', () => {
    expect(() => parseAmount('1e3')).toThrow();
    expect(() => parseAmount('-1')).toThrow();
    expect(() => parseAmount('1.23456')).toThrow();
  });
});

describe('formatAmount', () => {
  it('keeps at least 2 decimals and trims zeros beyond them', () => {
    expect(formatAmount(124800000n)).toBe('12480.00');
    expect(formatAmount(123450n)).toBe('12.345');
    expect(formatAmount(0n)).toBe('0.00');
    expect(formatAmount(1n)).toBe('0.0001');
  });

  it('round-trips parseAmount', () => {
    for (const amount of ['0.00', '12480.00', '12.345', '0.0001', '9999999999999.9999']) {
      expect(formatAmount(parseAmount(amount))).toBe(amount);
    }
  });
});

describe('formatMoneyText', () => {
  it('groups digits with commas and appends the currency', () => {
    expect(formatMoneyText(840000000n, 'USD')).toBe('84,000.00 USD');
    expect(formatMoneyText(8750000n, 'USD')).toBe('875.00 USD');
    expect(formatMoneyText(0n, 'EUR')).toBe('0.00 EUR');
  });

  it('groups a 13-digit amount', () => {
    expect(formatMoneyText(parseAmount('1234567890123.45'), 'USD')).toBe(
      '1,234,567,890,123.45 USD',
    );
  });
});

describe('compareUnits', () => {
  it('orders bigint amounts', () => {
    expect(compareUnits(1n, 2n)).toBe(-1);
    expect(compareUnits(2n, 1n)).toBe(1);
    expect(compareUnits(2n, 2n)).toBe(0);
  });
});
