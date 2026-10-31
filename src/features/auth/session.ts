import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { resolveAppUserId } from '@/features/users/resolve';

// The dashboard's one authorisation check: every page and Server Action calls this first and runs
// as the app user it returns, never an id from the request. The proxy's redirect is only a
// shortcut; this is the check. Signed out → /sign-in; signed in but not on the allowlist (the
// same app_users list MCP uses) → /not-allowed.
export const requireUser = cache(async () => {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const userId = await resolveAppUserId(clerkUserId);
  if (!userId) redirect('/not-allowed');
  return { userId, clerkUserId };
});
