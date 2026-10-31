import { directionOf, ruleApplies } from '@/features/categorisation/rule-matchers';
import { sourceForRule } from '@/features/categorisation/steps';
import type { Category, CategoryRule } from '@/features/categorisation/types';
import type { StoredTransaction, Stores, TransactionStore, UnitOfWork } from './ports';

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

// The "categorise this" action, called by the categorise_transaction MCP tool and the interim route.
export function createCategoryCorrector({ stores, unitOfWork }: Deps) {
  return {
    // The other uncategorised transactions the learned rule would categorise.
    async findSimilar(userId: string, transactionId: string) {
      const tx = await stores.transactions.findById(userId, transactionId);
      if (!tx) throw new NotFoundError(`transaction ${transactionId}`);
      const rule = learnedRuleFor(tx);
      return (await stores.transactions.listUncategorised(userId))
        .filter((t) => t.id !== tx.id && ruleApplies(rule, t))
        .map((t) => t.id);
    },

    // Sets the category by hand and learns an exact rule for the description, in the direction the
    // money moved, so future emails match. With applyToSimilar (the default) the rule also
    // categorises past transactions that are still uncategorised.
    async correct({
      userId,
      transactionId,
      categoryId,
      applyToSimilar = true,
    }: {
      userId: string;
      transactionId: string;
      categoryId: string;
      applyToSimilar?: boolean;
    }): Promise<Correction> {
      const tx = await stores.transactions.findById(userId, transactionId);
      if (!tx) throw new NotFoundError(`transaction ${transactionId}`);
      const category = (await stores.categories.listCategories(userId)).find((c) => c.id === categoryId);
      if (!category) throw new NotFoundError(`category ${categoryId}`);

      return unitOfWork(async (s) => {
        await s.transactions.setCategory(userId, tx.id, { categoryId, source: 'manual', ruleId: null });
        const rule = await s.categories.upsertRule(userId, { ...learnedRuleFor(tx), categoryId, origin: 'learned' });
        const appliedTo = applyToSimilar ? await applyRuleRetroactively(s.transactions, userId, rule) : 0;
        return { transactionId: tx.id, category, ruleId: rule.id, appliedTo };
      });
    },
  };
}

// The rule a correction to `tx` teaches: its exact description, money moving the same way only.
function learnedRuleFor(tx: Pick<StoredTransaction, 'descriptionNormalised' | 'amountCents'>) {
  return { matchType: 'exact' as const, pattern: tx.descriptionNormalised, direction: directionOf(tx.amountCents) };
}

// Categorises every still-uncategorised transaction the rule matches. Rows categorised any other
// way (manually, or by another rule) are never touched, so a learned rule can't undo a choice.
export async function applyRuleRetroactively(
  store: Pick<TransactionStore, 'listUncategorised' | 'categoriseIfUncategorised'>,
  userId: string,
  rule: CategoryRule,
) {
  const ids = (await store.listUncategorised(userId))
    .filter((t) => ruleApplies(rule, t))
    .map((t) => t.id);
  return store.categoriseIfUncategorised(userId, ids, {
    categoryId: rule.categoryId,
    source: sourceForRule(rule),
    ruleId: rule.id,
  });
}
