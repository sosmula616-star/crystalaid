import type { Redis } from 'ioredis';
import type { BotEvent } from '@crystalaid/contracts';
import type { EventSink } from './roster.js';
import type { MsgRef, OfferStore, TicketMeta } from './ports.js';

export const STREAM = 'events:bot';
export const OFFER_TTL_SECONDS = 24 * 60 * 60;

/** Publishes to the stream the API worker reads. XADD is a Redis 5 command. */
export function redisEventSink(redis: Redis): EventSink {
  return {
    async publish(event: BotEvent): Promise<void> {
      await redis.xadd(STREAM, '*', 'event', JSON.stringify(event));
    },
  };
}

/** Message ids of the offers per ticket, kept for 24 hours. Uses SET EX, RPUSH, EXPIRE, LRANGE only. */
export function redisOfferStore(redis: Redis): OfferStore {
  const metaKey = (id: string) => `bot:ticket:${id}:meta`;
  const offersKey = (id: string) => `bot:ticket:${id}:offers`;
  return {
    async remember(ticketId: string, meta: TicketMeta): Promise<void> {
      await redis.set(metaKey(ticketId), JSON.stringify(meta), 'EX', OFFER_TTL_SECONDS);
    },
    async meta(ticketId: string): Promise<TicketMeta | null> {
      const raw = await redis.get(metaKey(ticketId));
      return raw ? (JSON.parse(raw) as TicketMeta) : null;
    },
    async addOffer(ticketId: string, userId: string, ref: MsgRef): Promise<void> {
      await redis
        .multi()
        .rpush(offersKey(ticketId), JSON.stringify({ userId, ref }))
        .expire(offersKey(ticketId), OFFER_TTL_SECONDS)
        .exec();
    },
    async offers(ticketId: string) {
      const rows = await redis.lrange(offersKey(ticketId), 0, -1);
      return rows.map((r) => JSON.parse(r) as { userId: string; ref: MsgRef });
    },
  };
}
