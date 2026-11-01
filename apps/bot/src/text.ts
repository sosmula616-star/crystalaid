import type { ItemKey } from '@crystalaid/domain';

/** What the support reads in "Выберите: ...". The picture of the target is never named in the files. */
export const ITEM_RU: Record<ItemKey, string> = {
  sword: 'меч',
  shield: 'щит',
  key: 'ключ',
  gem: 'самоцвет',
  potion: 'зелье',
  crown: 'корону',
  bow: 'лук',
  ring: 'кольцо',
};

export const MODAL_ID = 'help-modal';
export const MODAL_INPUT_ID = 'question';
export const MODAL_TITLE = 'Что хотите спросить?';

export const shortId = (ticketId: string): string => ticketId.slice(0, 8);

export const claimId = (ticketId: string, index: number): string => `claim:${ticketId}:${index}`;
export const closeId = (ticketId: string): string => `close:${ticketId}`;
export const rateId = (ticketId: string, n: number): string => `rate:${ticketId}:${n}`;
export const cancelId = (ticketId: string): string => `cancel:${ticketId}`;

export type ParsedButton =
  | { kind: 'claim'; ticketId: string; index: number }
  | { kind: 'close'; ticketId: string }
  | { kind: 'cancel'; ticketId: string }
  | { kind: 'rate'; ticketId: string; rating: number };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function parseButton(customId: string): ParsedButton | null {
  const claim = new RegExp(`^claim:(${UUID}):([0-3])$`).exec(customId);
  if (claim) return { kind: 'claim', ticketId: claim[1]!, index: Number(claim[2]) };
  const close = new RegExp(`^close:(${UUID})$`).exec(customId);
  if (close) return { kind: 'close', ticketId: close[1]! };
  const cancel = new RegExp(`^cancel:(${UUID})$`).exec(customId);
  if (cancel) return { kind: 'cancel', ticketId: cancel[1]! };
  const rate = new RegExp(`^rate:(${UUID}):([1-5])$`).exec(customId);
  if (rate) return { kind: 'rate', ticketId: rate[1]!, rating: Number(rate[2]) };
  return null;
}
