import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BudgetLine } from '@/features/budget/types';
import { seedSavingsAccounts } from './seed';
import { cyclesToGoal, savingsLines, savingsTotals, type SavingsInput } from './summary';
import type { SavingsAccount } from './types';

const account = (name: string, over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id: name,
  name,
  purpose: null,
  categoryId: null,
  accountMatch: null,
  balanceSource: 'contributions',
  manualBalanceCents: null,
  manualBalanceOn: null,
  goalCents: null,
  note: null,
  sortOrder: 0,
  isActive: true,
  ...over,
});

const budgetLine = (categoryId: string, allocatedCents: number): BudgetLine => ({
  categoryId,
  categoryName: categoryId,
  categoryEmoji: null,
  expenseType: 'static',
  allocatedCents,
  expectedDay: null,
  isActive: true,
  sortOrder: 0,
  isSavings: true,
});

const input = (over: Partial<SavingsInput> = {}): SavingsInput => ({
  accounts: [],
  budgetLines: [],
  banks: [],
  contributions: [],
  categories: [],
  ...over,
});

describe('savings lines', () => {
  test('each source gives its own balance, with the date it is as at', () => {
    const lines = savingsLines(
      input({
        accounts: [
          account('TruSave', { balanceSource: 'bank', accountMatch: 'SAVE1234', sortOrder: 0 }),
          account('TFSA', { balanceSource: 'contributions', categoryId: 'tfsa', sortOrder: 1 }),
          account('ZAR', { balanceSource: 'manual', manualBalanceCents: 1_464_83, manualBalanceOn: '2026-11-19', sortOrder: 2 }),
        ],
        banks: [{ match: 'SAVE1234', availableCents: 1_515_95, availableOn: '2026-11-17' }],
        contributions: [{ categoryId: 'tfsa', contributedCents: 11_366_00 }],
      }),
    );

    assert.deepEqual(
      lines.map((l) => [l.name, l.balanceCents, l.balanceOn]),
      [
        ['TruSave', 1_515_95, '2026-11-17'],
        ['TFSA', 11_366_00, null],
        ['ZAR', 1_464_83, '2026-11-19'],
      ],
    );
  });

  test('a source with nothing to give reads as unknown, not as zero', () => {
    const lines = savingsLines(
      input({
        accounts: [
          account('30 Day', { balanceSource: 'bank', accountMatch: 'SAVE9999' }),
          account('Known', { balanceSource: 'manual', manualBalanceCents: 500_00, sortOrder: 1 }),
        ],
      }),
    );

    assert.equal(lines[0]!.balanceCents, null);
    assert.equal(lines[0]!.progressPct, null);
    const totals = savingsTotals(lines);
    assert.equal(totals.savedCents, 500_00);
    assert.deepEqual(totals.unknown, ['30 Day']);
  });

  test('progress and what is left come off the goal, and the budget says how long that takes', () => {
    const [line] = savingsLines(
      input({
        accounts: [account('TruSave', { balanceSource: 'manual', manualBalanceCents: 1_515_95, goalCents: 10_000_00, categoryId: 'tru' })],
        budgetLines: [budgetLine('tru', 4_000_00)],
      }),
    );

    assert.equal(line!.progressPct, 15);
    assert.equal(line!.remainingCents, 8_484_05);
    assert.equal(line!.budgetedCents, 4_000_00);
    assert.equal(cyclesToGoal(line!), 3);
  });

  test('past the goal there is nothing left to do, and no goal means no progress', () => {
    const [done, open] = savingsLines(
      input({
        accounts: [
          account('Done', { balanceSource: 'manual', manualBalanceCents: 12_000_00, goalCents: 10_000_00 }),
          account('Open', { balanceSource: 'manual', manualBalanceCents: 900_00, sortOrder: 1 }),
        ],
      }),
    );

    assert.equal(done!.remainingCents, 0);
    assert.equal(cyclesToGoal(done!), null);
    assert.equal(open!.progressPct, null);
    assert.equal(cyclesToGoal(open!), null);
  });

  test('totals and the per-cycle amount skip archived pots', () => {
    const lines = savingsLines(
      input({
        accounts: [
          account('Live', { balanceSource: 'manual', manualBalanceCents: 100_00, categoryId: 'a' }),
          account('Old', { balanceSource: 'manual', manualBalanceCents: 900_00, categoryId: 'b', isActive: false, sortOrder: 1 }),
        ],
        budgetLines: [budgetLine('a', 50_00), budgetLine('b', 70_00)],
      }),
    );

    assert.deepEqual(savingsTotals(lines), { budgetedCents: 50_00, savedCents: 100_00, unknown: [] });
  });
});

describe('seeding savings accounts', () => {
  function fakeRepo(existing: SavingsAccount[] = []) {
    const created: { name: string; categoryId: string | null; accountMatch: string | null; balanceSource: string }[] = [];
    return {
      created,
      repo: {
        listSavingsAccounts: async () => existing,
        createSavingsAccount: async (_userId: string, input: { name: string; categoryId?: string | null; accountMatch?: string | null; balanceSource?: string }) => {
          created.push({
            name: input.name,
            categoryId: input.categoryId ?? null,
            accountMatch: input.accountMatch ?? null,
            balanceSource: input.balanceSource ?? 'contributions',
          });
          return input.name;
        },
      },
    };
  }

  test('links the categories it finds by name and leaves the rest unlinked', async () => {
    const { repo, created } = fakeRepo();
    const added = await seedSavingsAccounts(repo, 'owner', [{ id: 'c-tfsa', name: 'Tax Free Savings' }], []);

    assert.equal(added, created.length);
    assert.equal(created.find((c) => c.name === 'Tax Free Savings')!.categoryId, 'c-tfsa');
    assert.equal(created.find((c) => c.name === 'EasyEquities ZAR')!.categoryId, null);
  });

  test('a pot meant to read a bank balance falls back when that account is unknown', async () => {
    const { repo, created } = fakeRepo();
    await seedSavingsAccounts(repo, 'owner', [], []);
    assert.equal(created.find((c) => c.name === 'TruSave')!.balanceSource, 'manual');

    const second = fakeRepo();
    await seedSavingsAccounts(second.repo, 'owner', [], ['SAVE1234']);
    assert.equal(second.created.find((c) => c.name === 'TruSave')!.balanceSource, 'manual');
  });

  test('re-running adds nothing, whatever the name was changed to in case', async () => {
    const { repo, created } = fakeRepo([account('trusave'), account('30 Day Savings'), account('Tax Free Savings'), account('Retirement Annuity'), account('EasyEquities ZAR')]);
    assert.equal(await seedSavingsAccounts(repo, 'owner', [], []), 0);
    assert.deepEqual(created, []);
  });
});
