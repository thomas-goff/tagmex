import { hasCronSecret, unauthorised } from '@/features/auth/cron-secret';
import { formatRand } from '@/features/sync/format';
import { ledger } from '@/features/transactions';
import { OWNER_USER_ID } from '@/features/users/owner';

// GET /api/transactions/uncategorised: uncategorised transactions grouped by description, biggest
// group first. Correcting a group's latestTransactionId learns a rule that fixes the whole group.
export async function GET(req: Request) {
  if (!hasCronSecret(req)) return unauthorised();
  const groups = await ledger.stores.transactions.summariseUncategorised(OWNER_USER_ID);
  return Response.json({
    transactions: groups.reduce((n, g) => n + g.count, 0),
    groups: groups.map((g) => ({ ...g, total: formatRand(g.totalCents) })),
  });
}
