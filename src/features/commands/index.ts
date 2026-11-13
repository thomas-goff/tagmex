import 'server-only';
import { accountLabelRepo } from '@/features/accounts';
import { budget, budgetRepo } from '@/features/budget';
import { reviewMessages } from '@/features/notifications/review-messages';
import { statusPoster } from '@/features/notifications/status';
import { ledger } from '@/features/transactions';
import { createCommands } from './commands';

export const commands = createCommands({ budget, repo: budgetRepo, accounts: accountLabelRepo, ledger, review: reviewMessages, status: statusPoster });
