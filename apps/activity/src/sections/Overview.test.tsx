import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@crystalaid/contracts';
import { createTranslator } from '@crystalaid/i18n';
import { ShellContext } from '../shell/context.js';
import Overview from './Overview.js';

const ME: MeResponse = {
  user: { id: 'u1', discordId: '123456789012345678', username: 'Marta Voss', avatar: null },
  level: 'CURATOR',
  position: 'Старший куратор',
  status: 'active',
  tokenBalance: 1250,
  permissions: [],
};

function show(me: MeResponse) {
  return render(
    <ShellContext.Provider value={{ me, t: createTranslator('ru'), locale: 'ru', setLocale: () => {}, setCompactAction: () => {} }}>
      <Overview />
    </ShellContext.Provider>,
  );
}

describe('Overview', () => {
  it('shows the name, level, position and balance from /me', () => {
    show(ME);
    expect(screen.getByRole('heading', { name: 'Здравствуйте, Marta Voss' })).toBeTruthy();
    expect(screen.getByText('Куратор')).toBeTruthy();
    expect(screen.getByText('Старший куратор')).toBeTruthy();
    // Intl groups with a no-break space in ru.
    expect(screen.getByText(/^1\s250$/)).toBeTruthy();
  });

  it('says shifts and tickets come later and invents no numbers', () => {
    const { container } = show(ME);
    expect(screen.getByText('Смены и тикеты появятся позже')).toBeTruthy();
    const digits = (container.textContent ?? '').match(/\d+/g)?.join(' ');
    expect(digits).toBe('1 250');
  });

  it('leaves out the position card when there is none', () => {
    show({ ...ME, position: null });
    expect(screen.queryByText('Должность')).toBeNull();
  });
});
