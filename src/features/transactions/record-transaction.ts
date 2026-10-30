import type { ParsedTransaction } from '@/features/bank-email/types';
import { categorise } from '@/features/categorisation/categorise';
import { TRANSFER_WINDOW_DAYS } from '@/features/categorisation/steps';
import {
  UNCATEGORISED,
  type CategorisableTransaction,
  type Categorisation,
  type Category,
  type CategoryRule,
} from '@/features/categorisation/types';
import type { NewTransaction, Stores, UnitOfWork } from './ports';

export interface RecordInput {
  userId: string;
  ingestedMessageId: string;
  gmailMessageId: string;
  transaction: ParsedTransaction;
}

export interface RecordOutcome {
  transactionId: string;
  // False when this email already had a row (a retry, or a backfill racing the sync).
  created: boolean;
  // Null = uncategorised.
  categoryName: string | null;
}

export interface Preview {
  categorisation: Categorisation;
  categoryName: string | null;
}

interface Deps {
  stores: Pick<Stores, 'transactions' | 'categories'>;
  unitOfWork: UnitOfWork;
  log?: Pick<Console, 'error'>;
}

interface Catalogue {
  rules: CategoryRule[];
  transferCategoryId: string | null;
  nameById: Map<string, string>;
}

export type TransactionRecorder = ReturnType<typeof createTransactionRecorder>;

// Turns parsed bank emails into categorised ledger rows. Create one per sync run or script: it
// loads each user's categories and rules once and reuses them for every email in the run.
export function createTransactionRecorder({ stores, unitOfWork, log = console }: Deps) {
  const catalogues = new Map<string, Promise<Catalogue>>();

  function catalogue(userId: string) {
    let loaded = catalogues.get(userId);
    if (!loaded) {
      loaded = loadCatalogue(userId);
      loaded.catch(() => catalogues.delete(userId)); // let the next email retry
      catalogues.set(userId, loaded);
    }
    return loaded;
  }

  async function loadCatalogue(userId: string): Promise<Catalogue> {
    const [categories, rules] = await Promise.all([
      stores.categories.listCategories(userId),
      stores.categories.listRules(userId),
    ]);
    return {
      rules,
      transferCategoryId: systemCategory(categories, 'transfer')?.id ?? null,
      nameById: new Map(categories.map((c) => [c.id, c.name])),
    };
  }

  // A categorisation problem (bad rule, database hiccup) must never stop the email being recorded.
  async function categoriseSafely(userId: string, tx: CategorisableTransaction) {
    try {
      const { rules, transferCategoryId } = await catalogue(userId);
      const transferCandidates = transferCategoryId
        ? await stores.transactions.findTransferCandidates(userId, tx, TRANSFER_WINDOW_DAYS)
        : [];
      return categorise(tx, { rules, transferCategoryId, transferCandidates }, { onError: (err) => log.error(err) });
    } catch (err) {
      log.error('categorisation failed, recording as uncategorised', err);
      return UNCATEGORISED;
    }
  }

  async function nameOf(userId: string, categoryId: string | null) {
    if (!categoryId) return null;
    const { nameById } = await catalogue(userId).catch(() => ({ nameById: new Map<string, string>() }));
    return nameById.get(categoryId) ?? 'unknown category';
  }

  return {
    // What a parsed email would be categorised as. Reads only; used by dry runs.
    async preview(userId: string, parsed: ParsedTransaction): Promise<Preview> {
      const categorisation = await categoriseSafely(userId, categorisable(parsed));
      return { categorisation, categoryName: await nameOf(userId, categorisation.categoryId) };
    },

    // Insert the ledger row (once, ever, per email), categorise it, and link the ingested message.
    async record({ userId, ingestedMessageId, gmailMessageId, transaction }: RecordInput): Promise<RecordOutcome> {
      const categorisation = await categoriseSafely(userId, categorisable(transaction));

      const { id, created, categoryId } = await unitOfWork(async (s) => {
        const row = await s.transactions.insertIfNew(newTransaction(userId, gmailMessageId, transaction, categorisation));
        if (row.created && categorisation.counterpartId) {
          // The other leg arrived first and was left uncategorised: it is a transfer too.
          const { categoryId, source, ruleId } = categorisation;
          await s.transactions.categoriseIfUncategorised(userId, [categorisation.counterpartId], {
            categoryId,
            source,
            ruleId,
          });
        }
        await s.ingestedMessages.linkTransaction(ingestedMessageId, row.id);
        const categoryId = row.created
          ? categorisation.categoryId
          : ((await s.transactions.findById(userId, row.id))?.categoryId ?? null);
        return { ...row, categoryId };
      });

      return { transactionId: id, created, categoryName: await nameOf(userId, categoryId) };
    },
  };
}

function systemCategory(categories: Category[], kind: Category['kind']) {
  return categories.find((c) => c.isSystem && c.kind === kind);
}

function categorisable(t: ParsedTransaction): CategorisableTransaction {
  return {
    descriptionNormalised: t.description,
    amountCents: t.amountCents,
    occurredOn: t.occurredOn,
    accountLast4: t.accountLast4,
  };
}

function newTransaction(
  userId: string,
  gmailMessageId: string,
  t: ParsedTransaction,
  { categoryId, source, ruleId }: Categorisation,
): NewTransaction {
  return {
    userId,
    accountType: t.accountType,
    accountLast4: t.accountLast4,
    occurredOn: t.occurredOn,
    amountCents: t.amountCents,
    descriptionRaw: t.descriptionRaw,
    descriptionNormalised: t.description,
    balanceAfterCents: t.balanceAfterCents ?? null,
    kind: t.kind,
    transactionType: t.transactionType,
    reserved: t.reserved,
    source: 'gmail',
    sourceRef: gmailMessageId,
    category: { categoryId, source, ruleId },
  };
}
