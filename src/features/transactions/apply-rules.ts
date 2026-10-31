import { bestMatchingRule, sourceForRule } from '@/features/categorisation/steps';
import type { CategoryRule } from '@/features/categorisation/types';
import type { Stores } from './ports';

// Runs the user's current rules over every still-uncategorised transaction, e.g. after new seed
// rules are added. Same order as categorise: exact (learned) rules, then the best token rule.
// Transfer detection is left out: recording already looked for the other leg.
export async function applyRulesToUncategorised(stores: Pick<Stores, 'transactions' | 'categories'>, userId: string) {
  const [rules, rows] = await Promise.all([
    stores.categories.listRules(userId),
    stores.transactions.listUncategorised(userId),
  ]);

  const matches = new Map<string, { rule: CategoryRule; ids: string[] }>();
  for (const tx of rows) {
    const rule = bestMatchingRule(rules, 'exact', tx) ?? bestMatchingRule(rules, 'token', tx);
    if (!rule) continue;
    const match = matches.get(rule.id) ?? { rule, ids: [] };
    match.ids.push(tx.id);
    matches.set(rule.id, match);
  }

  let categorised = 0;
  for (const { rule, ids } of matches.values()) {
    categorised += await stores.transactions.categoriseIfUncategorised(userId, ids, {
      categoryId: rule.categoryId,
      source: sourceForRule(rule),
      ruleId: rule.id,
    });
  }
  return categorised;
}
