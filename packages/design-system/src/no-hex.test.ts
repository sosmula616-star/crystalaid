import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = new URL('../../../scripts/check-css-colors.mjs', import.meta.url);

function run(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'hexcheck-'));
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  }
  return spawnSync(process.execPath, [fileURLToPath(script), root], { encoding: 'utf8' });
}

describe('check-css-colors', () => {
  it('fails on a hex color in a CSS module', () => {
    const r = run({ 'apps/x/Button.module.css': '.a { color: #fff; }\n.b { background: #0B1220cc; }' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Button.module.css:1');
    expect(r.stderr).toContain('Button.module.css:2');
  });

  it('passes token-only CSS and ignores hex-like ids and comments-free selectors', () => {
    const r = run({ 'apps/x/Button.module.css': '#main { color: var(--color-primary); }' });
    expect(r.status).toBe(0);
  });

  it('allows hex colors in tokens.css and themes.css', () => {
    const r = run({
      'packages/design-system/src/tokens.css': ':root { --color-x: #FFFFFF; }',
      'packages/design-system/src/themes.css': ":root { --color-y: #000000; }",
    });
    expect(r.status).toBe(0);
  });
});
