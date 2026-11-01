import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
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

/** Issues (or re-issues, if not yet attempted) a challenge for each support. */
async function issueChallenges(
  tx: Tx,
  ticketId: string,
  supports: { userId: string; discordId: string }[],
): Promise<OfferedChallenge[]> {
  const offered: OfferedChallenge[] = [];
  for (const s of supports) {
    const challenge = makeChallenge();
    const rows = await tx
      .insert(ticketChallenges)
      .values({ ticketId, userId: s.userId, answer: challenge.target })
      .onConflictDoUpdate({
        target: [ticketChallenges.ticketId, ticketChallenges.userId],
        set: { answer: challenge.target },
        setWhere: isNull(ticketChallenges.attemptedAt),
      })
      .returning({ userId: ticketChallenges.userId });
    if (rows.length > 0) offered.push({ supportDiscordId: s.discordId, challenge });
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
        offeredAt: supports.length > 0 ? now : null,
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
    const challenges = await issueChallenges(tx, ticket!.id, supports);
    await writeAudit(tx, {
      guildId: config.guildId,
      actorUserId: requester.id,
      action: 'ticket.created',
      data: { ticketId: ticket!.id, offeredTo: challenges.length },
    });
    return { ticket: ticket!, requesterDiscordId: requester.discordId, challenges };
  });
}

export type ClaimResult = 'claimed' | 'wrong' | 'already_taken' | 'closed';

/**
 * A support answers the check. One attempt per support per ticket: the attempt is spent before
 * the answer is compared. A correct first answer takes the ticket with one atomic
 * `UPDATE ... WHERE status = 'open'`, so of any number of parallel correct answers one wins.
 */
export async function claimTicket(
  deps: TicketDeps,
  ticketId: string,
  supportDiscordId: string,
  choice: string,
  now: Date = new Date(),
): Promise<{ result: ClaimResult; ticket?: TicketRow; requesterDiscordId?: string }> {
  const { db, config } = deps;
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!ticket || ticket.guildId !== config.guildId) throw new AppError('NOT_FOUND', 'Not found', 404);
    if (ticket.status === 'closed') return { result: 'closed' as const };
    if (ticket.status === 'claimed') return { result: 'already_taken' as const };

    const [support] = await tx.select().from(users).where(eq(users.discordId, supportDiscordId));
    if (!support) return { result: 'wrong' as const };
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
      .returning({ answer: ticketChallenges.answer });
    if (!attempt || attempt.answer !== choice) return { result: 'wrong' as const };

    const [claimed] = await tx
      .update(tickets)
      .set({ status: 'claimed', claimedBy: support.id, claimedAt: now })
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
      .for('share');
    if (!ticket) throw new AppError('NOT_FOUND', 'Not found', 404);
    const [author] = await tx.select().from(users).where(eq(users.discordId, authorDiscordId));
    const isRequester = author?.id === ticket.requesterId;
    const isClaimer = !!author && author.id === ticket.claimedBy;
    if (!author || (!isRequester && !isClaimer)) throw new AppError('FORBIDDEN', 'Not allowed', 403);
    if (ticket.status === 'closed') throw conflict('The ticket is closed', 'ticket_closed');

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

/** The transcript as plain text; names are real, times are in the configured timezone. */
async function buildTranscript(tx: Tx, deps: TicketDeps, ticket: TicketRow): Promise<string> {
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
    lines.push(`[${formatInZone(m.createdAt, tz)}] ${who}${m.isStaff ? ' (support)' : ''}: ${m.content}`);
  }
  return lines.join('\n');
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
): Promise<{ ticket: TicketRow; transcript: string; requesterDiscordId: string }> {
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
    const transcript = await buildTranscript(tx, deps, ticket);
    const [req] = await tx
      .select({ discordId: users.discordId })
      .from(users)
      .where(eq(users.id, ticket.requesterId));
    return { ticket, transcript, requesterDiscordId: req!.discordId };
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
 * workers get different tickets) and returns fresh challenges for the supports on duty who have
 * not attempted that ticket. A ticket with nobody to offer to stays unmarked.
 */
export async function dueTickets(deps: TicketDeps, now: Date = new Date()): Promise<DueTicket[]> {
  const { db, config } = deps;
  return db.transaction(async (tx) => {
    const supports = await onDutySupports(tx, deps, now);
    if (supports.length === 0) return [];
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
      .for('update', { of: tickets, skipLocked: true });

    const due: DueTicket[] = [];
    for (const { ticket, requesterDiscordId } of candidates) {
      const eligible = supports.filter((s) => s.userId !== ticket.requesterId);
      const challenges = await issueChallenges(tx, ticket.id, eligible);
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
  const [t] = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.guildId, config.guildId),
        ne(tickets.status, 'closed'),
        or(eq(tickets.requesterId, user.id), eq(tickets.claimedBy, user.id)),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(1);
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
