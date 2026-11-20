import type { BudgetLine, BudgetLineVersion } from './types';

// Which budget figures a cycle runs on. Pure: the repo hands over every version it holds and these
// pick the ones in force, so one query answers a whole run of cycles and each still reads the
// budget as it stood when that cycle started.

// What rows written before budgets were versioned carry, and where a brand new category's first
// figures go: in force for every cycle, past and future, until something later supersedes them.
export const BUDGET_EPOCH = '1970-01-01';

function byPosition(a: BudgetLine, b: BudgetLine) {
  return a.sortOrder - b.sortOrder || a.categoryName.localeCompare(b.categoryName);
}

// The version of each category's budget in force on `asOf` (a cycle's start date): the newest one
// dated on or before it. A category whose only versions are later has no budget yet, so it is left
// out rather than counted at zero.
export function effectiveLines(versions: readonly BudgetLineVersion[], asOf: string): BudgetLine[] {
  const chosen = new Map<string, BudgetLineVersion>();
  for (const v of versions) {
    if (v.effectiveFrom > asOf) continue;
    const held = chosen.get(v.categoryId);
    if (!held || v.effectiveFrom > held.effectiveFrom) chosen.set(v.categoryId, v);
  }
  // A version is a BudgetLine with a date on it, so there is nothing to strip.
  return [...chosen.values()].sort(byPosition);
}

// Changes dated past `asOf`: what is queued but not yet in force. Soonest first.
export function scheduledChanges(versions: readonly BudgetLineVersion[], asOf: string): BudgetLineVersion[] {
  return versions
    .filter((v) => v.effectiveFrom > asOf)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || byPosition(a, b));
}

// The version a new one should be built from: what is in force on `effectiveFrom` (so an unchanged
// field carries forward), or the earliest later version when the category has nothing in force yet.
export function versionToExtend(versions: readonly BudgetLineVersion[], categoryId: string, effectiveFrom: string) {
  const mine = versions.filter((v) => v.categoryId === categoryId);
  const inForce = mine.filter((v) => v.effectiveFrom <= effectiveFrom).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return inForce ?? mine.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
}
