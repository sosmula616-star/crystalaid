import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerConfig } from '@crystalaid/config';
import type { StaffListResponse } from '@crystalaid/contracts';
import { staffMembers, users, type Db } from '@crystalaid/database';
import { PAGE_SIZE, decodeCursor, encodeCursor } from './cursor.js';

const Query = z.object({
  status: z.enum(['active', 'inactive']).default('active'),
  cursor: z.string().min(1).optional(),
});

export function registerStaff(app: FastifyInstance, deps: { db: Db; config: ServerConfig }): void {
  const { db, config } = deps;
  app.get(
    '/staff',
    { onRequest: [app.requireStaff, app.requireLevel('CURATOR')] },
    async (request): Promise<StaffListResponse> => {
      const query = Query.parse(request.query);
      const after = query.cursor ? decodeCursor(query.cursor) : undefined;
      const stamp = sql<string>`${staffMembers.joinedAt}::text`;

      const rows = await db
        .select({ staff: staffMembers, user: users, stamp })
        .from(staffMembers)
        .innerJoin(users, eq(users.id, staffMembers.userId))
        .where(
          and(
            eq(staffMembers.guildId, config.guildId),
            eq(staffMembers.status, query.status),
            after
              ? sql`(${staffMembers.joinedAt}, ${staffMembers.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(staffMembers.joinedAt), desc(staffMembers.id))
        .limit(PAGE_SIZE + 1);

      const page = rows.slice(0, PAGE_SIZE);
      const last = page[page.length - 1];
      return {
        items: page.map(({ staff, user }) => ({
          userId: user.id,
          discordId: user.discordId,
          username: user.username,
          avatar: user.avatar,
          level: staff.level,
          status: staff.status,
          position: staff.position,
          joinedAt: staff.joinedAt.toISOString(),
          tokenBalance: staff.tokenBalance,
        })),
        nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ ts: last.stamp, id: last.staff.id }) : null,
      };
    },
  );
}
