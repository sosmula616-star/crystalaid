import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Input } from './Input.js';

describe('Input', () => {
  it('labels the field and links hint through aria-describedby', () => {
    render(<Input label="Name" hint="Shown to staff" />);
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    const hint = screen.getByText('Shown to staff');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('marks the field invalid and links the error text', () => {
    render(<Input label="Name" hint="Shown to staff" error="Required" />);
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toContain(screen.getByText('Required').id);
    expect(ids).toContain(screen.getByText('Shown to staff').id);
  });

  it('announces the error text as an alert', () => {
    render(<Input label="Name" error="Required" />);
    expect(screen.getByRole('alert').textContent).toBe('Required');
  });

  it('hides the label visually but keeps the accessible name', () => {
    render(<Input label="Search" hideLabel />);
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
    expect(screen.getByText('Search').className).toMatch(/srOnly/);
  });

  it('forwards onChange and ref', async () => {
    const onChange = vi.fn();
    const ref = { current: null as HTMLInputElement | null };
    render(<Input label="Name" ref={ref} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Name'), 'ab');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(ref.current).toBe(screen.getByLabelText('Name'));
  });

  it('has no a11y violations', async () => {
    const { container } = render(<Input label="Name" error="Required" />);
    await expectNoA11yViolations(container);
  });
});
