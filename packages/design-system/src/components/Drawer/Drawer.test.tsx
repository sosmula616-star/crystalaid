import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../testing.js';
import { Drawer } from './Drawer.js';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Drawer open={open} onOpenChange={setOpen} title="Settings" description="Change things">
        <button type="button">Inside</button>
      </Drawer>
    </>
  );
}

async function openIt() {
  const opener = screen.getByRole('button', { name: 'Open' });
  await userEvent.click(opener);
  await screen.findByRole('dialog');
  return opener;
}

describe('Drawer', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is named by its title and described by its description', async () => {
    render(<Harness />);
    await openIt();
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('Change things').id);
  });

  it('keeps focus inside while tabbing', async () => {
    render(<Harness />);
    await openIt();
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 5; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = await openIt();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes with the close button', async () => {
    render(<Harness />);
    await openIt();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('omits the description and aria-describedby when none is given', async () => {
    function NoDesc() {
      const [open, setOpen] = useState(true);
      return (
        <Drawer open={open} onOpenChange={setOpen} title="Settings">
          <button type="button">Inside</button>
        </Drawer>
      );
    }
    render(<NoDesc />);
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
    expect(dialog.querySelector('p')).toBeNull();
    await expectNoA11yViolations(document.body);
  });

  it('has no a11y violations when open', async () => {
    render(<Harness />);
    await openIt();
    await expectNoA11yViolations(document.body);
  });
});
