// The user's settings row. Scoped by the userId argument; the salary amount becomes cents here.
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { userSettings } from '@/db/schema';
import { centsToDecimal, decimalToCents } from '@/features/transactions/money';
import { DEFAULT_SETTINGS, type Settings } from './types';

export function createSettingsRepo(db: Database) {
  const columns = {
    salaryDayHint: userSettings.salaryDayHint,
    expectedSalaryAmount: userSettings.expectedSalaryAmount,
    salaryTolerancePct: userSettings.salaryTolerancePct,
    timezone: userSettings.timezone,
    digestHour: userSettings.digestHour,
    digestEnabled: userSettings.digestEnabled,
    discordAlertsEnabled: userSettings.discordAlertsEnabled,
  };

  return {
    // Creates the row with defaults on first read.
    async getSettings(userId: string): Promise<Settings> {
      await db.insert(userSettings).values({ userId }).onConflictDoNothing();
      const [row] = await db.select(columns).from(userSettings).where(eq(userSettings.userId, userId));
      if (!row) return DEFAULT_SETTINGS;
      const { expectedSalaryAmount, ...rest } = row;
      return { ...rest, expectedSalaryCents: expectedSalaryAmount === null ? null : decimalToCents(expectedSalaryAmount) };
    },

    async updateSettings(userId: string, patch: Partial<Settings>) {
      await db.insert(userSettings).values({ userId }).onConflictDoNothing();
      const { expectedSalaryCents, ...rest } = patch;
      await db
        .update(userSettings)
        .set({
          ...rest,
          ...(expectedSalaryCents === undefined
            ? {}
            : { expectedSalaryAmount: expectedSalaryCents === null ? null : centsToDecimal(expectedSalaryCents) }),
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, userId));
    },
  };
}
