import { DEFAULT_CATEGORIES, DEFAULT_MERCHANT_RULES } from '@/features/categorisation/defaults';
import { applyRulesToUncategorised } from './apply-rules';
import type { Stores } from './ports';

// Gives a user the starter categories and merchant rules, then runs the rules over transactions
// still uncategorised so newly added seeds fix past rows too. Safe to re-run: only missing rows are
// added. A renamed default comes back under its old name, so rename by editing defaults.ts too.
export async function seedDefaults(stores: Pick<Stores, 'categories' | 'transactions'>, userId: string) {
  const addedCategories = await stores.categories.insertCategoriesIfMissing(
    userId,
    DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })),
  );

  const idByName = new Map((await stores.categories.listCategories(userId)).map((c) => [c.name, c.id]));
  const addedRules = await stores.categories.insertRulesIfMissing(
    userId,
    DEFAULT_MERCHANT_RULES.flatMap(({ pattern, category }) => {
      const categoryId = idByName.get(category);
      return categoryId ? [{ matchType: 'token' as const, pattern, categoryId, origin: 'seed' as const, direction: null }] : [];
    }),
  );

  const categorisedExisting = await applyRulesToUncategorised(stores, userId);
  return { addedCategories, addedRules, categorisedExisting };
}
