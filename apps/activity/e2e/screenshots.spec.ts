import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';

// Screenshots for a human look (git-ignored). They assert nothing.
const dir = fileURLToPath(new URL('./screenshots', import.meta.url));
mkdirSync(dir, { recursive: true });

const SIZES = [
  [390, 844],
  [1440, 900],
  [3440, 1440],
] as const;

const SCREENS = [
  { name: 'overview', path: '/?level=ADMIN&name=long', full: false },
  { name: 'kit', path: '/kit', full: true },
  { name: 'not-staff', path: '/?error=NOT_STAFF', full: false },
] as const;

for (const [width, height] of SIZES) {
  for (const screen of SCREENS) {
    test(`shot ${screen.name} ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(screen.path);
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/${screen.name}-${width}x${height}.png`, fullPage: screen.full });
    });
  }
}
