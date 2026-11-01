import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Checkbox } from './Checkbox.js';

describe('Checkbox', () => {
  it('toggles by click and Space', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Agree" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Agree' });
    await userEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
    box.focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('toggles when the label is clicked', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Agree" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByText('Agree'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects checked and ignores input when disabled', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Agree" checked disabled onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Agree' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no a11y violations', async () => {
    const { container } = render(<Checkbox label="Agree" checked onChange={() => {}} />);
    await expectNoA11yViolations(container);
  });
});
