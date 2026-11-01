import { en } from './en.js';
import { ru, type MessageKey } from './ru.js';

export type Locale = 'ru' | 'en';
export type { MessageKey };

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { ru, en };

export function isLocale(value: string): value is Locale {
  return value === 'ru' || value === 'en';
}

export function resolveLocale(discordLocale?: string): Locale {
  const language = discordLocale?.toLowerCase().split(/[-_]/)[0];
  return language === 'ru' ? 'ru' : 'en';
}

export function createTranslator(
  locale: Locale,
): (key: MessageKey, params?: Record<string, string | number>) => string {
  const catalog = CATALOGS[locale];
  return (key, params) =>
    catalog[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name];
      return value === undefined ? placeholder : String(value);
    });
}
