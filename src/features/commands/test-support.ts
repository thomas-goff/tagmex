// An in-memory tagmex for tests: one ledger, with the real services (budget, corrector, manual
// entries, status poster, commands) running over it. Only storage, Discord and the clock are fake,
// so a test of a command or an MCP tool exercises the same code the app runs.
import type { AccountLabel } from '@/features/accounts/labels';
import type { AccountLabelRepo } from '@/features/accounts/repo';
import type { TransactionKind } from '@/features/bank-email/types';
import type { BudgetRepo, CategoryInfo, RuleInfo, TransactionView } from '@/features/budget/repo';
import { ConflictError } from '@/features/budget/repo';
import { createBudgetService } from '@/features/budget/service';
import { DEFAULT_SETTINGS, type BudgetLine, type Settings } from '@/features/budget/types';
import type { CategoryRule, CategorySource, ExpenseType } from '@/features/categorisation/types';
import { payloadText } from '@/features/notifications/embeds';
import type { ReviewOutcome, ReviewSuggestion } from '@/features/notifications/review';
import { createStatusPoster } from '@/features/notifications/status-post';
import { createCategoryCorrector } from '@/features/transactions/correct-category';
import { createManualEntries } from '@/features/transactions/manual-entries';
import type { CategoryAssignment, NewTransaction, Stores, TransactionSource, UncategorisedGroup } from '@/features/transactions/ports';
import { createCommands } from './commands';

export interface FakeTransaction {
  id: string;
  userId: string;
  accountType: string;
  accountLast4: string;
  occurredOn: string;
  amountCents: number;
  descriptionRaw: string;
  descriptionNormalised: string;
  categoryId: string | null;
  categorySource: CategorySource;
  ruleId: string | null;
  balanceAfterCents: number | null;
  kind: TransactionKind;
  transactionType: string;
  reserved: boolean;
  source: TransactionSource;
  sourceRef: string;
  isDeleted: boolean;
  splitOf: string | null;
  suggestedCategoryId: string | null;
  suggestedAt: boolean;
}

interface FakeCategory extends Omit<CategoryInfo, 'hasBudgetItem'> {
  userId: string;
  expenseType: ExpenseType | null;
}

interface FakeBudgetItem extends Omit<BudgetLine, 'categoryName' | 'categoryEmoji' | 'isSavings'> {
  userId: string;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const TODAY = '2026-11-13';

export function fakeWorld({ now = () => new Date(`${TODAY}T10:00:00Z`) }: { now?: () => Date } = {}) {
  let next = 0;
  const id = () => uuid(++next);
  const transactions: FakeTransaction[] = [];
  const categories: FakeCategory[] = [];
  const budgetItems: FakeBudgetItem[] = [];
  const rules: (CategoryRule & { userId: string })[] = [];
  const labels: (AccountLabel & { userId: string })[] = [];
  const settings = new Map<string, Settings>();
  const reviewed: { userId: string; ids: string[]; outcome: ReviewOutcome }[] = [];
  const suggested: { userId: string; ids: string[]; suggestion: ReviewSuggestion; offered: string[] }[] = [];
  const posts: { channel: string; text: string }[] = [];
  const statusPosts: { userId: string; at: Date }[] = [];
  let discordDown = false;

  const own = (userId: string) => transactions.filter((t) => t.userId === userId);
  const live = (userId: string) => own(userId).filter((t) => !t.isDeleted);
  const categoryOf = (categoryId: string | null) => categories.find((c) => c.id === categoryId) ?? null;
  const assign = (t: FakeTransaction, c: CategoryAssignment) => Object.assign(t, { categoryId: c.categoryId, categorySource: c.source, ruleId: c.ruleId });
  const stored = (t: FakeTransaction) => ({
    id: t.id,
    occurredOn: t.occurredOn,
    amountCents: t.amountCents,
    accountLast4: t.accountLast4,
    descriptionNormalised: t.descriptionNormalised,
    categoryId: t.categoryId,
    categorySource: t.categorySource,
  });
  const view = (t: FakeTransaction): TransactionView => ({
    id: t.id,
    occurredOn: t.occurredOn,
    amountCents: t.amountCents,
    description: t.descriptionNormalised,
    categoryId: t.categoryId,
    categoryName: categoryOf(t.categoryId)?.name ?? null,
    categoryEmoji: categoryOf(t.categoryId)?.emoji ?? null,
    categorySource: t.categorySource,
    kind: t.kind,
    accountType: t.accountType,
    accountLast4: t.accountLast4,
    reserved: t.reserved,
    isDeleted: t.isDeleted,
    splitOf: t.splitOf,
  });
  const info = (c: FakeCategory): CategoryInfo => {
    const { id: categoryId, name, emoji, kind, isSystem, isSalary, isSavings, isArchived } = c;
    return { id: categoryId, name, emoji, kind, isSystem, isSalary, isSavings, isArchived, hasBudgetItem: budgetItems.some((b) => b.categoryId === c.id) };
  };
  const byDateDesc = (a: FakeTransaction, b: FakeTransaction) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id);

  const stores = {
    transactions: {
      async insertIfNew(tx: NewTransaction) {
        const existing = transactions.find((t) => t.source === tx.source && t.sourceRef === tx.sourceRef);
        if (existing) return { id: existing.id, created: false };
        const { category, splitOf, ...rest } = tx;
        const row: FakeTransaction = {
          id: id(),
          ...rest,
          categoryId: category.categoryId,
          categorySource: category.source,
          ruleId: category.ruleId,
          isDeleted: false,
          splitOf: splitOf ?? null,
          suggestedCategoryId: null,
          suggestedAt: false,
        };
        transactions.push(row);
        return { id: row.id, created: true };
      },
      async findById(userId: string, txId: string) {
        const t = live(userId).find((r) => r.id === txId);
        return t ? stored(t) : null;
      },
      async findFull(userId: string, txId: string) {
        const t = own(userId).find((r) => r.id === txId);
        return t ? { ...stored(t), accountType: t.accountType, descriptionRaw: t.descriptionRaw, kind: t.kind, transactionType: t.transactionType, reserved: t.reserved, isDeleted: t.isDeleted, splitOf: t.splitOf } : null;
      },
      async findTransferCandidates() {
        return [];
      },
      async setCategory(userId: string, txId: string, c: CategoryAssignment) {
        const t = live(userId).find((r) => r.id === txId);
        if (t) assign(t, c);
      },
      async categoriseIfUncategorised(userId: string, ids: string[], c: CategoryAssignment) {
        const hits = live(userId).filter((t) => ids.includes(t.id) && t.categorySource === 'none');
        hits.forEach((t) => assign(t, c));
        return hits.length;
      },
      async listUncategorised(userId: string) {
        return live(userId).filter((t) => t.categorySource === 'none').map(stored);
      },
      async summariseUncategorised(userId: string, { unreviewedOnly = false } = {}) {
        const groups = new Map<string, UncategorisedGroup>();
        for (const t of live(userId).filter((r) => r.categorySource === 'none' && !(unreviewedOnly && r.suggestedAt)).sort(byDateDesc)) {
          const g = groups.get(t.descriptionNormalised) ?? { descriptionNormalised: t.descriptionNormalised, count: 0, totalCents: 0, lastOccurredOn: t.occurredOn, latestTransactionId: t.id, accounts: [] };
          g.count++;
          g.totalCents += t.amountCents;
          if (!g.accounts.some((a) => a.accountType === t.accountType && a.accountLast4 === t.accountLast4)) g.accounts.push({ accountType: t.accountType, accountLast4: t.accountLast4 });
          groups.set(t.descriptionNormalised, g);
        }
        return [...groups.values()].sort((a, b) => b.count - a.count);
      },
      async findMatching(userId: string, match: { description?: string; categoryId?: string; from?: string; to?: string }) {
        return live(userId)
          .filter(
            (t) =>
              (match.description === undefined || t.descriptionNormalised === match.description) &&
              (match.categoryId === undefined || t.categoryId === match.categoryId) &&
              (!match.from || t.occurredOn >= match.from) &&
              (!match.to || t.occurredOn < match.to),
          )
          .sort(byDateDesc)
          .map(stored);
      },
      async setCategoryMany(userId: string, ids: string[], c: CategoryAssignment) {
        const hits = live(userId).filter((t) => ids.includes(t.id));
        hits.forEach((t) => assign(t, c));
        return hits.length;
      },
      async listSplitParts(userId: string, originalId: string) {
        return live(userId).filter((t) => t.splitOf === originalId).map(stored);
      },
      async setExcluded(userId: string, ids: string[], excluded: boolean) {
        const hits = own(userId).filter((t) => ids.includes(t.id));
        hits.forEach((t) => (t.isDeleted = excluded));
        return hits.length;
      },
    },
    categories: {
      async listCategories(userId: string) {
        return categories.filter((c) => c.userId === userId).map(({ id: cid, name, kind, isSystem }) => ({ id: cid, name, kind, isSystem }));
      },
      async listRules(userId: string) {
        return rules.filter((r) => r.userId === userId);
      },
      async upsertRule(userId: string, rule: Omit<CategoryRule, 'id'>) {
        const existing = rules.find((r) => r.userId === userId && r.matchType === rule.matchType && r.pattern === rule.pattern && r.direction === rule.direction);
        if (existing) return Object.assign(existing, rule);
        const created = { id: id(), userId, ...rule };
        rules.push(created);
        return created;
      },
    },
  } as unknown as Stores;
  const unitOfWork = <T>(work: (s: Stores) => Promise<T>) => work(stores);

  const repo = {
    async getSettings(userId: string) {
      return settings.get(userId) ?? DEFAULT_SETTINGS;
    },
    async updateSettings(userId: string, patch: Partial<Settings>) {
      settings.set(userId, { ...(settings.get(userId) ?? DEFAULT_SETTINGS), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
    },
    async listSalaryCredits(userId: string) {
      return live(userId)
        .filter((t) => categoryOf(t.categoryId)?.isSalary && t.amountCents > 0)
        .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))
        .map((t) => ({ transactionId: t.id, occurredOn: t.occurredOn, amountCents: t.amountCents }));
    },
    async firstTransactionDate(userId: string) {
      return live(userId).map((t) => t.occurredOn).sort()[0] ?? null;
    },
    async listLedgerRows(userId: string, from: string, to: string) {
      return live(userId)
        .filter((t) => t.occurredOn >= from && t.occurredOn < to)
        .map((t) => {
          const c = categoryOf(t.categoryId);
          return { id: t.id, occurredOn: t.occurredOn, amountCents: t.amountCents, categoryId: t.categoryId, categoryKind: c?.kind ?? null, categoryName: c?.name ?? null, categoryEmoji: c?.emoji ?? null, categoryIsSavings: c?.isSavings ?? false };
        });
    },
    async listTransactions(userId: string, filter: { includeExcluded?: boolean; categoryId?: string; uncategorisedOnly?: boolean; search?: string; from?: string; to?: string }, limit: number) {
      const rows = own(userId)
        .filter(
          (t) =>
            (filter.includeExcluded || !t.isDeleted) &&
            (!filter.categoryId || t.categoryId === filter.categoryId) &&
            (!filter.uncategorisedOnly || t.categoryId === null) &&
            (!filter.search || t.descriptionNormalised.includes(filter.search.toUpperCase())) &&
            (!filter.from || t.occurredOn >= filter.from) &&
            (!filter.to || t.occurredOn < filter.to),
        )
        .sort(byDateDesc);
      return { transactions: rows.slice(0, limit).map(view), next: null };
    },
    async findTransaction(userId: string, txId: string) {
      const t = own(userId).find((r) => r.id === txId);
      return t ? view(t) : null;
    },
    async setExcluded(userId: string, ids: string | string[], excluded: boolean) {
      return stores.transactions.setExcluded(userId, [ids].flat(), excluded);
    },
    async setSuggestion(userId: string, ids: string[], suggestion: { categoryId: string | null; note: string | null }) {
      const hits = live(userId).filter((t) => ids.includes(t.id) && t.categorySource === 'none');
      hits.forEach((t) => Object.assign(t, { suggestedCategoryId: suggestion.categoryId, suggestedAt: true }));
      return hits.map((t) => t.id);
    },
    async listKnownDescriptions(userId: string) {
      return live(userId)
        .filter((t) => t.categoryId !== null && t.categorySource !== 'transfer')
        .map((t) => ({ descriptionNormalised: t.descriptionNormalised, categoryId: t.categoryId! }));
    },
    async listCategories(userId: string) {
      return categories.filter((c) => c.userId === userId).map(info);
    },
    async createCategory(userId: string, c: { name: string; kind: 'expense' | 'income'; expenseType: ExpenseType | null; emoji?: string | null; isSavings?: boolean }) {
      if (categories.some((x) => x.userId === userId && x.name === c.name)) throw new ConflictError(`a category called "${c.name}" already exists`);
      const created: FakeCategory = { id: id(), userId, name: c.name, emoji: c.emoji ?? null, kind: c.kind, expenseType: c.kind === 'expense' ? c.expenseType : null, isSystem: false, isSalary: false, isSavings: c.kind === 'expense' && (c.isSavings ?? false), isArchived: false };
      categories.push(created);
      return created.id;
    },
    async setCategoryEmoji(userId: string, categoryId: string, emoji: string | null) {
      const c = categories.find((x) => x.userId === userId && x.id === categoryId);
      if (c) c.emoji = emoji;
      return Boolean(c);
    },
    async updateCategory(userId: string, categoryId: string, patch: { name?: string; isArchived?: boolean; isSavings?: boolean }) {
      const c = categories.find((x) => x.userId === userId && x.id === categoryId);
      if (c) Object.assign(c, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      return Boolean(c);
    },
    async categoryUsage(userId: string, categoryId: string) {
      return { transactions: own(userId).filter((t) => t.categoryId === categoryId).length, rules: rules.filter((r) => r.userId === userId && r.categoryId === categoryId).length };
    },
    async mergeCategory(userId: string, fromId: string, intoId: string) {
      const moved = own(userId).filter((t) => t.categoryId === fromId);
      moved.forEach((t) => (t.categoryId = intoId));
      const repointed = rules.filter((r) => r.userId === userId && r.categoryId === fromId);
      repointed.forEach((r) => (r.categoryId = intoId));
      budgetItems.filter((b) => b.userId === userId && b.categoryId === fromId).forEach((b) => (b.isActive = false));
      categories.filter((c) => c.userId === userId && c.id === fromId).forEach((c) => (c.isArchived = true));
      return { transactions: moved.length, rules: repointed.length };
    },
    async ensureBudgetItems(userId: string) {
      const missing = categories.filter((c) => c.userId === userId && c.kind === 'expense' && !budgetItems.some((b) => b.categoryId === c.id));
      missing.forEach((c, i) => budgetItems.push({ userId, categoryId: c.id, expenseType: c.expenseType ?? 'dynamic', allocatedCents: 0, expectedDay: null, isActive: true, sortOrder: budgetItems.length + i }));
      return missing.length;
    },
    async listBudgetLines(userId: string): Promise<BudgetLine[]> {
      return budgetItems
        .filter((b) => b.userId === userId)
        .map((b) => {
          const c = categoryOf(b.categoryId)!;
          const { categoryId, expenseType, allocatedCents, expectedDay, isActive, sortOrder } = b;
          return { categoryId, expenseType, allocatedCents, expectedDay, isActive, sortOrder, categoryName: c.name, categoryEmoji: c.emoji, isSavings: c.isSavings };
        });
    },
    async updateBudgetItem(userId: string, categoryId: string, patch: Partial<Pick<BudgetLine, 'allocatedCents' | 'expenseType' | 'expectedDay' | 'isActive'>>) {
      const b = budgetItems.find((x) => x.userId === userId && x.categoryId === categoryId);
      if (b) Object.assign(b, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      return Boolean(b);
    },
    async listRules(userId: string, filter: { origin?: 'learned' | 'seed'; categoryId?: string } = {}): Promise<RuleInfo[]> {
      return rules
        .filter((r) => r.userId === userId && (!filter.origin || r.origin === filter.origin) && (!filter.categoryId || r.categoryId === filter.categoryId))
        .map((r) => ({
          id: r.id,
          matchType: r.matchType,
          pattern: r.pattern,
          direction: r.direction,
          origin: r.origin,
          categoryId: r.categoryId,
          categoryName: categoryOf(r.categoryId)?.name ?? '?',
          transactionCount: live(userId).filter((t) => t.ruleId === r.id).length,
          updatedAt: now(),
        }));
    },
    async deleteRule(userId: string, ruleId: string) {
      const i = rules.findIndex((r) => r.userId === userId && r.id === ruleId);
      if (i < 0) return false;
      rules.splice(i, 1);
      transactions.filter((t) => t.ruleId === ruleId).forEach((t) => (t.ruleId = null));
      return true;
    },
  } satisfies Partial<BudgetRepo>;

  const accounts = {
    async listLabels(userId: string) {
      return labels.filter((l) => l.userId === userId).map(({ kind, match, label, note }) => ({ kind, match, label, note }));
    },
    async listAccounts(userId: string) {
      const seen = new Map<string, Awaited<ReturnType<AccountLabelRepo['listAccounts']>>[number]>();
      for (const t of [...own(userId)].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))) {
        const key = `${t.accountType}${t.accountLast4}`;
        const prev = seen.get(key);
        seen.set(key, {
          accountType: t.accountType,
          accountLast4: t.accountLast4,
          transactionCount: (prev?.transactionCount ?? 0) + 1,
          lastOccurredOn: t.occurredOn,
          availableCents: t.balanceAfterCents ?? prev?.availableCents ?? null,
          availableOn: t.balanceAfterCents === null ? (prev?.availableOn ?? null) : t.occurredOn,
        });
      }
      // Most recently used first, like the real query.
      return [...seen.values()].sort((a, b) => b.lastOccurredOn.localeCompare(a.lastOccurredOn));
    },
    async countDescriptionMatches(userId: string, text: string) {
      return own(userId).filter((t) => t.descriptionNormalised.includes(text)).length;
    },
    async setLabel(userId: string, l: { kind: AccountLabel['kind']; match: string; label: string; note?: string | null }) {
      const existing = labels.find((x) => x.userId === userId && x.kind === l.kind && x.match === l.match);
      if (existing) Object.assign(existing, { label: l.label }, l.note === undefined ? {} : { note: l.note });
      else labels.push({ userId, kind: l.kind, match: l.match, label: l.label, note: l.note ?? null });
    },
    async removeLabel(userId: string, kind: AccountLabel['kind'], match: string) {
      const i = labels.findIndex((x) => x.userId === userId && x.kind === kind && x.match === match);
      if (i >= 0) labels.splice(i, 1);
      return i >= 0;
    },
  } satisfies AccountLabelRepo;

  const budget = createBudgetService({ repo, now });
  const review = {
    async resolve(userId: string, ids: string[], outcome: ReviewOutcome) {
      reviewed.push({ userId, ids, outcome });
      return ids.length;
    },
    async suggest(userId: string, ids: string[], suggestion: ReviewSuggestion, offered: readonly { id: string }[]) {
      suggested.push({ userId, ids, suggestion, offered: offered.map((c) => c.id) });
      return ids.length;
    },
  };
  const status = createStatusPoster({
    budget,
    now,
    logger: { error: () => {} },
    async post(channel, payload) {
      if (discordDown) throw new Error('Discord webhook failed: 404');
      posts.push({ channel, text: payloadText(payload) });
      return `msg_${posts.length}`;
    },
    log: {
      countSince: async (userId, since) => statusPosts.filter((p) => p.userId === userId && p.at >= since).length,
      record: async (userId, at) => void statusPosts.push({ userId, at }),
    },
  });
  const ledger = {
    stores,
    corrector: createCategoryCorrector({ stores, unitOfWork }),
    // No rules engine here: a transaction added without a category arrives uncategorised.
    manual: createManualEntries({ stores, unitOfWork, categorise: async () => ({ categoryId: null, source: 'none', ruleId: null }), newRef: id }),
  };
  const commands = createCommands({ budget, repo, accounts, ledger, review, status, now });

  return {
    commands,
    budget,
    repo,
    accounts,
    stores,
    state: { transactions, categories, budgetItems, rules, labels, reviewed, suggested, posts, statusPosts },
    discord: { down: (down = true) => (discordDown = down) },

    // Adds a category (and, for an expense one, its budget item) and returns its id.
    category(name: string, over: Partial<FakeCategory> & { allocatedCents?: number; expectedDay?: number | null } = {}, userId = 'owner') {
      const { allocatedCents = 0, expectedDay = null, ...rest } = over;
      const c: FakeCategory = { id: id(), userId, name, emoji: null, kind: 'expense', expenseType: 'dynamic', isSystem: false, isSalary: false, isSavings: false, isArchived: false, ...rest };
      if (c.kind !== 'expense') c.expenseType = null;
      categories.push(c);
      if (c.kind === 'expense') budgetItems.push({ userId, categoryId: c.id, expenseType: c.expenseType ?? 'dynamic', allocatedCents, expectedDay, isActive: true, sortOrder: budgetItems.length });
      return c.id;
    },

    // Adds a bank transaction and returns its id.
    transaction(description: string, amountCents: number, over: Partial<FakeTransaction> = {}) {
      const t: FakeTransaction = {
        id: id(),
        userId: 'owner',
        accountType: 'CHEQ',
        accountLast4: '1297',
        occurredOn: '2026-11-03',
        amountCents,
        descriptionRaw: description,
        descriptionNormalised: description,
        categoryId: null,
        categorySource: 'none',
        ruleId: null,
        balanceAfterCents: null,
        kind: amountCents < 0 ? 'card_purchase' : 'credit',
        transactionType: 'PURCHASE',
        reserved: false,
        source: 'gmail',
        sourceRef: `gmail-${next + 1}`,
        isDeleted: false,
        splitOf: null,
        suggestedCategoryId: null,
        suggestedAt: false,
        ...over,
      };
      if (t.categoryId && t.categorySource === 'none') t.categorySource = 'manual';
      transactions.push(t);
      return t.id;
    },

    find: (txId: string) => transactions.find((t) => t.id === txId)!,
  };
}

export type FakeWorld = ReturnType<typeof fakeWorld>;
