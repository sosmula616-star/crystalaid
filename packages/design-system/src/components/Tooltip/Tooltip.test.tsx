import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Tooltip, TooltipProvider } from './Tooltip.js';

function setup() {
  render(
    <Tooltip content="More info">
      <button type="button">Trigger</button>
    </Tooltip>,
  );
}

describe('Tooltip', () => {
  it('has no a11y violations when open', async () => {
    setup();
    await userEvent.tab();
    await screen.findByRole('tooltip');
    await expectNoA11yViolations(document.body);
  });

  it('works under a shared TooltipProvider', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="Shared">
          <button type="button">Trigger</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.tab();
    expect((await screen.findByRole('tooltip')).textContent).toBe('Shared');
  });

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
