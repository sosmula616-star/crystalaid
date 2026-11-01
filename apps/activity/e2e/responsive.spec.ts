import { expect, test, type Page } from '@playwright/test';
import {
  LEVELS,
  LONG_NAME,
  SIZES,
  expectInsideWindow,
  expectNoHorizontalScroll,
  openApp,
  trackConsole,
  waitForSection,
} from './helpers.js';

const NAV = 'Основная навигация';

/** Presses a section button through whatever navigation the width shows. */
async function goTo(page: Page, width: number, label: string) {
  if (width < 720) {
    // The bar holds the first four sections; anything else is behind "Ещё".
    const inBar = page.getByRole('navigation', { name: NAV }).getByRole('button', { name: label, exact: true });
    if ((await inBar.count()) > 0) {
      await inBar.click();
    } else {
      await page.getByRole('button', { name: 'Ещё' }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: label, exact: true }).click();
    }
  } else {
    await page.getByRole('navigation', { name: NAV }).getByRole('button', { name: label, exact: true }).click();
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
  await waitForSection(page);
}

async function checkSize(page: Page, level: (typeof LEVELS)[number], width: number, height: number, name?: 'long') {
  const errors = trackConsole(page);
  await page.setViewportSize({ width, height });
  await openApp(page, `level=${level}${name ? `&name=${name}` : ''}`);

  await expectNoHorizontalScroll(page);
  await expectInsideWindow(page, 'header');
  await expectInsideWindow(page, 'nav');
  await expect(page.getByRole('navigation', { name: NAV })).toBeVisible();
  // Under 480 px the name is hidden on purpose; the level badge stays.
  if (name && width >= 480) await expect(page.locator('header').getByText(LONG_NAME)).toBeVisible();

  // The navigation is usable down to the last section the level has.
  await goTo(page, width, level === 'ADMIN' ? 'Журнал' : 'Настройки');
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
}

for (const level of LEVELS) {
  for (const [width, height] of SIZES) {
    test(`${level} ${width}x${height}: no sideways scroll, navigation works`, async ({ page }) => {
      await checkSize(page, level, width, height);
    });
  }
}

// Review focus 3: a 40-character name breaks no size.
for (const [width, height] of SIZES) {
  test(`ADMIN with a long name ${width}x${height}`, async ({ page }) => {
    await checkSize(page, 'ADMIN', width, height, 'long');
  });
}

// 200% text: the root font size doubles.
for (const [width, height] of [
  [390, 844],
  [1280, 720],
] as const) {
  test(`200% text at ${width}x${height}: main actions stay reachable`, async ({ page }) => {
    const errors = trackConsole(page);
    await page.setViewportSize({ width, height });
    await openApp(page, 'level=ADMIN&name=long');
    const fontSizes = () =>
      page.evaluate(() => {
        const px = (el: Element | null) => parseFloat(getComputedStyle(el!).fontSize);
        return {
          body: px(document.body),
          h1: px(document.querySelector('h1')),
          greeting: px(document.querySelector('main h2')),
        };
      });
    const before = await fontSizes();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    // The test is only meaningful when the text really doubled (type tokens are rem).
    const after = await fontSizes();
    expect(after.body / before.body).toBeCloseTo(2, 2);
    expect(after.h1 / before.h1).toBeGreaterThan(1.7);
    // The fluid heading token has a vw part that does not scale, so it grows a little less than 2x.
    expect(after.greeting / before.greeting).toBeGreaterThan(1.5);

    // Overview at 200%.
    await expectNoHorizontalScroll(page);
    await expectInsideWindow(page, 'header');
    await expectInsideWindow(page, 'nav');
    await expect(page.locator('main h2').first()).toBeVisible();
    await goTo(page, width, 'Журнал');
    await expectNoHorizontalScroll(page);

    // Settings at 200% with the language select open.
    await goTo(page, width, 'Настройки');
    await expectNoHorizontalScroll(page);
    const select = page.getByRole('combobox').first();
    await select.scrollIntoViewIfNeeded();
    await select.click();
    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();
    await expectInsideWindow(page, '[role="listbox"]');
    for (const option of await page.getByRole('option').all()) {
      const box = (await option.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    await expectNoHorizontalScroll(page);
    await page.getByRole('option', { name: 'English' }).click();
    await expect(select).toHaveText('English');
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

// 200% page zoom: the window is half as wide and half as tall in CSS pixels.
for (const [width, height] of [
  [1280, 720],
  [390, 844],
] as const) {
  test(`200% page zoom (${width / 2}x${height / 2} CSS px)`, async ({ page }) => {
    const errors = trackConsole(page);
    await page.setViewportSize({ width: width / 2, height: height / 2 });
    await openApp(page, 'level=ADMIN&name=long', { compact: width / 2 < 320 });
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Обзор');
    // Below 320 px the shell is compact: the title only, readable and without sideways scroll.
    if (width / 2 >= 320) await goTo(page, width / 2, 'Журнал');
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

// Review focus 5.
test('resizing 1280 -> 390 -> 1280 keeps the current section', async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, 'level=ADMIN');
  await goTo(page, 1280, 'Настройки');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Ещё' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки');
  await waitForSection(page);
  await expectNoHorizontalScroll(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('button', { name: 'Ещё' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки');
  await waitForSection(page);
  await expect(
    page.getByRole('navigation', { name: NAV }).getByRole('button', { name: 'Настройки', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
});

test('Discord picture-in-picture event turns the compact view on and off', async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, 'level=ADMIN');
  const layout = (mode: number) =>
    page.evaluate((m) => (window as unknown as { __crystalaidLayout: (n: number) => void }).__crystalaidLayout(m), mode);
  const nav = page.getByRole('navigation', { name: NAV });
  await expect(nav).toBeVisible();

  await layout(1);
  await expect(nav).toHaveCount(0);
  await expect(page.locator('header')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Обзор');
  await expectNoHorizontalScroll(page);

  await layout(0);
  await expect(nav).toBeVisible();
  await expect(page.locator('header')).toBeVisible();
  await waitForSection(page);
  expect(errors).toEqual([]);
});

test('PIP at start via ?pip=1 shows the compact view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, 'level=SUPPORT&pip=1', { compact: true });
  await expect(page.getByRole('navigation', { name: NAV })).toHaveCount(0);
});

test('a failed section chunk can be retried', async ({ page }) => {
  const errors = trackConsole(page, [/Failed to load resource/, /Failed to fetch dynamically imported module/, /net::ERR/]);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, 'level=SUPPORT');
  let failures = 0;
  let blocked = true;
  await page.route(/\/src\/sections\/Settings\.tsx/, (route) => {
    if (blocked) {
      failures += 1;
      return route.abort('failed');
    }
    return route.continue();
  });
  await page.getByRole('navigation', { name: NAV }).getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByText('Не удалось показать раздел')).toBeVisible();
  expect(failures).toBeGreaterThan(0);
  // The rest of the panel still works.
  await expect(page.getByRole('navigation', { name: NAV })).toBeVisible();

  blocked = false;
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByText('Не удалось показать раздел')).toHaveCount(0);
  await waitForSection(page);
  await expect(page.getByRole('combobox').first()).toBeVisible();
  expect(errors).toEqual([]);
});

// Final review: the section title is not squeezed by a long name.
for (const width of [320, 360, 390]) {
  test(`long name at ${width}: the section title keeps at least 120 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, 'level=ADMIN&name=long');
    const h1 = page.getByRole('heading', { level: 1 });
    expect((await h1.boundingBox())!.width).toBeGreaterThanOrEqual(120);

    // The longest title is readable: wrapped in full, and also in the title attribute.
    await goTo(page, width, 'Управление магазином');
    const box = (await h1.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(120);
    const clipped = await h1.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    expect(clipped, 'the title is cut off').toBe(false);
    await expect(h1).toHaveAttribute('title', 'Управление магазином');
    await expectNoHorizontalScroll(page);
  });
}

test('at 1440 with a short name the level badge sits at the right edge of the bar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, 'level=SUPPORT');
  const bar = (await page.locator('header').boundingBox())!;
  const badge = (await page.locator('header').getByText('Саппорт', { exact: true }).boundingBox())!;
  expect(bar.x + bar.width - (badge.x + badge.width)).toBeLessThanOrEqual(24);
  expect((await page.getByRole('heading', { level: 1 }).boundingBox())!.width).toBeGreaterThanOrEqual(120);
});

test('the name is hidden under 480 px and shown above, the level badge stays', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openApp(page, 'level=ADMIN&name=long');
  const header = page.locator('header');
  await expect(header.getByText(LONG_NAME)).toBeHidden();
  await expect(header.getByText('Админ', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(header.getByText(LONG_NAME)).toBeVisible();
});
