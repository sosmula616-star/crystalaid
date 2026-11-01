import { randomUUID } from 'node:crypto';
import type { ServerConfig } from '@crystalaid/config';
import type { BotEvent } from '@crystalaid/contracts';

export interface RosterMember {
  userId: string;
  username: string;
  avatar: string | null;
  roleIds: string[];
}

export interface EventSink {
  publish(event: BotEvent): Promise<void>;
}

type RosterConfig = Pick<ServerConfig, 'guildId' | 'roles' | 'users'>;

/**
 * Decides which members the API hears about: branch role holders now or before, and the people
 * listed in `users.admins` and `users.developers`. "Before" is remembered in `known`, because the
 * member cache is small and the old state of a member is usually not available.
 */
export function createRoster(cfg: RosterConfig, sink: EventSink, now: () => Date = () => new Date()) {
  const branchRoles = new Set([...cfg.roles.support, ...cfg.roles.curator, ...cfg.roles.admin]);
  const listed = new Set([...cfg.users.admins, ...cfg.users.developers]);
  const known = new Set<string>();

  const holdsBranchRole = (roleIds: Iterable<string>): boolean => {
    for (const r of roleIds) if (branchRoles.has(r)) return true;
    return false;
  };
  const isRelevant = (userId: string, roleIds: Iterable<string>): boolean =>
    listed.has(userId) || holdsBranchRole(roleIds);

  async function memberUpdated(m: RosterMember): Promise<void> {
    const nowRelevant = isRelevant(m.userId, m.roleIds);
    if (!nowRelevant && !known.has(m.userId)) return;
    await sink.publish({
      type: 'member.updated',
      guildId: cfg.guildId,
      userId: m.userId,
      username: m.username,
      avatar: m.avatar,
      roleIds: m.roleIds,
      at: now().toISOString(),
    });
    if (nowRelevant) known.add(m.userId);
    else known.delete(m.userId);
  }

  async function memberRemoved(userId: string, roleIds: Iterable<string> = []): Promise<void> {
    if (!known.has(userId) && !isRelevant(userId, roleIds)) return;
    await sink.publish({ type: 'member.removed', guildId: cfg.guildId, userId, at: now().toISOString() });
    known.delete(userId);
  }

  /**
   * One snapshot of everyone relevant. `at` is taken before the fetch starts, so events that arrive
   * during a long fetch are newer than the snapshot. Listed users are fetched by id, not by scanning.
   */
  async function snapshot(source: {
    fetchAll(): Promise<RosterMember[]>;
    fetchByIds(ids: string[]): Promise<RosterMember[]>;
  }): Promise<number> {
    const at = now().toISOString();
    const all = await source.fetchAll();
    const byId = new Map<string, RosterMember>();
    for (const m of all) if (holdsBranchRole(m.roleIds)) byId.set(m.userId, m);
    const missing = [...listed].filter((id) => !byId.has(id));
    if (missing.length > 0) for (const m of await source.fetchByIds(missing)) byId.set(m.userId, m);
    const members = [...byId.values()];
    await sink.publish({
      type: 'member.snapshot',
      guildId: cfg.guildId,
      snapshotId: randomUUID(),
      members,
      part: 1,
      parts: 1,
      at,
    });
    for (const m of members) known.add(m.userId);
    return members.length;
  }

  return { memberUpdated, memberRemoved, snapshot, isRelevant, known };
}

export type Roster = ReturnType<typeof createRoster>;
