// The app works in integer cents; Postgres numeric(12,2) travels as a string. Converting through
// strings (never floats) keeps every cent exact.

export function centsToDecimal(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new Error(`not a whole number of cents: ${cents}`);
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function decimalToCents(value: string) {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`not a money amount: "${value}"`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '0').padEnd(2, '0'));
  return m[1] && cents !== 0 ? -cents : cents;
}
