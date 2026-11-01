import { expect, test } from '@playwright/test';
import { axeViolations, openApp } from './helpers.js';

const SIZES = [
  [390, 844],
  [1440, 900],
] as const;

for (const [width, height] of SIZES) {
  test.describe(`axe at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('Overview', async ({ page }) => {
      await openApp(page, 'level=ADMIN');
      // The top bar hides the name on narrow screens; the greeting always shows it.
      await expect(page.locator('main').getByText('Ilya Brandt').first()).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });

    test('Settings', async ({ page }) => {
      await openApp(page, 'level=ADMIN');
      if (width < 720) {
        await page.getByRole('button', { name: 'Ещё' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Настройки', exact: true }).click();
      } else {
        await page
          .getByRole('navigation', { name: 'Основная навигация' })
          .getByRole('button', { name: 'Настройки', exact: true })
          .click();
      }
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки');
      await expect(page.getByRole('combobox').first()).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });

    test('NOT_STAFF screen', async ({ page }) => {
      await page.goto('/?error=NOT_STAFF');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  });
}

test.describe('sign-in screens at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const code of ['NOT_STAFF', 'GUILD_REQUIRED', 'INVALID_INSTANCE', 'DISCORD_UNAVAILABLE']) {
    test(`${code} does not scroll`, async ({ page }) => {
      await page.goto(`/?error=${code}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const sizes = await page.evaluate(() => ({
        scroll: document.documentElement.scrollHeight,
        client: document.documentElement.clientHeight,
      }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
    });
  }
});

test('a Russian curator without the support role reads Russian, not the server text', async ({ page }) => {
  await page.goto('/?error=NOT_STAFF&reason=support_role_missing');
  await expect(page.getByText(/нужна роль саппорта/)).toBeVisible();
  await expect(page.getByText('No access to the staff panel')).toHaveCount(0);
});

test('StatCard values keep tabular numerals', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, 'level=ADMIN');
  const values = await page.evaluate(() =>
    [...document.querySelectorAll('main h2 ~ div > div > div:nth-child(2)')].map((el) => getComputedStyle(el).fontVariantNumeric),
  );
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) expect(value).toBe('tabular-nums');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontVariantNumeric)).toBe('tabular-nums');
});
