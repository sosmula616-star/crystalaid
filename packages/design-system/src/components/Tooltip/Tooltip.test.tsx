import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip } from './Tooltip.js';

function setup() {
  render(
    <Tooltip content="More info">
      <button type="button">Trigger</button>
    </Tooltip>,
  );
}

describe('Tooltip', () => {
  it('shows on keyboard focus and hides on Escape', async () => {
    setup();
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.tab();
    expect((await screen.findByRole('tooltip')).textContent).toBe('More info');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('describes the trigger while open', async () => {
    setup();
    await userEvent.tab();
    await screen.findByRole('tooltip');
    expect(screen.getByRole('button', { name: 'Trigger' }).getAttribute('aria-describedby')).toBeTruthy();
  });
});
