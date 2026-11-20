import 'server-only';
import { db } from '@/db';
import { createSavingsRepo } from './repo';

export const savingsRepo = createSavingsRepo(db);
