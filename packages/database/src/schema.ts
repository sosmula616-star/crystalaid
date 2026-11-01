import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Level } from '@crystalaid/domain';

// `guild_id` is the Discord guild id as text. There is no guilds table.
// Balances and amounts are bigint in number mode; times are timestamptz.

export const LEVELS = ['NONE', 'SUPPORT', 'CURATOR', 'ADMIN', 'DEVELOPER'] as const satisfies readonly Level[];

const id = () => uuid('id').primaryKey().defaultRandom();
const guildId = () => text('guild_id').notNull();
const userRef = (name = 'user_id') =>
  uuid(name)
    .notNull()
    .references(() => users.id);
const optUserRef = (name: string) => uuid(name).references(() => users.id);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const big = (name: string) => bigint(name, { mode: 'number' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(', ')})`);

export const users = pgTable('users', {
  id: id(),
  discordId: text('discord_id').notNull().unique(),
  username: text('username').notNull(),
  displayName: text('display_name'),
  avatar: text('avatar'),
  createdAt: createdAt(),
});

export const staffMembers = pgTable(
  'staff_members',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    level: text('level', { enum: LEVELS }).notNull().default('SUPPORT'),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    position: text('position'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    tokenBalance: big('token_balance').notNull().default(0),
    // Time of the newest Discord event applied; older (retried) events are skipped.
    lastEventAt: ts('last_event_at'),
  },
  (t) => [
    unique('staff_members_guild_user_uq').on(t.guildId, t.userId),
    check('staff_members_balance_nonneg', sql`${t.tokenBalance} >= 0`),
    check('staff_members_level_chk', inList('level', LEVELS)),
    check('staff_members_status_chk', inList('status', ['active', 'inactive'])),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    guildId: guildId(),
    level: text('level', { enum: LEVELS }).notNull(),
    permission: text('permission').notNull(),
    amountLimit: big('amount_limit'),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.level, t.permission] }),
    check('role_permissions_level_chk', inList('level', LEVELS)),
    check('role_permissions_limit_nonneg', sql`${t.amountLimit} IS NULL OR ${t.amountLimit} >= 0`),
  ],
);

export const settings = pgTable('settings', {
  guildId: text('guild_id').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// Append-only: UPDATE and DELETE are rejected by a trigger (see migrations).
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    guildId: guildId(),
    actorUserId: optUserRef('actor_user_id'),
    action: text('action').notNull(),
    targetUserId: optUserRef('target_user_id'),
    reason: text('reason'),
    data: jsonb('data').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_guild_created_idx').on(t.guildId, t.createdAt)],
);

const TICKET_STATUSES = ['open', 'claimed', 'closed'] as const;
const TICKET_EVENT_TYPES = ['created', 'claimed', 'transferred', 'closed'] as const;

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    guildId: guildId(),
    requesterId: userRef('requester_id'),
    category: text('category').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: TICKET_STATUSES }).notNull().default('open'),
    channelId: text('channel_id'),
    claimedBy: optUserRef('claimed_by'),
    createdAt: createdAt(),
    claimedAt: ts('claimed_at'),
    // Last time the ticket was offered to supports; null while nobody was on duty.
    offeredAt: ts('offered_at'),
    firstResponseAt: ts('first_response_at'),
    // Last message, claim or release; a ticket idle for 24 hours is closed by the scheduler.
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
    closedBy: optUserRef('closed_by'),
    result: text('result'),
    rating: smallint('rating'),
    ratedAt: ts('rated_at'),
  },
  (t) => [
    uniqueIndex('tickets_one_open_per_category_uq')
      .on(t.guildId, t.requesterId, t.category)
      .where(sql`${t.status} <> 'closed'`),
    index('tickets_guild_status_idx').on(t.guildId, t.status),
    check('tickets_status_chk', inList('status', TICKET_STATUSES)),
    check('tickets_rating_chk', sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
  ],
);

// One anti-bot task per support per ticket. `answer` never leaves the API.
export const ticketChallenges = pgTable(
  'ticket_challenges',
  {
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: userRef(),
    answer: text('answer').notNull(),
    // The 4 option keys in the order shown; a claim names a position, not a key.
    options: jsonb('options').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    attemptedAt: ts('attempted_at'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] })],
);

// Hourly duty slots (PT). `starts_at` is aligned to the hour in the configured timezone.
export const ptSlots = pgTable(
  'pt_slots',
  {
    id: id(),
    guildId: guildId(),
    startsAt: ts('starts_at').notNull(),
    userId: userRef(),
    remindedAt: ts('reminded_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pt_slots_guild_start_user_uq').on(t.guildId, t.startsAt, t.userId),
    index('pt_slots_guild_start_idx').on(t.guildId, t.startsAt),
  ],
);

export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: id(),
    guildId: guildId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    type: text('type', { enum: TICKET_EVENT_TYPES }).notNull(),
    actorUserId: optUserRef('actor_user_id'),
    targetUserId: optUserRef('target_user_id'),
    data: jsonb('data').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('ticket_events_ticket_idx').on(t.ticketId),
    check('ticket_events_type_chk', inList('type', TICKET_EVENT_TYPES)),
  ],
);

// Retained 90 days; a cleanup job deletes by created_at.
export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: id(),
    guildId: guildId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    discordMessageId: text('discord_message_id'),
    authorDiscordId: text('author_discord_id').notNull(),
    authorUserId: optUserRef('author_user_id'),
    isStaff: boolean('is_staff').notNull().default(false),
    content: text('content').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ticket_messages_ticket_created_idx').on(t.ticketId, t.createdAt),
    index('ticket_messages_created_idx').on(t.createdAt),
  ],
);

export const staffDaily = pgTable(
  'staff_daily',
  {
    guildId: guildId(),
    userId: userRef(),
    day: date('day', { mode: 'string' }).notNull(),
    onlineSeconds: integer('online_seconds').notNull().default(0),
    voiceSeconds: integer('voice_seconds').notNull().default(0),
    messages: integer('messages').notNull().default(0),
    shiftSeconds: integer('shift_seconds').notNull().default(0),
    ticketsClaimed: integer('tickets_claimed').notNull().default(0),
    ticketsClosed: integer('tickets_closed').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId, t.day] })],
);

export const presenceSessions = pgTable(
  'presence_sessions',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    startedAt: ts('started_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
  },
  (t) => [
    uniqueIndex('presence_sessions_one_open_uq')
      .on(t.guildId, t.userId)
      .where(sql`${t.endedAt} IS NULL`),
  ],
);

export const voiceSessions = pgTable(
  'voice_sessions',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    startedAt: ts('started_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
  },
  (t) => [
    uniqueIndex('voice_sessions_one_open_uq')
      .on(t.guildId, t.userId)
      .where(sql`${t.endedAt} IS NULL`),
  ],
);

export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    startedAt: ts('started_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
    endReason: text('end_reason', { enum: ['manual', 'auto_closed', 'edited'] }),
    excludedSeconds: integer('excluded_seconds').notNull().default(0),
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    promptedAt: ts('prompted_at'),
    editedBy: optUserRef('edited_by'),
  },
  (t) => [
    uniqueIndex('shifts_one_open_uq')
      .on(t.guildId, t.userId)
      .where(sql`${t.endedAt} IS NULL`),
    index('shifts_guild_user_started_idx').on(t.guildId, t.userId, t.startedAt),
    check('shifts_end_reason_chk', sql`${t.endReason} IS NULL OR ${t.endReason} IN ('manual', 'auto_closed', 'edited')`),
  ],
);

export const absences = pgTable(
  'absences',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    reason: text('reason'),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    decidedBy: optUserRef('decided_by'),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('absences_guild_user_starts_idx').on(t.guildId, t.userId, t.startsOn),
    check('absences_range_chk', sql`${t.endsOn} >= ${t.startsOn}`),
    check('absences_status_chk', inList('status', ['pending', 'approved', 'rejected'])),
  ],
);

export const warnings = pgTable(
  'warnings',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    authorId: userRef('author_id'),
    reason: text('reason').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedBy: optUserRef('revoked_by'),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('warnings_guild_user_idx').on(t.guildId, t.userId)],
);

export const staffNotes = pgTable(
  'staff_notes',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    authorId: userRef('author_id'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('staff_notes_guild_user_idx').on(t.guildId, t.userId)],
);

export const careerEvents = pgTable(
  'career_events',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    type: text('type').notNull(),
    actorUserId: optUserRef('actor_user_id'),
    data: jsonb('data').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('career_events_guild_user_idx').on(t.guildId, t.userId)],
);

const LEDGER_TYPES = ['payroll', 'grant', 'deduct', 'purchase', 'refund'] as const;

// Append-only: UPDATE and DELETE are rejected by a trigger (see migrations).
// `amount` is the signed change to the balance.
export const tokenLedger = pgTable(
  'token_ledger',
  {
    id: id(),
    guildId: guildId(),
    userId: userRef(),
    type: text('type', { enum: LEDGER_TYPES }).notNull(),
    amount: big('amount').notNull(),
    balanceAfter: big('balance_after').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    reason: text('reason'),
    actorUserId: optUserRef('actor_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('token_ledger_guild_user_created_idx').on(t.guildId, t.userId, t.createdAt),
    check('token_ledger_type_chk', inList('type', LEDGER_TYPES)),
    check('token_ledger_amount_nonzero', sql`${t.amount} <> 0`),
    check('token_ledger_balance_nonneg', sql`${t.balanceAfter} >= 0`),
  ],
);

export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    id: id(),
    guildId: guildId(),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['draft', 'approved'] })
      .notNull()
      .default('draft'),
    createdAt: createdAt(),
    approvedBy: optUserRef('approved_by'),
    approvedAt: ts('approved_at'),
  },
  (t) => [
    unique('payroll_periods_guild_week_uq').on(t.guildId, t.weekStart),
    check('payroll_periods_status_chk', inList('status', ['draft', 'approved'])),
  ],
);

export const payrollLines = pgTable(
  'payroll_lines',
  {
    id: id(),
    guildId: guildId(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: 'cascade' }),
    userId: userRef(),
    breakdown: jsonb('breakdown').notNull().default({}),
    calculatedAmount: big('calculated_amount').notNull(),
    adjustedAmount: big('adjusted_amount'),
    adjustReason: text('adjust_reason'),
    adjustedBy: optUserRef('adjusted_by'),
  },
  (t) => [
    unique('payroll_lines_period_user_uq').on(t.periodId, t.userId),
    check(
      'payroll_lines_amounts_nonneg',
      sql`${t.calculatedAmount} >= 0 AND (${t.adjustedAmount} IS NULL OR ${t.adjustedAmount} >= 0)`,
    ),
  ],
);

const SHOP_KINDS = ['role', 'theme', 'manual'] as const;
const ORDER_STATUSES = ['pending', 'fulfilled', 'rejected', 'failed'] as const;

export const shopItems = pgTable(
  'shop_items',
  {
    id: id(),
    guildId: guildId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    price: big('price').notNull(),
    stock: big('stock'),
    active: boolean('active').notNull().default(true),
    kind: text('kind', { enum: SHOP_KINDS }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('shop_items_guild_active_idx').on(t.guildId, t.active),
    check('shop_items_price_nonneg', sql`${t.price} >= 0`),
    check('shop_items_stock_nonneg', sql`${t.stock} IS NULL OR ${t.stock} >= 0`),
    check('shop_items_kind_chk', inList('kind', SHOP_KINDS)),
  ],
);

export const shopOrders = pgTable(
  'shop_orders',
  {
    id: id(),
    guildId: guildId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => shopItems.id),
    userId: userRef(),
    price: big('price').notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('pending'),
    decidedBy: optUserRef('decided_by'),
    decidedAt: ts('decided_at'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('shop_orders_guild_status_idx').on(t.guildId, t.status),
    check('shop_orders_status_chk', inList('status', ORDER_STATUSES)),
  ],
);

export const TABLE_NAMES = [
  'users',
  'staff_members',
  'role_permissions',
  'settings',
  'audit_log',
  'tickets',
  'ticket_events',
  'ticket_messages',
  'ticket_challenges',
  'pt_slots',
  'staff_daily',
  'presence_sessions',
  'voice_sessions',
  'shifts',
  'absences',
  'warnings',
  'staff_notes',
  'career_events',
  'token_ledger',
  'payroll_periods',
  'payroll_lines',
  'shop_items',
  'shop_orders',
] as const;
