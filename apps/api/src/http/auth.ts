import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env, ServerConfig } from '@crystalaid/config';
import { ActivityAuthRequest, AppError, type ActivityAuthResponse } from '@crystalaid/contracts';
import { staffMembers, users, type Db } from '@crystalaid/database';
import { hasPermission, type Level, type Permission } from '@crystalaid/domain';
import type { DiscordClient } from '../discord/client.js';
import { getGrants } from '../services/permissions.js';
import { SESSION_TTL_SECONDS, signSession, verifySession } from '../services/session.js';
import { syncMember } from '../services/staff.js';
import { LOGIN_LIMIT } from './rateLimit.js';

/** Who is calling. Read from the database on every request, never from the token. */
export interface Actor {
  userId: string;
  discordUserId: string;
  level: Level;
  grants: Permission[];
}

type Guard = (request: FastifyRequest) => Promise<void>;

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
  interface FastifyInstance {
    /** onRequest hook: valid session and an active staff record; sets `request.actor`. */
    requireStaff: Guard;
    /** Use after `requireStaff`. */
    requirePermission: (permission: Permission) => Guard;
    /** Use after `requireStaff`. The actor's level must be at least `level`. */
    requireLevel: (level: Level) => Guard;
    /** onRequest hook: `Authorization: Bearer <SERVICE_TOKEN>`, for the bot. */
    requireService: Guard;
  }
}

const LEVEL_RANK: Record<Level, number> = { NONE: 0, SUPPORT: 1, CURATOR: 2, ADMIN: 3 };

const bearer = (request: FastifyRequest): string | undefined =>
  /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1];

const digest = (value: string) => createHash('sha256').update(value).digest();

export interface AuthDeps {
  env: Env;
  config: ServerConfig;
  db: Db;
  discord: DiscordClient;
}

export function registerAuth(app: FastifyInstance, deps: AuthDeps): void {
  const { env, config, db, discord } = deps;

  app.decorateRequest('actor', null as unknown as Actor);

  app.decorate('requireStaff', async (request: FastifyRequest) => {
    const token = bearer(request);
    if (!token) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    const claims = await verifySession(token, env.JWT_SECRET);

    const [row] = await db
      .select({ staff: staffMembers, discordId: users.discordId })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(and(eq(staffMembers.guildId, config.guildId), eq(staffMembers.userId, claims.userId)));
    if (row && row.discordId !== claims.discordUserId) {
      throw new AppError('UNAUTHORIZED', 'Invalid session', 401);
    }
    if (!row || row.staff.status !== 'active' || row.staff.level === 'NONE') {
      throw new AppError('NOT_STAFF', 'No access to the staff panel', 403);
    }
    request.actor = {
      userId: claims.userId,
      discordUserId: row.discordId,
      level: row.staff.level,
      grants: await getGrants(db, config.guildId, row.staff.level),
    };
  });

  app.decorate('requirePermission', (permission: Permission): Guard => async (request) => {
    const { level, grants } = request.actor;
    if (!hasPermission(level, permission, grants)) {
      throw new AppError('FORBIDDEN', 'Not allowed', 403);
    }
  });

  app.decorate('requireLevel', (level: Level): Guard => async (request) => {
    if (LEVEL_RANK[request.actor.level] < LEVEL_RANK[level]) {
      throw new AppError('FORBIDDEN', 'Not allowed', 403);
    }
  });

  const expectedService = digest(env.SERVICE_TOKEN);
  app.decorate('requireService', async (request: FastifyRequest) => {
    const token = bearer(request);
    // Compare fixed-length digests so neither content nor length leaks through timing.
    if (!token || !timingSafeEqual(digest(token), expectedService)) {
      throw new AppError('UNAUTHORIZED', 'Invalid service token', 401);
    }
  });

  app.post(
    '/auth/activity',
    { config: { rateLimit: { max: LOGIN_LIMIT, timeWindow: '1 minute' } } },
    async (request): Promise<ActivityAuthResponse> => {
      const { code, instanceId } = ActivityAuthRequest.parse(request.body);

      const accessToken = await discord.exchangeCode(code);
      const me = await discord.getCurrentUser(accessToken);

      const instance = await discord.getActivityInstance(instanceId);
      if (!instance) throw new AppError('INVALID_INSTANCE', 'Unknown activity instance', 403);
      const guildId = instance.location.guild_id;
      if (instance.location.kind === 'pc' || !guildId) {
        throw new AppError('GUILD_REQUIRED', 'Open the Activity in a server', 400);
      }
      if (guildId !== config.guildId || !instance.users.includes(me.id)) {
        throw new AppError('INVALID_INSTANCE', 'Invalid activity instance', 403);
      }

      const member = await discord.getMember(guildId, me.id);
      if (!member) throw new AppError('NOT_STAFF', 'No access to the staff panel', 403);

      // `at: now` makes this read count as the newest knowledge of the member's roles.
      const staff = await syncMember(
        { db, config },
        { userId: me.id, username: me.username, avatar: me.avatar, roleIds: member.roles, at: new Date() },
      );
      if (!staff || staff.status !== 'active') {
        throw new AppError('NOT_STAFF', 'No access to the staff panel', 403);
      }

      const sessionToken = await signSession({ userId: staff.userId, discordUserId: me.id }, env.JWT_SECRET);
      return { sessionToken, discordAccessToken: accessToken, expiresIn: SESSION_TTL_SECONDS };
    },
  );
}
