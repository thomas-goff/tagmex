import 'server-only';
import { budget, budgetRepo } from '@/features/budget';
import { reviewMessages } from '@/features/notifications/review-messages';
import { ledger } from '@/features/transactions';
import { createCommands } from './commands';

export const commands = createCommands({ budget, repo: budgetRepo, ledger, review: reviewMessages });
