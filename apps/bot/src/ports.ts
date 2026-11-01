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
  /** Re-uploads a file to the log channel and returns the URL of the log message that holds it. */
  archiveFile(file: { url: string; name: string }, caption: string): Promise<string>;
}

/** A file attached to a DM. */
export interface Attachment {
  url: string;
  name: string;
  size: number;
}

/** Short-lived memory of the bot (Redis, 24 hours): where the offer messages of a ticket are. */
export interface OfferStore {
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
  /** Discord username, for the log (the log server may not know the person). */
  username?: string;
  /** Replaces the message the button is on. */
  update(msg: OutMessage): Promise<void>;
  /** Ephemeral note, the message stays as it is. */
  notify(text: string): Promise<void>;
}

// ---------- /menu and /dev, independent of discord.js (the adapter renders them) ----------

export interface MenuButton {
  id: string;
  label: string;
  style?: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
}
export interface MenuOption {
  label: string;
  value: string;
  default?: boolean;
}
/** One action row of a menu message. */
export type MenuRow =
  | { kind: 'buttons'; buttons: MenuButton[] }
  | { kind: 'user'; id: string; placeholder: string }
  | { kind: 'select'; id: string; placeholder: string; min: number; max: number; options: MenuOption[] };

/** Plain message content (Discord allows 2000 characters) and at most 5 rows. */
export interface MenuView {
  text: string;
  rows: MenuRow[];
}
export interface ModalSpec {
  id: string;
  title: string;
  inputs: { id: string; label: string; value?: string; required: boolean; maxLength: number }[];
}
export type MenuResult = { view: MenuView } | { modal: ModalSpec } | { note: string };
