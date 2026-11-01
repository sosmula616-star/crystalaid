import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { ToastProvider, useToast } from './Toast.js';

function Trigger({ tone, duration }: { tone?: 'success' | 'warning' | 'danger'; duration?: number }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show({ title: 'Saved', description: 'All good', tone, duration })}>
      Go
    </button>
  );
}

function setup(tone?: 'success' | 'warning' | 'danger', duration?: number) {
  return render(
    <ToastProvider>
      <Trigger tone={tone} duration={duration} />
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

  it('announces danger toasts assertively and others politely', async () => {
    const { unmount } = setup('danger');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Saved');
    });
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('assertive');
    unmount();
    setup('success');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Saved');
    });
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('closes by itself after a custom duration', async () => {
    setup('success', 50);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await screen.findByText('Saved', { selector: '[class*="title"]' });
    await waitFor(() => {
      expect(screen.queryByText('Saved', { selector: '[class*="title"]' })).toBeNull();
    });
  });

  it('closes the toast on dismiss before removing the entry', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    const title = await screen.findByText('Saved', { selector: '[class*="title"]' });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(title.isConnected).toBe(false);
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
