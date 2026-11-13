// Budget data access, in three parts by what they own: the settings row, categories with their
// budget items and rules, and the budget's view of the ledger. Consumers name the methods they
// need (Pick<BudgetRepo, …>), so none depends on the whole.
import type { Database } from '@/db/client';
import { createCategoryRepo } from './category-repo';
import { createSettingsRepo } from './settings-repo';
import { createTransactionRepo } from './transaction-repo';

export { ConflictError, type CategoryInfo, type MergeResult, type RuleInfo } from './category-repo';
export { escapeLike, type TransactionCursor, type TransactionFilter, type TransactionView } from './transaction-repo';

export type BudgetRepo = ReturnType<typeof createBudgetRepo>;

export function createBudgetRepo(db: Database) {
  return { ...createSettingsRepo(db), ...createCategoryRepo(db), ...createTransactionRepo(db) };
}
