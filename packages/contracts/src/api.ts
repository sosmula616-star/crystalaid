import { z } from 'zod';
import { PERMISSIONS } from '@crystalaid/domain';
import { DiscordId } from './events.js';

const IsoDate = z.iso.datetime();
const PermissionSchema = z.enum(PERMISSIONS);
const LevelSchema = z.enum(['NONE', 'SUPPORT', 'CURATOR', 'ADMIN']);
const StatusSchema = z.enum(['active', 'inactive']);

export const ActivityAuthRequest = z.object({
  code: z.string().min(1),
  instanceId: z.string().min(1),
});
export type ActivityAuthRequest = z.infer<typeof ActivityAuthRequest>;

export const ActivityAuthResponse = z.object({
  sessionToken: z.string(),
  discordAccessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type ActivityAuthResponse = z.infer<typeof ActivityAuthResponse>;

export const MeResponse = z.object({
  user: z.object({
    id: z.string(),
    discordId: DiscordId,
    username: z.string(),
    avatar: z.string().nullable(),
  }),
  level: LevelSchema,
  position: z.string().nullable(),
  status: StatusSchema,
  tokenBalance: z.number().int(),
  permissions: z.array(PermissionSchema),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const StaffListResponse = z.object({
  items: z.array(
    z.object({
      userId: z.string(),
      discordId: DiscordId,
      username: z.string(),
      avatar: z.string().nullable(),
      level: LevelSchema,
      status: StatusSchema,
      position: z.string().nullable(),
      joinedAt: IsoDate,
      tokenBalance: z.number().int(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type StaffListResponse = z.infer<typeof StaffListResponse>;

export const PermissionsResponse = z.object({
  SUPPORT: z.array(PermissionSchema),
  CURATOR: z.array(PermissionSchema),
});
export type PermissionsResponse = z.infer<typeof PermissionsResponse>;

export const PermissionsUpdate = z.object({
  level: z.enum(['SUPPORT', 'CURATOR']),
  grants: z.array(PermissionSchema),
});
export type PermissionsUpdate = z.infer<typeof PermissionsUpdate>;

const nonNegative = z.number().min(0);
const nonNegativeInt = z.number().int().min(0);

export const SettingsSchema = z.object({
  ticketRate: nonNegative.default(10),
  shiftHourRate: nonNegative.default(5),
  normBonus: nonNegative.default(50),
  weeklyNormHours: nonNegative.default(20),
  weeklyNormTickets: nonNegativeInt.default(30),
  ticketWaitMinutes: nonNegativeInt.default(30),
  inactivityMinutes: nonNegativeInt.default(30),
  inactivityReplyMinutes: nonNegativeInt.default(10),
  warningDays: nonNegativeInt.default(30),
  ticketCategories: z.array(z.string()).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const AuditListResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      actorUserId: z.string().nullable(),
      action: z.string(),
      targetUserId: z.string().nullable(),
      reason: z.string().nullable(),
      data: z.unknown(),
      createdAt: IsoDate,
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type AuditListResponse = z.infer<typeof AuditListResponse>;
