import 'server-only';
import { db } from '@/db';
import { createLedger } from './ledger';

export const ledger = createLedger(db);
