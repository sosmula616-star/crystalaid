import { auditLog, type Db } from '@crystalaid/database';

/** A transaction handle, or the database itself. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface AuditEntry {
  guildId: string;
  /** Internal users.id of the actor; null for system actions such as Discord sync. */
  actorUserId: string | null;
  action: string;
  targetUserId?: string;
  reason?: string;
  data?: unknown;
}

/** Appends one row to the append-only audit log inside the caller's transaction. */
export async function writeAudit(tx: Tx | Db, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    guildId: entry.guildId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetUserId: entry.targetUserId ?? null,
    reason: entry.reason ?? null,
    data: entry.data ?? {},
  });
}
