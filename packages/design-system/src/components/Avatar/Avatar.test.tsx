import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Avatar, initialsOf } from './Avatar.js';

describe('initialsOf', () => {
  it('takes up to two initials', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('  grace  brewster  hopper ')).toBe('GB');
    expect(initialsOf('Madonna')).toBe('M');
    expect(initialsOf('')).toBe('?');
  });
});

describe('Avatar', () => {
  it('shows initials without src', () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByRole('img', { name: 'Ada Lovelace' }).textContent).toBe('AL');
  });

  it('shows the image when src is given', () => {
    render(<Avatar name="Ada Lovelace" src="/a.png" />);
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/a.png');
  });

  it('falls back to initials when the image fails', () => {
    render(<Avatar name="Ada Lovelace" src="/broken.png" />);
    fireEvent.error(document.querySelector('img')!);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Ada Lovelace' }).textContent).toBe('AL');
  });

  it('retries when src changes after an error', () => {
    const { rerender } = render(<Avatar name="Ada" src="/broken.png" />);
    fireEvent.error(document.querySelector('img')!);
    rerender(<Avatar name="Ada" src="/ok.png" />);
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/ok.png');
  });

  it('is hidden from assistive tech when the name is empty', () => {
    const { container } = render(<Avatar name="" />);
    const el = container.firstElementChild!;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('aria-label')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
  });

  it('has no a11y violations', async () => {
    const { container } = render(<><Avatar name="Ada Lovelace" /><Avatar name="Bo" src="/b.png" /></>);
    await expectNoA11yViolations(container);
  });
});
