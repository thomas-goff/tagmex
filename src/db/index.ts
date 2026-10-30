import 'server-only';
import { env } from '@/env';
import { createDb } from './client';

export const db = createDb(env.DATABASE_URL).db;
