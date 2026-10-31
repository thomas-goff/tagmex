// What the transaction services need from storage. Services depend on these interfaces, never on
// Drizzle directly: drizzle-stores.ts implements them, and tests can pass in-memory fakes.
import type { TransactionKind } from '@/features/bank-email/types';
import type { CategorySeed } from '@/features/categorisation/defaults';
import type {
  Categorisation,
  Category,
  CategoryRule,
  CategorySource,
  TransferCandidate,
} from '@/features/categorisation/types';

export type CategoryAssignment = Pick<Categorisation, 'categoryId' | 'source' | 'ruleId'>;

export interface NewTransaction {
  userId: string;
  accountType: string;
  accountLast4: string;
  occurredOn: string;
  amountCents: number;
  descriptionRaw: string;
  descriptionNormalised: string;
  balanceAfterCents: number | null;
  kind: TransactionKind;
  transactionType: string;
  reserved: boolean;
  source: 'gmail';
  sourceRef: string;
  category: CategoryAssignment;
}

export interface StoredTransaction {
  id: string;
  occurredOn: string;
  amountCents: number;
  accountLast4: string;
  descriptionNormalised: string;
  categoryId: string | null;
  categorySource: CategorySource;
}

export interface UncategorisedGroup {
  descriptionNormalised: string;
  count: number;
  totalCents: number;
  lastOccurredOn: string;
  // Correcting this one transaction teaches a rule that fixes the rest of the group.
  latestTransactionId: string;
  // The accounts the group's transactions were on.
  accounts: { accountType: string; accountLast4: string }[];
}

export interface TransactionStore {
  // Insert unless (source, sourceRef) already exists. Returns the row's id either way.
  insertIfNew(tx: NewTransaction): Promise<{ id: string; created: boolean }>;
  findById(userId: string, id: string): Promise<StoredTransaction | null>;
  // Uncategorised rows on other accounts with the opposite amount, within `windowDays`.
  findTransferCandidates(
    userId: string,
    near: Pick<StoredTransaction, 'occurredOn' | 'amountCents' | 'accountLast4'>,
    windowDays: number,
  ): Promise<TransferCandidate[]>;
  setCategory(userId: string, id: string, category: CategoryAssignment): Promise<void>;
  // Skips rows that are no longer uncategorised (never overwrites a rule or manual choice).
  categoriseIfUncategorised(userId: string, ids: string[], category: CategoryAssignment): Promise<number>;
  listUncategorised(userId: string): Promise<Pick<StoredTransaction, 'id' | 'descriptionNormalised' | 'amountCents'>[]>;
  // unreviewedOnly: just the rows nobody has suggested a category for yet (suggest_category).
  summariseUncategorised(userId: string, options?: { unreviewedOnly?: boolean }): Promise<UncategorisedGroup[]>;
}

export interface CategoryStore {
  listCategories(userId: string): Promise<Category[]>;
  listRules(userId: string): Promise<CategoryRule[]>;
  // Insert, or re-point an existing rule with the same match type, pattern and direction.
  upsertRule(userId: string, rule: Omit<CategoryRule, 'id'>): Promise<CategoryRule>;
  // Seeding: rows that already exist (by name, or by pattern) are left untouched.
  insertCategoriesIfMissing(userId: string, categories: (CategorySeed & { sortOrder: number })[]): Promise<number>;
  insertRulesIfMissing(userId: string, rules: Omit<CategoryRule, 'id'>[]): Promise<number>;
}

export interface IngestedMessageStore {
  linkTransaction(ingestedMessageId: string, transactionId: string): Promise<void>;
  // Parsed before phase 2 (or by a run that died mid-way): waiting for a ledger row. Keyset-paged by id.
  listParsedWithoutTransaction(
    userId: string,
    page: { afterId: string | null; limit: number },
  ): Promise<{ id: string; gmailMessageId: string }[]>;
}

export interface Stores {
  transactions: TransactionStore;
  categories: CategoryStore;
  ingestedMessages: IngestedMessageStore;
}

// Runs `work` in one database transaction: everything it writes commits together or not at all.
export type UnitOfWork = <T>(work: (stores: Stores) => Promise<T>) => Promise<T>;
