// Composition root for the MCP endpoint: real database, Clerk and sync behind the pure pieces.
import 'server-only';
import { db } from '@/db';
import { accountLabelRepo } from '@/features/accounts';
import { budget, budgetRepo } from '@/features/budget';
import { postMessage } from '@/features/notifications/discord';
import { reviewMessages } from '@/features/notifications/review-messages';
import { syncMailbox } from '@/features/sync/sync-mailbox';
import { ledger } from '@/features/transactions';
import { resolveAppUserId } from '@/features/users/resolve';
import { createAuditLog } from './audit';
import { verifyClerkToken } from './clerk';
import { createMcpEndpoint, resourceMetadataUrl, resourceUrl } from './server';

export const handleMcpRequest = createMcpEndpoint({
  tools: {
    budget,
    repo: budgetRepo,
    accounts: accountLabelRepo,
    ledger,
    audit: createAuditLog(db),
    review: reviewMessages,
    discord: { post: (channel, payload) => postMessage(channel, payload) },
    async reprocessFailed(userId) {
      const { fetched, parsed, ignored, failed } = await syncMailbox(userId, { retryFailed: true });
      return { fetched, parsed, ignored, failed };
    },
  },
  auth: (request) => {
    const origin = new URL(request.url).origin;
    return {
      verifyToken: (token) => verifyClerkToken(token, resourceUrl(origin)),
      resolveUserId: resolveAppUserId,
      resourceMetadataUrl: resourceMetadataUrl(origin),
    };
  },
});
