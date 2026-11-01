import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const appDir = fileURLToPath(new URL('..', import.meta.url));

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

/** Discord's own domains (the SDK talks to them), and names that are identifiers, never fetched. */
const ALLOWED_HOST = [
  /(^|\.)discord(app)?\.(com|co)$/, // Discord SDK
  /^www\.w3\.org$/, // XML namespace strings in React and SVG
  /^json-schema\.org$/, // $schema strings in zod
  /^react\.dev$/, // text of React error messages
  /^github\.com$/, // a comment string in uuid
  /^localhost$/, // the SDK's local proxy default
  /^\[/, // IPv6 pattern text
];

test('production build holds no kit, no dev mock, no outside addresses', async () => {
  test.setTimeout(120_000);
  const out = mkdtempSync(join(tmpdir(), 'crystalaid-dist-'));
  try {
    const { build } = await import('vite');
    await build({ root: appDir, logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });

    const textFiles = [...files(out)].filter((f) => /\.(js|css|html|map|json|svg)$/.test(f));
    expect(textFiles.length).toBeGreaterThan(0);
    const foreign: string[] = [];
    for (const file of textFiles) {
      const text = readFileSync(file, 'utf8');
      const name = file.slice(out.length + 1);
      for (const marker of [
        '/kit',
        'createMock',
        '__crystalaidLayout',
        'mock-session-token',
        'mock-instance',
        'VITE_DEV_MOCK',
        'Витрина CrystalAid',
      ]) {
        expect(text.includes(marker), `${name} contains "${marker}"`).toBe(false);
      }
      for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.[\]-]+)/g)) {
        const host = match[1]!;
        if (!ALLOWED_HOST.some((pattern) => pattern.test(host))) foreign.push(`${name}: ${match[0]}`);
      }
      // Nothing loads from outside: no remote src, href, @import or url().
      expect(text, `${name} loads a remote resource`).not.toMatch(
        /(?:src|href)=["']https?:|@import\s+(?:url\()?["']?https?:|url\(\s*["']?https?:/,
      );
    }
    expect(foreign).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
