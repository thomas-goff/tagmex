import 'server-only';
import { db } from '@/db';
import { verifiedEmails } from '@/features/mcp/clerk';
import { createAppUserRepo } from './app-users';

const users = createAppUserRepo(db);

// The app user a Clerk user signs in as (MCP and the dashboard alike), or null when their verified
// emails aren't allowed in. Linked users resolve with one indexed lookup; a first sign-in costs one
// Clerk API call.
export async function resolveAppUserId(clerkUserId: string) {
  return (await users.findByClerkId(clerkUserId)) ?? users.linkByEmail(clerkUserId, await verifiedEmails(clerkUserId));
}
