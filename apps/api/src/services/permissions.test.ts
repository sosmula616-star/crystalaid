import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRANTS, type Permission } from '@crystalaid/domain';
import { auditLog, rolePermissions, seedDefaults, withTestDb } from '@crystalaid/database';
import { getGrants, updateGrants } from './permissions.js';
import { syncMember } from './staff.js';
import { ADMIN_ROLE, CURATOR_ROLE, GUILD, SUPPORT_ROLE, config, memberInput } from '../test-helpers.js';

describe('grants', () => {
  it('reads seeded grants for a level', () =>
    withTestDb(async (db) => {
      await seedDefaults(db, GUILD);
      expect((await getGrants(db, GUILD, 'CURATOR')).sort()).toEqual([...DEFAULT_GRANTS.CURATOR].sort());
      expect(await getGrants(db, GUILD, 'SUPPORT')).toEqual([]);
    }));

  it('lets an admin replace grants, writes the audit log and keeps amount limits', () =>
    withTestDb(async (db) => {
      await seedDefaults(db, GUILD);
      const admin = (await syncMember({ db, config }, memberInput(1, [ADMIN_ROLE])))!;
      await db
        .insert(rolePermissions)
        .values({ guildId: GUILD, level: 'CURATOR', permission: 'tokens.grant', amountLimit: 100 });

      const next: Permission[] = ['tickets.view_all', 'tokens.grant'];
      await updateGrants(db, { userId: admin.userId, level: 'ADMIN' }, 'CURATOR', next);

      expect((await getGrants(db, GUILD, 'CURATOR')).sort()).toEqual([...next].sort());
      const [limited] = await db
        .select()
        .from(rolePermissions)
        .where(and(eq(rolePermissions.level, 'CURATOR'), eq(rolePermissions.permission, 'tokens.grant')));
      expect(limited?.amountLimit).toBe(100);
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'grants.updated'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorUserId: admin.userId, guildId: GUILD });
    }));

  it('rejects an unknown permission with VALIDATION_ERROR and changes nothing', () =>
    withTestDb(async (db) => {
      await seedDefaults(db, GUILD);
      const admin = (await syncMember({ db, config }, memberInput(1, [ADMIN_ROLE])))!;
      await expect(
        updateGrants(db, { userId: admin.userId, level: 'ADMIN' }, 'CURATOR', ['nope.nothing' as Permission]),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await getGrants(db, GUILD, 'CURATOR')).toHaveLength(DEFAULT_GRANTS.CURATOR.length);
      expect(await db.select().from(auditLog).where(eq(auditLog.action, 'grants.updated'))).toHaveLength(0);
    }));

  it('rejects an actor below ADMIN with FORBIDDEN', () =>
    withTestDb(async (db) => {
      await seedDefaults(db, GUILD);
      const curator = (await syncMember({ db, config }, memberInput(2, [SUPPORT_ROLE, CURATOR_ROLE])))!;
      for (const level of ['CURATOR', 'SUPPORT', 'NONE'] as const) {
        await expect(
          updateGrants(db, { userId: curator.userId, level }, 'SUPPORT', ['reports.view']),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      expect(await getGrants(db, GUILD, 'SUPPORT')).toEqual([]);
    }));
});
