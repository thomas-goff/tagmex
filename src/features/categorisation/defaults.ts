import type { CategoryKind, ExpenseType } from './types';

// Starter data for a new user, applied by `npm run db:seed` (idempotent: existing rows are kept, so
// renaming or re-pointing anything in the database is never undone by a re-seed).
//
// Categories are the old transaction-tracker defaults. Its "Other Income" becomes the system Income
// category, and Transfer is a system category; both are found by kind. Salary is a plain income
// category flagged isSalary: its credits open budget cycles (phase 3).

export interface CategorySeed {
  name: string;
  emoji: string;
  kind: CategoryKind;
  expenseType: ExpenseType | null;
  isSystem: boolean;
  isSalary?: boolean;
}

// Migration 0008 gives existing users the same emoji; keep the two in step.
export const DEFAULT_CATEGORIES = [
  { name: 'Groceries', emoji: '🛒', kind: 'expense', expenseType: 'dynamic', isSystem: false },
  { name: 'Petrol', emoji: '⛽', kind: 'expense', expenseType: 'dynamic', isSystem: false },
  { name: 'Rent / Bond', emoji: '🏠', kind: 'expense', expenseType: 'static', isSystem: false },
  { name: 'Utilities', emoji: '💡', kind: 'expense', expenseType: 'static', isSystem: false },
  { name: 'Eating Out', emoji: '🍔', kind: 'expense', expenseType: 'dynamic', isSystem: false },
  { name: 'Entertainment', emoji: '🎬', kind: 'expense', expenseType: 'dynamic', isSystem: false },
  { name: 'Medical', emoji: '💊', kind: 'expense', expenseType: 'irregular', isSystem: false },
  { name: 'Insurance', emoji: '🛡️', kind: 'expense', expenseType: 'static', isSystem: false },
  { name: 'Clothing', emoji: '👕', kind: 'expense', expenseType: 'irregular', isSystem: false },
  { name: 'Subscriptions', emoji: '📺', kind: 'expense', expenseType: 'static', isSystem: false },
  { name: 'Personal Care', emoji: '💈', kind: 'expense', expenseType: 'dynamic', isSystem: false },
  { name: 'Transport', emoji: '🚌', kind: 'expense', expenseType: 'dynamic', isSystem: false },
  { name: 'Salary', emoji: '💰', kind: 'income', expenseType: null, isSystem: false, isSalary: true },
  { name: 'Income', emoji: '💵', kind: 'income', expenseType: null, isSystem: true },
  { name: 'Transfer', emoji: '🔁', kind: 'transfer', expenseType: null, isSystem: true },
] as const satisfies readonly CategorySeed[];

export type DefaultCategoryName = (typeof DEFAULT_CATEGORIES)[number]['name'];

export interface MerchantRuleSeed {
  // Whole words, matched as a sequence (see rule-matchers.ts), so "BP" never matches "BPA".
  pattern: string;
  category: DefaultCategoryName;
}

// From the old repo's SeedGlobalCategoryRules.sql, adjusted for whole-word matching:
//   TOTAL → TOTALENERGIES  ("TOTAL" alone also matches "TOTAL SPORTS")
//   APPLE → APPLE COM BILL (Apple's subscription descriptor; "APPLE" alone also matches the Apple Store)
// Additions are marked. When the longest matching pattern wins, "UBER EATS" beats "UBER".
export const DEFAULT_MERCHANT_RULES: readonly MerchantRuleSeed[] = [
  // Groceries
  { pattern: 'WOOLWORTHS', category: 'Groceries' },
  { pattern: 'CHECKERS', category: 'Groceries' },
  { pattern: 'PICK N PAY', category: 'Groceries' },
  { pattern: 'PNP', category: 'Groceries' }, // added
  { pattern: 'SHOPRITE', category: 'Groceries' },
  { pattern: 'SPAR', category: 'Groceries' },
  { pattern: 'FOOD LOVERS', category: 'Groceries' }, // added

  // Petrol
  { pattern: 'ENGEN', category: 'Petrol' },
  { pattern: 'SHELL', category: 'Petrol' },
  { pattern: 'SASOL', category: 'Petrol' },
  { pattern: 'BP', category: 'Petrol' },
  { pattern: 'CALTEX', category: 'Petrol' },
  { pattern: 'ASTRON', category: 'Petrol' }, // added: Caltex's SA rebrand
  { pattern: 'TOTALENERGIES', category: 'Petrol' },

  // Eating Out
  { pattern: 'MCDONALDS', category: 'Eating Out' },
  { pattern: 'KFC', category: 'Eating Out' },
  { pattern: 'STEERS', category: 'Eating Out' },
  { pattern: 'NANDOS', category: 'Eating Out' },
  { pattern: 'WIMPY', category: 'Eating Out' },
  { pattern: 'UBER EATS', category: 'Eating Out' }, // added
  { pattern: 'MR D', category: 'Eating Out' }, // added

  // Transport (added)
  { pattern: 'UBER', category: 'Transport' },
  { pattern: 'BOLT', category: 'Transport' },
  { pattern: 'GAUTRAIN', category: 'Transport' },

  // Subscriptions
  { pattern: 'NETFLIX', category: 'Subscriptions' },
  { pattern: 'SPOTIFY', category: 'Subscriptions' },
  { pattern: 'SHOWMAX', category: 'Subscriptions' },
  { pattern: 'YOUTUBE', category: 'Subscriptions' },
  { pattern: 'YOUTUBEPREMIUM', category: 'Subscriptions' }, // added: Absa sends "GOOGLE YOUTUBEPREMIUM LONDON"
  { pattern: 'GOOGLE ONE', category: 'Subscriptions' }, // added
  { pattern: 'APPLE COM BILL', category: 'Subscriptions' },
  { pattern: 'DSTV', category: 'Subscriptions' }, // added

  // Entertainment
  { pattern: 'TAKEALOT', category: 'Entertainment' },

  // Clothing
  { pattern: 'MR PRICE', category: 'Clothing' },
  { pattern: 'COTTON ON', category: 'Clothing' },
  { pattern: 'ACKERMANS', category: 'Clothing' },

  // Insurance
  { pattern: 'DISCOVERY', category: 'Insurance' },
  { pattern: 'OLD MUTUAL', category: 'Insurance' },

  // Medical
  { pattern: 'DIS CHEM', category: 'Medical' },
  { pattern: 'CLICKS', category: 'Medical' },

  // Utilities (added): mobile networks
  { pattern: 'VODACOM', category: 'Utilities' },
  { pattern: 'MTN', category: 'Utilities' },
  { pattern: 'TELKOM', category: 'Utilities' },

  // Salary (added): EFT salary references normalise to "SALARY"
  { pattern: 'SALARY', category: 'Salary' },
];
