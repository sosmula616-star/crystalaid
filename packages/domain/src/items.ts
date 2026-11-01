/** Pictures of the anti-bot check a support picks from before taking a ticket. */
export const ITEM_KEYS = ['sword', 'shield', 'key', 'gem', 'potion', 'crown', 'bow', 'ring'] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];
