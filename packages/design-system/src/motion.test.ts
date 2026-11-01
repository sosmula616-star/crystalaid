import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('./components', import.meta.url));
const cssFiles = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.css'))
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

describe('motion', () => {
  it('finds component stylesheets', () => {
    expect(cssFiles.length).toBeGreaterThan(5);
  });

  it('component animations and transitions use duration tokens, not literals', () => {
    for (const [file, css] of cssFiles) {
      for (const m of css.matchAll(/^\s*(animation|transition)\s*:([^;]*);/gm)) {
        expect(m[2], `${file} ${m[1]}`).not.toMatch(/\d(ms|s)\b/);
      }
    }
  });

  it('tokens.css zeroes every motion token and drops animations under reduced motion', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    const names = [...css.matchAll(/^\s*(--motion-[\w-]+):/gm)].map((m) => m[1]!);
    expect(names).toEqual(expect.arrayContaining(['--motion-spin', '--motion-shimmer']));
    const block = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
    for (const name of new Set(names)) expect(block, name).toContain(`${name}: 0ms`);
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });
});
