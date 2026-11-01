import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Dropdown } from './Dropdown.js';

function setup() {
  const onFirst = vi.fn();
  const onSecond = vi.fn();
  const onThird = vi.fn();
  render(
    <Dropdown
      trigger={<button type="button">Actions</button>}
      items={[
        { id: 'a', label: 'Edit', onSelect: onFirst },
        { id: 'b', label: 'Archive', onSelect: onSecond, disabled: true },
        { id: 'c', label: 'Delete', onSelect: onThird },
      ]}
    />,
  );
  return { onFirst, onSecond, onThird };
}

describe('Dropdown', () => {
  it('opens with Enter, moves with arrows (skipping disabled) and selects with Enter', async () => {
    const { onThird, onSecond } = setup();
    screen.getByRole('button', { name: 'Actions' }).focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    expect(onThird).toHaveBeenCalledOnce();
    expect(onSecond).not.toHaveBeenCalled();
  });

  it('never focuses a disabled item while moving through the menu', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await screen.findByRole('menu');
    const disabled = screen.getByRole('menuitem', { name: 'Archive' });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    for (const key of ['{ArrowDown}', '{ArrowDown}', '{ArrowDown}', '{ArrowUp}', '{ArrowUp}', '{ArrowUp}']) {
      await userEvent.keyboard(key);
      expect(document.activeElement).not.toBe(disabled);
    }
  });

  it('selects by click and closes', async () => {
    const { onFirst } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(onFirst).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await userEvent.click(trigger);
    await screen.findByRole('menu');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('has no a11y violations when open', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await screen.findByRole('menu');
    await expectNoA11yViolations(document.body);
  });
});
