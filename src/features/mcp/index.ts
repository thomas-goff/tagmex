// Composition root for the MCP endpoint: real database, Clerk and sync behind the pure pieces.
import 'server-only';
import { db } from '@/db';
import { accountLabelRepo } from '@/features/accounts';
import { budget, budgetRepo } from '@/features/budget';
import { commands } from '@/features/commands';
import { syncStatusRepo } from '@/features/sync/status';
import { mailboxSync } from '@/features/sync';
import { ledger } from '@/features/transactions';
import { resolveAppUserId } from '@/features/users/resolve';
import { createAuditLog } from './audit';
import { verifyClerkToken } from './clerk';
import { createMcpEndpoint, resourceMetadataUrl, resourceUrl } from './server';

export const handleMcpRequest = createMcpEndpoint({
  tools: {
    commands,
    budget,
    repo: budgetRepo,
    accounts: accountLabelRepo,
    uncategorised: ledger.stores.transactions,
    sync: syncStatusRepo,
    audit: createAuditLog(db),
    async reprocessFailed(userId) {
      const { fetched, parsed, ignored, failed } = await mailboxSync.run(userId, { retryFailed: true });
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
