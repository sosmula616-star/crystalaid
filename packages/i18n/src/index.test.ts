import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { createTranslator, resolveLocale } from './index.js';
import { ru, type MessageKey } from './ru.js';

describe('createTranslator', () => {
  it('translates into both locales', () => {
    expect(createTranslator('ru')('nav.overview')).toBe('Обзор');
    expect(createTranslator('en')('nav.overview')).toBe('Overview');
  });

  it('keeps ru and en keys identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('has no empty messages', () => {
    for (const catalog of [ru, en]) {
      for (const value of Object.values(catalog)) expect(value.trim()).not.toBe('');
    }
  });

  it('rejects mismatched catalogs at type level', () => {
    // @ts-expect-error a missing key must not compile
    const missing: Record<MessageKey, string> = { 'nav.overview': 'x' };
    const extra: Record<MessageKey, string> = {
      ...en,
      // @ts-expect-error an unknown key must not compile
      'nav.unknown': 'x',
    };
    expect(missing).toBeDefined();
    expect(extra).toBeDefined();
  });
});

describe('interpolation', () => {
  it('fills placeholders and keeps unknown ones visible', () => {
    // Exercise the engine through a catalog entry patched in for the test.
    const t = createTranslator('en') as (key: string, p?: Record<string, string | number>) => string;
    const original = en['nav.shift'];
    en['nav.shift'] = 'Hi {name}, {count} left, {missing}';
    try {
      expect(t('nav.shift', { name: 'Ann', count: 3 })).toBe('Hi Ann, 3 left, {missing}');
    } finally {
      en['nav.shift'] = original;
    }
  });
});

describe('resolveLocale', () => {
  it('maps Discord locales', () => {
    expect(resolveLocale('ru')).toBe('ru');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('de')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });
});
