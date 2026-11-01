import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@crystalaid/contracts';
import { createTranslator } from '@crystalaid/i18n';
import { ShellContext } from '../shell/context.js';
import Settings from './Settings.js';

const ME: MeResponse = {
  user: { id: 'u1', discordId: '123456789012345678', username: 'alice', avatar: null },
  level: 'SUPPORT',
  position: null,
  status: 'active',
  tokenBalance: 0,
  permissions: [],
};

function show() {
  const setLocale = vi.fn();
  render(
    <ShellContext.Provider
      value={{ me: ME, t: createTranslator('ru'), locale: 'ru', setLocale, setCompactAction: () => {} }}
    >
      <Settings />
    </ShellContext.Provider>,
  );
  return { setLocale, user: userEvent.setup() };
}

describe('Settings', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('saves the chosen language and applies it', async () => {
    const { user, setLocale } = show();
    await user.click(screen.getByRole('combobox', { name: 'Язык' }));
    await user.click(await screen.findByRole('option', { name: 'English' }));
    expect(localStorage.getItem('crystalaid.locale')).toBe('en');
    expect(setLocale).toHaveBeenCalledWith('en');
  });

  it('moves aria-pressed to the chosen theme', async () => {
    document.documentElement.dataset.theme = 'indigo';
    const { user } = show();
    const crystal = screen.getByRole('button', { name: 'Кристалл' });
    const indigo = screen.getByRole('button', { name: 'Индиго' });
    expect(crystal.getAttribute('aria-pressed')).toBe('false');
    await user.click(crystal);
    expect(crystal.getAttribute('aria-pressed')).toBe('true');
    expect(indigo.getAttribute('aria-pressed')).toBe('false');
  });

  it('lists all six themes and lets only Crystal be chosen', async () => {
    document.documentElement.dataset.theme = 'indigo';
    const { user } = show();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);

    const locked = ['Индиго', 'Янтарь', 'Изумруд', 'Графит', 'Малина'];
    for (const name of locked) {
      const button = within(list).getByRole('button', { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBeTruthy();
    }
    expect(within(list).getAllByText('Откроется в магазине')).toHaveLength(5);

    await user.click(within(list).getByRole('button', { name: 'Индиго' }));
    expect(document.documentElement.dataset.theme).toBe('indigo');

    await user.click(within(list).getByRole('button', { name: 'Кристалл' }));
    expect(document.documentElement.dataset.theme).toBe('crystal');
    expect(localStorage.getItem('crystalaid.theme')).toBe('crystal');
  });
});
