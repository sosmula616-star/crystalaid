import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, openApp, trackConsole } from './helpers.js';

// The Avatar example loads /missing.png on purpose.
const KIT_IGNORE = [/Failed to load resource/];

async function openKit(page: Page, size: { width: number; height: number } = { width: 1280, height: 900 }) {
  const errors = trackConsole(page, KIT_IGNORE);
  await page.setViewportSize(size);
  await page.goto('/kit');
  await expect(page.getByRole('heading', { level: 1, name: 'Витрина CrystalAid' })).toBeVisible();
  return errors;
}

/** The element under the middle of `target` is `target` itself, or lies inside `container`. */
async function expectOnTop(target: Locator, container: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, 'target has a box').not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const handle = await container.elementHandle();
  const hit = await target.page().evaluate(
    ([px, py, root]) => {
      const el = document.elementFromPoint(px as number, py as number);
      return !!el && (root as Element).contains(el);
    },
    [x, y, handle] as const,
  );
  expect(hit, 'the overlay is the topmost element at its own centre').toBe(true);
}

test('a Select inside a Modal lists its options on top', async ({ page }) => {
  const errors = await openKit(page);
  await page.getByRole('button', { name: 'Окно', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Окно' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Язык в окне' }).click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  await expectOnTop(page.getByRole('option', { name: 'English' }), list);
  await page.getByRole('option', { name: 'English' }).click();
  await expect(dialog.getByRole('combobox', { name: 'Язык в окне' })).toHaveText('English');
  await expect(dialog).toBeVisible();
  expect(errors).toEqual([]);
});

test('a Dropdown and a Tooltip inside a Drawer sit on top', async ({ page }) => {
  const errors = await openKit(page);
  await page.getByRole('button', { name: 'Панель', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Панель' });
  await expect(drawer).toBeVisible();

  await drawer.getByRole('button', { name: 'Меню в панели' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expectOnTop(page.getByRole('menuitem', { name: 'Второй пункт' }), menu);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(drawer).toBeVisible();

  await drawer.getByRole('button', { name: 'Справка в панели' }).hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  const tipBox = (await tip.boundingBox())!;
  const topmost = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number);
      return el?.closest('[role="tooltip"], [data-radix-popper-content-wrapper]') !== null;
    },
    [tipBox.x + tipBox.width / 2, tipBox.y + tipBox.height / 2] as const,
  );
  expect(topmost, 'the tooltip is the topmost element at its centre').toBe(true);
  expect(errors).toEqual([]);
});

test('a Toast shows above a Modal and its close button works', async ({ page }) => {
  const errors = await openKit(page);
  await page.getByRole('button', { name: 'Окно', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Окно' });
  await dialog.getByRole('button', { name: 'Показать уведомление' }).click();

  const toast = page.locator('li[data-state="open"]').filter({ hasText: 'Готово' });
  await expect(toast).toBeVisible();
  // Radix hides the page behind a modal from assistive technology, so the role lookup cannot see the toast.
  const close = toast.locator('button[aria-label="Закрыть"]');
  await expectOnTop(close, close);
  await close.click();
  await expect(page.locator('li').filter({ hasText: 'Готово' })).toHaveCount(0);
  // Closing the toast leaves the dialog where it was.
  await expect(dialog).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('Table in card mode at 390 px', () => {
  test('toggle, row header, no overflow, roles', async ({ page }) => {
    const errors = await openKit(page, { width: 390, height: 844 });
    const table = page.getByRole('table', { name: 'Длинные значения' });
    await table.scrollIntoViewIfNeeded();

    const header = table.getByRole('rowheader', { name: 'Konstantina-Aleksandrovna-Wilhelmina-Ros' });
    await expect(header).toBeVisible();
    await expect(table.getByRole('cell', { name: '1000000000' })).toBeHidden();

    const toggle = table.getByRole('button', { name: /Подробнее/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(table.getByRole('cell', { name: 'x'.repeat(40) })).toBeVisible();
    await expect(table.getByRole('cell', { name: '1000000000' })).toBeVisible();

    await expectNoHorizontalScroll(page);
    const inside = await table.evaluate((el) => {
      const root = el.closest('[role="region"]')!.getBoundingClientRect();
      return [...el.querySelectorAll('th, td')].every((cell) => {
        const r = cell.getBoundingClientRect();
        return r.width === 0 || (r.left >= root.left - 0.5 && r.right <= root.right + 0.5);
      });
    });
    expect(inside, 'every cell is inside the table region').toBe(true);

    // Roles and the caption name survive the card layout.
    const snapshot = await page.getByRole('region', { name: 'Длинные значения' }).ariaSnapshot();
    expect(snapshot).toContain('table "Длинные значения"');
    expect(snapshot).toContain('row');
    expect(snapshot).toContain('rowheader "Konstantina-Aleksandrovna-Wilhelmina-Ros"');
    expect(snapshot).toContain('cell "' + 'x'.repeat(40) + '"');
    expect(snapshot).toContain('cell "1000000000"');
    expect(snapshot).toContain('columnheader');
    expect(errors).toEqual([]);
  });

  test('the wide layout is a plain table without the toggle', async ({ page }) => {
    await openKit(page, { width: 1280, height: 900 });
    const table = page.getByRole('table', { name: 'Длинные значения' });
    await expect(table.getByRole('cell', { name: '1000000000' })).toBeVisible();
    await expect(table.getByRole('button', { name: /Подробнее/ })).toBeHidden();
  });
});

test('picking a section in the More drawer closes it and focuses the heading', async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, 'level=ADMIN');
  await page.getByRole('button', { name: 'Ещё' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  // The drawer covers the bottom bar.
  await expectOnTop(drawer.getByRole('button', { name: 'Журнал', exact: true }), drawer);
  await drawer.getByRole('button', { name: 'Журнал', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Журнал');
  await expect(heading).toBeFocused();
  expect(errors).toEqual([]);
});

test('opening a Drawer moves focus inside it and closing returns focus', async ({ page }) => {
  await openKit(page);
  const opener = page.getByRole('button', { name: 'Панель', exact: true });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Панель' });
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeFocused();
});

test.describe('prefers-reduced-motion', () => {
  const running = (page: Page) =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration ?? 0) > 1)
        .map((a) => (a as CSSAnimation).animationName ?? a.constructor.name),
    );

  test('without the preference the loading button spins', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openKit(page);
    expect((await running(page)).length).toBeGreaterThan(0);
  });

  test('animations stop and the Button still shows loading', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openKit(page);
    expect(await running(page)).toEqual([]);

    const button = page.getByRole('button', { name: 'Загрузка' });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    const spinner = await button.evaluate((el) => {
      const s = el.querySelector('span[aria-hidden="true"]')!;
      const r = s.getBoundingClientRect();
      const style = getComputedStyle(s);
      return { w: r.width, h: r.height, border: style.borderTopWidth, color: style.borderTopColor, animation: style.animationName };
    });
    // A still ring remains: loading is shown without motion.
    expect(spinner.w).toBeGreaterThan(8);
    expect(spinner.h).toBeGreaterThan(8);
    expect(spinner.border).toBe('2px');
    expect(spinner.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(spinner.animation).toBe('none');
  });
});
