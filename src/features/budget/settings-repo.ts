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
    // Read only: no row yet means nothing has been changed from the defaults, which is exactly what
    // DEFAULT_SETTINGS is. The row is created by the first updateSettings, so this stays off the
    // write path -- every page load used to insert here before reading.
    async getSettings(userId: string): Promise<Settings> {
      const [row] = await db.select(columns).from(userSettings).where(eq(userSettings.userId, userId));
      if (!row) return DEFAULT_SETTINGS;
      const { expectedSalaryAmount, ...rest } = row;
      return { ...rest, expectedSalaryCents: expectedSalaryAmount === null ? null : decimalToCents(expectedSalaryAmount) };
    },

    // One upsert that returns the settings as they now stand: the row is created with the column
    // defaults if it is the user's first change, and whatever the patch leaves out keeps its value.
    // Callers used to follow this with getSettings, which was two more round trips for a row the
    // write already had.
    async updateSettings(userId: string, patch: Partial<Settings>): Promise<Settings> {
      const { expectedSalaryCents, ...rest } = patch;
      const changes = {
        ...rest,
        ...(expectedSalaryCents === undefined
          ? {}
          : { expectedSalaryAmount: expectedSalaryCents === null ? null : centsToDecimal(expectedSalaryCents) }),
      };
      const [row] = await db
        .insert(userSettings)
        .values({ userId, ...changes })
        .onConflictDoUpdate({ target: userSettings.userId, set: { ...changes, updatedAt: new Date() } })
        .returning(columns);
      const { expectedSalaryAmount, ...saved } = row!;
      return { ...saved, expectedSalaryCents: expectedSalaryAmount === null ? null : decimalToCents(expectedSalaryAmount) };
    },
  };
}
