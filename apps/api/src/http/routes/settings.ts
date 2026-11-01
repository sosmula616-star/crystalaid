import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '@crystalaid/config';
import { SettingsPatch, type Settings } from '@crystalaid/contracts';
import type { Db } from '@crystalaid/database';
import { getSettings, patchSettings } from '../../services/settings.js';

export function registerSettings(app: FastifyInstance, deps: { db: Db; config: ServerConfig }): void {
  const { db, config } = deps;
  const guards = [app.requireStaff, app.requireLevel('ADMIN')];

  app.get('/settings', { onRequest: guards }, async (): Promise<Settings> => getSettings(db, config.guildId));

  app.patch('/settings', { onRequest: guards }, async (request): Promise<Settings> =>
    patchSettings(db, config.guildId, request.actor.userId, SettingsPatch.parse(request.body)),
  );
}
