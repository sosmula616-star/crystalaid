import { and, desc, eq } from 'drizzle-orm';
import type { ServerConfig } from '@crystalaid/config';
import { auditLog, users, type Db } from '@crystalaid/database';
import { writeAudit } from './audit.js';

export interface DeliveryDeps {
  db: Db;
  config: ServerConfig;
}

export const DELIVERY_FAILED = 'delivery_failed';
export const DELIVERY_LIST_LIMIT = 20;

export interface DeliveryFailure {
  at: Date;
  discordId: string;
  what: string;
  code: number | null;
}

/** The bot could not DM a person. Kept in `audit_log`, action `delivery_failed`. */
export async function recordDeliveryFailure(
  deps: DeliveryDeps,
  input: { targetDiscordId: string; what: string; code?: number | null },
): Promise<void> {
  const { db, config } = deps;
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, input.targetDiscordId));
  await writeAudit(db, {
    guildId: config.guildId,
    actorUserId: null,
    action: DELIVERY_FAILED,
    targetUserId: target?.id,
    data: { discordId: input.targetDiscordId, what: input.what, code: input.code ?? null },
  });
}

/** The last 20 failed DMs, newest first. */
export async function listDeliveryFailures(deps: DeliveryDeps): Promise<DeliveryFailure[]> {
  const { db, config } = deps;
  const rows = await db
    .select({ at: auditLog.createdAt, data: auditLog.data })
    .from(auditLog)
    .where(and(eq(auditLog.guildId, config.guildId), eq(auditLog.action, DELIVERY_FAILED)))
    .orderBy(desc(auditLog.createdAt))
    .limit(DELIVERY_LIST_LIMIT);
  return rows.map((r) => {
    const d = r.data as { discordId?: unknown; what?: unknown; code?: unknown };
    return {
      at: r.at,
      discordId: String(d.discordId ?? ''),
      what: String(d.what ?? ''),
      code: typeof d.code === 'number' ? d.code : null,
    };
  });
}
