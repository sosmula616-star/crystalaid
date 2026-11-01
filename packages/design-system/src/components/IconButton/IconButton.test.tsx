import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { IconButton } from './IconButton.js';

const icon = <svg aria-hidden="true" />;

describe('IconButton', () => {
  it('is named by its label', () => {
    render(<IconButton label="Close">{icon}</IconButton>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('calls onClick and is blocked when disabled', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<IconButton label="Close" onClick={onClick}>{icon}</IconButton>);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<IconButton label="Close" disabled onClick={onClick}>{icon}</IconButton>);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('has no a11y violations', async () => {
    const { container } = render(<IconButton label="Close">{icon}</IconButton>);
    await expectNoA11yViolations(container);
  });
});
