// Gives the owner the starter categories and merchant rules from
// src/features/categorisation/defaults.ts. Safe to re-run: only missing rows are added.
// Usage: npm run db:seed
import { createLedger } from '@/features/transactions/ledger';
import { OWNER_USER_ID } from '@/features/users/owner';
import { openDatabase, runScript } from './_db';

runScript(async () => {
  const { db, close } = openDatabase();
  try {
    const { addedCategories, addedRules } = await createLedger(db).seedDefaults(OWNER_USER_ID);
    console.log(`Added ${addedCategories} categories and ${addedRules} merchant rules for "${OWNER_USER_ID}".`);
  } finally {
    await close();
  }
});
