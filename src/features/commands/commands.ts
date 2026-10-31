import type { BudgetRepo } from '@/features/budget/repo';
import type { BudgetService } from '@/features/budget/service';
import type { Settings } from '@/features/budget/types';
import type { ExpenseType } from '@/features/categorisation/types';
import { categoryTag } from '@/features/notifications/embeds';
import type { ReviewMessages } from '@/features/notifications/review';
import { findCategory, type CategoryCorrector } from '@/features/transactions/correct-category';
import type { Stores } from '@/features/transactions/ports';

// The app's writes, shared by the MCP tools and the dashboard's Server Actions. Each takes the
// authenticated user's id first and never reaches another user's rows. Small and reversible: no
// hard deletes. Inputs are already parsed (cents, ids or names); callers turn a CommandError into
// their own error shape.

// A learned rule touching more rows than this needs confirming first, so one mistaken (or injected)
// call can't recategorise a large part of the ledger.
export const BULK_CONFIRM_THRESHOLD = 25;

export type CommandErrorCode =
  | 'unknown_category'
  | 'unknown_transaction'
  | 'excluded'
  | 'already_categorised'
  | 'not_expense'
  | 'income_budget'
  | 'nothing_to_change'
  | 'zero_salary';

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface CommandDeps {
  budget: Pick<BudgetService, 'summary'>;
  repo: Pick<
    BudgetRepo,
    | 'findTransaction'
    | 'listCategories'
    | 'createCategory'
    | 'setCategoryEmoji'
    | 'ensureBudgetItems'
    | 'updateBudgetItem'
    | 'listBudgetLines'
    | 'updateSettings'
    | 'getSettings'
    | 'setExcluded'
    | 'setSuggestion'
  >;
  ledger: { stores: Pick<Stores, 'categories'>; corrector: Pick<CategoryCorrector, 'findSimilar' | 'correct'> };
  // #needs-review messages to tick off when their transactions are sorted, or to show a suggestion.
  review: Pick<ReviewMessages, 'resolve' | 'suggest'>;
}

export type Commands = ReturnType<typeof createCommands>;

export function createCommands(deps: CommandDeps) {
  async function category(userId: string, ref: string) {
    const found = findCategory(await deps.ledger.stores.categories.listCategories(userId), ref);
    if (!found) throw new CommandError('unknown_category', `No category "${ref}".`);
    return found;
  }

  async function transaction(userId: string, id: string) {
    const tx = await deps.repo.findTransaction(userId, id);
    if (!tx) throw new CommandError('unknown_transaction', `No transaction ${id}.`);
    return tx;
  }

  async function emojiOf(userId: string, categoryId: string) {
    return (await deps.repo.listCategories(userId)).find((c) => c.id === categoryId)?.emoji ?? null;
  }

  return {
    // Sets the category and learns a rule for the exact description. With applyToSimilar, the rule
    // also fixes past uncategorised transactions with that description; past the threshold that
    // needs confirm, and nothing changes until then.
    async categorise(userId: string, input: { transactionId: string; category: string; applyToSimilar: boolean; confirm: boolean }) {
      const tx = await transaction(userId, input.transactionId);
      if (tx.isDeleted) throw new CommandError('excluded', 'That transaction is excluded. Restore it first.');
      const target = await category(userId, input.category);

      const similar = input.applyToSimilar ? await deps.ledger.corrector.findSimilar(userId, tx.id) : [];
      if (similar.length > BULK_CONFIRM_THRESHOLD && !input.confirm) {
        return { status: 'needs_confirmation' as const, tx, category: target, wouldAlsoChange: similar.length };
      }

      const result = await deps.ledger.corrector.correct({ userId, transactionId: tx.id, categoryId: target.id, applyToSimilar: input.applyToSimilar });
      await deps.review.resolve(userId, [tx.id, ...similar], categoryTag(target.name, await emojiOf(userId, target.id)));
      return { status: 'done' as const, tx, category: target, appliedTo: result.appliedTo, ruleId: result.ruleId };
    },

    // Records a suggested category (null = looked at, not sure) and shows it on #needs-review with
    // an Accept button. Never categorises: the user decides. With applyToSimilar, the other
    // uncategorised transactions with the same description get it too. Either way they count as
    // looked at, so the next pass skips them.
    async suggest(userId: string, input: { transactionId: string; category: string | null; note: string | null; applyToSimilar: boolean }) {
      const tx = await transaction(userId, input.transactionId);
      if (tx.isDeleted) throw new CommandError('excluded', 'That transaction is excluded. Restore it first.');
      if (tx.categorySource !== 'none') {
        throw new CommandError('already_categorised', `That transaction is already categorised as ${tx.categoryName ?? 'something'}.`);
      }
      const target = input.category === null ? null : await category(userId, input.category);

      const similar = input.applyToSimilar ? await deps.ledger.corrector.findSimilar(userId, tx.id) : [];
      const ids = await deps.repo.setSuggestion(userId, [tx.id, ...similar], { categoryId: target?.id ?? null, note: input.note });
      const categories = await deps.repo.listCategories(userId);
      const shown = target ? (categories.find((c) => c.id === target.id) ?? { ...target, emoji: null }) : null;
      await deps.review.suggest(userId, ids, { category: shown, note: input.note }, categories);
      return { tx, category: target, suggested: ids.length };
    },

    // An expense category gets a budget item at R0, or at allocatedCents.
    async createCategory(
      userId: string,
      input: { name: string; kind: 'expense' | 'income'; expenseType: ExpenseType; allocatedCents?: number; emoji?: string | null },
    ) {
      if (input.kind === 'income' && input.allocatedCents !== undefined) {
        throw new CommandError('income_budget', 'Only expense categories have a budget.');
      }
      const id = await deps.repo.createCategory(userId, { name: input.name, kind: input.kind, expenseType: input.expenseType, emoji: input.emoji });
      await deps.repo.ensureBudgetItems(userId);
      if (input.allocatedCents !== undefined) await deps.repo.updateBudgetItem(userId, id, { allocatedCents: input.allocatedCents });
      return { id };
    },

    // Null clears it back to the default.
    async setCategoryEmoji(userId: string, ref: string, emoji: string | null) {
      const target = await category(userId, ref);
      await deps.repo.setCategoryEmoji(userId, target.id, emoji);
      return target;
    },

    // Only what's passed changes.
    async setBudgetItem(
      userId: string,
      ref: string,
      patch: { allocatedCents?: number; expenseType?: ExpenseType; expectedDay?: number | null; isActive?: boolean },
    ) {
      if (Object.values(patch).every((v) => v === undefined)) {
        throw new CommandError('nothing_to_change', 'Nothing to change.');
      }
      const target = await category(userId, ref);
      if (target.kind !== 'expense') {
        throw new CommandError('not_expense', `${target.name} is a ${target.kind} category; only expense categories have a budget.`);
      }
      await deps.repo.ensureBudgetItems(userId);
      await deps.repo.updateBudgetItem(userId, target.id, patch);
      return (await deps.repo.listBudgetLines(userId)).find((l) => l.categoryId === target.id)!;
    },

    async setSalaryConfig(userId: string, patch: Pick<Partial<Settings>, 'salaryDayHint' | 'expectedSalaryCents' | 'salaryTolerancePct'>) {
      // Zero would make every salary credit "outside tolerance" and silently stop cycles opening.
      if (patch.expectedSalaryCents === 0) {
        throw new CommandError('zero_salary', 'The expected salary must be more than R0.');
      }
      await deps.repo.updateSettings(userId, patch);
      const [settings, { cycle }] = await Promise.all([deps.repo.getSettings(userId), deps.budget.summary(userId)]);
      return { settings, cycle };
    },

    async setNotificationSettings(userId: string, patch: Pick<Partial<Settings>, 'digestEnabled' | 'digestHour' | 'discordAlertsEnabled'>) {
      await deps.repo.updateSettings(userId, patch);
      return deps.repo.getSettings(userId);
    },

    // A soft delete: the transaction leaves every total until it's restored.
    async exclude(userId: string, transactionId: string) {
      const tx = await transaction(userId, transactionId);
      await deps.repo.setExcluded(userId, tx.id, true);
      await deps.review.resolve(userId, [tx.id], '🗑️ excluded');
      return tx;
    },

    async restore(userId: string, transactionId: string) {
      const tx = await transaction(userId, transactionId);
      await deps.repo.setExcluded(userId, tx.id, false);
      return tx;
    },
  };
}
