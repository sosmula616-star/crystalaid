import { SettingsSchema } from '@crystalaid/contracts';
import { DEFAULT_GRANTS } from '@crystalaid/domain';
import type { Db } from './client.js';
import { rolePermissions, settings } from './schema.js';

/** Inserts default settings and grants for a guild. Existing rows are never overwritten. */
export async function seedDefaults(db: Db, guildId: string): Promise<void> {
  const grants = Object.entries(DEFAULT_GRANTS) as [keyof typeof DEFAULT_GRANTS, string[]][];
  const rows = grants.flatMap(([level, permissions]) =>
    permissions.map((permission) => ({ guildId, level, permission, amountLimit: null })),
  );
  await db.transaction(async (tx) => {
    await tx
      .insert(settings)
      .values({ guildId, data: SettingsSchema.parse({}) })
      .onConflictDoNothing();
    if (rows.length > 0) await tx.insert(rolePermissions).values(rows).onConflictDoNothing();
  });
}
