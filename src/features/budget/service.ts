import {
  cycleContaining,
  cycleStatus,
  detectSalaryStarts,
  previousCycle,
  type Cycle,
  type SalaryCredit,
} from '@/features/cycle/cycle';
import { addDays, isIsoDate, todayIn } from '@/features/cycle/dates';
import type { BudgetRepo } from './repo';
import { summariseCycle, type CycleSummary } from './summary';
import { deriveTips } from './tips';
import { spendingTrend } from './trend';
import type { Settings } from './types';

// The budget's one service layer: MCP tools, the Discord digest and any later API all call these.
// Every function takes the user id first and reads nothing else from ambient state.

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

export const MAX_TREND_CYCLES = 12;

interface Deps {
  repo: Pick<
    BudgetRepo,
    'getSettings' | 'listSalaryCredits' | 'listLedgerRows' | 'listBudgetLines' | 'ensureBudgetItems'
  >;
  now?: () => Date;
}

export interface UserContext {
  settings: Settings;
  starts: SalaryCredit[];
  today: string;
  current: Cycle;
}

export type BudgetService = ReturnType<typeof createBudgetService>;

export function createBudgetService({ repo, now = () => new Date() }: Deps) {
  async function context(userId: string): Promise<UserContext> {
    const [settings, credits] = await Promise.all([repo.getSettings(userId), repo.listSalaryCredits(userId)]);
    const starts = detectSalaryStarts(credits, {
      salaryDayHint: settings.salaryDayHint,
      expectedSalaryCents: settings.expectedSalaryCents,
      tolerancePct: settings.salaryTolerancePct,
    });
    const today = todayIn(settings.timezone, now());
    return { settings, starts, today, current: cycleContaining(today, starts, settings.salaryDayHint) };
  }

  // A cycle id is its start date, but any date inside the cycle finds it too.
  function resolveCycle(ctx: UserContext, ref: string | undefined) {
    if (!ref) return ctx.current;
    if (!isIsoDate(ref)) throw new InvalidInputError(`"${ref}" is not a date: pass a cycle id or any date in it as YYYY-MM-DD`);
    return cycleContaining(ref, ctx.starts, ctx.settings.salaryDayHint);
  }

  // Summaries for several cycles from one query. A current cycle whose salary is late runs past its
  // projected end, so its rows are read up to today.
  async function summarise(userId: string, ctx: UserContext, cycles: Cycle[]): Promise<CycleSummary[]> {
    await repo.ensureBudgetItems(userId);
    const rowsEnd = (c: Cycle) => (c.id === ctx.current.id && addDays(ctx.today, 1) > c.end ? addDays(ctx.today, 1) : c.end);
    const from = cycles.reduce((min, c) => (c.start < min ? c.start : min), cycles[0]!.start);
    const to = cycles.reduce((max, c) => (rowsEnd(c) > max ? rowsEnd(c) : max), rowsEnd(cycles[0]!));
    const [rows, lines] = await Promise.all([repo.listLedgerRows(userId, from, to), repo.listBudgetLines(userId)]);

    return cycles.map((cycle) => {
      const end = rowsEnd(cycle);
      return summariseCycle({
        cycle,
        status: cycleStatus(cycle, ctx.today, cycle.id === ctx.current.id),
        today: ctx.today,
        rows: rows.filter((r) => r.occurredOn >= cycle.start && r.occurredOn < end),
        lines,
      });
    });
  }

  function previous(ctx: UserContext, cycle: Cycle) {
    return previousCycle(cycle, ctx.starts, ctx.settings.salaryDayHint);
  }

  return {
    context,

    async summary(userId: string, cycleRef?: string) {
      const ctx = await context(userId);
      const [summary] = await summarise(userId, ctx, [resolveCycle(ctx, cycleRef)]);
      return summary!;
    },

    // The summary, the cycle before it, and tips comparing the two.
    async overview(userId: string, cycleRef?: string) {
      const ctx = await context(userId);
      const cycle = resolveCycle(ctx, cycleRef);
      const [prior, summary] = await summarise(userId, ctx, [previous(ctx, cycle), cycle]);
      return { summary: summary!, previous: prior!, tips: deriveTips({ current: summary!, previous: prior! }) };
    },

    // The last `completed` finished cycles plus the current one, oldest first.
    async trend(userId: string, completed: number) {
      const ctx = await context(userId);
      const cycles = [ctx.current];
      for (let i = 0; i < Math.min(Math.max(completed, 1), MAX_TREND_CYCLES); i++) cycles.unshift(previous(ctx, cycles[0]!));
      return spendingTrend(await summarise(userId, ctx, cycles));
    },
  };
}
