import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { ProgressBar } from './ProgressBar.js';

const now = () => screen.getByRole('progressbar').getAttribute('aria-valuenow');

describe('ProgressBar', () => {
  it('exposes progressbar semantics', () => {
    render(<ProgressBar value={30} max={120} label="XP" />);
    const bar = screen.getByRole('progressbar', { name: 'XP' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('120');
  });

  it('clamps values above max', () => {
    render(<ProgressBar value={500} max={100} label="XP" />);
    expect(now()).toBe('100');
  });

  it('clamps negative and non-finite values to zero', () => {
    const { rerender } = render(<ProgressBar value={-5} label="XP" />);
    expect(now()).toBe('0');
    rerender(<ProgressBar value={Number.NaN} label="XP" />);
    expect(now()).toBe('0');
  });

  it('defaults max to 100', () => {
    render(<ProgressBar value={40} label="XP" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('100');
  });

  it('has no a11y violations', async () => {
    const { container } = render(<ProgressBar value={40} label="XP" />);
    await expectNoA11yViolations(container);
  });
});
