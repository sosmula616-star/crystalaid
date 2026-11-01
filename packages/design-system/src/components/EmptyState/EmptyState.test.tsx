import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Button } from '../Button/Button.js';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('shows title, description and action', () => {
    render(<EmptyState title="Nothing here" description="Add one" action={<Button>Add</Button>} />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByText('Add one')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('works with a title only', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('has no a11y violations', async () => {
    const { container } = render(<EmptyState title="Nothing" description="Add" action={<Button>Add</Button>} />);
    await expectNoA11yViolations(container);
  });
});
