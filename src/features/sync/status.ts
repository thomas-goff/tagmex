import 'server-only';
import { db } from '@/db';
import { createSyncStatusRepo } from './status-repo';

export const syncStatusRepo = createSyncStatusRepo(db);
