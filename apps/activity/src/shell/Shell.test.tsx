import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useEffect, useState, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@crystalaid/contracts';
import { createTranslator } from '@crystalaid/i18n';
import { ApiError } from '../api/client.js';
import { installFakeResizeObserver, removeFakeResizeObserver, resizeTo } from '../testing/fakeResizeObserver.js';
import { useShell } from './context.js';
import { Shell, type ShellProps } from './Shell.js';
import { SECTIONS, type Section } from './sections.js';

const t = createTranslator('ru');

const ME: MeResponse = {
  user: { id: 'u1', discordId: '123456789012345678', username: 'alice', avatar: null },
  level: 'ADMIN',
  position: null,
  status: 'active',
  tokenBalance: 5,
  permissions: [],
};

function setup(props: Partial<ShellProps> = {}, width = 400) {
  const user = userEvent.setup();
  const onRetryAuth = vi.fn();
  const reportAuthFailure = vi.fn();
  const view = render(
    <Shell me={ME} t={t} onRetryAuth={onRetryAuth} reportAuthFailure={reportAuthFailure} {...props} />,
  );
  resizeTo(width);
  return { user, onRetryAuth, reportAuthFailure, ...view };
}

const navigation = () => screen.getByRole('navigation', { name: 'Основная навигация' });

describe('Shell', () => {
  beforeEach(installFakeResizeObserver);
  afterEach(() => {
    removeFakeResizeObserver();
    document.documentElement.style.removeProperty('--toast-bottom-offset');
    vi.restoreAllMocks();
  });

  it('puts four sections and More in the bottom bar and the rest into the drawer', async () => {
    const { user } = setup();
    const buttons = within(navigation()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Обзор', 'Смена', 'Тикеты', 'Статистика', 'Ещё']);
    expect(within(navigation()).queryByText('Журнал')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Ещё' }));
    const drawer = await screen.findByRole('dialog', { name: 'Все разделы' });
    for (const label of ['Магазин', 'Настройки', 'Состав', 'Журнал']) {
      expect(within(drawer).getByRole('button', { name: label })).toBeTruthy();
    }
    expect(within(drawer).queryByRole('button', { name: 'Обзор' })).toBeNull();
    expect(within(drawer).getByRole('heading', { name: 'Админ' })).toBeTruthy();
  });

  it('marks the active section with aria-current and switches sections from the drawer', async () => {
    const { user } = setup();
    expect(within(navigation()).getByRole('button', { name: 'Обзор' }).getAttribute('aria-current')).toBe('page');
    await user.click(within(navigation()).getByRole('button', { name: 'Тикеты' }));
    expect(within(navigation()).getByRole('button', { name: 'Тикеты' }).getAttribute('aria-current')).toBe('page');
    expect(within(navigation()).getByRole('button', { name: 'Обзор' }).getAttribute('aria-current')).toBeNull();

    await user.click(within(navigation()).getByRole('button', { name: 'Ещё' }));
    await user.click(await screen.findByRole('button', { name: 'Журнал' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Журнал');
    expect(await screen.findByText('Раздел появится в следующих версиях')).toBeTruthy();
  });

  it('shows the skeleton until the real Overview is ready, then the user from /me', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sections = SECTIONS.map((s) => (s.id === 'overview' ? { ...s, load: () => gate.then(() => s.load()) } : s));
    setup({ sections });
    expect(screen.getByRole('status', { name: 'Раздел загружается' })).toBeTruthy();
    release();
    expect(await screen.findByRole('heading', { name: 'Здравствуйте, alice' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Раздел загружается' })).toBeNull();
  });

  it('moves focus to the section heading when the section changes, and not on first render', async () => {
    const { user } = setup();
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
    await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Смена');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('has a skip link, a main landmark, and the user name with the level in the top bar', () => {
    setup();
    const skip = screen.getByRole('link', { name: 'Перейти к содержимому' });
    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(screen.getByRole('main').id).toBe('main-content');
    expect(screen.getByText('alice')).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText('Админ')).toBeTruthy();
  });

  it('shows a side bar with every section at medium and wide widths and no More button', () => {
    setup({}, 900);
    expect(within(navigation()).getAllByRole('button')).toHaveLength(15);
    expect(within(navigation()).getByRole('button', { name: 'Обзор' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'Ещё' })).toBeNull();
    resizeTo(1400);
    expect(within(navigation()).getAllByRole('button')).toHaveLength(15);
  });

  it('groups the side bar under base, Curator and Admin headings', () => {
    setup({}, 1400);
    expect(within(navigation()).getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Саппорт',
      'Куратор',
      'Админ',
    ]);
  });

  it('hides sections the user may not see', () => {
    setup({ me: { ...ME, level: 'SUPPORT' } }, 1400);
    expect(within(navigation()).getAllByRole('button')).toHaveLength(6);
  });

  it('shows only the title in compact mode and no button while the section sets no action', () => {
    setup({}, 200);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Обзор');
  });

  describe('compact mode keeps the section', () => {
    const Counter: ComponentType = () => {
      const { setCompactAction } = useShell();
      const [count, setCount] = useState(0);
      useEffect(() => {
        setCompactAction({ label: 'Главное', onSelect: () => setCount((n) => n + 10) });
        return () => setCompactAction(null);
      }, [setCompactAction]);
      return (
        <button type="button" onClick={() => setCount((n) => n + 1)}>
          count {count}
        </button>
      );
    };
    const withCounter = (): Section[] =>
      SECTIONS.map((s) => ({ ...s, load: async () => ({ default: s.id === 'shift' ? Counter : Fine }) }));
    const Fine: ComponentType = () => <p>fine</p>;

    it('drops the compact action when the section changes, even if the section forgot to', async () => {
      const Leaky: ComponentType = () => {
        const { setCompactAction } = useShell();
        useEffect(() => setCompactAction({ label: 'Утечка', onSelect: () => {} }), [setCompactAction]);
        return <p>leaky</p>;
      };
      const sections = SECTIONS.map((s) => ({ ...s, load: async () => ({ default: s.id === 'shift' ? Leaky : Fine }) }));
      const { user } = setup({ sections }, 1400);
      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      await screen.findByText('leaky');
      resizeTo(200);
      expect(screen.getByRole('button', { name: 'Утечка' })).toBeTruthy();
      resizeTo(1400);
      await user.click(within(navigation()).getByRole('button', { name: 'Тикеты' }));
      resizeTo(200);
      expect(screen.queryByRole('button', { name: 'Утечка' })).toBeNull();
    });

    it('keeps the compact action when the active section is selected again', async () => {
      const { user } = setup({ sections: withCounter() }, 1400);
      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      await screen.findByRole('button', { name: 'count 0' });
      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      resizeTo(200);
      expect(screen.getByRole('button', { name: 'Главное' })).toBeTruthy();
    });

    it('keeps local state and the active section from wide to compact and back, and shows the section action', async () => {
      const { user } = setup({ sections: withCounter() }, 1400);
      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      await user.click(await screen.findByRole('button', { name: 'count 0' }));
      expect(screen.getByRole('button', { name: 'count 1' })).toBeTruthy();

      resizeTo(200);
      expect(screen.queryByRole('navigation')).toBeNull();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Смена');
      expect(screen.queryByRole('button', { name: /count/ })).toBeNull(); // hidden, not unmounted
      await user.click(screen.getByRole('button', { name: 'Главное' }));

      resizeTo(1400);
      expect(within(navigation()).getByRole('button', { name: 'Смена' }).getAttribute('aria-current')).toBe('page');
      expect(screen.getByRole('button', { name: 'count 11' })).toBeTruthy();
    });
  });

  it('focuses the new section heading after a choice in the drawer, and returns to More on Escape', async () => {
    const { user } = setup();
    const more = () => within(navigation()).getByRole('button', { name: 'Ещё' });
    await user.click(more());
    await user.click(await screen.findByRole('button', { name: 'Журнал' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Журнал' }));

    await user.click(more());
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(more());

    // Choosing the section that is already open also lands on its heading.
    await user.click(more());
    await user.click(await screen.findByRole('button', { name: 'Журнал' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('loads a section once and shows no skeleton when returning to it', async () => {
    const load = vi.fn(async () => ({ default: () => <p>fine</p> }));
    const list = SECTIONS.map((s) => (s.id === 'shift' ? { ...s, load } : s));
    const { user } = setup({ sections: list });
    await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
    expect(await screen.findByText('fine')).toBeTruthy();
    await user.click(within(navigation()).getByRole('button', { name: 'Тикеты' }));
    await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
    expect(screen.getByText('fine')).toBeTruthy(); // synchronously, no skeleton
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('makes main focusable for the skip link and gives the user name no tab stop', () => {
    setup();
    expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1');
    const name = screen.getByText('alice');
    expect(name.getAttribute('tabindex')).toBeNull();
    expect(name.getAttribute('title')).toBe('alice');
  });

  it('goes compact while Discord reports the PIP mode', () => {
    let push: (mode: number) => void = () => {};
    const unsubscribe = vi.fn();
    const onLayoutMode = vi.fn((cb: (mode: number) => void) => {
      push = cb;
      return unsubscribe;
    });
    const { unmount } = setup({ onLayoutMode }, 1400);
    expect(screen.getByRole('navigation')).toBeTruthy();
    act(() => push(1));
    expect(screen.queryByRole('navigation')).toBeNull();
    act(() => push(2));
    expect(screen.getByRole('navigation')).toBeTruthy();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('lifts toasts above the bottom bar only while the bar is shown', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(64);
    setup();
    expect(document.documentElement.style.getPropertyValue('--toast-bottom-offset')).toBe('64px');
    resizeTo(1400);
    expect(document.documentElement.style.getPropertyValue('--toast-bottom-offset')).toBe('');
  });

  describe('section failures', () => {
    const Broken: ComponentType = () => {
      throw new Error('render failed');
    };
    const Fine: ComponentType = () => <p>fine</p>;

    const sectionsWith = (load: Section['load']): Section[] =>
      SECTIONS.map((s) => ({ ...s, load: s.id === 'shift' ? load : async () => ({ default: Fine }) }));

    beforeEach(() => {
      // React logs caught render errors; they are expected here.
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('shows an ErrorState for a render error, keeps navigation working and retries', async () => {
      let attempt = 0;
      const load = vi.fn(async () => ({ default: ++attempt === 1 ? Broken : Fine }));
      const { user } = setup({ sections: sectionsWith(load) });
      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Не удалось показать раздел');

      await user.click(within(navigation()).getByRole('button', { name: 'Тикеты' }));
      expect(await screen.findByText('fine')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();

      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      expect(await screen.findByText('fine')).toBeTruthy();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('shows an ErrorState when load fails and loads again on retry', async () => {
      let attempt = 0;
      const load = vi.fn(async () => {
        if (++attempt === 1) throw new Error('chunk failed');
        return { default: Fine };
      });
      const { user } = setup({ sections: sectionsWith(load) });
      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Не удалось показать раздел');
      await user.click(screen.getByRole('button', { name: 'Повторить' }));
      expect(await screen.findByText('fine')).toBeTruthy();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('reports an auth error to the gate', async () => {
      const load = vi.fn(async () => {
        throw new ApiError('TOKEN_EXPIRED', 'expired', 401);
      });
      const { user, reportAuthFailure } = setup({ sections: sectionsWith(load) });
      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      await waitFor(() => expect(reportAuthFailure).toHaveBeenCalledTimes(1));
      expect(reportAuthFailure.mock.calls[0]?.[0]).toBeInstanceOf(ApiError);
    });

    it('retries the sign-in, not the section, for an auth error that stays on screen', async () => {
      const load = vi.fn(async () => {
        throw new ApiError('UNAUTHORIZED', 'no', 401);
      });
      const { user, onRetryAuth } = setup({ sections: sectionsWith(load), reportAuthFailure: () => {} });
      await user.click(within(navigation()).getByRole('button', { name: 'Смена' }));
      await user.click(await screen.findByRole('button', { name: 'Повторить' }));
      expect(onRetryAuth).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledTimes(1);
    });
  });
});
