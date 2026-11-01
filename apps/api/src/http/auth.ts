import { createHash, timingSafeEqual } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env, ServerConfig } from '@crystalaid/config';
import { ActivityAuthRequest, AppError, type ActivityAuthResponse } from '@crystalaid/contracts';
import { careerEvents, staffMembers, users, type Db } from '@crystalaid/database';
import { LEVEL_RANK, hasPermission, type Level, type Permission } from '@crystalaid/domain';
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
    /** Set by `requireService`; the rate limiter skips such requests. */
    serviceAuthenticated: boolean;
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

const bearer = (request: FastifyRequest): string | undefined =>
  /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1];

const NOT_STAFF_MESSAGE = 'No access to the staff panel';
/** A curator needs the support role too; saying so lets them ask for the missing role. */
const SUPPORT_MISSING_MESSAGE =
  'No access to the staff panel: the support role is missing (a curator also needs the support role)';

/** NOT_STAFF with a reason the client can translate; the message stays English for logs and other clients. */
const notStaff = (supportMissing: boolean) =>
  new AppError(
    'NOT_STAFF',
    supportMissing ? SUPPORT_MISSING_MESSAGE : NOT_STAFF_MESSAGE,
    403,
    supportMissing ? 'support_role_missing' : 'not_in_branch',
  );

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
  app.decorateRequest('serviceAuthenticated', false);

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
      // Only on this failure path: was the last deactivation caused by a missing support role?
      const [last] = row
        ? await db
            .select({ type: careerEvents.type, data: careerEvents.data })
            .from(careerEvents)
            .where(and(eq(careerEvents.guildId, config.guildId), eq(careerEvents.userId, claims.userId)))
            .orderBy(desc(careerEvents.createdAt), desc(careerEvents.id))
            .limit(1)
        : [];
      const supportMissing =
        last?.type === 'deactivated' && (last.data as { supportRoleMissing?: boolean } | null)?.supportRoleMissing === true;
      throw notStaff(supportMissing);
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
    request.serviceAuthenticated = true;
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

      // Taken before the roles are read: a removal event that lands while we wait is newer than
      // `at` and wins; one applied earlier than `at` was already reflected in the roles we read.
      const at = new Date();
      const member = await discord.getMember(guildId, me.id);
      if (!member) throw notStaff(false);

      const staff = await syncMember(
        { db, config },
        { userId: me.id, username: me.username, avatar: me.avatar, roleIds: member.roles, at },
      );
      if (!staff || staff.status !== 'active') {
        const supportMissing =
          !member.roles.some((id) => config.roles.support.includes(id)) &&
          member.roles.some((id) => config.roles.curator.includes(id)) &&
          !member.roles.some((id) => config.roles.admin.includes(id));
        throw notStaff(supportMissing);
      }

      const sessionToken = await signSession({ userId: staff.userId, discordUserId: me.id }, env.JWT_SECRET);
      return { sessionToken, discordAccessToken: accessToken, expiresIn: SESSION_TTL_SECONDS };
    },
  );
}
