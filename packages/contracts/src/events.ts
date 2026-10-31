import { z } from 'zod';

export const DiscordId = z.string().regex(/^\d{17,20}$/);
const IsoDate = z.iso.datetime();

export const MemberUpdated = z.object({
  type: z.literal('member.updated'),
  guildId: DiscordId,
  userId: DiscordId,
  username: z.string(),
  avatar: z.string().nullable(),
  roleIds: z.array(DiscordId),
  at: IsoDate,
});

export const MemberRemoved = z.object({
  type: z.literal('member.removed'),
  guildId: DiscordId,
  userId: DiscordId,
  at: IsoDate,
});

export const MemberSnapshot = z.object({
  type: z.literal('member.snapshot'),
  guildId: DiscordId,
  snapshotId: z.string().min(1),
  members: z.array(
    z.object({
      userId: DiscordId,
      username: z.string(),
      avatar: z.string().nullable(),
      roleIds: z.array(DiscordId),
    }),
  ),
  final: z.boolean(),
  at: IsoDate,
});

export const BotEvent = z.discriminatedUnion('type', [MemberUpdated, MemberRemoved, MemberSnapshot]);
export type BotEvent = z.infer<typeof BotEvent>;
