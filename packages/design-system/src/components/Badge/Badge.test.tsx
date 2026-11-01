import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge tone="success">Online</Badge>);
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('has no a11y violations for every tone', async () => {
    const { container } = render(
      <>
        {(['neutral', 'primary', 'success', 'warning', 'danger'] as const).map((tone) => (
          <Badge key={tone} tone={tone}>{tone}</Badge>
        ))}
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
