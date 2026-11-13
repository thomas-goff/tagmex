// Composition root: wires the transaction services to a database. The app uses the instance in
// ./index.ts; local scripts call createLedger with their own connection.
import type { Database } from '@/db/client';
import { createCategoryCorrector } from './correct-category';
import { createDrizzleStores } from './drizzle-stores';
import { createManualEntries } from './manual-entries';
import type { UnitOfWork } from './ports';
import { createTransactionRecorder } from './record-transaction';
import { seedDefaults } from './seed-defaults';

export type Ledger = ReturnType<typeof createLedger>;

export function createLedger(database: Database) {
  const stores = createDrizzleStores(database);
  const unitOfWork: UnitOfWork = (work) => database.transaction((tx) => work(createDrizzleStores(tx)));

  return {
    stores,
    // One per sync run or script run (it caches the user's rules).
    createRecorder: () => createTransactionRecorder({ stores, unitOfWork }),
    corrector: createCategoryCorrector({ stores, unitOfWork }),
    // Transactions added by hand, and splits.
    manual: createManualEntries({
      stores,
      unitOfWork,
      categorise: async (userId, tx) => (await createTransactionRecorder({ stores, unitOfWork }).preview(userId, tx)).categorisation,
    }),
    seedDefaults: (userId: string) => seedDefaults(stores, userId),
  };
}
