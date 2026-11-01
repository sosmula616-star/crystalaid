import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '@crystalaid/config';
import { AppError, SettingsSchema, type Settings } from '@crystalaid/contracts';
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
    const patch: unknown = request.body;
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new AppError('VALIDATION_ERROR', 'Invalid request: body', 400);
    }
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(settings).where(eq(settings.guildId, config.guildId)).for('update');
      const before = SettingsSchema.parse(row?.data ?? {});
      const after = SettingsSchema.parse({ ...before, ...patch });
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
