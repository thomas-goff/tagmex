import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { appUsers } from '@/db/schema';

export type AppUserRepo = ReturnType<typeof createAppUserRepo>;

export function createAppUserRepo(db: Database) {
  return {
    async findByClerkId(clerkUserId: string) {
      const [row] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.clerkUserId, clerkUserId));
      return row?.id ?? null;
    },

    // Links a first-time Clerk user to the unlinked app user with one of their verified emails.
    // Returns the app user id, or null when none matches (not allowed in).
    async linkByEmail(clerkUserId: string, verifiedEmails: string[]) {
      const emails = verifiedEmails.map((e) => e.trim().toLowerCase());
      if (emails.length === 0) return null;
      const [candidate] = await db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(and(inArray(appUsers.email, emails), isNull(appUsers.clerkUserId)))
        .orderBy(asc(appUsers.createdAt))
        .limit(1);
      if (!candidate) return null;
      const [linked] = await db
        .update(appUsers)
        .set({ clerkUserId, linkedAt: new Date() })
        .where(and(eq(appUsers.id, candidate.id), isNull(appUsers.clerkUserId)))
        .returning({ id: appUsers.id });
      // Lost a race with a concurrent first sign-in: whoever won is linked now.
      return linked?.id ?? (await this.findByClerkId(clerkUserId));
    },

    // Allow an email in, as the given app user id. Re-running updates the email and name; an
    // existing Clerk link is kept unless `unlink` (e.g. after moving to a new Clerk instance).
    async upsert({ id, email, displayName, unlink = false }: { id: string; email: string; displayName?: string; unlink?: boolean }) {
      const values = { email: email.trim().toLowerCase(), displayName: displayName ?? null };
      await db
        .insert(appUsers)
        .values({ id, ...values })
        .onConflictDoUpdate({
          target: appUsers.id,
          set: { ...values, ...(unlink ? { clerkUserId: null, linkedAt: null } : {}) },
        });
      const [row] = await db.select().from(appUsers).where(eq(appUsers.id, id));
      return row!;
    },
  };
}
