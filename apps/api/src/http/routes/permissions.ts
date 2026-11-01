import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '@crystalaid/config';
import { PermissionsUpdate, type PermissionsResponse } from '@crystalaid/contracts';
import type { Db } from '@crystalaid/database';
import { getGrants, updateGrants } from '../../services/permissions.js';

export function registerPermissions(app: FastifyInstance, deps: { db: Db; config: ServerConfig }): void {
  const { db, config } = deps;
  const read = async (): Promise<PermissionsResponse> => ({
    SUPPORT: await getGrants(db, config.guildId, 'SUPPORT'),
    CURATOR: await getGrants(db, config.guildId, 'CURATOR'),
  });
  const guards = [app.requireStaff, app.requireLevel('ADMIN')];

  app.get('/permissions', { onRequest: guards }, read);
  app.patch('/permissions', { onRequest: guards }, async (request) => {
    const { level, grants } = PermissionsUpdate.parse(request.body);
    const { userId, level: actorLevel } = request.actor;
    await updateGrants(db, config.guildId, { userId, level: actorLevel }, level, grants);
    return read();
  });
}
