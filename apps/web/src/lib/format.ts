export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatMoney(amount: string, currency: string): string {
  const [integerPart = '0', fractionPart = ''] = amount.split('.');
  const fraction = (fractionPart + '00').slice(0, Math.max(2, fractionPart.length));
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}.${fraction} ${currency}`;
}
