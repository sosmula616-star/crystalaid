import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEM_KEYS } from '@crystalaid/domain';
import { renderOut } from './discord.js';
import { ITEM_RU, claimId } from './text.js';

describe('renderOut', () => {
  it('attaches the options as neutral names 1.png to 4.png and keeps item keys out of the payload', () => {
    const r = renderOut({
      text: 'Новый тикет #1. Выберите: меч',
      images: ['sword', 'gem', 'key', 'bow'],
      buttons: [0, 1, 2, 3].map((i) => ({ id: claimId('11111111-2222-4333-8444-555555555555', i), label: String(i + 1) })),
    });
    expect(r.files.map((f) => f.name)).toEqual(['1.png', '2.png', '3.png', '4.png']);
    const json = JSON.stringify(r.components.map((c) => c.toJSON()));
    expect(json).toContain('attachment://1.png');
    expect(json).toContain('attachment://4.png');
    expect(json).not.toMatch(/sword|gem|"key"|bow/);
    expect(r.flags).toBe(1 << 15);
  });
});

describe('assets', () => {
  it('has a picture and a Russian name for every item key', () => {
    for (const key of ITEM_KEYS) {
      expect(existsSync(fileURLToPath(new URL(`../assets/captcha/${key}.png`, import.meta.url))), key).toBe(true);
      expect(ITEM_RU[key]).toBeTruthy();
    }
  });
});
