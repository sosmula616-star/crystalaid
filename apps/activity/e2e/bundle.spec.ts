import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

/** Strings that exist only in dev code: the showcase, the dev mock and the dev switch. */
const DEV_MARKERS = [
  '/kit',
  'createMock',
  '__crystalaidLayout',
  'mock-session-token',
  'mock-instance',
  'VITE_DEV_MOCK',
  'Витрина CrystalAid',
];

const markersIn = (text: string) => DEV_MARKERS.filter((marker) => text.includes(marker));

test('the marker scan finds a dev marker (positive control)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crystalaid-control-'));
  try {
    const sample = join(dir, 'sample.js');
    writeFileSync(sample, 'const t = "mock-session-token";');
    expect(markersIn(readFileSync(sample, 'utf8'))).toEqual(['mock-session-token']);
    expect(markersIn('const clean = 1;')).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the build fails with a clear message when VITE_DISCORD_CLIENT_ID is empty', async () => {
  test.setTimeout(60_000);
  const out = mkdtempSync(join(tmpdir(), 'crystalaid-empty-'));
  const previous = process.env.VITE_DISCORD_CLIENT_ID;
  process.env.VITE_DISCORD_CLIENT_ID = '';
  try {
    const { build } = await import('vite');
    await expect(
      build({ root: appDir, mode: 'production', logLevel: 'silent', build: { outDir: out, emptyOutDir: true } }),
    ).rejects.toThrow(/VITE_DISCORD_CLIENT_ID is empty/);
  } finally {
    if (previous === undefined) delete process.env.VITE_DISCORD_CLIENT_ID;
    else process.env.VITE_DISCORD_CLIENT_ID = previous;
    rmSync(out, { recursive: true, force: true });
  }
});

test('production build holds no kit, no dev mock, no outside addresses', async () => {
  test.setTimeout(120_000);
  const out = mkdtempSync(join(tmpdir(), 'crystalaid-dist-'));
  const previousEnv = process.env.NODE_ENV;
  const previousClientId = process.env.VITE_DISCORD_CLIENT_ID;
  process.env.NODE_ENV = 'production';
  // The build refuses an empty id; the bundle check needs any value.
  process.env.VITE_DISCORD_CLIENT_ID = 'dummy-client-id';
  try {
    const { build } = await import('vite');
    await build({ root: appDir, mode: 'production', logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });

    const textFiles = [...files(out)].filter((f) => /\.(js|css|html|map|json|svg)$/.test(f));
    expect(textFiles.length).toBeGreaterThan(0);
    const foreign: string[] = [];
    for (const file of textFiles) {
      const text = readFileSync(file, 'utf8');
      const name = file.slice(out.length + 1);
      // import.meta.env.DEV was false: the dev-only code is gone, and no marker of it is left.
      expect(markersIn(text), `${name} holds dev-only markers`).toEqual([]);
      expect(text, `${name} keeps a DEV check`).not.toContain('import.meta.env');
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
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (previousClientId === undefined) delete process.env.VITE_DISCORD_CLIENT_ID;
    else process.env.VITE_DISCORD_CLIENT_ID = previousClientId;
    rmSync(out, { recursive: true, force: true });
  }
});
