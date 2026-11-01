import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, type Page } from '@playwright/test';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/** The 15 control sizes of spec section 6. */
export const SIZES: ReadonlyArray<readonly [number, number]> = [
  [320, 568],
  [360, 800],
  [375, 667],
  [390, 844],
  [412, 915],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [2560, 1440],
  [3440, 1440],
];

/** The spec's 40-character name. */
export const LONG_NAME = 'Konstantina Aleksandrovna Wilhelmina-Ros';
if (LONG_NAME.length !== 40) throw new Error('LONG_NAME must be 40 characters');

export const LEVELS =['SUPPORT', 'ADMIN'] as const;

/** Console errors and uncaught page errors, collected until the test ends. */
export function trackConsole(page: Page, ignore: RegExp[] = []): string[] {
  const errors: string[] = [];
  const keep = (text: string) => !ignore.some((pattern) => pattern.test(text));
  page.on('console', (message) => {
    if (message.type() === 'error' && keep(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (keep(error.message)) errors.push(error.message);
  });
  return errors;
}

/** The page must not scroll sideways, and no part of the chrome may stick out of the window. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({
    root: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    body: [document.body.scrollWidth, document.body.clientWidth],
  }));
  expect(sizes.root[0], 'documentElement scrollWidth').toBeLessThanOrEqual(sizes.root[1]!);
  expect(sizes.body[0], 'body scrollWidth').toBeLessThanOrEqual(sizes.body[1]!);
}

/** Every element inside `selector` lies inside the window horizontally. */
export async function expectInsideWindow(page: Page, selector: string): Promise<void> {
  const outside = await page.evaluate((sel) => {
    const found: string[] = [];
    for (const root of document.querySelectorAll(sel)) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.position === 'absolute') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < -0.5 || r.right > window.innerWidth + 0.5) {
          found.push(`${el.tagName}.${String(el.className)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
        }
      }
    }
    return found;
  }, selector);
  expect(outside, `outside the window in ${selector}`).toEqual([]);
}

/**
 * Waits until the section shows its real content: the loading indicator is gone and the
 * main area holds a heading, a field or text. A size check on a skeleton proves nothing.
 */
export async function waitForSection(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: 'Раздел загружается' })).toHaveCount(0);
  await expect(page.locator('main#main-content').locator('h2, [role="combobox"], p').first()).toBeVisible();
}

/** Opens the app and, unless the view is compact, waits for the first section's content. */
export async function openApp(page: Page, query: string, options: { compact?: boolean } = {}): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (!options.compact) await waitForSection(page);
}

/** Runs axe-core (injected from the installed package) on the page, contrast included. */
export async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; help: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe;
    const results = await axe.run(document, {});
    return results.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  });
}
