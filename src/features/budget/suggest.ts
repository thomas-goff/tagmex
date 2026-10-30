import { tokenise } from '@/features/categorisation/rule-matchers';

// A guess for an uncategorised description from ones already categorised: the description that
// shares the longest run of leading words. "CORNER SHOP - ELSEWHERE" → whatever "CORNER SHOP -
// SUBURB" is. Needs two shared words, or one word of 5+ letters, so "BP X" doesn't borrow from
// "BP Y". Generic bank prefixes ("ABSA BANK …") can still mislead, so this is only ever offered as
// a suggestion for the user to confirm, never applied.

export interface KnownDescription {
  descriptionNormalised: string;
  categoryId: string;
}

export interface Suggestion {
  categoryId: string;
  // The categorised description it was borrowed from.
  basedOn: string;
  sharedWords: number;
}

export function suggestCategory(description: string, known: readonly KnownDescription[]): Suggestion | null {
  const words = tokenise(description);
  let best: Suggestion | null = null;
  for (const k of known) {
    const other = tokenise(k.descriptionNormalised);
    let shared = 0;
    while (shared < words.length && shared < other.length && words[shared] === other[shared]) shared++;
    const enough = shared >= 2 || (shared === 1 && words[0]!.length >= 5);
    if (enough && (!best || shared > best.sharedWords)) {
      best = { categoryId: k.categoryId, basedOn: k.descriptionNormalised, sharedWords: shared };
    }
  }
  return best;
}
