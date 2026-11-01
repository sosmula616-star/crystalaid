import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { ServerConfig } from '@crystalaid/config';
import { AppError } from '@crystalaid/contracts';
import {
  staffDaily,
  staffMembers,
  ptSlots,
  ticketChallenges,
  ticketEvents,
  ticketMessages,
  tickets,
  users,
  type Db,
} from '@crystalaid/database';
import { ITEM_KEYS, atLeast, type ItemKey } from '@crystalaid/domain';
import type { StaffActor } from './actor.js';
import { writeAudit, type Tx } from './audit.js';
import { formatInZone, hourStart, localDay } from './time.js';

export interface TicketDeps {
  db: Db;
  config: ServerConfig;
}

export type TicketRow = typeof tickets.$inferSelect;

/** What a support sees: pick `target` among `options`. The stored answer is never sent. */
export interface Challenge {
  target: ItemKey;
  options: ItemKey[];
}
export interface OfferedChallenge {
  supportDiscordId: string;
  challenge: Challenge;
}

export const TICKET_CATEGORY = 'dm';
export const NEW_TICKET_COOLDOWN_MS = 5 * 60_000;
export const REOFFER_AFTER_MS = 5 * 60_000;
export const MAX_MESSAGE_LENGTH = 4000;
/** A round of `dueTickets` offers at most this many tickets. */
export const DUE_PER_ROUND = 10;
/** Candidates looked at per round, so tickets nobody can take do not hide the ones behind them. */
const DUE_SCAN_LIMIT = 100;
export const MAX_OUTSTANDING_OFFERS = 3;
/** A ticket with no message, claim or release for this long is closed by the scheduler. */
export const IDLE_CLOSE_AFTER_MS = 24 * 60 * 60_000;
/** The first message is the /help modal question. */
export const FIRST_MESSAGE_MAX_LENGTH = 300;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 4 distinct item keys in random order; the target is one of them. */
export function makeChallenge(): Challenge {
  const options = shuffle([...ITEM_KEYS]).slice(0, 4);
  return { target: options[randomInt(options.length)]!, options: shuffle(options) };
}

const conflict = (message: string, reason: string) => new AppError('CONFLICT', message, 409, reason);

async function ensureUser(tx: Tx, discordId: string, username: string) {
  const [created] = await tx.insert(users).values({ discordId, username }).onConflictDoNothing().returning();
  if (created) return created;
  const [row] = await tx.select().from(users).where(eq(users.discordId, discordId));
  return row!;
}

/** Active supports (and above) with a PT slot in the current hour. */
async function onDutySupports(
  tx: Tx,
  deps: TicketDeps,
  now: Date,
): Promise<{ userId: string; discordId: string }[]> {
  const start = hourStart(now, deps.config.timezone);
  return tx
    .select({ userId: users.id, discordId: users.discordId })
    .from(ptSlots)
    .innerJoin(users, eq(users.id, ptSlots.userId))
    .innerJoin(
      staffMembers,
      and(
        eq(staffMembers.userId, ptSlots.userId),
        eq(staffMembers.guildId, ptSlots.guildId),
        eq(staffMembers.status, 'active'),
        ne(staffMembers.level, 'NONE'),
      ),
    )
    .where(and(eq(ptSlots.guildId, deps.config.guildId), eq(ptSlots.startsAt, start)));
}

/** open tickets a support was offered and has not answered, per support (user id to ticket ids) */
type Outstanding = Map<string, Set<string>>;

async function outstandingOffers(tx: Tx, guildId: string, userIds: string[]): Promise<Outstanding> {
  const out: Outstanding = new Map();
  if (userIds.length === 0) return out;
  const rows = await tx
    .select({ userId: ticketChallenges.userId, ticketId: ticketChallenges.ticketId })
    .from(ticketChallenges)
    .innerJoin(tickets, eq(tickets.id, ticketChallenges.ticketId))
    .where(
      and(
        eq(tickets.guildId, guildId),
        eq(tickets.status, 'open'),
        isNull(ticketChallenges.attemptedAt),
        inArray(ticketChallenges.userId, userIds),
      ),
    );
  for (const r of rows) out.set(r.userId, (out.get(r.userId) ?? new Set()).add(r.ticketId));
  return out;
}

/**
 * Issues a challenge for each support, or hands out the one they already hold: a challenge that
 * has not been attempted keeps its options, so buttons of an earlier offer stay valid after a
 * re-offer. A support who attempted the ticket gets nothing, and neither does one who already has
 * `MAX_OUTSTANDING_OFFERS` other open tickets waiting for an answer.
 */
async function issueChallenges(
  tx: Tx,
  ticketId: string,
  supports: { userId: string; discordId: string }[],
  outstanding: Outstanding,
): Promise<OfferedChallenge[]> {
  const offered: OfferedChallenge[] = [];
  for (const s of supports) {
    const held = outstanding.get(s.userId) ?? new Set<string>();
    if (!held.has(ticketId) && held.size >= MAX_OUTSTANDING_OFFERS) continue;
    const fresh = makeChallenge();
    const [created] = await tx
      .insert(ticketChallenges)
      .values({ ticketId, userId: s.userId, answer: fresh.target, options: fresh.options })
      .onConflictDoNothing()
      .returning({ userId: ticketChallenges.userId });
    let challenge = fresh;
    if (!created) {
      const [row] = await tx
        .select()
        .from(ticketChallenges)
        .where(and(eq(ticketChallenges.ticketId, ticketId), eq(ticketChallenges.userId, s.userId)));
      if (!row || row.attemptedAt) continue;
      if (row.options.length === 4 && row.options.includes(row.answer)) {
        challenge = { target: row.answer as ItemKey, options: row.options as ItemKey[] };
      } else {
        // A row from before options were stored cannot be shown; nothing was attempted, so replace it.
        await tx
          .update(ticketChallenges)
          .set({ answer: fresh.target, options: fresh.options })
          .where(
            and(
              eq(ticketChallenges.ticketId, ticketId),
              eq(ticketChallenges.userId, s.userId),
              isNull(ticketChallenges.attemptedAt),
            ),
          );
      }
    }
    outstanding.set(s.userId, held.add(ticketId));
    offered.push({ supportDiscordId: s.discordId, challenge });
  }
  return offered;
}

async function bumpDaily(
  tx: Tx,
  deps: TicketDeps,
  userId: string,
  at: Date,
  column: 'ticketsClaimed' | 'ticketsClosed',
): Promise<void> {
  const col = staffDaily[column];
  await tx
    .insert(staffDaily)
    .values({
      guildId: deps.config.guildId,
      userId,
      day: localDay(at, deps.config.timezone),
      [column]: 1,
    })
    .onConflictDoUpdate({
      target: [staffDaily.guildId, staffDaily.userId, staffDaily.day],
      set: { [column]: sql`${col} + 1` },
    });
}

export interface CreatedTicket {
  ticket: TicketRow;
  requesterDiscordId: string;
  /** One per on-duty support; empty means the ticket waits for the next PT. */
  challenges: OfferedChallenge[];
}

/**
 * A member opens a ticket from the DM. One open ticket per requester and a 5 minute pause after
 * the last one. Stores the first message and offers the ticket to the supports on duty now
 * (never to the requester themselves).
 */
export async function createTicket(
  deps: TicketDeps,
  input: { requesterDiscordId: string; username: string; message: string },
  now: Date = new Date(),
): Promise<CreatedTicket> {
  const { db, config } = deps;
  const message = input.message.trim();
  if (message.length === 0 || message.length > FIRST_MESSAGE_MAX_LENGTH) {
    throw new AppError('VALIDATION_ERROR', 'Invalid message', 400);
  }
  return db.transaction(async (tx) => {
    const requester = await ensureUser(tx, input.requesterDiscordId, input.username);
    // Serializes parallel requests of one person, so the checks below cannot both pass.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ticket:${config.guildId}:${requester.id}`}, 0))`,
    );

    const [open] = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.guildId, config.guildId),
          eq(tickets.requesterId, requester.id),
          ne(tickets.status, 'closed'),
        ),
      )
      .limit(1);
    if (open) throw conflict('You already have an open ticket', 'open_ticket_exists');

    const [last] = await tx
      .select({ createdAt: tickets.createdAt })
      .from(tickets)
      .where(and(eq(tickets.guildId, config.guildId), eq(tickets.requesterId, requester.id)))
      .orderBy(desc(tickets.createdAt))
      .limit(1);
    if (last && now.getTime() - last.createdAt.getTime() < NEW_TICKET_COOLDOWN_MS) {
      throw new AppError('RATE_LIMITED', 'Wait before opening a new ticket', 429, 'cooldown');
    }

    const supports = (await onDutySupports(tx, deps, now)).filter((s) => s.userId !== requester.id);
    const [ticket] = await tx
      .insert(tickets)
      .values({
        guildId: config.guildId,
        requesterId: requester.id,
        category: TICKET_CATEGORY,
        description: message,
        createdAt: now,
        lastActivityAt: now,
      })
      .returning();
    await tx.insert(ticketMessages).values({
      guildId: config.guildId,
      ticketId: ticket!.id,
      authorDiscordId: requester.discordId,
      authorUserId: requester.id,
      isStaff: false,
      content: message,
      createdAt: now,
    });
    await tx.insert(ticketEvents).values({
      guildId: config.guildId,
      ticketId: ticket!.id,
      type: 'created',
      actorUserId: requester.id,
      createdAt: now,
    });
    const outstanding = await outstandingOffers(tx, config.guildId, supports.map((s) => s.userId));
    const challenges = await issueChallenges(tx, ticket!.id, supports, outstanding);
    // A ticket nobody could be offered to stays unmarked and waits for the next round.
    let created = ticket!;
    if (challenges.length > 0) {
      created = (await tx.update(tickets).set({ offeredAt: now }).where(eq(tickets.id, created.id)).returning())[0]!;
    }
    await writeAudit(tx, {
      guildId: config.guildId,
      actorUserId: requester.id,
      action: 'ticket.created',
      data: { ticketId: created.id, offeredTo: challenges.length },
    });
    return { ticket: created, requesterDiscordId: requester.discordId, challenges };
  });
}

export type ClaimResult = 'claimed' | 'wrong' | 'already_taken' | 'closed' | 'busy' | 'yours';

/**
 * A support answers the check by the position (0 to 3) of the pressed option. One attempt per support per ticket: the attempt is spent before
 * the answer is compared. A correct first answer takes the ticket with one atomic
 * `UPDATE ... WHERE status = 'open'`, so of any number of parallel correct answers one wins.
 * A support holds one claimed ticket at a time: with another one in work the answer is `busy`
 * and the attempt is not spent. Pressing again on the ticket they hold gives `yours`.
 */
export async function claimTicket(
  deps: TicketDeps,
  ticketId: string,
  supportDiscordId: string,
  choiceIndex: number,
  now: Date = new Date(),
): Promise<{ result: ClaimResult; ticket?: TicketRow; requesterDiscordId?: string }> {
  const { db, config } = deps;
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!ticket || ticket.guildId !== config.guildId) throw new AppError('NOT_FOUND', 'Not found', 404);
    const [support] = await tx.select().from(users).where(eq(users.discordId, supportDiscordId));
    if (ticket.status === 'closed') return { result: 'closed' as const };
    if (ticket.status === 'claimed') {
      if (!support || ticket.claimedBy !== support.id) return { result: 'already_taken' as const };
      const [req] = await tx
        .select({ discordId: users.discordId })
        .from(users)
        .where(eq(users.id, ticket.requesterId));
      return { result: 'yours' as const, ticket, requesterDiscordId: req!.discordId };
    }

    if (!support) return { result: 'wrong' as const };
    // Serializes the claims of one support, so two tickets cannot both be taken in parallel.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`claim:${config.guildId}:${support.id}`}, 0))`,
    );
    const [inWork] = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(eq(tickets.guildId, config.guildId), eq(tickets.status, 'claimed'), eq(tickets.claimedBy, support.id)),
      )
      .limit(1);
    if (inWork?.id === ticketId) {
      const [req] = await tx
        .select({ discordId: users.discordId })
        .from(users)
        .where(eq(users.id, ticket.requesterId));
      return { result: 'yours' as const, ticket, requesterDiscordId: req!.discordId };
    }
    if (inWork) return { result: 'busy' as const };
    const [attempt] = await tx
      .update(ticketChallenges)
      .set({ attemptedAt: now })
      .where(
        and(
          eq(ticketChallenges.ticketId, ticketId),
          eq(ticketChallenges.userId, support.id),
          isNull(ticketChallenges.attemptedAt),
        ),
      )
      .returning({ answer: ticketChallenges.answer, options: ticketChallenges.options });
    if (!attempt || !Number.isInteger(choiceIndex) || attempt.options[choiceIndex] !== attempt.answer) return { result: 'wrong' as const };

    const [claimed] = await tx
      .update(tickets)
      .set({ status: 'claimed', claimedBy: support.id, claimedAt: now, lastActivityAt: now })
      .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'open')))
      .returning();
    if (!claimed) {
      const [latest] = await tx.select({ status: tickets.status }).from(tickets).where(eq(tickets.id, ticketId));
      return { result: latest?.status === 'closed' ? ('closed' as const) : ('already_taken' as const) };
    }
    await tx.insert(ticketEvents).values({
      guildId: config.guildId,
      ticketId,
      type: 'claimed',
      actorUserId: support.id,
      createdAt: now,
    });
    await bumpDaily(tx, deps, support.id, now, 'ticketsClaimed');
    await writeAudit(tx, {
      guildId: config.guildId,
      actorUserId: support.id,
      action: 'ticket.claimed',
      data: { ticketId },
    });
    const [req] = await tx
      .select({ discordId: users.discordId })
      .from(users)
      .where(eq(users.id, claimed.requesterId));
    return { result: 'claimed' as const, ticket: claimed, requesterDiscordId: req!.discordId };
  });
}

/**
 * Stores a message of the requester or of the claimer. The first reply of the claimer sets
 * `first_response_at`. Returns who should receive the message ('' while nobody has the ticket).
 */
export async function addMessage(
  deps: TicketDeps,
  ticketId: string,
  authorDiscordId: string,
  content: string,
  now: Date = new Date(),
  discordMessageId?: string,
): Promise<{ isStaff: boolean; recipientDiscordId: string }> {
  const { db, config } = deps;
  const text = content.trim();
  if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) {
    throw new AppError('VALIDATION_ERROR', 'Invalid message', 400);
  }
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.guildId, config.guildId)))
      .for('update');
    if (!ticket) throw new AppError('NOT_FOUND', 'Not found', 404);
    const [author] = await tx.select().from(users).where(eq(users.discordId, authorDiscordId));
    const isRequester = author?.id === ticket.requesterId;
    const isClaimer = !!author && author.id === ticket.claimedBy;
    if (!author || (!isRequester && !isClaimer)) throw new AppError('FORBIDDEN', 'Not allowed', 403);
    if (ticket.status === 'closed') throw conflict('The ticket is closed', 'ticket_closed');
    if (isClaimer) {
      // Access can be taken away while a ticket is in work; the claimer must still be staff now.
      const [staff] = await tx
        .select({ level: staffMembers.level, status: staffMembers.status })
        .from(staffMembers)
        .where(and(eq(staffMembers.guildId, config.guildId), eq(staffMembers.userId, author.id)));
      if (!staff || staff.status !== 'active' || !atLeast(staff.level, 'SUPPORT')) {
        throw new AppError('FORBIDDEN', 'Not allowed', 403, 'not_staff');
      }
    }

    await tx.update(tickets).set({ lastActivityAt: now }).where(eq(tickets.id, ticketId));
    await tx.insert(ticketMessages).values({
      guildId: config.guildId,
      ticketId,
      discordMessageId: discordMessageId ?? null,
      authorDiscordId,
      authorUserId: author.id,
      isStaff: isClaimer,
      content: text,
      createdAt: now,
    });
    if (isClaimer) {
      await tx
        .update(tickets)
        .set({ firstResponseAt: now })
        .where(and(eq(tickets.id, ticketId), isNull(tickets.firstResponseAt)));
    }
    const otherId = isClaimer ? ticket.requesterId : ticket.claimedBy;
    const other = otherId
      ? (await tx.select({ discordId: users.discordId }).from(users).where(eq(users.id, otherId)))[0]
      : undefined;
    return { isStaff: isClaimer, recipientDiscordId: other?.discordId ?? '' };
  });
}

/**
 * The transcript as plain text; names are real, times are in the configured timezone. Lines after
 * the first of a message are indented, so only a message header starts at column 0 with `[`.
 */
async function buildTranscript(
  tx: Tx,
  deps: TicketDeps,
  ticket: TicketRow,
): Promise<{ text: string; messageCount: number }> {
  const tz = deps.config.timezone;
  const name = (u: { displayName: string | null; username: string }) => u.displayName ?? u.username;
  const [requester] = await tx.select().from(users).where(eq(users.id, ticket.requesterId));
  const claimer = ticket.claimedBy
    ? (await tx.select().from(users).where(eq(users.id, ticket.claimedBy)))[0]
    : undefined;
  const rows = await tx
    .select({ m: ticketMessages, u: users })
    .from(ticketMessages)
    .leftJoin(users, eq(users.discordId, ticketMessages.authorDiscordId))
    .where(eq(ticketMessages.ticketId, ticket.id))
    .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));
  const lines = [
    `Ticket ${ticket.id}`,
    `Requester: ${requester ? name(requester) : '?'} (${requester?.discordId ?? '?'})`,
    `Support: ${claimer ? `${name(claimer)} (${claimer.discordId})` : '-'}`,
    `Opened: ${formatInZone(ticket.createdAt, tz)} (${tz})`,
    `Closed: ${ticket.closedAt ? formatInZone(ticket.closedAt, tz) : '-'}`,
    '',
  ];
  for (const { m, u } of rows) {
    const who = u ? name(u) : m.authorDiscordId;
    const body = m.content.replace(/\r\n?|\n/g, '\n    ');
    lines.push(`[${formatInZone(m.createdAt, tz)}] ${who}${m.isStaff ? ' (support)' : ''}: ${body}`);
  }
  return { text: lines.join('\n'), messageCount: rows.length };
}

/**
 * Closes a ticket. Only the claimer or an ADMIN and above may. A second close fails. The work is
 * credited to the claimer in `staff_daily`. Returns the transcript text.
 */
export async function closeTicket(
  deps: TicketDeps,
  ticketId: string,
  actor: StaffActor,
  now: Date = new Date(),
): Promise<{
  ticket: TicketRow;
  transcript: string;
  messageCount: number;
  requesterDiscordId: string;
  claimerDiscordId: string | null;
}> {
  const { db, config } = deps;
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.guildId, config.guildId)))
      .for('update');
    if (!current) throw new AppError('NOT_FOUND', 'Not found', 404);
    if (current.claimedBy !== actor.userId && !atLeast(actor.level, 'ADMIN')) {
      throw new AppError('FORBIDDEN', 'Only the support who took the ticket or an admin can close it', 403);
    }
    if (current.status === 'closed') throw conflict('The ticket is already closed', 'ticket_closed');

    const [ticket] = await tx
      .update(tickets)
      .set({ status: 'closed', closedAt: now, closedBy: actor.userId })
      .where(and(eq(tickets.id, ticketId), ne(tickets.status, 'closed')))
      .returning();
    if (!ticket) throw conflict('The ticket is already closed', 'ticket_closed');
    await tx.insert(ticketEvents).values({
      guildId: config.guildId,
      ticketId,
      type: 'closed',
      actorUserId: actor.userId,
      createdAt: now,
    });
    if (ticket.claimedBy) await bumpDaily(tx, deps, ticket.claimedBy, now, 'ticketsClosed');
    await writeAudit(tx, {
      guildId: config.guildId,
      actorUserId: actor.userId,
      action: 'ticket.closed',
      data: { ticketId, claimedBy: ticket.claimedBy },
    });
    const { text, messageCount } = await buildTranscript(tx, deps, ticket);
    const [req] = await tx
      .select({ discordId: users.discordId })
      .from(users)
      .where(eq(users.id, ticket.requesterId));
    return {
      ticket,
      transcript: text,
      messageCount,
      requesterDiscordId: req!.discordId,
      claimerDiscordId: await discordIdOf(tx, ticket.claimedBy),
    };
  });
}

const discordIdOf = async (tx: Tx, userId: string | null): Promise<string | null> =>
  userId ? ((await tx.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId)))[0]?.discordId ?? null) : null;

/**
 * Puts a claimed ticket back to `open` and makes it due for an offer at once (it counts as offered
 * 5 minutes ago). The claimer keeps their spent attempt, so it is not offered to them again.
 * Returns null when the ticket is not claimed any more.
 */
export async function releaseTx(
  tx: Tx,
  guildId: string,
  ticket: TicketRow,
  actorUserId: string | null,
  reason: string,
  now: Date,
): Promise<TicketRow | null> {
  const [released] = await tx
    .update(tickets)
    .set({
      status: 'open',
      claimedBy: null,
      claimedAt: null,
      offeredAt: new Date(now.getTime() - REOFFER_AFTER_MS),
      lastActivityAt: now,
    })
    .where(and(eq(tickets.id, ticket.id), eq(tickets.status, 'claimed')))
    .returning();
  if (!released) return null;
  await writeAudit(tx, {
    guildId,
    actorUserId,
    action: 'ticket.released',
    targetUserId: ticket.claimedBy ?? undefined,
    reason,
    data: { ticketId: ticket.id, claimedBy: ticket.claimedBy },
  });
  return released;
}

/** An ADMIN or above returns a claimed ticket to the queue; it is offered again. */
export async function releaseTicket(
  deps: TicketDeps,
  ticketId: string,
  actor: StaffActor,
  now: Date = new Date(),
): Promise<{ ticket: TicketRow; requesterDiscordId: string; claimerDiscordId: string | null }> {
  const { db, config } = deps;
  if (!atLeast(actor.level, 'ADMIN')) throw new AppError('FORBIDDEN', 'Not allowed', 403);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.guildId, config.guildId)))
      .for('update');
    if (!current) throw new AppError('NOT_FOUND', 'Not found', 404);
    if (current.status !== 'claimed') throw conflict('The ticket is not claimed', 'not_claimed');
    const claimerDiscordId = await discordIdOf(tx, current.claimedBy);
    const ticket = await releaseTx(tx, config.guildId, current, actor.userId, 'released_by_admin', now);
    if (!ticket) throw conflict('The ticket is not claimed', 'not_claimed');
    return { ticket, requesterDiscordId: (await discordIdOf(tx, ticket.requesterId))!, claimerDiscordId };
  });
}

/** Releases every ticket a deactivated or removed support had in work. */
export async function releaseClaimedBy(tx: Tx, guildId: string, userId: string, now: Date): Promise<void> {
  const held = await tx
    .select()
    .from(tickets)
    .where(and(eq(tickets.guildId, guildId), eq(tickets.status, 'claimed'), eq(tickets.claimedBy, userId)))
    .for('update');
  for (const t of held) await releaseTx(tx, guildId, t, null, 'claimer_deactivated', now);
}

/**
 * The requester withdraws a ticket nobody has taken. A claimed ticket is closed by the support, a
 * closed one stays closed; both are reported, nothing changes.
 */
export async function cancelTicket(
  deps: TicketDeps,
  ticketId: string,
  requesterDiscordId: string,
  now: Date = new Date(),
): Promise<{ result: 'cancelled' | 'claimed' | 'closed' }> {
  const { db, config } = deps;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ ticket: tickets, discordId: users.discordId })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.requesterId))
      .where(and(eq(tickets.id, ticketId), eq(tickets.guildId, config.guildId)))
      .for('update', { of: tickets });
    if (!row) throw new AppError('NOT_FOUND', 'Not found', 404);
    if (row.discordId !== requesterDiscordId) throw new AppError('FORBIDDEN', 'Not allowed', 403);
    if (row.ticket.status === 'closed') return { result: 'closed' as const };
    if (row.ticket.status === 'claimed') return { result: 'claimed' as const };
    await tx
      .update(tickets)
      .set({ status: 'closed', closedAt: now, closedBy: row.ticket.requesterId, lastActivityAt: now })
      .where(eq(tickets.id, ticketId));
    await tx.insert(ticketEvents).values({
      guildId: config.guildId,
      ticketId,
      type: 'closed',
      actorUserId: row.ticket.requesterId,
      data: { cancelled: true },
      createdAt: now,
    });
    await writeAudit(tx, {
      guildId: config.guildId,
      actorUserId: row.ticket.requesterId,
      action: 'ticket.cancelled',
      data: { ticketId },
    });
    return { result: 'cancelled' as const };
  });
}

export interface ExpiredTicket {
  ticketId: string;
  requesterDiscordId: string;
  claimerDiscordId: string | null;
  transcript: string;
  messageCount: number;
}

/**
 * Closes open and claimed tickets with no message, claim or release for 24 hours, up to `limit`
 * at a time. Nobody is credited for the close (`closed_by` stays empty). Returns what the bot
 * needs to tell both sides and to write the transcript to the log.
 */
export async function expireStaleTickets(
  deps: TicketDeps,
  now: Date = new Date(),
  limit = 20,
): Promise<ExpiredTicket[]> {
  const { db, config } = deps;
  return db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.guildId, config.guildId),
          ne(tickets.status, 'closed'),
          lte(tickets.lastActivityAt, new Date(now.getTime() - IDLE_CLOSE_AFTER_MS)),
        ),
      )
      .orderBy(asc(tickets.lastActivityAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    const out: ExpiredTicket[] = [];
    for (const t of stale) {
      const [ticket] = await tx
        .update(tickets)
        .set({ status: 'closed', closedAt: now, closedBy: null })
        .where(and(eq(tickets.id, t.id), ne(tickets.status, 'closed')))
        .returning();
      if (!ticket) continue;
      await tx.insert(ticketEvents).values({
        guildId: config.guildId,
        ticketId: t.id,
        type: 'closed',
        actorUserId: null,
        data: { reason: 'inactive' },
        createdAt: now,
      });
      await writeAudit(tx, {
        guildId: config.guildId,
        actorUserId: null,
        action: 'ticket.expired',
        reason: 'inactive_24h',
        data: { ticketId: t.id, claimedBy: t.claimedBy },
      });
      const { text, messageCount } = await buildTranscript(tx, deps, ticket);
      out.push({
        ticketId: t.id,
        requesterDiscordId: (await discordIdOf(tx, t.requesterId))!,
        claimerDiscordId: await discordIdOf(tx, t.claimedBy),
        transcript: text,
        messageCount,
      });
    }
    return out;
  });
}

/** The requester rates a closed ticket 1 to 5, once. */
export async function rateTicket(
  deps: TicketDeps,
  ticketId: string,
  requesterDiscordId: string,
  rating: number,
  now: Date = new Date(),
): Promise<void> {
  const { db, config } = deps;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError('VALIDATION_ERROR', 'Rating must be 1 to 5', 400);
  }
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ ticket: tickets, discordId: users.discordId })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.requesterId))
      .where(and(eq(tickets.id, ticketId), eq(tickets.guildId, config.guildId)));
    if (!row) throw new AppError('NOT_FOUND', 'Not found', 404);
    if (row.discordId !== requesterDiscordId) throw new AppError('FORBIDDEN', 'Not allowed', 403);
    if (row.ticket.status !== 'closed') throw conflict('The ticket is not closed', 'ticket_not_closed');
    const [rated] = await tx
      .update(tickets)
      .set({ rating, ratedAt: now })
      .where(and(eq(tickets.id, ticketId), isNull(tickets.rating)))
      .returning({ id: tickets.id });
    if (!rated) throw conflict('The ticket is already rated', 'already_rated');
    await writeAudit(tx, {
      guildId: config.guildId,
      actorUserId: row.ticket.requesterId,
      action: 'ticket.rated',
      data: { ticketId, rating },
    });
  });
}

export interface DueTicket {
  ticketId: string;
  requesterDiscordId: string;
  description: string;
  createdAt: Date;
  /** True when the ticket was offered before and nobody took it. */
  reoffer: boolean;
  challenges: OfferedChallenge[];
}

/**
 * Open tickets to offer now: offered over 5 minutes ago, or never offered (nobody was on duty)
 * while someone is on duty now. Marks `offered_at` (under a row lock with SKIP LOCKED, so parallel
 * workers get different tickets) and returns the challenges for the supports on duty who have
 * not attempted that ticket: a challenge they already hold is returned unchanged, so a lost
 * round is repaired by the next re-offer. A round has at most `limit` tickets and no support gets
 * more than `MAX_OUTSTANDING_OFFERS` open tickets to answer. A ticket with nobody to offer to
 * stays unmarked.
 */
export async function dueTickets(
  deps: TicketDeps,
  now: Date = new Date(),
  limit = DUE_PER_ROUND,
): Promise<DueTicket[]> {
  const { db, config } = deps;
  return db.transaction(async (tx) => {
    const supports = await onDutySupports(tx, deps, now);
    if (supports.length === 0) return [];
    const outstanding = await outstandingOffers(tx, config.guildId, supports.map((s) => s.userId));
    const candidates = await tx
      .select({ ticket: tickets, requesterDiscordId: users.discordId })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.requesterId))
      .where(
        and(
          eq(tickets.guildId, config.guildId),
          eq(tickets.status, 'open'),
          or(isNull(tickets.offeredAt), lte(tickets.offeredAt, new Date(now.getTime() - REOFFER_AFTER_MS))),
        ),
      )
      .orderBy(asc(tickets.createdAt))
      .limit(DUE_SCAN_LIMIT)
      .for('update', { of: tickets, skipLocked: true });

    const due: DueTicket[] = [];
    for (const { ticket, requesterDiscordId } of candidates) {
      if (due.length >= limit) break;
      const eligible = supports.filter((s) => s.userId !== ticket.requesterId);
      const challenges = await issueChallenges(tx, ticket.id, eligible, outstanding);
      if (challenges.length === 0) continue;
      await tx.update(tickets).set({ offeredAt: now }).where(eq(tickets.id, ticket.id));
      const reoffer = ticket.offeredAt !== null;
      if (reoffer) {
        await writeAudit(tx, {
          guildId: config.guildId,
          actorUserId: null,
          action: 'ticket.reoffered',
          data: { ticketId: ticket.id, offeredTo: challenges.length },
        });
      }
      due.push({
        ticketId: ticket.id,
        requesterDiscordId,
        description: ticket.description,
        createdAt: ticket.createdAt,
        reoffer,
        challenges,
      });
    }
    return due;
  });
}

/** The open or claimed ticket a person takes part in (as requester or claimer), newest first. */
export async function activeTicket(
  deps: TicketDeps,
  discordId: string,
): Promise<{
  ticketId: string;
  status: 'open' | 'claimed';
  role: 'requester' | 'support';
  counterpartDiscordId: string | null;
} | null> {
  const { db, config } = deps;
  const [user] = await db.select().from(users).where(eq(users.discordId, discordId));
  if (!user) return null;
  // The ticket a person claimed comes first: their own open question must not take its place.
  const [inWork] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.guildId, config.guildId), eq(tickets.status, 'claimed'), eq(tickets.claimedBy, user.id)))
    .orderBy(desc(tickets.claimedAt))
    .limit(1);
  const [own] = inWork
    ? []
    : await db
        .select()
        .from(tickets)
        .where(
          and(eq(tickets.guildId, config.guildId), ne(tickets.status, 'closed'), eq(tickets.requesterId, user.id)),
        )
        .orderBy(desc(tickets.createdAt))
        .limit(1);
  const t = inWork ?? own;
  if (!t) return null;
  const role = t.requesterId === user.id ? 'requester' : 'support';
  const otherId = role === 'requester' ? t.claimedBy : t.requesterId;
  const other = otherId
    ? (await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, otherId)))[0]
    : undefined;
  return {
    ticketId: t.id,
    status: t.status as 'open' | 'claimed',
    role,
    counterpartDiscordId: other?.discordId ?? null,
  };
}
