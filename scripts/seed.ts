// Gives the owner the starter categories and merchant rules from
// src/features/categorisation/defaults.ts, then applies the rules to uncategorised transactions.
// Safe to re-run: only missing rows are added, and categorised transactions are never changed.
// Usage: npm run db:seed
import { createLedger } from '@/features/transactions/ledger';
import { OWNER_USER_ID } from '@/features/users/owner';
import { openDatabase, runScript } from './_db';

runScript(async () => {
  const { db, close } = openDatabase();
  try {
    const { addedCategories, addedRules, categorisedExisting } = await createLedger(db).seedDefaults(OWNER_USER_ID);
    console.log(`Added ${addedCategories} categories and ${addedRules} merchant rules for "${OWNER_USER_ID}".`);
    console.log(`Categorised ${categorisedExisting} existing uncategorised transactions.`);
  } finally {
    await close();
  }
});
