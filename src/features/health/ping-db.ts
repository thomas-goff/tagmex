import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

// Round-trips a trivial query and returns how long it took in ms.
export async function pingDb() {
  const t0 = performance.now();
  await db.execute(sql`select 1`);
  return Math.round(performance.now() - t0);
}
