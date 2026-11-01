import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '@crystalaid/config';
import { SettingsPatch, SettingsSchema, type Settings } from '@crystalaid/contracts';
import { settings, type Db } from '@crystalaid/database';
import { writeAudit } from '../../services/audit.js';

export function registerSettings(app: FastifyInstance, deps: { db: Db; config: ServerConfig }): void {
  const { db, config } = deps;
  const guards = [app.requireStaff, app.requireLevel('ADMIN')];

  app.get('/settings', { onRequest: guards }, async (): Promise<Settings> => {
    const [row] = await db.select().from(settings).where(eq(settings.guildId, config.guildId));
    return SettingsSchema.parse(row?.data ?? {});
  });

  app.patch('/settings', { onRequest: guards }, async (request): Promise<Settings> => {
    const patch = SettingsPatch.parse(request.body);
    return db.transaction(async (tx) => {
      // FOR UPDATE on zero rows locks nothing, so make sure the row exists first.
      await tx
        .insert(settings)
        .values({ guildId: config.guildId, data: SettingsSchema.parse({}) })
        .onConflictDoNothing();
      const [row] = await tx.select().from(settings).where(eq(settings.guildId, config.guildId)).for('update');
      const before = SettingsSchema.parse(row?.data ?? {});
      const after = SettingsSchema.parse({ ...before, ...patch });
      // Nothing changed: no write and no audit row.
      if (isDeepStrictEqual(before, after)) return before;
      await tx
        .insert(settings)
        .values({ guildId: config.guildId, data: after })
        .onConflictDoUpdate({ target: settings.guildId, set: { data: after, updatedAt: new Date() } });
      await writeAudit(tx, {
        guildId: config.guildId,
        actorUserId: request.actor.userId,
        action: 'settings.updated',
        data: { before, after },
      });
      return after;
    });
  });
}
