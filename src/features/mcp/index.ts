// Composition root for the MCP endpoint: real database, Clerk and sync behind the pure pieces.
import 'server-only';
import { db } from '@/db';
import { accountLabelRepo } from '@/features/accounts';
import { budget, budgetRepo } from '@/features/budget';
import { reviewMessages } from '@/features/notifications/review-messages';
import { syncMailbox } from '@/features/sync/sync-mailbox';
import { ledger } from '@/features/transactions';
import { createAppUserRepo } from '@/features/users/app-users';
import { createAuditLog } from './audit';
import { verifiedEmails, verifyClerkToken } from './clerk';
import { createMcpEndpoint, resourceMetadataUrl, resourceUrl } from './server';

const users = createAppUserRepo(db);

// Linked users resolve with one indexed lookup; a first sign-in costs one Clerk API call.
async function resolveUserId(clerkUserId: string) {
  return (await users.findByClerkId(clerkUserId)) ?? users.linkByEmail(clerkUserId, await verifiedEmails(clerkUserId));
}

export const handleMcpRequest = createMcpEndpoint({
  tools: {
    budget,
    repo: budgetRepo,
    accounts: accountLabelRepo,
    ledger,
    audit: createAuditLog(db),
    review: reviewMessages,
    async reprocessFailed(userId) {
      const { fetched, parsed, ignored, failed } = await syncMailbox(userId, { retryFailed: true });
      return { fetched, parsed, ignored, failed };
    },
  },
  auth: (request) => {
    const origin = new URL(request.url).origin;
    return {
      verifyToken: (token) => verifyClerkToken(token, resourceUrl(origin)),
      resolveUserId,
      resourceMetadataUrl: resourceMetadataUrl(origin),
    };
  },
});
