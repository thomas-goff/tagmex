import { z } from 'zod';
import { hasCronSecret, unauthorised } from '@/features/auth/cron-secret';
import { ledger } from '@/features/transactions';
import { NotFoundError, findCategory } from '@/features/transactions/correct-category';
import { OWNER_USER_ID } from '@/features/users/owner';

const body = z.object({
  // A category name (any case) or id, from GET /api/categories.
  category: z.string().trim().min(1),
});

// POST /api/transactions/{id}/category  {"category": "Groceries"}
// Sets the category, learns a rule for the description and applies it to matching uncategorised
// transactions. Interim: phase 3's MCP tool replaces this.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasCronSecret(req)) return unauthorised();

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: 'transaction id must be a uuid' }, { status: 400 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'expected {"category": "<name or id>"}' }, { status: 400 });

  const categories = await ledger.stores.categories.listCategories(OWNER_USER_ID);
  const category = findCategory(categories, parsed.data.category);
  if (!category) {
    return Response.json(
      { error: `no category "${parsed.data.category}"`, categories: categories.map((c) => c.name) },
      { status: 404 },
    );
  }

  try {
    const result = await ledger.corrector.correct({ userId: OWNER_USER_ID, transactionId: id, categoryId: category.id });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
