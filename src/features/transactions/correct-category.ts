import { ruleMatches } from '@/features/categorisation/rule-matchers';
import { sourceForRule } from '@/features/categorisation/steps';
import type { Category, CategoryRule } from '@/features/categorisation/types';
import type { Stores, TransactionStore, UnitOfWork } from './ports';

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

// A category by id, or by name ignoring case, so callers can say "groceries".
export function findCategory(categories: Category[], ref: string) {
  const name = ref.trim().toLowerCase();
  return categories.find((c) => c.id === ref) ?? categories.find((c) => c.name.toLowerCase() === name) ?? null;
}

export interface Correction {
  transactionId: string;
  category: Category;
  ruleId: string;
  // Other uncategorised transactions the learned rule fixed.
  appliedTo: number;
}

interface Deps {
  stores: Pick<Stores, 'transactions' | 'categories'>;
  unitOfWork: UnitOfWork;
}

export type CategoryCorrector = ReturnType<typeof createCategoryCorrector>;

// The "categorise this" action. Phase 3's MCP tool calls this; until then a protected route does.
export function createCategoryCorrector({ stores, unitOfWork }: Deps) {
  return {
    // Sets the category by hand, learns an exact rule for the description so future emails match,
    // and applies that rule to past transactions that are still uncategorised.
    async correct({
      userId,
      transactionId,
      categoryId,
    }: {
      userId: string;
      transactionId: string;
      categoryId: string;
    }): Promise<Correction> {
      const tx = await stores.transactions.findById(userId, transactionId);
      if (!tx) throw new NotFoundError(`transaction ${transactionId}`);
      const category = (await stores.categories.listCategories(userId)).find((c) => c.id === categoryId);
      if (!category) throw new NotFoundError(`category ${categoryId}`);

      return unitOfWork(async (s) => {
        await s.transactions.setCategory(userId, tx.id, { categoryId, source: 'manual', ruleId: null });
        const rule = await s.categories.upsertRule(userId, {
          matchType: 'exact',
          pattern: tx.descriptionNormalised,
          categoryId,
          origin: 'learned',
        });
        const appliedTo = await applyRuleRetroactively(s.transactions, userId, rule);
        return { transactionId: tx.id, category, ruleId: rule.id, appliedTo };
      });
    },
  };
}

// Categorises every still-uncategorised transaction the rule matches. Rows categorised any other
// way (manually, or by another rule) are never touched, so a learned rule can't undo a choice.
export async function applyRuleRetroactively(
  store: Pick<TransactionStore, 'listUncategorised' | 'categoriseIfUncategorised'>,
  userId: string,
  rule: CategoryRule,
) {
  const ids = (await store.listUncategorised(userId))
    .filter((t) => ruleMatches(rule, t.descriptionNormalised))
    .map((t) => t.id);
  return store.categoriseIfUncategorised(userId, ids, {
    categoryId: rule.categoryId,
    source: sourceForRule(rule),
    ruleId: rule.id,
  });
}
