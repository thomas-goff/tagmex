import {
  accountKey,
  counterpartyKey,
  maskedAccount,
  MIN_COUNTERPARTY_LENGTH,
  resolveAccount,
  type AccountLabelKind,
} from '@/features/accounts/labels';
import type { AccountLabelRepo } from '@/features/accounts/repo';
import type { BudgetRepo, CategoryInfo } from '@/features/budget/repo';
import type { BudgetService } from '@/features/budget/service';
import type { Settings } from '@/features/budget/types';
import type { ExpenseType } from '@/features/categorisation/types';
import { isIsoDate, todayIn } from '@/features/cycle/dates';
import type { ReviewMessages } from '@/features/notifications/review';
import type { StatusPoster } from '@/features/notifications/status-post';
import { findCategory, type CategoryCorrector } from '@/features/transactions/correct-category';
import { normaliseManualDescription, type ManualEntries } from '@/features/transactions/manual-entries';
import { formatRand } from '@/features/transactions/money';
import type { TransactionStore } from '@/features/transactions/ports';

// The app's writes, shared by the MCP tools, the dashboard's Server Actions and the Discord
// buttons. Each takes the authenticated user's id first and never reaches another user's rows.
// Small and reversible: transactions are never hard-deleted. Inputs are already parsed (cents, ids
// or names); callers turn a CommandError into their own error shape.

// A change touching more rows than this needs confirming first, so one mistaken (or injected)
// call can't recategorise a large part of the ledger.
export const BULK_CONFIRM_THRESHOLD = 25;
// Claude posting to Discord: a loop or an injected instruction can't flood the channel.
export const DISCORD_POSTS_PER_HOUR = 5;
export const MAX_SPLIT_PARTS = 10;

export type CommandErrorCode =
  | 'unknown_category'
  | 'archived_category'
  | 'unknown_transaction'
  | 'unknown_rule'
  | 'unknown_account'
  | 'unknown_counterparty'
  | 'excluded'
  | 'already_categorised'
  | 'not_expense'
  | 'income_budget'
  | 'nothing_to_change'
  | 'nothing_matches'
  | 'zero_salary'
  | 'system_category'
  | 'name_taken'
  | 'cannot_merge'
  | 'seed_rule'
  | 'bad_date'
  | 'bad_amount'
  | 'bad_split'
  | 'split_part'
  | 'one_target'
  | 'nothing_to_post'
  | 'post_limit'
  | 'post_failed';

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
    | 'updateCategory'
    | 'mergeCategory'
    | 'categoryUsage'
    | 'ensureBudgetItems'
    | 'updateBudgetItem'
    | 'listBudgetLines'
    | 'listRules'
    | 'deleteRule'
    | 'updateSettings'
    | 'getSettings'
    | 'setExcluded'
    | 'setSuggestion'
  >;
  accounts: Pick<AccountLabelRepo, 'listAccounts' | 'listLabels' | 'countDescriptionMatches' | 'setLabel' | 'removeLabel'>;
  ledger: {
    stores: { transactions: Pick<TransactionStore, 'findMatching' | 'listSplitParts'> };
    corrector: Pick<CategoryCorrector, 'findSimilar' | 'correct' | 'recategorise'>;
    manual: Pick<ManualEntries, 'add' | 'split' | 'unsplit'>;
  };
  // #needs-review messages to tick off when their transactions are sorted, or to show a suggestion.
  review: Pick<ReviewMessages, 'resolve' | 'suggest'>;
  // Posts a budget status and/or a note to #budget, and remembers how often it has.
  status: StatusPoster;
  now?: () => Date;
}

export type Commands = ReturnType<typeof createCommands>;

export function createCommands(deps: CommandDeps) {
  const now = deps.now ?? (() => new Date());

  // A category the user can file things under. Archived ones are refused unless the caller is
  // acting on the category itself.
  async function category(userId: string, ref: string, { archived = false } = {}) {
    const found = findCategory(await deps.repo.listCategories(userId), ref);
    if (!found) throw new CommandError('unknown_category', `No category "${ref}".`);
    if (found.isArchived && !archived) throw new CommandError('archived_category', `${found.name} is archived.`);
    return found;
  }

  async function transaction(userId: string, id: string) {
    const tx = await deps.repo.findTransaction(userId, id);
    if (!tx) throw new CommandError('unknown_transaction', `No transaction ${id}.`);
    return tx;
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
      await deps.review.resolve(userId, [tx.id, ...similar], { kind: 'categorised', category: target });
      return { status: 'done' as const, tx, category: target, appliedTo: result.appliedTo, ruleId: result.ruleId };
    },

    // Moves transactions that are already filed to another category: everything with a description
    // (which also re-points its rule, so future emails follow), everything in a category, or both,
    // in one cycle or over all history. Past the threshold that needs confirm.
    async recategorise(
      userId: string,
      input: { description?: string; fromCategory?: string; toCategory: string; cycleRef?: string; confirm: boolean },
    ) {
      if (input.description === undefined && input.fromCategory === undefined) {
        throw new CommandError('nothing_to_change', 'Say which transactions: a description, a category to move them from, or both.');
      }
      const target = await category(userId, input.toCategory);
      const from = input.fromCategory === undefined ? null : await category(userId, input.fromCategory, { archived: true });
      const description = input.description === undefined ? undefined : normaliseManualDescription(input.description);

      let range: { from?: string; to?: string } = {};
      if (input.cycleRef) {
        const { cycle, status } = await deps.budget.summary(userId, input.cycleRef);
        // The current cycle stays open past its projected end while the salary is late.
        range = { from: cycle.start, to: status.isCurrent ? undefined : cycle.end };
      }
      const matched = await deps.ledger.stores.transactions.findMatching(userId, { description, categoryId: from?.id, ...range });
      const rows = matched.filter((r) => r.categoryId !== target.id);
      if (rows.length === 0) {
        throw new CommandError('nothing_matches', matched.length > 0 ? `Those are all ${target.name} already.` : 'No transactions match.');
      }
      if (rows.length > BULK_CONFIRM_THRESHOLD && !input.confirm) {
        return { status: 'needs_confirmation' as const, category: target, wouldChange: rows.length };
      }

      const result = await deps.ledger.corrector.recategorise({ userId, rows, categoryId: target.id, learn: description !== undefined });
      await deps.review.resolve(userId, rows.filter((r) => r.categoryId === null).map((r) => r.id), { kind: 'categorised', category: target });
      return { status: 'done' as const, category: target, changed: result.changed, rulesLearned: result.rulesLearned };
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
      const pickable = (await deps.repo.listCategories(userId)).filter((c) => !c.isArchived);
      await deps.review.suggest(userId, ids, { category: target, note: input.note }, pickable);
      return { tx, category: target, suggested: ids.length };
    },

    // An expense category gets a budget item at R0, or at allocatedCents.
    async createCategory(
      userId: string,
      input: { name: string; kind: 'expense' | 'income'; expenseType: ExpenseType; allocatedCents?: number; emoji?: string | null; isSavings?: boolean },
    ) {
      if (input.kind === 'income' && (input.allocatedCents !== undefined || input.isSavings)) {
        throw new CommandError('income_budget', 'Only expense categories have a budget or count as savings.');
      }
      const id = await deps.repo.createCategory(userId, {
        name: input.name,
        kind: input.kind,
        expenseType: input.expenseType,
        emoji: input.emoji,
        isSavings: input.isSavings,
      });
      await deps.repo.ensureBudgetItems(userId);
      if (input.allocatedCents !== undefined) await deps.repo.updateBudgetItem(userId, id, { allocatedCents: input.allocatedCents });
      return { id };
    },

    // Null clears it back to the default.
    async setCategoryEmoji(userId: string, ref: string, emoji: string | null) {
      const target = await category(userId, ref, { archived: true });
      await deps.repo.setCategoryEmoji(userId, target.id, emoji);
      return target;
    },

    // Renames a category, archives it (hidden from pickers, nothing new can be filed under it, its
    // budget switched off; what's in it still counts) or flags it as savings. Only what's passed
    // changes.
    async updateCategory(userId: string, ref: string, patch: { name?: string; archived?: boolean; savings?: boolean }) {
      if (Object.values(patch).every((v) => v === undefined)) throw new CommandError('nothing_to_change', 'Nothing to change.');
      const all = await deps.repo.listCategories(userId);
      const target = findCategory(all, ref);
      if (!target) throw new CommandError('unknown_category', `No category "${ref}".`);

      if (patch.archived && target.isSystem) {
        throw new CommandError('system_category', `${target.name} is a built-in category (${target.kind}) and can't be archived.`);
      }
      if (patch.savings !== undefined && target.kind !== 'expense') {
        throw new CommandError('not_expense', `${target.name} is a ${target.kind} category; only expense categories can count as savings.`);
      }
      const name = patch.name?.trim();
      if (name !== undefined && all.some((c) => c.id !== target.id && c.name.toLowerCase() === name.toLowerCase())) {
        throw new CommandError('name_taken', `There is already a category called "${name}".`);
      }

      await deps.repo.updateCategory(userId, target.id, {
        ...(name === undefined ? {} : { name }),
        ...(patch.archived === undefined ? {} : { isArchived: patch.archived }),
        ...(patch.savings === undefined ? {} : { isSavings: patch.savings }),
      });
      if (patch.archived && target.kind === 'expense') await deps.repo.updateBudgetItem(userId, target.id, { isActive: false });
      const updated: CategoryInfo = {
        ...target,
        name: name ?? target.name,
        isArchived: patch.archived ?? target.isArchived,
        isSavings: patch.savings ?? target.isSavings,
      };
      return { before: target, category: updated };
    },

    // Folds one category into another: its transactions and rules move, and it is archived. Always
    // previews first; it isn't undone by a single call.
    async mergeCategories(userId: string, input: { from: string; into: string; confirm: boolean }) {
      const from = await category(userId, input.from, { archived: true });
      const into = await category(userId, input.into);
      if (from.id === into.id) throw new CommandError('cannot_merge', 'Those are the same category.');
      if (from.isSystem) throw new CommandError('system_category', `${from.name} is a built-in category (${from.kind}) and can't be merged away.`);
      if (from.kind !== into.kind) throw new CommandError('cannot_merge', `${from.name} is ${from.kind} and ${into.name} is ${into.kind}: only categories of the same kind merge.`);
      if (from.isSalary !== into.isSalary) {
        throw new CommandError('cannot_merge', 'Only one of those is a salary category, and salary credits are what open budget cycles.');
      }
      if (from.isSavings !== into.isSavings) {
        throw new CommandError('cannot_merge', 'Only one of those counts as savings: merging would turn spending into saving, or the other way.');
      }

      if (!input.confirm) {
        return { status: 'needs_confirmation' as const, from, into, ...(await deps.repo.categoryUsage(userId, from.id)) };
      }
      const budgetCents = (await deps.repo.listBudgetLines(userId)).find((l) => l.categoryId === from.id && l.isActive)?.allocatedCents ?? 0;
      const moved = await deps.repo.mergeCategory(userId, from.id, into.id);
      return { status: 'done' as const, from, into, ...moved, droppedBudgetCents: budgetCents };
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

    // Forgets a learned rule. What it already categorised stays as it is; future emails with that
    // description fall back to the merchant rules, or arrive uncategorised.
    async deleteRule(userId: string, ruleId: string) {
      const rule = (await deps.repo.listRules(userId)).find((r) => r.id === ruleId);
      if (!rule) throw new CommandError('unknown_rule', `No rule ${ruleId}.`);
      if (rule.origin === 'seed') {
        throw new CommandError('seed_rule', `"${rule.pattern}" is a built-in merchant rule. Categorise one of its transactions instead: a learned rule outranks it.`);
      }
      await deps.repo.deleteRule(userId, rule.id);
      return rule;
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

    // A soft delete: the transaction leaves every total until it's restored. Excluding one that
    // was split takes its parts out too.
    async exclude(userId: string, transactionId: string) {
      const tx = await transaction(userId, transactionId);
      const parts = await deps.ledger.stores.transactions.listSplitParts(userId, tx.id);
      await deps.repo.setExcluded(userId, [tx.id, ...parts.map((p) => p.id)], true);
      await deps.review.resolve(userId, [tx.id], { kind: 'excluded' });
      return tx;
    },

    // Restoring a transaction that was split undoes the split: it counts again and its parts don't.
    async restore(userId: string, transactionId: string) {
      const tx = await transaction(userId, transactionId);
      if (tx.splitOf) {
        const original = await deps.repo.findTransaction(userId, tx.splitOf);
        if (original && !original.isDeleted) {
          throw new CommandError('split_part', 'That is a part of a split that was undone, so the whole transaction already counts. Split it again instead.');
        }
      }
      const unsplitParts = tx.splitOf ? 0 : await deps.ledger.manual.unsplit(userId, tx.id);
      if (unsplitParts === 0) await deps.repo.setExcluded(userId, tx.id, false);
      return { tx, unsplitParts };
    },

    // A transaction the bank never emailed: cash, or something that went missing. Categorised by
    // the user's rules unless a category is given.
    async addTransaction(
      userId: string,
      input: { amountCents: number; direction: 'out' | 'in'; description: string; occurredOn?: string; account?: string; category?: string | null },
    ) {
      if (input.amountCents <= 0) throw new CommandError('bad_amount', 'The amount must be more than R0.');
      const today = todayIn((await deps.repo.getSettings(userId)).timezone, now());
      const occurredOn = input.occurredOn ?? today;
      if (!isIsoDate(occurredOn)) throw new CommandError('bad_date', `"${occurredOn}" is not a date: use YYYY-MM-DD.`);
      if (occurredOn > today) throw new CommandError('bad_date', `${occurredOn} is in the future (today is ${today}).`);
      if (normaliseManualDescription(input.description) === '') throw new CommandError('nothing_to_change', 'Give it a description.');

      let account: { accountType: string; accountLast4: string } | undefined;
      if (input.account !== undefined) {
        const ref = resolveAccount(input.account, await deps.accounts.listAccounts(userId));
        if (!ref.ok) throw new CommandError('unknown_account', `${ref.reason}.`);
        account = ref.account;
      }
      const target = input.category ? await category(userId, input.category) : null;

      const added = await deps.ledger.manual.add({
        userId,
        occurredOn,
        amountCents: input.direction === 'out' ? -input.amountCents : input.amountCents,
        description: input.description,
        account,
        categoryId: target?.id ?? null,
      });
      return (await deps.repo.findTransaction(userId, added.id))!;
    },

    // Divides one transaction between categories (a supermarket run that was half groceries, half
    // clothing). The parts must add up to it exactly. It leaves the totals and its parts take its
    // place; restore it to undo.
    async splitTransaction(userId: string, input: { transactionId: string; parts: { amountCents: number; category: string }[] }) {
      const tx = await transaction(userId, input.transactionId);
      if (tx.splitOf) throw new CommandError('split_part', 'That is already a part of a split. Split the original transaction again instead.');
      if (tx.isDeleted && (await deps.ledger.stores.transactions.listSplitParts(userId, tx.id)).length === 0) {
        throw new CommandError('excluded', 'That transaction is excluded. Restore it first.');
      }
      if (input.parts.length < 2 || input.parts.length > MAX_SPLIT_PARTS) {
        throw new CommandError('bad_split', `A split needs 2 to ${MAX_SPLIT_PARTS} parts.`);
      }
      if (input.parts.some((p) => p.amountCents <= 0)) throw new CommandError('bad_split', 'Every part must be more than R0.');
      const total = Math.abs(tx.amountCents);
      const sum = input.parts.reduce((n, p) => n + p.amountCents, 0);
      if (sum !== total) {
        throw new CommandError(
          'bad_split',
          `The parts add up to ${formatRand(sum)} but the transaction is ${formatRand(total)}: ${formatRand(Math.abs(total - sum))} ${sum < total ? 'short' : 'too much'}.`,
        );
      }
      const all = await deps.repo.listCategories(userId);
      const parts = input.parts.map((p) => {
        const found = findCategory(all, p.category);
        if (!found) throw new CommandError('unknown_category', `No category "${p.category}".`);
        if (found.isArchived) throw new CommandError('archived_category', `${found.name} is archived.`);
        return { amountCents: p.amountCents, category: found };
      });

      const { partIds } = await deps.ledger.manual.split(userId, tx.id, parts.map((p) => ({ amountCents: p.amountCents, categoryId: p.category.id })));
      await deps.review.resolve(userId, [tx.id], { kind: 'split', parts: parts.length });
      const sign = tx.amountCents < 0 ? -1 : 1;
      return { tx, parts: parts.map((p, i) => ({ id: partIds[i]!, amountCents: sign * p.amountCents, category: p.category })) };
    },

    // Names one of the user's bank accounts, or whoever is behind text in descriptions. Display
    // only: labels never change categories or totals. label null removes it; an undefined note
    // keeps the one already there.
    async setAccountLabel(userId: string, input: { account?: string; counterparty?: string; label: string | null; note?: string | null }) {
      if ((input.account === undefined) === (input.counterparty === undefined)) {
        throw new CommandError('one_target', 'Name exactly one thing: an account or a counterparty.');
      }

      let kind: AccountLabelKind;
      let match: string;
      let shown: string;
      if (input.account !== undefined) {
        // Only an account in the user's own ledger can be named.
        const ref = resolveAccount(input.account, await deps.accounts.listAccounts(userId));
        if (!ref.ok) throw new CommandError('unknown_account', `${ref.reason}.`);
        kind = 'account';
        match = accountKey(ref.account);
        shown = maskedAccount(ref.account);
      } else {
        kind = 'counterparty';
        match = counterpartyKey(input.counterparty!);
        if (match.length < MIN_COUNTERPARTY_LENGTH) {
          throw new CommandError('unknown_counterparty', `A counterparty needs at least ${MIN_COUNTERPARTY_LENGTH} characters of description text.`);
        }
        const count = await deps.accounts.countDescriptionMatches(userId, match);
        if (count === 0) throw new CommandError('unknown_counterparty', `No transaction description contains "${match}".`);
        shown = `"${match}" (${count} transaction${count === 1 ? '' : 's'})`;
      }
      const subject = { kind, shown, account: kind === 'account' ? shown : null, counterparty: kind === 'counterparty' ? match : null };

      if (input.label === null) {
        const removed = await deps.accounts.removeLabel(userId, kind, match);
        return { ...subject, label: null, note: null, removed };
      }
      await deps.accounts.setLabel(userId, { kind, match, label: input.label, note: input.note });
      const saved = (await deps.accounts.listLabels(userId)).find((l) => l.kind === kind && l.match === match);
      return { ...subject, label: input.label, note: saved?.note ?? null, removed: false };
    },

    // Posts the budget status and/or a note to #budget, at most DISCORD_POSTS_PER_HOUR an hour.
    async postStatus(userId: string, input: { note: string; includeBudget: boolean }) {
      if (!input.note && !input.includeBudget) throw new CommandError('nothing_to_post', 'Nothing to post.');
      const since = new Date(now().getTime() - 3_600_000);
      if ((await deps.status.recentPosts(userId, since)) >= DISCORD_POSTS_PER_HOUR) {
        throw new CommandError('post_limit', `Already posted ${DISCORD_POSTS_PER_HOUR} times to Discord in the last hour. Nothing was posted.`);
      }
      const posted = await deps.status.post(userId, input);
      if (posted.messageIds.length === 0) {
        throw new CommandError('post_failed', 'Discord did not accept the post (the webhook may be missing or revoked). Nothing was posted.');
      }
      if (posted.messageIds.length < posted.total) {
        throw new CommandError('post_failed', `Discord accepted ${posted.messageIds.length} of the ${posted.total} messages, then failed. Only part was posted.`);
      }
      return posted;
    },
  };
}
