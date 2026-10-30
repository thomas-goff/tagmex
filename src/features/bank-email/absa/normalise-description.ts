// Derived from real NotifyMe references, which mix the payee with bank reference numbers:
//   "TELCO 0123456789 X1234567" → "TELCO"
//   "EFTAB12C34D5E678/SALARY"   → "SALARY"
//   "SOME SHOP - SUBURB"        stays as is
export function normaliseDescription(raw: string) {
  let s = raw.toUpperCase().replace(/\s+/g, ' ').trim();

  // "<reference>/<description>" from EFTs: keep the description.
  const slash = /^\S*\/([A-Z][^/]*)$/.exec(s);
  if (slash) s = slash[1]!;

  s = s
    .split(' ')
    .filter((token) => (token.match(/\d/g) ?? []).length < 4) // account and reference numbers
    .join(' ')
    .replace(/^[\s,:;/-]+|[\s,:;/-]+$/g, '');

  return s || raw.trim();
}
