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
      await expect(page.getByText('Ilya Brandt').first()).toBeVisible();
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
