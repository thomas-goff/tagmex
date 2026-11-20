import type { SavingsBalanceSource } from './types';

// The pots to start with, from the savings notes. Seeded, never migrated: `npm run db:seed` adds
// only what is missing, so editing or removing one here afterwards is safe and re-running it will
// not undo your changes.
//
// `category` is matched by name against the user's savings categories, `accountMatch` against
// their own bank accounts (type + last 4). Either one missing just leaves that link unset.
export interface DefaultSavingsAccount {
  name: string;
  purpose: string;
  category: string | null;
  accountMatch: string | null;
  balanceSource: SavingsBalanceSource;
  goalCents: number | null;
  note: string | null;
}

export const DEFAULT_SAVINGS_ACCOUNTS: readonly DefaultSavingsAccount[] = [
  {
    name: 'TruSave',
    purpose: 'Emergency fund',
    category: 'TruSave',
    accountMatch: null,
    balanceSource: 'bank',
    goalCents: 10_000_00,
    note: 'Fill this first. Pay emergencies from here, then give notice on the 30 Day account to refill it.',
  },
  {
    name: '30 Day Savings',
    purpose: 'Car / house',
    category: null,
    accountMatch: null,
    balanceSource: 'manual',
    goalCents: 200_000_00,
    note: 'Gets the monthly amount once TruSave reaches R10,000.',
  },
  {
    name: 'Tax Free Savings',
    purpose: 'Long term (EasyEquities)',
    category: 'Tax Free Savings',
    accountMatch: null,
    // The lifetime cap counts what was paid in, not what it has grown to, so contributions are the
    // figure that matters against the goal.
    balanceSource: 'contributions',
    goalCents: 500_000_00,
    note: 'Lifetime cap counts deposits, not growth. Annual limit R46,000. New money into MSCI World / Nasdaq 100.',
  },
  {
    name: 'Retirement Annuity',
    purpose: 'Retirement (EasyEquities)',
    category: 'Retirement Annuity',
    accountMatch: null,
    balanceSource: 'contributions',
    goalCents: null,
    note: 'No goal: just make sure the monthly minimum goes in. About R310 back from SARS per R1,000.',
  },
  {
    name: 'EasyEquities ZAR',
    purpose: 'Investing',
    category: null,
    accountMatch: null,
    balanceSource: 'manual',
    goalCents: null,
    note: 'Portfolio total minus the tax free account and the retirement annuity.',
  },
];
