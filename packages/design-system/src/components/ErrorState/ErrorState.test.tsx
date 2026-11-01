import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { ErrorState } from './ErrorState.js';

describe('ErrorState', () => {
  it('announces the error and calls onRetry', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Failed" description="Try again" onRetry={onRetry} retryLabel="Retry" />);
    expect(screen.getByRole('alert').textContent).toContain('Failed');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('hides the retry button without onRetry', () => {
    render(<ErrorState title="Failed" retryLabel="Retry" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has no a11y violations', async () => {
    const { container } = render(
      <ErrorState title="Failed" description="d" onRetry={() => {}} retryLabel="Retry" />,
    );
    await expectNoA11yViolations(container);
  });
});
