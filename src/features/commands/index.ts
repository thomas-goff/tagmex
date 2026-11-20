import 'server-only';
import { accountLabelRepo } from '@/features/accounts';
import { budget, budgetRepo } from '@/features/budget';
import { reviewMessages } from '@/features/notifications/review-messages';
import { statusPoster } from '@/features/notifications/status';
import { savingsRepo } from '@/features/savings';
import { ledger } from '@/features/transactions';
import { createCommands } from './commands';

export const commands = createCommands({
  budget,
  repo: budgetRepo,
  accounts: accountLabelRepo,
  savings: savingsRepo,
  ledger,
  review: reviewMessages,
  status: statusPoster,
});
