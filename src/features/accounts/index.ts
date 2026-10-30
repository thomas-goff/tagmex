import 'server-only';
import { db } from '@/db';
import { createAccountLabelRepo } from './repo';

export const accountLabelRepo = createAccountLabelRepo(db);
