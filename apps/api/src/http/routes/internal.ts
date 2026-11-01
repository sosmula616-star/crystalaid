import { readFileSync } from 'node:fs';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { ServerConfig } from '@crystalaid/config';
import {
  ActorQuery,
  AppError,
  ClaimRequest,
  CloseRequest,
  CreateTicketRequest,
  DiscordId,
  MenuSettingsPatchRequest,
  MessageRequest,
  PtListQuery,
  PtSlotQuery,
  PtSlotRequest,
  RatingRequest,
  TicketIdParams,
  type ClaimResponse,
  type CloseResponse,
  type CreateTicketResponse,
  type DiagnosticsResponse,
  type DueTicketsResponse,
  type Settings,
} from '@crystalaid/contracts';
import { staffMembers, tickets, users, type Db } from '@crystalaid/database';
import { requireActor } from '../../services/actor.js';
import { listSlots, removeSlot, setSlot, dueReminders } from '../../services/pt.js';
import { getSettings, patchSettings } from '../../services/settings.js';
import {
  activeTicket,
  addMessage,
  claimTicket,
  closeTicket,
  createTicket,
  dueTickets,
  rateTicket,
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
    const r = await claimTicket(svc, id, body.actorDiscordId, body.choice);
    return { result: r.result, ...(r.requesterDiscordId ? { requesterDiscordId: r.requesterDiscordId } : {}) };
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
    return { ticketId: r.ticket.id, requesterDiscordId: r.requesterDiscordId, transcript: r.transcript };
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
    await requireActor(svc, q.actorDiscordId, 'CURATOR');
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
    let recentErrors: DiagnosticsResponse['recentErrors'] = [];
    if (redis && redisOk) {
      queueSize = await redis.xlen(STREAM).catch(() => null);
      // XREVRANGE exists in Redis 5. Only the id and the error text are returned, never payloads.
      const entries = await redis.xrevrange(DEAD_STREAM, '+', '-', 'COUNT', 5).catch(() => []);
      recentErrors = entries.map(([id, fields]) => {
        const i = fields.indexOf('error');
        return { id, error: i >= 0 ? (fields[i + 1] ?? '').slice(0, 300) : '' };
      });
    }
    return { version, queueSize, openTickets: openRow[0]?.n ?? 0, database, redis: redisOk, recentErrors };
  });

}
