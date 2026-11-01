import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { StatCard } from './StatCard.js';

describe('StatCard', () => {
  it('shows label, value and hint', () => {
    render(<StatCard label="Members" value="128" hint="+4 this week" />);
    expect(screen.getByText('Members')).toBeTruthy();
    expect(screen.getByText('128')).toBeTruthy();
    expect(screen.getByText('+4 this week')).toBeTruthy();
  });

  it('omits the hint when absent', () => {
    render(<StatCard label="Members" value={5} />);
    expect(screen.queryByText(/week/)).toBeNull();
  });

  it('has no a11y violations', async () => {
    const { container } = render(<StatCard label="Members" value="128" hint="+4" />);
    await expectNoA11yViolations(container);
  });
});
