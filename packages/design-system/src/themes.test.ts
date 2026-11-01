import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { THEMES, applyTheme, type ThemeTokens } from './themes.js';

function channel(hex: string, from: number): number {
  const v = parseInt(hex.slice(from, from + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['foreground', 'muted', 'primary', 'success', 'warning', 'danger'] as const;
const SURFACES = ['background', 'surface', 'surface-elevated', 'surface-hover'] as const;

describe('THEMES', () => {
  it('lists the six themes, only crystal free', () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      'crystal', 'indigo', 'amber', 'emerald', 'graphite', 'raspberry',
    ]);
    expect(THEMES.filter((t) => t.free).map((t) => t.id)).toEqual(['crystal']);
    for (const t of THEMES) expect(t.nameKey).toBe(`theme.${t.id}`);
  });

  it('shares status colors across themes', () => {
    for (const t of THEMES) {
      expect(t.tokens.success).toBe('#5BD6A0');
      expect(t.tokens.warning).toBe('#F5C451');
      expect(t.tokens.danger).toBe('#F47174');
    }
  });

  for (const theme of THEMES) {
    describe(theme.id, () => {
      for (const text of TEXT) {
        for (const surface of SURFACES) {
          // surface-hover is held to foreground and muted only: it hosts row text, not status chips.
          if (surface === 'surface-hover' && text !== 'foreground' && text !== 'muted') continue;
          it(`${text} on ${surface} is at least 4.5:1`, () => {
            expect(contrast(theme.tokens[text], theme.tokens[surface])).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
      it('on-primary on primary is at least 4.5:1', () => {
        expect(contrast(theme.tokens['on-primary'], theme.tokens.primary)).toBeGreaterThanOrEqual(4.5);
      });
      it('surface-hover is one step lighter than surface-elevated', () => {
        expect(luminance(theme.tokens['surface-hover'])).toBeGreaterThan(
          luminance(theme.tokens['surface-elevated']),
        );
      });
    });
  }

  it('keeps themes.css in sync with themes.ts', () => {
    const css = readFileSync(new URL('./themes.css', import.meta.url), 'utf8');
    for (const theme of THEMES) {
      const block = css.match(new RegExp(String.raw`\[data-theme='${theme.id}'\]\s*\{([^}]*)\}`))?.[1];
      expect(block, theme.id).toBeDefined();
      const found: Record<string, string> = {};
      for (const m of block!.matchAll(/--color-([\w-]+):\s*(#[0-9A-Fa-f]{6});/g)) found[m[1]!] = m[2]!.toUpperCase();
      const expected = Object.fromEntries(
        Object.entries(theme.tokens as ThemeTokens).map(([k, v]) => [k, v.toUpperCase()]),
      );
      expect(found, theme.id).toEqual(expected);
    }
  });
});

describe('themes.css fallback', () => {
  it('applies the crystal values to :root as well', () => {
    const css = readFileSync(new URL('./themes.css', import.meta.url), 'utf8');
    expect(css).toMatch(/:root,\s*\[data-theme='crystal'\]\s*\{/);
  });
});

describe('applyTheme', () => {
  const makeRoot = () => ({ dataset: {} as Record<string, string> });

  it('sets data-theme on the root', () => {
    const root = makeRoot();
    expect(applyTheme('indigo', root)).toBe('indigo');
    expect(root.dataset.theme).toBe('indigo');
  });

  it('replaces an unknown id with crystal', () => {
    const root = makeRoot();
    vi.stubGlobal('document', { documentElement: root });
    try {
      expect(applyTheme('nope')).toBe('crystal');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(applyTheme('nope', root)).toBe('crystal');
    expect(root.dataset.theme).toBe('crystal');
  });
});
