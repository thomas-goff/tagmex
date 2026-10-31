import type { CategoryRule, RuleDirection, RuleMatchType } from './types';

type Matcher = (pattern: string, description: string) => boolean;

// Words only: "DIS-CHEM*123" → ["DIS", "CHEM", "123"].
export function tokenise(s: string) {
  return s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

function canonical(s: string) {
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

// True when `needle` appears in `haystack` as a contiguous run of whole tokens.
function containsTokens(haystack: string[], needle: string[]) {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((t, j) => haystack[i + j] === t)) return true;
  }
  return false;
}

// A Record, so adding a match type without its matcher is a compile error.
const MATCHERS: Record<RuleMatchType, Matcher> = {
  exact: (pattern, description) => canonical(pattern) !== '' && canonical(pattern) === canonical(description),
  // Whole words, never substrings: "BP" must not match "BPA", nor "SHELL" match "SHELLEY".
  token: (pattern, description) => containsTokens(tokenise(description), tokenise(pattern)),
};

export function ruleMatches(rule: Pick<CategoryRule, 'matchType' | 'pattern'>, description: string) {
  return MATCHERS[rule.matchType](rule.pattern, description);
}

// The direction a rule learned from this amount gets. Zero moves nothing, so its rule matches either.
export function directionOf(amountCents: number): RuleDirection | null {
  if (amountCents === 0) return null;
  return amountCents < 0 ? 'out' : 'in';
}

// The description matches and the money moves the rule's way (a direction-less rule allows either).
export function ruleApplies(
  rule: Pick<CategoryRule, 'matchType' | 'pattern' | 'direction'>,
  tx: { descriptionNormalised: string; amountCents: number },
) {
  return (rule.direction === null || rule.direction === directionOf(tx.amountCents)) && ruleMatches(rule, tx.descriptionNormalised);
}

// How specific a pattern is, for picking between several matching rules: more words, then longer.
export function specificity(rule: Pick<CategoryRule, 'pattern'>) {
  return tokenise(rule.pattern).length * 1000 + rule.pattern.length;
}
