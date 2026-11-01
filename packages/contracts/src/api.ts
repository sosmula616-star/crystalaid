import { z } from 'zod';
import { PERMISSIONS } from '@crystalaid/domain';
import { DiscordId } from './events.js';

const IsoDate = z.iso.datetime();
const PermissionSchema = z.enum(PERMISSIONS);
const LevelSchema = z.enum(['NONE', 'SUPPORT', 'CURATOR', 'ADMIN', 'DEVELOPER']);
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
/** Waiting times: zero would fire a timer at once. */
const minutes = z.number().int().min(1);

/** Token amounts are whole numbers: the ledger is integer. */
const settingFields = {
  ticketRate: nonNegativeInt,
  shiftHourRate: nonNegativeInt,
  normBonus: nonNegativeInt,
  weeklyNormHours: nonNegative,
  weeklyNormTickets: nonNegativeInt,
  ticketWaitMinutes: minutes,
  inactivityMinutes: minutes,
  inactivityReplyMinutes: minutes,
  warningDays: nonNegativeInt,
  ticketCategories: z.array(z.string()),
};

export const SettingsSchema = z.object({
  ticketRate: settingFields.ticketRate.default(10),
  shiftHourRate: settingFields.shiftHourRate.default(5),
  normBonus: settingFields.normBonus.default(50),
  weeklyNormHours: settingFields.weeklyNormHours.default(20),
  weeklyNormTickets: settingFields.weeklyNormTickets.default(30),
  ticketWaitMinutes: settingFields.ticketWaitMinutes.default(30),
  inactivityMinutes: settingFields.inactivityMinutes.default(30),
  inactivityReplyMinutes: settingFields.inactivityReplyMinutes.default(10),
  warningDays: settingFields.warningDays.default(30),
  ticketCategories: settingFields.ticketCategories.default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** PATCH /settings body: any subset of the settings, no unknown keys. */
export const SettingsPatch = z.strictObject(
  Object.fromEntries(Object.entries(settingFields).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof settingFields]: z.ZodOptional<(typeof settingFields)[K]>;
  },
);
export type SettingsPatch = z.infer<typeof SettingsPatch>;

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
