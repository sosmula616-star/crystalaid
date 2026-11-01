import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Drawer } from '../Drawer/Drawer.js';
import { Modal } from '../Modal/Modal.js';
import { Dropdown } from './Dropdown.js';

function Harness({ kind }: { kind: 'modal' | 'drawer' }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const Overlay = kind === 'modal' ? Modal : Drawer;
  return (
    <>
      <Dropdown
        trigger={<button type="button">Actions</button>}
        triggerRef={triggerRef}
        items={[{ id: 'a', label: 'Open it', onSelect: () => setOpen(true) }]}
      />
      <Overlay open={open} onOpenChange={setOpen} title="Settings" returnFocusRef={triggerRef}>
        <button type="button">Inside</button>
      </Overlay>
    </>
  );
}

describe.each(['modal', 'drawer'] as const)('Dropdown item opening a %s', (kind) => {
  it('returns focus to the dropdown trigger after Escape and frees the page', async () => {
    render(<Harness kind={kind} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open it' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  it('works from the keyboard too', async () => {
    render(<Harness kind={kind} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu');
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.pointerEvents).not.toBe('none');
  });
});
