import { hasCronSecret, unauthorised } from '@/features/auth/cron-secret';
import { ledger } from '@/features/transactions';
import { OWNER_USER_ID } from '@/features/users/owner';

// GET /api/categories: the names and ids accepted by POST /api/transactions/{id}/category.
export async function GET(req: Request) {
  if (!hasCronSecret(req)) return unauthorised();
  return Response.json({ categories: await ledger.stores.categories.listCategories(OWNER_USER_ID) });
}
