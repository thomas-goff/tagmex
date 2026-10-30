import 'server-only';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '@/env';

// Transaction pooler requires prepare: false. max: 1 suits serverless.
const client = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
export const db = drizzle({ client });
