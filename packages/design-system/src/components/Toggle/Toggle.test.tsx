import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Toggle } from './Toggle.js';

describe('Toggle', () => {
  it('is a switch that toggles by click and Space', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Alerts" checked={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Alerts' });
    await userEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    sw.focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('reflects state and respects disabled', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Alerts" checked disabled onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Alerts' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no a11y violations', async () => {
    const { container } = render(<Toggle label="Alerts" checked onChange={() => {}} />);
    await expectNoA11yViolations(container);
  });
});
