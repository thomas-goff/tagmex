import { ruleApplies, specificity } from './rule-matchers';
import type {
  CategorisableTransaction,
  CategorisationStep,
  CategoryRule,
  CategorySource,
  RuleMatchType,
  RuleOrigin,
  TransferCandidate,
} from './types';

// A transfer's two legs can post a few days apart (weekends, interbank clearing).
export const TRANSFER_WINDOW_DAYS = 3;

const ORIGIN_RANK: Record<RuleOrigin, number> = { learned: 0, seed: 1 };

// What a transaction categorised by `rule` records as its category_source.
export function sourceForRule(rule: Pick<CategoryRule, 'matchType'>): CategorySource {
  return rule.matchType === 'exact' ? 'user_rule' : 'merchant_rule';
}

// The best rule of one match type: learned over seed, then one for this direction over a
// direction-less one, then the most specific pattern.
export function bestMatchingRule(
  rules: CategoryRule[],
  matchType: RuleMatchType,
  tx: Pick<CategorisableTransaction, 'descriptionNormalised' | 'amountCents'>,
) {
  let best: CategoryRule | null = null;
  for (const rule of rules) {
    if (rule.matchType !== matchType || !ruleApplies(rule, tx)) continue;
    if (!best || outranks(rule, best)) best = rule;
  }
  return best;
}

function outranks(a: CategoryRule, b: CategoryRule) {
  if (ORIGIN_RANK[a.origin] !== ORIGIN_RANK[b.origin]) return ORIGIN_RANK[a.origin] < ORIGIN_RANK[b.origin];
  if ((a.direction === null) !== (b.direction === null)) return a.direction !== null;
  return specificity(a) > specificity(b);
}

function ruleStep(matchType: RuleMatchType): CategorisationStep {
  return (tx, { rules }) => {
    const rule = bestMatchingRule(rules, matchType, tx);
    return rule && { categoryId: rule.categoryId, source: sourceForRule(rule), ruleId: rule.id };
  };
}

// 1. The user's own corrections: the whole normalised description.
export const userRuleStep = ruleStep('exact');

// 2. Merchant names (seeded or learned) as whole words.
export const merchantRuleStep = ruleStep('token');

// 3. Money leaving one account and the same amount arriving in another within a few days.
export const transferStep: CategorisationStep = (tx, { transferCategoryId, transferCandidates }) => {
  if (!transferCategoryId) return null;
  const counterpart = findTransferCounterpart(tx, transferCandidates);
  return counterpart && { categoryId: transferCategoryId, source: 'transfer', ruleId: null, counterpartId: counterpart.id };
};

// The opposite leg: a different account, the exact opposite amount, within the window. The
// closest date wins; ties go to the earliest candidate given.
export function findTransferCounterpart(
  tx: Omit<CategorisableTransaction, 'descriptionNormalised'>,
  candidates: TransferCandidate[],
  windowDays = TRANSFER_WINDOW_DAYS,
) {
  if (tx.amountCents === 0) return null;
  let best: { candidate: TransferCandidate; days: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.accountLast4 === tx.accountLast4 || candidate.amountCents !== -tx.amountCents) continue;
    const days = Math.abs(daysBetween(candidate.occurredOn, tx.occurredOn));
    if (days <= windowDays && (!best || days < best.days)) best = { candidate, days };
  }
  return best?.candidate ?? null;
}

function daysBetween(a: string, b: string) {
  return (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}
