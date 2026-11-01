import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRANTS, type Permission } from '@crystalaid/domain';
import { auditLog, rolePermissions, seedDefaults, staffMembers, withTestDb } from '@crystalaid/database';
import { ensureSeeded, getGrants, updateGrants } from './permissions.js';
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
      await updateGrants(db, GUILD, { userId: admin.userId, level: 'ADMIN' }, 'CURATOR', next);

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
        updateGrants(db, GUILD, { userId: admin.userId, level: 'ADMIN' }, 'CURATOR', ['nope.nothing' as Permission]),
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
          updateGrants(db, GUILD, { userId: curator.userId, level }, 'SUPPORT', ['reports.view']),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      expect(await getGrants(db, GUILD, 'SUPPORT')).toEqual([]);
    }));
});

describe('ensureSeeded', () => {
  it('creates the default CURATOR grants on an empty guild', () =>
    withTestDb(async (db) => {
      await ensureSeeded(db, GUILD);
      expect((await getGrants(db, GUILD, 'CURATOR')).sort()).toEqual([...DEFAULT_GRANTS.CURATOR].sort());
    }));

  it('does not restore a grant an admin removed', () =>
    withTestDb(async (db) => {
      await ensureSeeded(db, GUILD);
      const admin = (await syncMember({ db, config }, memberInput(1, [ADMIN_ROLE])))!;
      await updateGrants(db, GUILD, { userId: admin.userId, level: 'ADMIN' }, 'CURATOR', ['reports.view']);
      await ensureSeeded(db, GUILD);
      expect(await getGrants(db, GUILD, 'CURATOR')).toEqual(['reports.view']);
    }));
});

describe('updateGrants guild', () => {
  it('changes the configured guild only, even when the admin also has a row in another guild', () =>
    withTestDb(async (db) => {
      const OTHER = '999999999999999999';
      await seedDefaults(db, GUILD);
      await seedDefaults(db, OTHER);
      const admin = (await syncMember({ db, config }, memberInput(1, [ADMIN_ROLE])))!;
      // an ADMIN row in a second guild, created first so that any "first row" guess would find it
      await db.insert(staffMembers).values({ guildId: OTHER, userId: admin.userId, level: 'ADMIN' });
      const otherBefore = (await getGrants(db, OTHER, 'CURATOR')).sort();

      await updateGrants(db, GUILD, { userId: admin.userId, level: 'ADMIN' }, 'CURATOR', ['reports.view']);

      expect(await getGrants(db, GUILD, 'CURATOR')).toEqual(['reports.view']);
      expect((await getGrants(db, OTHER, 'CURATOR')).sort()).toEqual(otherBefore);
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'grants.updated'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ guildId: GUILD });
    }));

  it('serializes parallel updates of one level without errors', () =>
    withTestDb(async (db) => {
      await seedDefaults(db, GUILD);
      const admin = (await syncMember({ db, config }, memberInput(1, [ADMIN_ROLE])))!;
      const sets: Permission[][] = [['reports.view'], ['tickets.view_all'], ['reports.view', 'tokens.grant'], []];
      const results = await Promise.allSettled(
        sets.map((g) => updateGrants(db, GUILD, { userId: admin.userId, level: 'ADMIN' }, 'CURATOR', g)),
      );
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
      const final = (await getGrants(db, GUILD, 'CURATOR')).sort();
      expect(sets.map((s) => [...s].sort())).toContainEqual(final);
    }));
});
