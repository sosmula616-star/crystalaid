import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '@crystalaid/config';
import { AppError, type MeResponse } from '@crystalaid/contracts';
import { staffMembers, users, type Db } from '@crystalaid/database';
import { PERMISSIONS, atLeast, type Permission } from '@crystalaid/domain';

export function registerMe(app: FastifyInstance, deps: { db: Db; config: ServerConfig }): void {
  const { db, config } = deps;
  app.get('/me', { onRequest: [app.requireStaff] }, async (request): Promise<MeResponse> => {
    const { actor } = request;
    const [row] = await db
      .select({ user: users, staff: staffMembers })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(and(eq(staffMembers.guildId, config.guildId), eq(staffMembers.userId, actor.userId)));
    if (!row) throw new AppError('NOT_STAFF', 'No access to the staff panel', 403, 'not_in_branch');
    const permissions: Permission[] =
      atLeast(actor.level, 'ADMIN') ? [...PERMISSIONS] : PERMISSIONS.filter((p) => actor.grants.includes(p));
    return {
      user: { id: row.user.id, discordId: row.user.discordId, username: row.user.username, avatar: row.user.avatar },
      level: actor.level,
      position: row.staff.position,
      status: row.staff.status,
      tokenBalance: row.staff.tokenBalance,
      permissions,
    };
  });
}
