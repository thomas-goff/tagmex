// Gives the owner the starter categories and merchant rules from
// src/features/categorisation/defaults.ts and the starter savings accounts from
// src/features/savings/defaults.ts, then applies the rules to uncategorised transactions.
// Safe to re-run: only missing rows are added, and categorised transactions are never changed.
// Usage: npm run db:seed
import { createBudgetRepo } from '@/features/budget/repo';
import { accountKey } from '@/features/accounts/labels';
import { createAccountLabelRepo } from '@/features/accounts/repo';
import { createSavingsRepo } from '@/features/savings/repo';
import { seedSavingsAccounts } from '@/features/savings/seed';
import { createLedger } from '@/features/transactions/ledger';
import { OWNER_USER_ID } from '@/features/users/owner';
import { openDatabase, runScript } from './_db';

runScript(async () => {
  const { db, close } = openDatabase();
  try {
    const { addedCategories, addedRules, categorisedExisting } = await createLedger(db).seedDefaults(OWNER_USER_ID);
    console.log(`Added ${addedCategories} categories and ${addedRules} merchant rules for "${OWNER_USER_ID}".`);
    console.log(`Categorised ${categorisedExisting} existing uncategorised transactions.`);

    const [categories, bankAccounts] = await Promise.all([
      createBudgetRepo(db).listCategories(OWNER_USER_ID),
      createAccountLabelRepo(db).listAccounts(OWNER_USER_ID),
    ]);
    const addedSavings = await seedSavingsAccounts(createSavingsRepo(db), OWNER_USER_ID, categories, bankAccounts.map(accountKey));
    console.log(`Added ${addedSavings} savings accounts.`);
  } finally {
    await close();
  }
});
