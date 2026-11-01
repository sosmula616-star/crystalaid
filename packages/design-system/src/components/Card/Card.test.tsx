import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Card } from './Card.js';

describe('Card', () => {
  it('renders children and passes attributes through', () => {
    render(<Card data-testid="card" className="extra">Body</Card>);
    const card = screen.getByTestId('card');
    expect(card.textContent).toBe('Body');
    expect(card.className).toContain('extra');
  });

  it('has no a11y violations', async () => {
    const { container } = render(<Card>Body</Card>);
    await expectNoA11yViolations(container);
  });
});
