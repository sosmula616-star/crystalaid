import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { ServerConfig } from '@crystalaid/config';
import {
  ActorQuery,
  AppError,
  CancelRequest,
  ClaimRequest,
  CloseRequest,
  CreateTicketRequest,
  DeliveryFailureRequest,
  DiscordId,
  InternalPermissionsPatch,
  MenuSettingsPatchRequest,
  MessageRequest,
  PtListQuery,
  PtSlotQuery,
  PtSlotRequest,
  RatingRequest,
  ReleaseRequest,
  ReminderConfirmRequest,
  TicketIdParams,
  type CancelResponse,
  type ClaimResponse,
  type CloseResponse,
  type DeliveryFailuresResponse,
  type ExpiredTicketsResponse,
  type ReleaseResponse,
  type CreateTicketResponse,
  type DiagnosticsResponse,
  type MenuAccessResponse,
  type OpenTicketsResponse,
  type PermissionsResponse,
  type DueTicketsResponse,
  type Settings,
} from '@crystalaid/contracts';
import { staffMembers, tickets, users, type Db } from '@crystalaid/database';
import { PERMISSIONS, hasPermission } from '@crystalaid/domain';
import { alias } from 'drizzle-orm/pg-core';
import { loadActor, requireActor } from '../../services/actor.js';
import { getGrants, updateGrants } from '../../services/permissions.js';
import { redactSecrets } from '../redact.js';
import { listDeliveryFailures, recordDeliveryFailure } from '../../services/delivery.js';
import { confirmReminder, listSlots, removeSlot, setSlot, dueReminders } from '../../services/pt.js';
import { getSettings, patchSettings } from '../../services/settings.js';
import {
  activeTicket,
  addMessage,
  cancelTicket,
  claimTicket,
  closeTicket,
  createTicket,
  dueTickets,
  expireStaleTickets,
  rateTicket,
  releaseTicket,
} from '../../services/tickets.js';
import { DEAD_STREAM, STREAM } from '../../worker/consumer.js';

const Params = z.object({ discordUserId: DiscordId });

function readVersion(): string {
  try {
    const url = new URL('../../../package.json', import.meta.url);
    return (JSON.parse(readFileSync(url, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function readCommit(): string | null {
  const env = process.env.GIT_COMMIT ?? process.env.COMMIT_SHA;
  if (env) return env.slice(0, 12);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * For the bot only; the service token authenticates the bot. Each route that acts for a person
 * also names them in `actorDiscordId`, and their current level is checked here on every request.
 * `/due` and `/reminders` are scheduler calls with no person behind them.
 */
export function registerInternal(
  app: FastifyInstance,
  deps: { db: Db; config: ServerConfig; redis?: Redis },
): void {
  const { db, config, redis } = deps;
  const svc = { db, config };
  const guard = { onRequest: [app.requireService] };
  const version = readVersion();
  const commit = readCommit();

  /** For the menus only: which buttons to show. Not an authority; each action checks again. */
  app.get('/internal/menu/access', guard, async (request): Promise<MenuAccessResponse> => {
    const { actorDiscordId } = ActorQuery.parse(request.query);
    const actor = await loadActor(svc, actorDiscordId);
    if (!actor) return { level: 'NONE', permissions: [] };
    const permissions = PERMISSIONS.filter((p) => hasPermission(actor.level, p, actor.grants));
    return { level: actor.level, permissions };
  });

  const readGrants = async (): Promise<PermissionsResponse> => ({
    SUPPORT: await getGrants(db, config.guildId, 'SUPPORT'),
    CURATOR: await getGrants(db, config.guildId, 'CURATOR'),
  });

  app.get('/internal/permissions', guard, async (request): Promise<PermissionsResponse> => {
    const { actorDiscordId } = ActorQuery.parse(request.query);
    await requireActor(svc, actorDiscordId, 'ADMIN');
    return readGrants();
  });

  app.patch('/internal/permissions', guard, async (request): Promise<PermissionsResponse> => {
    const body = InternalPermissionsPatch.parse(request.body);
    const actor = await requireActor(svc, body.actorDiscordId, 'ADMIN');
    await updateGrants(db, config.guildId, actor, body.level, body.grants);
    return readGrants();
  });

  app.get('/internal/tickets/open', guard, async (request): Promise<OpenTicketsResponse> => {
    const { actorDiscordId } = ActorQuery.parse(request.query);
    await requireActor(svc, actorDiscordId, 'ADMIN');
    const claimer = alias(users, 'claimer');
    const where = and(eq(tickets.guildId, config.guildId), ne(tickets.status, 'closed'));
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          ticketId: tickets.id,
          status: tickets.status,
          createdAt: tickets.createdAt,
          claimerDiscordId: claimer.discordId,
          claimerUsername: claimer.username,
        })
        .from(tickets)
        .leftJoin(claimer, eq(claimer.id, tickets.claimedBy))
        .where(where)
        .orderBy(desc(tickets.createdAt))
        .limit(25),
      db.select({ n: count() }).from(tickets).where(where),
    ]);
    return {
      items: rows.map((r) => ({
        ticketId: r.ticketId,
        status: r.status === 'claimed' ? 'claimed' : 'open',
        createdAt: r.createdAt.toISOString(),
        claimerDiscordId: r.claimerDiscordId,
        claimerUsername: r.claimerUsername,
      })),
      total: totalRow[0]?.n ?? 0,
    };
  });

  app.get('/internal/members/:discordUserId', guard, async (request) => {
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

  // The actor is the requester: any member may open a ticket.
  app.post('/internal/tickets', guard, async (request): Promise<CreateTicketResponse> => {
    const body = CreateTicketRequest.parse(request.body);
    const created = await createTicket(svc, {
      requesterDiscordId: body.actorDiscordId,
      username: body.username,
      message: body.message,
    });
    return {
      ticketId: created.ticket.id,
      requesterDiscordId: created.requesterDiscordId,
      challenges: created.challenges,
    };
  });

  app.post('/internal/tickets/:id/claim', guard, async (request): Promise<ClaimResponse> => {
    const { id } = TicketIdParams.parse(request.params);
    const body = ClaimRequest.parse(request.body);
    await requireActor(svc, body.actorDiscordId, 'SUPPORT');
    const r = await claimTicket(svc, id, body.actorDiscordId, body.choiceIndex);
    return {
      result: r.result,
      ...(r.requesterDiscordId ? { requesterDiscordId: r.requesterDiscordId } : {}),
      ...(r.ticket && (r.result === 'claimed' || r.result === 'yours') ? { description: r.ticket.description } : {}),
    };
  });

  // The actor is the author; the service checks they are the requester or the claimer.
  app.post('/internal/tickets/:id/messages', guard, async (request) => {
    const { id } = TicketIdParams.parse(request.params);
    const body = MessageRequest.parse(request.body);
    return addMessage(svc, id, body.actorDiscordId, body.content, new Date(), body.discordMessageId);
  });

  app.post('/internal/tickets/:id/close', guard, async (request): Promise<CloseResponse> => {
    const { id } = TicketIdParams.parse(request.params);
    const body = CloseRequest.parse(request.body);
    const actor = await requireActor(svc, body.actorDiscordId, 'SUPPORT');
    const r = await closeTicket(svc, id, actor);
    return {
      ticketId: r.ticket.id,
      requesterDiscordId: r.requesterDiscordId,
      claimerDiscordId: r.claimerDiscordId,
      transcript: r.transcript,
      messageCount: r.messageCount,
    };
  });

  app.post('/internal/tickets/:id/cancel', guard, async (request): Promise<CancelResponse> => {
    const { id } = TicketIdParams.parse(request.params);
    const body = CancelRequest.parse(request.body);
    return cancelTicket(svc, id, body.actorDiscordId);
  });

  // An admin returns a claimed ticket to the queue.
  app.post('/internal/tickets/:id/release', guard, async (request): Promise<ReleaseResponse> => {
    const { id } = TicketIdParams.parse(request.params);
    const body = ReleaseRequest.parse(request.body);
    const actor = await requireActor(svc, body.actorDiscordId, 'ADMIN');
    const r = await releaseTicket(svc, id, actor);
    return { ticketId: r.ticket.id, requesterDiscordId: r.requesterDiscordId, claimerDiscordId: r.claimerDiscordId };
  });

  // Scheduler call: closes tickets idle for 24 hours and hands back what the bot must announce.
  app.post('/internal/tickets/expire', guard, async (): Promise<ExpiredTicketsResponse> => {
    return { items: await expireStaleTickets(svc) };
  });

  app.post('/internal/tickets/:id/rating', guard, async (request) => {
    const { id } = TicketIdParams.parse(request.params);
    const body = RatingRequest.parse(request.body);
    await rateTicket(svc, id, body.actorDiscordId, body.rating);
    return { ok: true };
  });

  app.get('/internal/tickets/active', guard, async (request) => {
    const { actorDiscordId } = ActorQuery.parse(request.query);
    return { ticket: await activeTicket(svc, actorDiscordId) };
  });

  app.get('/internal/tickets/due', guard, async (): Promise<DueTicketsResponse> => {
    const due = await dueTickets(svc);
    return { items: due.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })) };
  });

  app.get('/internal/pt', guard, async (request) => {
    const q = PtListQuery.parse(request.query);
    const viewer = await requireActor(svc, q.actorDiscordId, 'CURATOR');
    if (!hasPermission(viewer.level, 'shifts.edit', viewer.grants)) throw new AppError('FORBIDDEN', 'Not allowed', 403);
    const items = await listSlots(svc, q.date);
    return { items: items.map((s) => ({ ...s, startsAt: s.startsAt.toISOString() })) };
  });

  app.put('/internal/pt', guard, async (request) => {
    const body = PtSlotRequest.parse(request.body);
    const actor = await requireActor(svc, body.actorDiscordId, 'CURATOR');
    return setSlot(svc, actor, { startsAt: new Date(body.startsAt), discordUserId: body.discordUserId });
  });

  app.delete('/internal/pt', guard, async (request) => {
    const q = PtSlotQuery.parse(request.query);
    const actor = await requireActor(svc, q.actorDiscordId, 'CURATOR');
    await removeSlot(svc, actor, { startsAt: new Date(q.startsAt), discordUserId: q.discordUserId });
    return { ok: true };
  });

  app.get('/internal/pt/reminders', guard, async () => {
    const items = await dueReminders(svc);
    return { items: items.map((s) => ({ ...s, startsAt: s.startsAt.toISOString() })) };
  });

  // The bot confirms a reminder after the DM went out; until then it is handed out again.
  app.post('/internal/pt/reminders/confirm', guard, async (request) => {
    const body = ReminderConfirmRequest.parse(request.body);
    await confirmReminder(svc, body.slotId);
    return { ok: true };
  });

  // Failed DMs: the bot reports each one; admins read the last 20 in the menu.
  app.post('/internal/delivery-failures', guard, async (request) => {
    const body = DeliveryFailureRequest.parse(request.body);
    await recordDeliveryFailure(svc, body);
    return { ok: true };
  });

  app.get('/internal/delivery-failures', guard, async (request): Promise<DeliveryFailuresResponse> => {
    const { actorDiscordId } = ActorQuery.parse(request.query);
    await requireActor(svc, actorDiscordId, 'ADMIN');
    const items = await listDeliveryFailures(svc);
    return { items: items.map((f) => ({ ...f, at: f.at.toISOString() })) };
  });

  app.get('/internal/menu/settings', guard, async (request): Promise<Settings> => {
    const { actorDiscordId } = ActorQuery.parse(request.query);
    await requireActor(svc, actorDiscordId, 'ADMIN');
    return getSettings(db, config.guildId);
  });

  app.patch('/internal/menu/settings', guard, async (request): Promise<Settings> => {
    const body = MenuSettingsPatchRequest.parse(request.body);
    const actor = await requireActor(svc, body.actorDiscordId, 'ADMIN');
    return patchSettings(db, config.guildId, actor.userId, body.patch);
  });

  app.get('/internal/diagnostics', guard, async (request): Promise<DiagnosticsResponse> => {
    const { actorDiscordId } = ActorQuery.parse(request.query);
    await requireActor(svc, actorDiscordId, 'DEVELOPER');
    const ok = (p: PromiseLike<unknown>) =>
      Promise.resolve(p).then(
        () => true,
        () => false,
      );
    const [database, redisOk, openRow] = await Promise.all([
      ok(db.execute(sql`select 1`)),
      redis ? ok(redis.ping()) : Promise.resolve(false),
      db
        .select({ n: count() })
        .from(tickets)
        .where(and(eq(tickets.guildId, config.guildId), ne(tickets.status, 'closed'))),
    ]);
    let queueSize: number | null = null;
    let deadSize: number | null = null;
    let recentErrors: DiagnosticsResponse['recentErrors'] = [];
    if (redis && redisOk) {
      queueSize = await redis.xlen(STREAM).catch(() => null);
      deadSize = await redis.xlen(DEAD_STREAM).catch(() => null);
      // XREVRANGE exists in Redis 5. Only the id and the error text are returned, never payloads.
      const entries = await redis.xrevrange(DEAD_STREAM, '+', '-', 'COUNT', 5).catch(() => []);
      recentErrors = entries.map(([id, fields]) => {
        const i = fields.indexOf('error');
        return { id, error: i >= 0 ? redactSecrets((fields[i + 1] ?? '').slice(0, 300)) : '' };
      });
    }
    return {
      version,
      commit,
      uptimeSeconds: Math.floor(process.uptime()),
      queueSize,
      deadSize, openTickets: openRow[0]?.n ?? 0, database, redis: redisOk, recentErrors };
  });

}
