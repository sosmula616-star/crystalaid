import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { ToastProvider, useToast } from './Toast.js';

function Trigger({ tone }: { tone?: 'success' | 'warning' | 'danger' }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show({ title: 'Saved', description: 'All good', tone })}>
      Go
    </button>
  );
}

function setup(tone?: 'success' | 'warning' | 'danger') {
  return render(
    <ToastProvider>
      <Trigger tone={tone} />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  it('shows a message with the status role', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    // Radix announces the toast through a live region with the status role.
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Saved');
    });
    expect(screen.getByRole('status').textContent).toContain('All good');
    expect(screen.getByText('All good', { selector: '[class*="description"]' })).toBeTruthy();
  });

  it('can be dismissed with the close button', async () => {
    setup('danger');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await screen.findByText('Saved', { selector: '[class*="title"]' });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Saved', { selector: '[class*="title"]' })).toBeNull();
    });
  });

  it('throws outside a provider', () => {
    function Bad() {
      useToast();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/ToastProvider/);
  });

  it('has no a11y violations', async () => {
    const { baseElement } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await screen.findByText('Saved', { selector: '[class*="title"]' });
    await expectNoA11yViolations(baseElement);
  });
});
