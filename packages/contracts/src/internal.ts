import { z } from 'zod';
import { ITEM_KEYS, PERMISSIONS } from '@crystalaid/domain';
import { SettingsPatch } from './api.js';
import { DiscordId } from './events.js';

// Requests of the bot to /internal/*. Every request names the person it acts for in
// `actorDiscordId`; the API checks that person's current level, never the bot.

const IsoDate = z.iso.datetime();
const TicketId = z.uuid();
const ItemKeySchema = z.enum(ITEM_KEYS);
/** Limit of the first message (the /help modal question). Later messages are not limited by it. */
export const FIRST_MESSAGE_MAX = 300;
const Text = z.string().trim().min(1).max(4000);
const Actor = { actorDiscordId: DiscordId };

export const TicketIdParams = z.object({ id: TicketId });

export const CreateTicketRequest = z.object({
  ...Actor,
  username: z.string().min(1).max(100),
  /** The question from the /help modal. */
  message: z.string().trim().min(1).max(FIRST_MESSAGE_MAX),
});
export type CreateTicketRequest = z.infer<typeof CreateTicketRequest>;

/** The task shown to a support. The right answer is never part of any response. */
export const ChallengeSchema = z.object({
  target: ItemKeySchema,
  options: z.array(ItemKeySchema).length(4),
});
export type ChallengeDto = z.infer<typeof ChallengeSchema>;

export const OfferedChallengeSchema = z.object({
  supportDiscordId: DiscordId,
  challenge: ChallengeSchema,
});

export const CreateTicketResponse = z.object({
  ticketId: TicketId,
  requesterDiscordId: DiscordId,
  /** Empty when nobody is on duty: the ticket waits for the next PT. */
  challenges: z.array(OfferedChallengeSchema),
});
export type CreateTicketResponse = z.infer<typeof CreateTicketResponse>;

/** The answer is the position (0 to 3) of the pressed button, never an item key. */
export const ClaimRequest = z.object({ ...Actor, choiceIndex: z.number().int().min(0).max(3) });
export type ClaimRequest = z.infer<typeof ClaimRequest>;
export const ClaimResponse = z.object({
  /** usy: the support already has a claimed ticket (the attempt is not spent). yours: they claimed this one already. */
  result: z.enum(['claimed', 'wrong', 'already_taken', 'closed', 'busy', 'yours']),
  requesterDiscordId: DiscordId.optional(),
  /** The question of the ticket, for claimed and yours. */
  description: z.string().optional(),
});
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const MessageRequest = z.object({
  ...Actor,
  content: Text,
  discordMessageId: z.string().max(32).optional(),
});
export type MessageRequest = z.infer<typeof MessageRequest>;
export const MessageResponse = z.object({
  isStaff: z.boolean(),
  /** Empty while nobody has taken the ticket. */
  recipientDiscordId: z.union([DiscordId, z.literal('')]),
});

export const CloseRequest = z.object({ ...Actor });
export const CloseResponse = z.object({
  ticketId: TicketId,
  requesterDiscordId: DiscordId,
  claimerDiscordId: DiscordId.nullable(),
  transcript: z.string(),
  messageCount: z.number().int(),
});
export type CloseResponse = z.infer<typeof CloseResponse>;

export const CancelRequest = z.object({ ...Actor });
export const CancelResponse = z.object({ result: z.enum(['cancelled', 'claimed', 'closed']) });
export type CancelResponse = z.infer<typeof CancelResponse>;

export const ReleaseRequest = z.object({ ...Actor });
export const ReleaseResponse = z.object({
  ticketId: TicketId,
  requesterDiscordId: DiscordId,
  claimerDiscordId: DiscordId.nullable(),
});
export type ReleaseResponse = z.infer<typeof ReleaseResponse>;

/** Tickets closed by the API because nothing happened in them for 24 hours. */
export const ExpiredTicketsResponse = z.object({
  items: z.array(
    z.object({
      ticketId: TicketId,
      requesterDiscordId: DiscordId,
      claimerDiscordId: DiscordId.nullable(),
      transcript: z.string(),
      messageCount: z.number().int(),
    }),
  ),
});
export type ExpiredTicketsResponse = z.infer<typeof ExpiredTicketsResponse>;

export const DeliveryFailureRequest = z.object({
  targetDiscordId: DiscordId,
  what: z.string().trim().min(1).max(200),
  code: z.number().int().nullable().optional(),
});
export type DeliveryFailureRequest = z.infer<typeof DeliveryFailureRequest>;
export const DeliveryFailuresResponse = z.object({
  items: z.array(z.object({ at: IsoDate, discordId: z.string(), what: z.string(), code: z.number().int().nullable() })),
});
export type DeliveryFailuresResponse = z.infer<typeof DeliveryFailuresResponse>;

export const RatingRequest = z.object({ ...Actor, rating: z.number().int().min(1).max(5) });
export type RatingRequest = z.infer<typeof RatingRequest>;

export const ActorQuery = z.object({ ...Actor });
export const ActiveTicketResponse = z.object({
  ticket: z
    .object({
      ticketId: TicketId,
      status: z.enum(['open', 'claimed']),
      role: z.enum(['requester', 'support']),
      counterpartDiscordId: DiscordId.nullable(),
    })
    .nullable(),
});

export const DueTicketsResponse = z.object({
  items: z.array(
    z.object({
      ticketId: TicketId,
      requesterDiscordId: DiscordId,
      description: z.string(),
      createdAt: IsoDate,
      reoffer: z.boolean(),
      challenges: z.array(OfferedChallengeSchema),
    }),
  ),
});
export type DueTicketsResponse = z.infer<typeof DueTicketsResponse>;

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const PtListQuery = z.object({ ...Actor, date: LocalDate });
export const PtSlotRequest = z.object({ ...Actor, startsAt: IsoDate, discordUserId: DiscordId });
export type PtSlotRequest = z.infer<typeof PtSlotRequest>;
export const PtSlotQuery = PtSlotRequest;
const PtSlotItem = z.object({ startsAt: IsoDate, discordId: DiscordId, username: z.string() });
export const PtListResponse = z.object({ items: z.array(PtSlotItem) });
/** A reminder is marked as sent only by ReminderConfirmRequest, after the DM went out. */
export const PtRemindersResponse = z.object({ items: z.array(PtSlotItem.extend({ slotId: z.uuid() })) });
export type PtRemindersResponse = z.infer<typeof PtRemindersResponse>;
export const ReminderConfirmRequest = z.object({ slotId: z.uuid() });

export const MenuSettingsPatchRequest = z.object({ ...Actor, patch: SettingsPatch });

export const DiagnosticsResponse = z.object({
  version: z.string(),
  commit: z.string().nullable(),
  uptimeSeconds: z.number().int(),
  queueSize: z.number().int().nullable(),
  deadSize: z.number().int().nullable(),
  openTickets: z.number().int(),
  database: z.boolean(),
  redis: z.boolean(),
  recentErrors: z.array(z.object({ id: z.string(), error: z.string() })),
});
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponse>;

/** What the menus need to decide which buttons to show. Every action is still checked on its own. */
export const MenuAccessResponse = z.object({
  level: z.enum(['NONE', 'SUPPORT', 'CURATOR', 'ADMIN', 'DEVELOPER']),
  permissions: z.array(z.enum(PERMISSIONS)),
});
export type MenuAccessResponse = z.infer<typeof MenuAccessResponse>;

export const InternalPermissionsPatch = z.object({
  ...Actor,
  level: z.enum(['SUPPORT', 'CURATOR']),
  grants: z.array(z.enum(PERMISSIONS)),
});
export type InternalPermissionsPatch = z.infer<typeof InternalPermissionsPatch>;

export const OpenTicketsResponse = z.object({
  items: z.array(
    z.object({
      ticketId: TicketId,
      status: z.enum(['open', 'claimed']),
      createdAt: IsoDate,
      claimerDiscordId: DiscordId.nullable(),
      claimerUsername: z.string().nullable(),
    }),
  ),
  total: z.number().int(),
});
export type OpenTicketsResponse = z.infer<typeof OpenTicketsResponse>;
