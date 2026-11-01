import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Button } from './Button.js';

describe('Button', () => {
  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('blocks clicks and reports aria-busy while loading', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps its label while loading so the width does not change', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button').textContent).toBe('Save');
  });

  it('does not call the handler when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type button and forwards the ref', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Go</Button>);
    expect(ref.current).toBe(screen.getByRole('button'));
    expect(ref.current?.getAttribute('type')).toBe('button');
  });

  it('has no a11y violations in every variant', async () => {
    const { container } = render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="secondary" size="sm">B</Button>
        <Button variant="ghost">C</Button>
        <Button variant="danger" loading>D</Button>
        <Button disabled>E</Button>
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
