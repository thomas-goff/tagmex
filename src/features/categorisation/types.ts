// Pure categorisation domain. No database or framework imports, so everything here is unit-testable
// and reusable from the sync route, local scripts and (phase 3) the MCP tools.

// Each list is also a Postgres enum: adding a value needs a migration.
export const CATEGORY_KINDS = ['expense', 'income', 'transfer'] as const;
export const EXPENSE_TYPES = ['static', 'dynamic', 'irregular'] as const;
export const CATEGORY_SOURCES = ['user_rule', 'merchant_rule', 'transfer', 'manual', 'none'] as const;
export const RULE_MATCH_TYPES = ['exact', 'token'] as const;
export const RULE_ORIGINS = ['seed', 'learned'] as const;
export const RULE_DIRECTIONS = ['out', 'in'] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];
// Used by the phase 3 budget: fixed (rent), variable (groceries) or occasional (clothing).
export type ExpenseType = (typeof EXPENSE_TYPES)[number];
// How a transaction got its category. `none` = uncategorised (category_id is null).
export type CategorySource = (typeof CATEGORY_SOURCES)[number];
// `exact`: the whole normalised description. `token`: a whole-word sequence inside it.
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];
// `learned` rules come from the user's corrections and outrank `seed` rules.
export type RuleOrigin = (typeof RULE_ORIGINS)[number];
// Which way the money moves: `out` is a negative amount, `in` a positive one.
export type RuleDirection = (typeof RULE_DIRECTIONS)[number];

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  isSystem: boolean;
}

export interface CategoryRule {
  id: string;
  matchType: RuleMatchType;
  // Upper case. For `exact` rules, a normalised description.
  pattern: string;
  categoryId: string;
  origin: RuleOrigin;
  // Only matches money moving this way; null matches either. Learned rules take the direction of
  // the transaction they were learned from, so "ABSA BANK SAVINGS" leaving the cheque account can
  // be Savings while the same description arriving in the savings account stays a transfer.
  direction: RuleDirection | null;
}

// The fields categorisation looks at, whether the transaction is stored yet or not.
export interface CategorisableTransaction {
  descriptionNormalised: string;
  // Integer cents. Negative = expense.
  amountCents: number;
  // YYYY-MM-DD
  occurredOn: string;
  accountLast4: string;
}

// An uncategorised stored transaction that might be the other leg of a transfer.
export interface TransferCandidate extends Omit<CategorisableTransaction, 'descriptionNormalised'> {
  id: string;
}

export interface CategorisationContext {
  rules: CategoryRule[];
  // The user's system category with kind `transfer`; null disables transfer detection.
  transferCategoryId: string | null;
  transferCandidates: TransferCandidate[];
}

export interface Categorisation {
  categoryId: string | null;
  source: CategorySource;
  ruleId: string | null;
  // Transfers only: the matching leg, which should be marked as a transfer too.
  counterpartId?: string;
}

export const UNCATEGORISED: Categorisation = Object.freeze({ categoryId: null, source: 'none', ruleId: null });

// One link in the categorisation chain: a result, or null to let the next step try.
export type CategorisationStep = (tx: CategorisableTransaction, context: CategorisationContext) => Categorisation | null;
