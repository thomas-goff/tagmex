import type { CategoryInfo } from '@/features/budget/repo';
import { DEFAULT_SAVINGS_ACCOUNTS } from './defaults';
import type { SavingsRepo } from './repo';
import type { SavingsAccount } from './types';

// Adds the starter savings accounts the user hasn't got. Matched by name, case-insensitively, so
// re-running changes nothing and a renamed account is left alone rather than duplicated.
export async function seedSavingsAccounts(
  repo: Pick<SavingsRepo, 'listSavingsAccounts' | 'createSavingsAccount'>,
  userId: string,
  categories: readonly Pick<CategoryInfo, 'id' | 'name'>[],
  knownAccounts: readonly string[],
) {
  const existing = await repo.listSavingsAccounts(userId);
  const taken = new Set(existing.map((a: SavingsAccount) => a.name.toLowerCase()));
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  let added = 0;
  for (const [i, d] of DEFAULT_SAVINGS_ACCOUNTS.entries()) {
    if (taken.has(d.name.toLowerCase())) continue;
    const categoryId = d.category ? (byName.get(d.category.toLowerCase()) ?? null) : null;
    const accountMatch = d.accountMatch && knownAccounts.includes(d.accountMatch) ? d.accountMatch : null;
    await repo.createSavingsAccount(userId, {
      name: d.name,
      purpose: d.purpose,
      categoryId,
      accountMatch,
      // A bank balance with no account to read it from would show nothing, so fall back.
      balanceSource: d.balanceSource === 'bank' && !accountMatch ? 'manual' : d.balanceSource,
      goalCents: d.goalCents,
      note: d.note,
      sortOrder: existing.length + i,
    });
    added++;
  }
  return added;
}
