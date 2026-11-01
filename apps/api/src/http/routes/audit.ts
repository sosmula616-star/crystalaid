import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerConfig } from '@crystalaid/config';
import type { AuditListResponse } from '@crystalaid/contracts';
import { auditLog, type Db } from '@crystalaid/database';
import { PAGE_SIZE, decodeCursor, encodeCursor } from './cursor.js';

const Query = z.object({ cursor: z.string().min(1).optional() });

export function registerAudit(app: FastifyInstance, deps: { db: Db; config: ServerConfig }): void {
  const { db, config } = deps;
  app.get(
    '/audit',
    { onRequest: [app.requireStaff, app.requireLevel('ADMIN')] },
    async (request): Promise<AuditListResponse> => {
      const { cursor } = Query.parse(request.query);
      const after = cursor ? decodeCursor(cursor) : undefined;
      const stamp = sql<string>`${auditLog.createdAt}::text`;

      const rows = await db
        .select({ row: auditLog, stamp })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.guildId, config.guildId),
            after
              ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(PAGE_SIZE + 1);

      const page = rows.slice(0, PAGE_SIZE);
      const last = page[page.length - 1];
      return {
        items: page.map(({ row }) => ({
          id: row.id,
          actorUserId: row.actorUserId,
          action: row.action,
          targetUserId: row.targetUserId,
          reason: row.reason,
          data: row.data,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ ts: last.stamp, id: last.row.id }) : null,
      };
    },
  );
}
