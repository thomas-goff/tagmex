import 'server-only';
import { db } from '@/db';
import { createBudgetRepo } from './repo';
import { createBudgetService } from './service';

export const budgetRepo = createBudgetRepo(db);
export const budget = createBudgetService({ repo: budgetRepo });
