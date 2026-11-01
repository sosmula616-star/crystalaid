import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerConfig } from '@crystalaid/config';
import { AppError, DiscordId } from '@crystalaid/contracts';
import { staffMembers, users, type Db } from '@crystalaid/database';

const Params = z.object({ discordUserId: DiscordId });

/** For the bot only; the service token is the whole authentication. */
export function registerInternal(app: FastifyInstance, deps: { db: Db; config: ServerConfig }): void {
  const { db, config } = deps;
  app.get('/internal/members/:discordUserId', { onRequest: [app.requireService] }, async (request) => {
    const { discordUserId } = Params.parse(request.params);
    const [row] = await db
      .select({ staff: staffMembers, username: users.username })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(and(eq(staffMembers.guildId, config.guildId), eq(users.discordId, discordUserId)));
    if (!row) throw new AppError('NOT_FOUND', 'Not found', 404);
    return {
      level: row.staff.level,
      status: row.staff.status,
      tokenBalance: row.staff.tokenBalance,
      username: row.username,
    };
  });
}
