import type { CreateTicketResponse } from '@crystalaid/contracts';

/** Where a sent message lives, enough to edit it later. */
export interface MsgRef {
  channelId: string;
  messageId: string;
}

export interface Button {
  /** Discord custom id; carries only a ticket id and an index or a number, never an item key. */
  id: string;
  label: string;
}

/** A DM, independent of discord.js. The adapter renders it (Components V2). */
export interface OutMessage {
  text: string;
  /** Item keys in the shown order; attached as `1.png` to `N.png`. */
  images?: string[];
  buttons?: Button[];
}

export interface LogMessage {
  text: string;
  file?: { name: string; content: string };
  embed?: { title: string; fields: { name: string; value: string }[] };
}

export interface DiscordPort {
  /** Throws a Discord error; code 50007 means the person's DMs are closed. */
  sendDm(userId: string, msg: OutMessage): Promise<MsgRef>;
  edit(ref: MsgRef, msg: OutMessage): Promise<void>;
  sendLog(msg: LogMessage): Promise<void>;
}

export interface TicketMeta {
  description: string;
}

/** Short-lived memory of the bot (Redis, 24 hours). */
export interface OfferStore {
  remember(ticketId: string, meta: TicketMeta): Promise<void>;
  meta(ticketId: string): Promise<TicketMeta | null>;
  addOffer(ticketId: string, userId: string, ref: MsgRef): Promise<void>;
  offers(ticketId: string): Promise<{ userId: string; ref: MsgRef }[]>;
}

export type Offered = CreateTicketResponse['challenges'];

/** The part of an interaction a handler needs. */
export interface Replier {
  /** Ephemeral answer to the person who interacted. */
  reply(text: string): Promise<void>;
}
export interface ButtonCtx {
  userId: string;
  /** Replaces the message the button is on. */
  update(msg: OutMessage): Promise<void>;
  /** Ephemeral note, the message stays as it is. */
  notify(text: string): Promise<void>;
}
