import { and, count, eq, gte } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { mcpAuditLog } from '@/db/schema';
import type { AuditLog } from './tool';

export function createAuditLog(db: Database): AuditLog {
  return {
    async record(entry) {
      await db.insert(mcpAuditLog).values(entry);
    },

    async countSince(userId, since) {
      const [row] = await db
        .select({ n: count() })
        .from(mcpAuditLog)
        .where(and(eq(mcpAuditLog.userId, userId), gte(mcpAuditLog.at, since)));
      return row?.n ?? 0;
    },

    async countOkSince(userId, tool, since) {
      const [row] = await db
        .select({ n: count() })
        .from(mcpAuditLog)
        .where(and(eq(mcpAuditLog.userId, userId), eq(mcpAuditLog.tool, tool), eq(mcpAuditLog.status, 'ok'), gte(mcpAuditLog.at, since)));
      return row?.n ?? 0;
    },
  };
}
