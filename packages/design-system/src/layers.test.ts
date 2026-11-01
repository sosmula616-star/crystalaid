import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith('.module.css') ? [path] : [];
  });
}

const here = fileURLToPath(new URL('.', import.meta.url));
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');
const layer = (name: string) => Number(new RegExp(`--layer-${name}: *([0-9]+)`).exec(tokens)?.[1]);

describe('z-index layers', () => {
  it('orders overlay < dialog < popper < toast', () => {
    expect(layer('overlay')).toBeLessThan(layer('dialog'));
    expect(layer('dialog')).toBeLessThan(layer('popper'));
    expect(layer('popper')).toBeLessThan(layer('toast'));
  });

  it('component CSS uses only layer tokens for z-index', () => {
    const files = cssFiles(join(here, 'components'));
    expect(files.length).toBeGreaterThan(0);
    const used: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/z-index:\s*([^;]+);/g)) {
        used.push(match[1]!.trim());
      }
    }
    expect(used.length).toBeGreaterThan(0);
    for (const value of used) {
      expect(value).toMatch(/^var\(--layer-(overlay|dialog|popper|toast)\)$/);
    }
  });
});
