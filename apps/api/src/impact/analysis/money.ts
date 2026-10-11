import { AMOUNT_PATTERN } from '@opsgraph/shared';

/** Amounts are bigint units of 10^-4, so no floating point is ever involved (research R6, KDN 5). */
const FRACTION_DIGITS = 4;

export function parseAmount(amount: string): bigint {
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new Error(`invalid amount: ${amount}`);
  }
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole + fraction.padEnd(FRACTION_DIGITS, '0'));
}

/** At least 2 decimals; trailing zeros beyond the second are trimmed. */
export function formatAmount(units: bigint): string {
  if (units < 0n) {
    throw new Error('negative amounts are not supported');
  }
  const scale = 10n ** BigInt(FRACTION_DIGITS);
  const whole = (units / scale).toString();
  let fraction = (units % scale).toString().padStart(FRACTION_DIGITS, '0');
  while (fraction.length > 2 && fraction.endsWith('0')) {
    fraction = fraction.slice(0, -1);
  }
  return `${whole}.${fraction}`;
}

/** "84,000.00 USD": digit groups of three with ",", never a locale API. */
export function formatMoneyText(units: bigint, currency: string): string {
  const [whole = '0', fraction = '00'] = formatAmount(units).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, ',');
  return `${grouped}.${fraction} ${currency}`;
}

export function compareUnits(a: bigint, b: bigint): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}
