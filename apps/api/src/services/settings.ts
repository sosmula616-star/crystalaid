import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import { SettingsSchema, type Settings, type SettingsPatch } from '@crystalaid/contracts';
import { settings, type Db } from '@crystalaid/database';
import { writeAudit } from './audit.js';

export async function getSettings(db: Db, guildId: string): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.guildId, guildId));
  return SettingsSchema.parse(row?.data ?? {});
}

/** Applies a patch; writes nothing (and no audit row) when nothing changes. */
export async function patchSettings(
  db: Db,
  guildId: string,
  actorUserId: string,
  patch: SettingsPatch,
): Promise<Settings> {
  return db.transaction(async (tx) => {
    // FOR UPDATE on zero rows locks nothing, so make sure the row exists first.
    await tx.insert(settings).values({ guildId, data: SettingsSchema.parse({}) }).onConflictDoNothing();
    const [row] = await tx.select().from(settings).where(eq(settings.guildId, guildId)).for('update');
    const before = SettingsSchema.parse(row?.data ?? {});
    const after = SettingsSchema.parse({ ...before, ...patch });
    if (isDeepStrictEqual(before, after)) return before;
    await tx
      .insert(settings)
      .values({ guildId, data: after })
      .onConflictDoUpdate({ target: settings.guildId, set: { data: after, updatedAt: new Date() } });
    await writeAudit(tx, { guildId, actorUserId, action: 'settings.updated', data: { before, after } });
    return after;
  });
}
